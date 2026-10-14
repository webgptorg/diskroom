import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readdir, lstat, utimes, rm, symlink, link, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { scan, revalidateCandidate, resolveScope, measureVolume, discoverVolumes } from '../src/scanner.js';
const old=new Date(Date.now()-200*86400000);
async function put(root,relative,contents='fixture'){const file=path.join(root,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,contents);return file;}
async function age(root){for(const e of await readdir(root,{withFileTypes:true})){const file=path.join(root,e.name);if(e.isDirectory())await age(file);if(!e.isSymbolicLink())await utimes(file,old,old);}await utimes(root,old,old);}
async function fixture(t){const base=await realpath(await mkdtemp(path.join(os.tmpdir(),'diskroom-scanner-')));t.after(()=>rm(base,{recursive:true,force:true}));return base;}
const registryRecord={version:'1.0.0',resolved:'https://registry.npmjs.org/example/-/example-1.0.0.tgz',integrity:'sha512-Zml4dHVyZQ=='};
async function nodeProject(base,name='old-project'){
 const root=path.join(base,name);await put(root,'package.json',JSON.stringify({name:'example',dependencies:{example:'1.0.0'}}));await put(root,'package-lock.json',JSON.stringify({lockfileVersion:3,packages:{'':{name:'example'},'node_modules/example':registryRecord}}));await put(root,'node_modules/.package-lock.json',JSON.stringify({lockfileVersion:3,packages:{'node_modules/example':registryRecord}}));await put(root,'node_modules/example/package.json',JSON.stringify({name:'example',version:'1.0.0'}));await put(root,'node_modules/example/index.js','export default 42;');await put(root,'src/index.js','export default 1;');await age(root);return root;
}
function options(base,roots){return {roots:Array.isArray(roots)?roots:[roots],cwd:base,workspace:base};}

test('all seven plugin families report real contextual findings without deleting files',async t=>{
 const base=await fixture(t);const root=await nodeProject(base);await put(base,'py/pyproject.toml','[project]\nname="example"');await put(base,'py/main.py','print(1)');await put(base,'py/__pycache__/main.cpython-311.pyc','bytecode');await put(base,'java/pom.xml','<project/>');await put(base,'java/src/main/java/App.java','class App {}');await put(base,'java/target/classes/App.class','class');await put(base,'.nvm/versions/node/v20.0.0/bin/node','runtime');await put(base,'repo/.git/HEAD','ref: refs/heads/main');await mkdir(path.join(base,'repo/.git/objects'),{recursive:true});await mkdir(path.join(base,'docker/containers'),{recursive:true});await put(base,'large.log','x'.repeat(4096));await age(base);
 const report=await scan({...options(base,base),targetFree:1024});assert.equal(report.status,'complete');assert.deepEqual(new Set(report.candidates.map(c=>c.ecosystem)),new Set(['node','python','jvm','runtime','git','docker','large-files']));
 assert.equal(report.candidates.find(c=>c.ecosystem==='node').operation,'delete-tree');assert.equal(report.candidates.find(c=>c.ecosystem==='python').operation,'delete-tree');assert.equal(report.candidates.find(c=>c.ecosystem==='jvm').operation,'delete-tree');
 for(const family of ['runtime','git','docker'])assert.equal(report.candidates.find(c=>c.ecosystem===family).operation,'detect-only');
 assert.equal((await lstat(path.join(root,'node_modules/example/index.js'))).isFile(),true);assert.equal(report.plugins.length,7);assert.ok(report.volume.freeBytes>0);
});

test('cwd project is protected even in broader scan and archival does not bypass it',async t=>{
 const base=await fixture(t),root=await nodeProject(base);const report=await scan({roots:[base],cwd:root,workspace:base,config:{archived:[root]}});const c=report.candidates.find(c=>c.category==='installed-dependencies');assert.equal(c.status,'protected');assert.match(c.protection.join(' '),/launched/);
});

test('fresh source activity protects old dependencies; explicit archive only waives activity',async t=>{
 const base=await fixture(t),root=await nodeProject(base);await writeFile(path.join(root,'src/index.js'),'export default 2;');let report=await scan(options(base,root));assert.equal(report.candidates[0].status,'protected');assert.match(report.candidates[0].protection.join(' '),/Recent/);
 report=await scan({...options(base,root),config:{archived:[root]}});assert.notEqual(report.candidates[0].status,'protected');
 report=await scan({...options(base,root),config:{archived:[root],protect:[root]}});assert.equal(report.candidates[0].status,'protected');
});

test('names alone never make installations, virtual environments or JVM artifacts disposable',async t=>{
 const base=await fixture(t);await put(base,'fake/node_modules/source.js','unique');await put(base,'fake/.venv/important.txt','unique');await put(base,'fake/target/classes/App.class','unique');await age(base);const report=await scan(options(base,base));assert.equal(report.candidates.length,0);
});

test('bytecode and JVM validation protects missing sources and unexpected unique data',async t=>{
 const base=await fixture(t);await put(base,'py/pyproject.toml','[project]');await put(base,'py/__pycache__/missing.cpython-311.pyc','unique bytecode');await put(base,'java/pom.xml','<project/>');await put(base,'java/src/main/java/App.java','class App {}');await put(base,'java/target/classes/App.class','class');await put(base,'java/target/classes/unique.txt','important');await age(base);const report=await scan(options(base,base));for(const c of report.candidates){assert.equal(c.status,'protected');assert.match(c.protection.join(' '),/preserved source|Non-class/);}
});

test('links never expand scan scope and hardlinked content has no promised reclaim',async t=>{
 const base=await fixture(t),root=await nodeProject(base);await put(base,'outside/keep.js','important');await mkdir(path.join(root,'node_modules/.bin'));await symlink(path.join(base,'outside','keep.js'),path.join(root,'node_modules/.bin/tool'),'file');await link(path.join(root,'node_modules/example/index.js'),path.join(base,'shared.js'));await age(root);const report=await scan(options(base,root));const c=report.candidates[0];assert.equal(c.metadata.symlinks,1);assert.equal(c.metadata.hardlinks,1);if(c.allocatedBytes===null)assert.equal(c.reclaimableBytes,null);else assert.ok(c.allocatedBytes>c.reclaimableBytes);assert.equal(report.candidates.some(c=>c.path.includes('keep.js')),false);assert.equal((await revalidateCandidate(c,report)).ok,true);
});

test('revalidation refuses candidate content, project source and restoration evidence changes',async t=>{
 const base=await fixture(t),root=await nodeProject(base);let report=await scan(options(base,root)),candidate=report.candidates[0];assert.equal((await revalidateCandidate(candidate,report)).ok,true);
 await writeFile(path.join(root,'node_modules/example/index.js'),'changed after review');let result=await revalidateCandidate(candidate,report);assert.equal(result.ok,false);assert.match(result.reasons.join(' '),/contents changed|confidence decreased/);
 await age(root);report=await scan(options(base,root));candidate=report.candidates[0];await writeFile(path.join(root,'src/index.js'),'modified source');result=await revalidateCandidate(candidate,report);assert.equal(result.ok,false);assert.match(result.reasons.join(' '),/sources|Recent/);
});

test('candidate roots replaced by symbolic links are rejected',async t=>{
 const base=await fixture(t),root=await nodeProject(base);const report=await scan(options(base,root));const c=report.candidates[0];await rm(c.path,{recursive:true});await mkdir(path.join(base,'outside'));await symlink(path.join(base,'outside'),c.path,'dir');const result=await revalidateCandidate(c,report);assert.equal(result.ok,false);assert.match(result.reasons.join(' '),/link|identity/i);
});

test('live process working directory remains a hard protection for archived projects',{skip:process.platform!=='linux'},async t=>{
 const base=await fixture(t),root=await nodeProject(base);const child=spawn(process.execPath,['-e','process.stdout.write("ready");setInterval(()=>{},1000)'],{cwd:root,stdio:['ignore','pipe','ignore']});t.after(()=>child.kill());await once(child.stdout,'data');const report=await scan({...options(base,root),config:{archived:[root]}});assert.equal(report.candidates[0].status,'protected');assert.match(report.candidates[0].protection.join(' '),/Observed cwd/);child.kill();await once(child,'exit');
});

test('audit inventory is bounded, compressed-writer compatible, and does not change source activity',async t=>{
 const base=await fixture(t),root=await nodeProject(base);for(let i=0;i<600;i++)await put(root,`src/file-${i}.js`,'x');await age(root);const chunks=[];const report=await scan({...options(base,root),audit:{id:'scan-test-id',path:path.join(base,'.diskroom/runs/scan-test-id'),write:async(name,value)=>{chunks.push({name,length:value.entries.length});}}});assert.equal(report.id,'scan-test-id');assert.ok(chunks.length>=3);assert.ok(chunks.every(c=>c.length<=256));assert.equal(report.status,'complete');assert.ok(report.inventory.processed>600);
});

test('exclusions remain protected inside candidates and overlapping roots are deduplicated',async t=>{
 const base=await fixture(t),root=await nodeProject(base);const report=await scan({...options(base,[root,path.join(root,'node_modules')]),config:{exclude:[path.join(root,'node_modules/example')]}});assert.equal(report.roots.length,1);assert.equal(report.candidates[0].status,'protected');assert.match(report.candidates[0].protection.join(' '),/excluded/);
});

test('scope and volume resolution use filesystem boundaries; cancellation is explicit',async t=>{
 const base=await fixture(t),root=await nodeProject(base);assert.deepEqual(await resolveScope('project',path.join(root,'src'),base),[root]);const volume=await measureVolume(root);assert.ok(volume.totalBytes>=volume.freeBytes);assert.ok((await discoverVolumes()).length>=1);const controller=new AbortController();controller.abort();const report=await scan({...options(base,root),signal:controller.signal});assert.equal(report.status,'cancelled');
});

test('virtual environments require interpreter identity and keep dependency restoration evidence',async t=>{
 const base=await fixture(t);await put(base,'python/pyproject.toml','[project]\nname="example"');await put(base,'python/requirements.txt','example==1.0.0');await put(base,'python/.venv/pyvenv.cfg','home = /usr/bin\ninclude-system-site-packages = false');await put(base,'python/.venv/bin/python','fixture interpreter');await put(base,'python/.venv/lib/python3.11/site-packages/example.py','x=1');await age(base);let report=await scan(options(base,base));let candidate=report.candidates.find(c=>c.category==='virtual-environment');assert.equal(candidate.operation,'delete-tree');assert.equal(candidate.metadata.evidence.some(e=>e.path.endsWith('requirements.txt')),true);
 await rm(path.join(base,'python/.venv/bin/python'));report=await scan(options(base,base));assert.equal(report.candidates.some(c=>c.category==='virtual-environment'),false);
});

test('fresh Git index activity protects dependencies even when source mtimes remain old',async t=>{
 const base=await fixture(t),root=await nodeProject(base);await put(root,'.git/HEAD','ref: refs/heads/main');await mkdir(path.join(root,'.git/objects'),{recursive:true});await put(root,'.git/index','index');const report=await scan(options(base,root));const c=report.candidates.find(c=>c.category==='installed-dependencies');assert.equal(c.status,'protected');assert.match(c.protection.join(' '),/Recent/);
});

test('standalone Python bytecode observes source activity and source replacement without a manifest',async t=>{
 const base=await fixture(t);const project=path.join(base,'standalone');await put(project,'main.py','print(1)');await put(project,'__pycache__/main.cpython-311.pyc','bytecode');await age(project);let report=await scan(options(base,project));const c=report.candidates[0];assert.equal(c.project,project);assert.equal((await revalidateCandidate(c,report)).ok,true);await writeFile(path.join(project,'main.py'),'print(2)');const result=await revalidateCandidate(c,report);assert.equal(result.ok,false);assert.match(result.reasons.join(' '),/restoration source|Recent/);report=await scan(options(base,project));assert.equal(report.candidates[0].status,'protected');
});

test('spawned scanner does not treat its own explicit scope argument as an active project',{skip:process.platform!=='linux'},async t=>{
 const base=await fixture(t),root=await nodeProject(base);
 const moduleUrl=new URL('../src/scanner.js',import.meta.url).href;
 const script=`import {scan} from ${JSON.stringify(moduleUrl)};const root=process.argv[1],base=process.argv[2];const r=await scan({roots:[root],cwd:base,workspace:base,config:{archived:[root]}});process.stdout.write(JSON.stringify(r.candidates.map(c=>({status:c.status,protection:c.protection}))));`;
 const child=spawn(process.execPath,['--input-type=module','-e',script,root,base],{cwd:base,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);const [code]=await once(child,'exit');assert.equal(code,0,stderr);const result=JSON.parse(stdout);assert.equal(result.length,1);assert.notEqual(result[0].status,'protected',JSON.stringify(result[0].protection));
});

test('empty npm metadata and extraneous package trees are not disposable dependencies',async t=>{
 const base=await fixture(t),root=await nodeProject(base);
 await put(root,'node_modules/personal-drafts/unpublished.js','unique work');await age(root);
 let report=await scan(options(base,root)),candidate=report.candidates.find(c=>c.category==='installed-dependencies');
 assert.equal(candidate.status,'protected');assert.match(candidate.protection.join(' '),/absent from verified/);
 await put(root,'node_modules/.package-lock.json',JSON.stringify({lockfileVersion:3,packages:{}}));await age(root);
 report=await scan(options(base,root));candidate=report.candidates.find(c=>c.category==='installed-dependencies');assert.equal(candidate.operation,'detect-only');
});

test('credentials and database paths remain protected even as standalone large-file candidates',async t=>{
 const base=await fixture(t);for(const file of ['.env.staging','backup.db','.ssh/keys/archive.txt','.aws/credentials','project/.npmrc'])await put(base,file,'x'.repeat(4096));await age(base);
 const report=await scan({...options(base,base),targetFree:1024});assert.equal(report.candidates.length,5);
 for(const candidate of report.candidates){assert.equal(candidate.status,'protected',candidate.path);assert.match(candidate.protection.join(' '),/credentials|unique data/);}
});

test('sensitive environment variants inside registered packages cannot be removed',async t=>{
 const base=await fixture(t),root=await nodeProject(base);await put(root,'node_modules/example/.env.staging','private=fixture');await age(root);
 const report=await scan(options(base,root)),candidate=report.candidates.find(c=>c.category==='installed-dependencies');assert.equal(candidate.status,'protected');
});

test('scan policy rejects invalid and inconsistent input rather than zero-day protection',async t=>{
 const base=await fixture(t);for(const activityDays of [0,-1,0.5,36501,Infinity])await assert.rejects(scan({...options(base,base),activityDays}),/Activity days/);
 await assert.rejects(scan({...options(base,base),config:{protect:['relative/path']}}),/normalized absolute/);
 const report=await scan({...options(base,base),activityDays:15});assert.equal(report.config.activityDays,15);
});
