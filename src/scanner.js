import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, stat, statfs, realpath, opendir, readFile, readlink } from 'node:fs/promises';
import { plugins } from './plugins/index.js';
import { regular, directory, smallJson, smallText, firstFile } from './plugins/shared.js';
import { VERSION } from './common.js';
import { validateConfig } from './audit.js';
import { collectDockerCandidates } from './managers.js';

const DAY=86400000;
const MAX_CANDIDATES=20000, MAX_PROJECTS=20000, MAX_DIRECTORIES=2000;
const SELF_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PSEUDO=new Set(['proc','sysfs','devtmpfs','devpts','securityfs','cgroup','cgroup2','pstore','debugfs','tracefs','configfs','mqueue','hugetlbfs','fusectl','autofs','binfmt_misc','rpc_pipefs']);
const NETWORK=new Set(['nfs','nfs4','cifs','smbfs','sshfs','fuse.sshfs','9p']);
const protectedNames=new Set(['.git','.diskroom','.npmrc','.pypirc','.netrc','credentials','credentials.json']);
const sensitiveDirectories=new Set(['.ssh','.aws','.azure','.gnupg','.kube']);
function sensitivePath(file) {const parts=file.split(path.sep);const base=path.basename(file);return protectedNames.has(base)||/^\.env(?:\.|$)/i.test(base)||/^(?:id_rsa|id_ed25519|id_dsa|id_ecdsa)(?:\.|$)/i.test(base)||/\.(?:sqlite|sqlite3|db|key|pem|p12|pfx|kdbx)$/i.test(base)||parts.some(part=>sensitiveDirectories.has(part));}
function within(file,root) { const rel=path.relative(path.resolve(root),path.resolve(file)); return rel===''||(!rel.startsWith(`..${path.sep}`)&&rel!=='..'&&!path.isAbsolute(rel)); }
function overlaps(a,b) { return within(a,b)||within(b,a); }
function fp(s) { return {dev:s.dev,ino:s.ino,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs,mode:s.mode}; }
function same(a,b) { return a && b && Object.keys(fp({})).every(k=>a[k]===b[k]); }
export function treeEntryDigest(key,s) {return createHash('sha256').update(JSON.stringify([key,fp(s)])).digest();}
const digestPart=treeEntryDigest;
function xor(into,part) {for(let i=0;i<into.length;i++)into[i]^=part[i];}
function idFor(file,category) {return createHash('sha256').update(`${file}\0${category}`).digest('hex').slice(0,20);}
function errorText(error) {return `${error.code||error.name||'ERROR'}: ${error.message}`;}
function unescapeMount(value) {return value.replace(/\\([0-7]{3})/g,(_,v)=>String.fromCharCode(parseInt(v,8)));}
async function mounts() {
  if(process.platform!=='linux')return [];
  try {return (await readFile('/proc/self/mountinfo','utf8')).trim().split('\n').map(line=>{const [head,tail]=line.split(' - '); const h=head.split(' '),t=tail.split(' ');return {root:unescapeMount(h[4]),type:t[0],source:unescapeMount(t[1]),removable:false};});}catch{return [];}
}
async function pathWithoutLinks(file) {
  let current=path.parse(path.resolve(file)).root;
  for(const part of path.resolve(file).slice(current.length).split(path.sep).filter(Boolean)) {current=path.join(current,part);const s=await lstat(current);if(s.isSymbolicLink())throw new Error(`Symbolic-link or junction path is outside the scan boundary: ${current}`);}
  return file;
}
export async function measureVolume(file) {
  const resolved=await realpath(file); const [s,fs,mountList]=await Promise.all([stat(resolved),statfs(resolved),mounts()]);
  let root=resolved;
  const match=mountList.filter(m=>within(resolved,m.root)).sort((a,b)=>b.root.length-a.root.length)[0];
  if(match)root=match.root;
  else {if(!s.isDirectory())root=path.dirname(root);while(path.dirname(root)!==root){const parent=path.dirname(root);try{if((await stat(parent)).dev!==s.dev)break;}catch{break;}root=parent;}}
  return {id:String(s.dev),root,totalBytes:Number(fs.blocks)*Number(fs.bsize),freeBytes:Number(fs.bavail)*Number(fs.bsize),type:match?.type||String(fs.type)};
}
export async function discoverVolumes() {
  let roots=[];const list=await mounts();
  if(list.length)roots=list.filter(m=>!PSEUDO.has(m.type)&&!NETWORK.has(m.type)&&m.type!=='tmpfs'&&!m.root.startsWith('/proc/')&&!m.root.startsWith('/sys/')&&!m.root.startsWith('/dev/')).map(m=>m.root);
  else if(process.platform==='win32')roots=Array.from({length:26},(_,i)=>`${String.fromCharCode(65+i)}:\\`);
  else {roots=['/'];try{for await(const e of await opendir('/Volumes'))if(e.isDirectory())roots.push(path.join('/Volumes',e.name));}catch{}}
  const found=[]; const seen=new Set();
  for(const root of roots){try{if(!await directory(root))continue;const volume=await measureVolume(root);const key=volume.root;if(!seen.has(key)){seen.add(key);found.push({...volume,label:volume.root});}}catch{}}
  return found;
}
async function projectAt(file) {
  const manifest=path.join(file,'package.json');let node=null;
  if(await regular(manifest))try{const p=await smallJson(manifest);if(p&&typeof p==='object'&&!Array.isArray(p)){const relevant=['next','nuxt','nuxt3','turbo','jest','vitest','nyc','c8'];node={dependencies:Object.fromEntries(relevant.filter(k=>p.dependencies?.[k]).map(k=>[k,true])),devDependencies:Object.fromEntries(relevant.filter(k=>p.devDependencies?.[k]).map(k=>[k,true])),scripts:{build:typeof p.scripts?.build==='string'}};}}catch{}
  const py=await firstFile(file,['pyproject.toml','requirements.txt','requirements.lock','Pipfile','setup.cfg','setup.py']);
  const jvmFile=await firstFile(file,['pom.xml','build.gradle','build.gradle.kts']);
  const git=await directory(path.join(file,'.git'))||await regular(path.join(file,'.git'));
  if(!node&&!py&&!jvmFile&&!git)return null;
  return {path:file,manifest:node?manifest:py||jvmFile||path.join(file,'.git','HEAD'),node,python:Boolean(py),jvm:jvmFile?(path.basename(jvmFile)==='pom.xml'?'maven':'gradle'):null,git,activityAt:0,logicalBytes:0,sourceHash:Buffer.alloc(32),parent:null};
}
async function ancestorProject(file) {let current=file;while(true){const project=await projectAt(current);if(project)return project;if(path.dirname(current)===current)return null;current=path.dirname(current);}}
export async function resolveScope(scope='cwd',file,cwd=process.cwd()) {
  const root=path.resolve(cwd,file||'.');await pathWithoutLinks(root);
  if(!await directory(root))throw new Error(`Scan scope must be an existing directory: ${root}`);
  if(scope==='system')return (await discoverVolumes()).map(v=>v.root);
  if(scope==='disk')return [(await measureVolume(root)).root];
  if(scope==='project')return [(await ancestorProject(root))?.path||root];
  if(scope!=='cwd')throw new Error(`Unknown scope: ${scope}`);
  return [root];
}
async function processSnapshot() {
  const refs=[];const limitations=[];let partial=false;
  if(process.platform!=='linux')return (await import('./processes.js')).nativeProcessSnapshot();
  const selfPids=new Set([String(process.pid)]);
  // /proc may expose a host PID namespace while process.pid is container-local.
  try{selfPids.add(path.basename(await readlink('/proc/self')));}catch{}
  try {
    for await(const entry of await opendir('/proc')) {
      if(!/^\d+$/.test(entry.name)||selfPids.has(entry.name))continue;
      const base=`/proc/${entry.name}`;
      let ps;try{ps=await stat(base);}catch{continue;}
      if(typeof process.getuid==='function'&&ps.uid!==process.getuid())continue;
      for(const kind of ['cwd','exe']){try{const value=(await readlink(`${base}/${kind}`)).replace(/ \(deleted\)$/,'');if(path.isAbsolute(value))refs.push({path:value,kind,pid:Number(entry.name)});}catch(e){if(!['ENOENT','ESRCH','EACCES'].includes(e.code))partial=true;if(e.code==='EACCES')partial=true;}}
      try{let count=0;for await(const fd of await opendir(`${base}/fd`)){if(++count>4096){partial=true;break;}try{const value=(await readlink(`${base}/fd/${fd.name}`)).replace(/ \(deleted\)$/,'');if(path.isAbsolute(value))refs.push({path:value,kind:'open-file',pid:Number(entry.name)});}catch{}}}catch(e){if(e.code!=='ENOENT'&&e.code!=='ESRCH')partial=true;}
      try{const memory=(await readFile(`${base}/maps`,'utf8'));if(memory.length>8388608)partial=true;else for(const line of memory.split('\n')){const match=line.match(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\/.*)$/);if(match)refs.push({path:match[1].replace(/ \(deleted\)$/,''),kind:'memory-map',pid:Number(entry.name)});}}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))partial=true;}
      // Parse only absolute arguments in memory; command lines and secrets never enter the report.
      try { const args=(await readFile(`${base}/cmdline`)).toString().split('\0');for(const arg of args.slice(1))if(path.isAbsolute(arg)&&arg.length<4096)refs.push({path:arg,kind:'process-argument',pid:Number(entry.name)}); }catch{}
      if(refs.length>100000){partial=true;break;}
    }
  }catch{partial=true;}
  if(partial)limitations.push('Some same-user process paths or open files could not be inspected; observed use is protected and absence of observed use is not proof of inactivity.');
  limitations.push('Process inspection is a point-in-time observation of same-user processes; other-user processes and future opens are not fully observable.');
  return {refs,coverage:partial?'partial':'same-user-proc',limitations};
}
/** Fresh process observation only; safe to repeat while a candidate tree is being reduced. */
export async function verifyCandidateUse(candidate) {
  const state=await processSnapshot();
  const used=state.refs.find(ref=>within(ref.path,candidate.path)||(candidate.project&&within(ref.path,candidate.project)));
  const reasons=used?[`Observed ${used.kind} in this resource or project (PID ${used.pid}); cleanup stopped.`]:[];
  if(candidate.metadata?.processCoverage==='same-user-proc'&&state.coverage!=='same-user-proc')reasons.push('Process observation became incomplete after approval; review a fresh scan.');
  return {ok:reasons.length===0,reasons,coverage:state.coverage};
}
async function evidenceSnapshot(files) {
  const entries=[];for(const file of [...new Set(files.filter(Boolean))]){try{const s=await lstat(file);if(s.isSymbolicLink()||!s.isFile())throw new Error('Evidence must be a regular file');entries.push({path:file,fingerprint:fp(s)});}catch(e){entries.push({path:file,error:errorText(e)});}}return entries;
}
function emptyTotals(){return {logicalBytes:0,allocatedBytes:0,reclaimableBytes:0,files:0,links:0,hardlinks:0,incomplete:false,hash:Buffer.alloc(32),newest:0,unsafe:[]};}
function addTotals(a,b){a.logicalBytes+=b.logicalBytes;a.allocatedBytes=a.allocatedBytes===null||b.allocatedBytes===null?null:a.allocatedBytes+b.allocatedBytes;a.reclaimableBytes=a.reclaimableBytes===null||b.reclaimableBytes===null?null:a.reclaimableBytes+b.reclaimableBytes;a.files+=b.files;a.links+=b.links;a.hardlinks+=b.hardlinks;a.incomplete||=b.incomplete;a.newest=Math.max(a.newest,b.newest);xor(a.hash,b.hash);for(const issue of b.unsafe)if(a.unsafe.length<20&&!a.unsafe.includes(issue))a.unsafe.push(issue);}
async function validateEntry(candidate,file,s,kind) {
  const rel=path.relative(candidate.path,file);const base=path.basename(file);
  if(!(rel===''&&candidate.ecosystem==='git')&&sensitivePath(file))return `Potential credentials, unique data or nested repository: ${rel||base}`;
  if(!rel)return null;
  if(candidate.validationKind==='explicit-file')return null;
  if(candidate.validationKind==='python-bytecode') {
    if(!s.isFile()||!/^.+\.(?:[\w-]+\.)?py[co]$/.test(base)||path.dirname(file)!==candidate.path)return `Unexpected bytecode-cache content: ${rel}`;
    const source=path.join(path.dirname(candidate.path),base.replace(/(?:\.cpython-\d+(?:\.opt-\d+)?|\.pypy[^.]*)?\.py[co]$/,'.py'));
    if(!await regular(source))return `Bytecode has no preserved source: ${rel}`;
    const sourceStat=await lstat(source);candidate.sourceActivity=Math.max(candidate.sourceActivity||0,sourceStat.mtimeMs);xor(candidate.sourceHash,digestPart(source,sourceStat));
  }
  if(candidate.validationKind==='pytest-cache' && !s.isDirectory() && !['README.md','.gitignore','CACHEDIR.TAG','v/cache/nodeids','v/cache/lastfailed','v/cache/stepwise'].includes(rel.split(path.sep).join('/')))return `Unexpected pytest-cache content: ${rel}`;
  if(candidate.validationKind==='jvm-classes' && !s.isDirectory()) {
    if(!s.isFile()||!base.endsWith('.class'))return `Non-class file in compiler output: ${rel}`;
    const source=path.join(candidate.sourceRoot,rel.replace(/\$[^/\\]*\.class$/,'.class').replace(/\.class$/,'.java'));
    if(!await regular(source))return `Compiled class has no preserved Java source: ${rel}`;
  }
  if(candidate.validationKind==='node-install') {
    const normalized=rel.split(path.sep).join('/');
    const membership=candidate.packageMembership;
    if(!membership)return 'Installed package membership could not be verified.';
    if(!candidate.packageMembershipIndex) {
      candidate.packageMembershipIndex=new Map(membership.map(item=>[item.path,item]));
      candidate.packageAncestorPaths=new Set();
      for(const item of membership) {const parts=item.path.split('/');for(let index=1;index<parts.length;index++)candidate.packageAncestorPaths.add(parts.slice(0,index).join('/'));}
    }
    if(normalized==='.package-lock.json'&&s.isFile())return null;
    if(normalized==='.bin')return s.isDirectory()?null:`Unexpected dependency command directory: ${rel}`;
    if(normalized.startsWith('.bin/'))return s.isSymbolicLink()&&path.dirname(rel)==='.bin'?null:`Unrecognized dependency command entry: ${rel}`;
    let member;const segments=normalized.split('/');
    for(let index=segments.length;index>0&&!member;index--)member=candidate.packageMembershipIndex.get(segments.slice(0,index).join('/'));
    const ancestor=s.isDirectory()&&candidate.packageAncestorPaths.has(normalized);
    if(!member&&!ancestor)return `Entry is absent from verified installed-package metadata: ${rel}`;
    if(member&&!ancestor&&normalized.slice(member.path.length+1).split('/').includes('node_modules'))return `Entry is absent from verified nested-package metadata: ${rel}`;
    if(member&&normalized===member.path&&((member.link&&!s.isSymbolicLink())||(!member.link&&!s.isDirectory())))return `Installed package type differs from lock metadata: ${rel}`;
    if(s.isDirectory()&&base==='node_modules'&&!ancestor)return `Unverified nested dependency installation: ${rel}`;
  }
  return null;
}

export async function scan(options={}) {
  const startedAt=new Date().toISOString();const cwd=path.resolve(options.cwd||process.cwd()),workspace=path.resolve(options.workspace||cwd);
  const config=validateConfig(options.config||{});
  const activityDays=options.activityDays??config.activityDays;
  if(!Number.isInteger(activityDays)||activityDays<1||activityDays>36500)throw new Error('Activity days must be an integer from 1 to 36500.');
  config.activityDays=activityDays;
  const requested=options.roots?.length?options.roots:[cwd]; const roots=[];
  for(const value of requested.map(p=>path.resolve(cwd,p)).sort((a,b)=>a.length-b.length)){await pathWithoutLinks(value);if(!await directory(value))throw new Error(`Scan root is not a directory: ${value}`);if(!roots.some(root=>within(value,root)))roots.push(value);}
  const volumes=[];for(const root of roots){const volume=await measureVolume(root);if(PSEUDO.has(volume.type))throw new Error(`Pseudo filesystem is not a supported disk scan scope: ${root} (${volume.type})`);volumes.push(volume);}
  if(new Set(volumes.map(v=>v.id)).size>1)throw new Error('Scan one target filesystem at a time; select separate scopes and targets for each volume.');
  const report={schemaVersion:1,kind:'scan',id:options.audit?.id||`scan-${randomUUID()}`,version:VERSION,startedAt,finishedAt:null,status:'complete',cwd,workspace,roots,targetFree:options.targetFree??null,volume:volumes[0],volumes,freeAfterBytes:null,activityDays:options.activityDays??config.activityDays??30,config,platform:process.platform,arch:process.arch,plugins:plugins.map(p=>({...p.metadata,status:'available'})),candidates:[],projects:[],issues:[],directories:[],auditPath:options.audit?.path};
  const processState=await processSnapshot();report.processCoverage=processState.coverage;report.limitations=[...processState.limitations];
  const cwdProject=await ancestorProject(cwd);const projects=new Map();const mountList=await mounts();const rootSet=new Set(roots);const excludedMounts=new Map(mountList.filter(m=>!rootSet.has(m.root)).map(m=>[m.root,m]));
  let processed=0,inventory=[],chunk=0,lastProgress=0,aborted=false;const auditRoot=path.join(workspace,'.diskroom');const notices=new Set();
  const threshold=Math.min(32*1024*1024,Math.max(1024,Math.ceil((report.targetFree??640*1024*1024)/20)));
  const issue=(code,file,message,incomplete=true)=>{if(report.issues.length<1000)report.issues.push({code,path:file,message});if(incomplete)report.status='incomplete';};
  async function flush(){if(inventory.length&&options.audit){const entries=inventory;inventory=[];await options.audit.write(`inventory-${String(++chunk).padStart(6,'0')}`,{schemaVersion:1,id:report.id,sequence:chunk,entries});}else inventory=[];}
  async function record(file,s,kind,extra={}){processed++;inventory.push({path:file,type:kind,logicalBytes:s?.size??null,fingerprint:s?fp(s):null,...extra});if(inventory.length>=256)await flush();if(Date.now()-lastProgress>150){lastProgress=Date.now();options.onProgress?.({processed,path:file,candidates:report.candidates.length,projects:projects.size});}}
  function rememberDirectory(item){report.directories.push(item);if(report.directories.length>MAX_DIRECTORIES*2){report.directories.sort((a,b)=>b.logicalBytes-a.logicalBytes);report.directories.length=MAX_DIRECTORIES;}}
  async function walk(file,parentProject,rootDev,insideCandidate=null,depth=0){
    const total=emptyTotals();if(options.signal?.aborted){aborted=true;return {...total,incomplete:true};}
    if(depth>1024){issue('DEPTH_LIMIT',file,'Directory nesting exceeded the safe traversal limit.');return {...total,incomplete:true};}
    let s;try{s=await lstat(file);}catch(e){issue('UNREADABLE',file,errorText(e));return {...total,incomplete:true};}
    if(config.exclude.some(x=>within(file,x))||file===auditRoot||path.basename(file)==='.diskroom') {await record(file,s,'excluded',{reason:file===auditRoot?'active-audit':'configured-or-audit-exclusion'});if(insideCandidate){total.incomplete=true;total.unsafe.push('Contains an excluded or audit directory.');}return total;}
    if(s.dev!==rootDev || (excludedMounts.has(file)&&!rootSet.has(file))) {const m=excludedMounts.get(file);issue('MOUNT_BOUNDARY',file,`Mounted filesystem excluded from this explicit scope${m?` (${m.type})`:''}.`,false);await record(file,s,'mount-boundary');if(insideCandidate){total.incomplete=true;total.unsafe.push('Contains an unconfirmed mounted filesystem.');}return total;}
    if(s.isSymbolicLink()){total.links=1;await record(file,s,'symlink');xor(total.hash,digestPart(file,s));if(insideCandidate){const problem=await validateEntry(insideCandidate,file,s,'symlink');if(problem)total.unsafe.push(problem);}return total;}
    if(!s.isFile()&&!s.isDirectory()){issue('SPECIAL_FILE',file,'Special filesystem entry was not opened.',false);total.unsafe.push('Special filesystem entries cannot be deleted by this operation.');await record(file,s,'special');return total;}
    let project=parentProject;let localCandidate=null;
    if(s.isDirectory()&&!insideCandidate){const found=await projectAt(file);if(found){if(projects.has(file))project=projects.get(file);else if(projects.size<MAX_PROJECTS){found.parent=parentProject?.path||null;projects.set(file,found);project=found;}else{issue('PROJECT_LIMIT',file,'Project summary limit reached; inventory continues but unclassified candidates are not executable.');project=null;}}}
    if(!insideCandidate){for(const plugin of plugins){if((s.isFile()&& !['docker','large-files',...(path.basename(file)==='.git'?['git']:[])].includes(plugin.metadata.id))||(s.isDirectory()&&plugin.metadata.id==='large-files'))continue;try{const hit=await plugin.detect({file,name:path.basename(file),stat:s,project,largeThreshold:threshold});if(hit){localCandidate={...hit,path:file,project:hit.project||project?.path||null,plugin:plugin.metadata.id,fingerprint:fp(s),sourceHash:Buffer.alloc(32),sourceActivity:0};break;}}catch(e){issue('DETECTOR_FAILED',file,`${plugin.metadata.id}: ${errorText(e)}`);report.plugins.find(p=>p.id===plugin.metadata.id).status='partial';}}
    }
    const owner=insideCandidate||localCandidate;
    if(owner){const problem=await validateEntry(owner,file,s,s.isDirectory()?'directory':'file');if(problem)total.unsafe.push(problem);}
    await record(file,s,s.isDirectory()?'directory':'file',localCandidate?{category:localCandidate.category,ecosystem:localCandidate.ecosystem}:{});
    xor(total.hash,digestPart(file,s));
    if(s.isFile()){
      total.files=1;total.logicalBytes=s.size;total.allocatedBytes=process.platform!=='win32'&&typeof s.blocks==='number'&&Number.isFinite(s.blocks)?s.blocks*512:null;total.hardlinks=s.nlink>1?1:0;total.reclaimableBytes=s.nlink>1?0:total.allocatedBytes;total.newest=s.mtimeMs;
      const gitActivity=owner?.ecosystem==='git'&&/^(?:HEAD|index|packed-refs|logs\/HEAD|refs\/heads\/.+|logs\/refs\/heads\/.+)$/.test(path.relative(owner.path,file).split(path.sep).join('/'));
      if(project&&(!owner||owner.validationKind==='explicit-file'||gitActivity)){project.activityAt=Math.max(project.activityAt,s.mtimeMs);xor(project.sourceHash,digestPart(file,s));}
    } else {
      try {for await(const entry of await opendir(file)){const child=await walk(path.join(file,entry.name),project,rootDev,owner,depth+1);addTotals(total,child);if(aborted)break;}}catch(e){issue('UNREADABLE_DIRECTORY',file,errorText(e));total.incomplete=true;}
      if(project?.path===file){project.logicalBytes=total.logicalBytes;if(parentProject){parentProject.activityAt=Math.max(parentProject.activityAt,project.activityAt);xor(parentProject.sourceHash,project.sourceHash);}}
      if(!insideCandidate)rememberDirectory({path:file,project:project?.path||null,logicalBytes:total.logicalBytes,allocatedBytes:total.allocatedBytes,files:total.files,incomplete:total.incomplete});
    }
    if(localCandidate){
      if(report.candidates.length<MAX_CANDIDATES){localCandidate.total=total;localCandidate.evidence=await evidenceSnapshot(localCandidate.evidencePaths||[]);report.candidates.push(localCandidate);}else if(!notices.has('candidate-limit')){notices.add('candidate-limit');issue('CANDIDATE_LIMIT',file,'Candidate summary limit reached; full file inventory continues, omitted candidates cannot be selected.');}
    }
    return total;
  }
  for(const root of roots){let parent=await ancestorProject(path.dirname(root));if(parent&&!within(root,parent.path))parent=null;if(parent){if(projects.has(parent.path))parent=projects.get(parent.path);else projects.set(parent.path,parent);}const rootStat=await lstat(root);await walk(root,parent,rootStat.dev);if(aborted)break;}
  await flush();
  const now=Date.now();
  report.candidates=report.candidates.map(c=>{
    const p=projects.get(c.project),total=c.total,protection=[...(c.metadata?.runtimeProtection||[])],reasons=[...c.reasons],risks=[...c.risks];
    const archived=config.archived.some(x=>c.project&&within(c.project,x));
    const activeAt=Math.max(p?.activityAt||0,c.sourceActivity||0)||(total.newest||0);
    const recent=activeAt>now-report.activityDays*DAY;
    if(config.protect.some(x=>overlaps(c.path,x)||(c.project&&within(c.project,x))))protection.push('Explicitly protected in workspace configuration.');
    if(c.project===cwd||(cwdProject&&(c.project===cwdProject.path||within(cwd,c.path))))protection.push('The project from which DiskRoom was launched is protected.');
    if(within(cwd,c.path)||within(auditRoot,c.path))protection.push('Contains the current working directory or active audit.');
    if(overlaps(c.path,SELF_ROOT)||within(process.execPath,c.path)||c.path===process.execPath)protection.push('Contains DiskRoom or its running Node.js runtime.');
    const used=processState.refs.find(ref=>within(ref.path,c.path)||(c.project&&within(ref.path,c.project)));
    if(used)protection.push(`Observed ${used.kind} in this resource or project (PID ${used.pid}).`);
    if(total.incomplete)protection.push('The candidate subtree could not be completely inspected.');
    if(c.evidence.some(e=>e.error))protection.push('Restoration evidence could not be verified.');
    if(total.unsafe.length)protection.push(...total.unsafe);
    if(c.installMarker){const marker=c.evidence.find(e=>e.path===c.installMarker);if(marker?.fingerprint&&total.newest>marker.fingerprint.mtimeMs+5000){reasons.push('Files changed after the installation metadata; local edits or incremental installation are possible.');c.score=Math.min(c.score,60);}}
    if(recent&&!archived&&c.operation!=='detect-only')protection.push(`Recent source or manifest activity within ${report.activityDays} days; mark the project archived only after review.`);
    if(archived)reasons.push('The project is explicitly marked archived; recent-activity soft protection is waived, hard protections remain.');
    if(!activeAt)reasons.push('No reliable project activity timestamp is available.');
    if(total.hardlinks)risks.push(`${total.hardlinks} hardlinked file(s): their shared allocation is excluded from the reclaim estimate.`);
    if(total.links)reasons.push(`${total.links} symbolic link(s) are counted as links only; targets are never traversed or removed.`);
    const score=c.score;let status=protection.length?'protected':c.operation==='detect-only'?'review':score>=80&&!recent&&processState.coverage==='same-user-proc'?'recommended':'review';
    if(!protection.length&&archived&&score>=80&&processState.coverage==='same-user-proc')status='recommended';
    if(c.category==='unclassified-large-file'||c.category==='log-or-dump')status=protection.length?'protected':'review';
    return {id:idFor(c.path,c.category),path:c.path,project:c.project,ecosystem:c.ecosystem,category:c.category,operation:c.operation,status,logicalBytes:total.logicalBytes,allocatedBytes:total.allocatedBytes,reclaimableBytes:c.operation==='detect-only'||c.metadata?.managerAction?null:total.reclaimableBytes,safety:{score,confidence:c.confidence,reasons:[...c.reasons,...(total.unsafe.length?['Unexpected content prevents removal.']:[])]},need:{score:protection.length?100:recent&&!archived?85:archived?10:activeAt?20:null,confidence:processState.coverage==='same-user-proc'?'medium':'low',reasons:[activeAt?`Latest observed project-source activity: ${new Date(activeAt).toISOString()}`:'Activity unknown.',...protection,...(!protection.length?[`Process observation: ${processState.coverage}.`]:[])]},reasons,restore:c.restore,risks,protection,fingerprint:c.fingerprint,activityAt:activeAt?new Date(activeAt).toISOString():null,manager:c.manager,metadata:{...c.metadata,plugin:c.plugin,validationKind:c.validationKind,treeDigest:total.hash.toString('hex'),projectDigest:p?.sourceHash.toString('hex')||null,restorationDigest:c.sourceHash.toString('hex'),evidence:c.evidence,files:total.files,symlinks:total.links,hardlinks:total.hardlinks,volumeId:report.volume.id,processCoverage:processState.coverage}};
  });
  if(!aborted) {
    const managed=await collectDockerCandidates({roots:report.roots,volume:report.volume,storageRoots:report.candidates.filter(candidate=>candidate.ecosystem==='docker'&&candidate.category==='docker-storage').map(candidate=>candidate.path),signal:options.signal,config,cwd,workspace});
    const dockerPlugin=report.plugins.find(plugin=>plugin.id==='docker');
    dockerPlugin.coverage=managed.coverage;dockerPlugin.limitations=[...(managed.limitations||[]),...(managed.issues||[]).map(item=>item.message)];
    if(managed.candidates.length)report.candidates.push(...managed.candidates);
    if(managed.issues?.length&&report.candidates.some(candidate=>candidate.ecosystem==='docker'))report.issues.push(...managed.issues);
  }
  report.projects=[...projects.values()].map(p=>({path:p.path,ecosystems:[p.node?'node':null,p.python?'python':null,p.jvm?'jvm':null,p.git?'git':null].filter(Boolean),activityAt:p.activityAt?new Date(p.activityAt).toISOString():null,logicalBytes:p.logicalBytes,sourceDigest:p.sourceHash.toString('hex'),parent:p.parent}));
  report.directories.sort((a,b)=>b.logicalBytes-a.logicalBytes);report.directories.length=Math.min(report.directories.length,MAX_DIRECTORIES);
  report.inventory={processed,parts:chunk,summaryDirectoryLimit:MAX_DIRECTORIES,summaryCandidateLimit:MAX_CANDIDATES,detail:options.audit?'chunked-audit':'in-memory-summary-only'};
  if(aborted)report.status='cancelled';
  try{report.freeAfterBytes=(await measureVolume(roots[0])).freeBytes;}catch(e){issue('VOLUME_UNAVAILABLE',roots[0],errorText(e));}
  report.finishedAt=new Date().toISOString();options.onProgress?.({processed,candidates:report.candidates.length,projects:projects.size,done:true});
  return report;
}

export async function revalidateCandidate(candidate,report) {
  const reasons=[];
  if(!candidate||!report||report.schemaVersion!==1||report.kind!=='scan')return {ok:false,reasons:['Unsupported scan or candidate.']};
  if(candidate.operation==='detect-only'||candidate.status==='protected')return {ok:false,reasons:['The recorded candidate is not executable.']};
  if(!Array.isArray(report.roots)||!report.roots.some(root=>within(candidate.path,root)))return {ok:false,reasons:['Candidate is outside the recorded scan scope.']};
  if(candidate.metadata?.managerAction) {
    let detected=candidate;
    if(candidate.operation==='git-gc') {
      const use=await verifyCandidateUse(candidate);if(!use.ok)return use;
      // Git maintenance is still subject to source activity, launch context and current configured protection.
      const fresh=await scan({roots:report.roots,cwd:report.cwd,workspace:report.workspace,targetFree:report.targetFree,activityDays:report.activityDays,config:report.config});
      const next=fresh.candidates.find(item=>item.id===candidate.id&&item.path===candidate.path);
      if(!next||next.status==='protected')return {ok:false,reasons:next?.protection||['Git candidate is no longer recognized.']};
      if(next.operation!==candidate.operation||next.metadata.treeDigest!==candidate.metadata.treeDigest||next.metadata.projectDigest!==candidate.metadata.projectDigest)return {ok:false,reasons:['Git storage or project contents changed after approval.']};
      detected=next;
    }
    const validated=await (await import('./managers.js')).revalidateManagerCandidate(candidate,report);
    return validated.ok&&candidate.operation==='git-gc'?{...validated,candidate:detected}:validated;
  }
  try {
    await pathWithoutLinks(candidate.path);const current=await lstat(candidate.path);
    if(!same(candidate.fingerprint,fp(current)))return {ok:false,reasons:['Candidate identity or metadata changed after the scan.']};
    const originalRoot=report.roots.filter(root=>within(candidate.path,root)).sort((a,b)=>b.length-a.length)[0];
    const validationRoot=candidate.project&&within(candidate.project,originalRoot)?candidate.project:originalRoot;
    const fresh=await scan({roots:[validationRoot],cwd:report.cwd,workspace:report.workspace,targetFree:report.targetFree,activityDays:report.activityDays,config:report.config});
    const next=fresh.candidates.find(c=>c.id===candidate.id&&c.path===candidate.path);
    if(!next)return {ok:false,reasons:['Fresh detection no longer recognizes this candidate.']};
    if(next.operation!==candidate.operation||next.category!==candidate.category)reasons.push('Fresh classification changed.');
    if(next.status==='protected')reasons.push(...next.protection);
    if(candidate.metadata?.treeDigest!==next.metadata.treeDigest)reasons.push('Candidate contents changed after the scan.');
    if(candidate.metadata?.restorationDigest!==next.metadata.restorationDigest)reasons.push('Preserved restoration source files changed after the scan.');
    if(candidate.metadata?.projectDigest!==next.metadata.projectDigest)reasons.push('Project sources or metadata changed after the scan.');
    if(JSON.stringify(candidate.metadata?.evidence)!==JSON.stringify(next.metadata.evidence))reasons.push('Restoration evidence changed after the scan.');
    if(next.safety.score<candidate.safety.score)reasons.push('Restoration confidence decreased after the scan.');
    return {ok:reasons.length===0,reasons,candidate:next};
  }catch(e){return {ok:false,reasons:[`Fresh validation failed: ${errorText(e)}`]};}
}
