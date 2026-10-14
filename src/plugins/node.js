import path from 'node:path';
import { descriptor, directory, firstFile, pluginMeta, regular, smallJson, smallText } from './shared.js';
export const metadata = pluginMeta('node',['detect-only','delete-tree'],['npm','pnpm','yarn','bun']);
function object(value) {return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function installedPath(value) {return typeof value==='string'&&value.startsWith('node_modules/')&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');}
function registryEntry(entry) {return object(entry)&&typeof entry.version==='string'&&typeof entry.resolved==='string'&&/^https:\/\//.test(entry.resolved)&&typeof entry.integrity==='string'&&/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}(?:\s|$)/.test(entry.integrity);}
export async function detect(ctx) {
  const {file, name, project} = ctx;
  if (name === 'node_modules' && project?.node) {
    const lock = await firstFile(project.path,['package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock','bun.lock','bun.lockb']);
    const marker = await firstFile(file,['.package-lock.json','.modules.yaml','.yarn-state.yml']);
    let verified=Boolean(lock&&marker?.endsWith('.package-lock.json')&&['package-lock.json','npm-shrinkwrap.json'].includes(path.basename(lock))&&path.dirname(file)===project.path);
    const packageMembership=[],packageManifests=[];
    if(verified)try {
      const data=await smallJson(marker,8388608),projectLock=await smallJson(lock,8388608);
      verified=object(data.packages)&&object(projectLock.packages)&&data.lockfileVersion>=2&&projectLock.lockfileVersion>=2;
      if(verified) {
        const installed=Object.entries(data.packages);
        verified=installed.length>0&&installed.length<=20000;
        for(const [key,entry] of installed) {
          const locked=projectLock.packages[key];
          if(!installedPath(key)||!registryEntry(entry)||!registryEntry(locked)||['version','resolved','integrity'].some(field=>entry[field]!==locked[field])){verified=false;break;}
          const manifest=path.join(project.path,...key.split('/'),'package.json');
          const pkg=await smallJson(manifest);
          if(!object(pkg)||pkg.version!==entry.version||typeof pkg.name!=='string'){verified=false;break;}
          packageMembership.push({path:key.slice('node_modules/'.length),link:false});packageManifests.push(manifest);
        }
      }
    } catch {verified=false;}
    packageMembership.sort((a,b)=>b.path.length-a.path.length);
    // Other managers need their own complete installed-membership parsers; marker presence alone is insufficient.
    return descriptor('node','installed-dependencies',{
      operation:verified?'delete-tree':'detect-only',score:verified?85:45,confidence:verified?'medium':'low',manager:marker?.endsWith('.modules.yaml')?'pnpm':marker?.endsWith('.yarn-state.yml')?'yarn':'npm',
      validationKind:'node-install',packageMembership:verified?packageMembership:null,evidencePaths:[project.manifest,lock,marker,...packageManifests].filter(Boolean),
      installMarker:marker,reasons:[verified?'Installed package membership, package manifests and registry integrity metadata agree with the preserved lock. Contents and future registry availability are not guaranteed.':'Complete installed-package provenance is unavailable. This manager/layout is detection-only; marker names alone do not establish disposable dependencies.'],
      restore:['Install dependencies with the project’s package manager and preserved lockfile. Network access, private registry credentials, local workspace sources and compatible tooling may be required.'],
      risks:['Local changes or unique files inside installed packages cannot be recovered by a lockfile.','Hardlinked package content may remain allocated in a shared store.'],
    });
  }
  if (project?.node && path.dirname(file) === project.path && ['.next','.nuxt','.turbo','coverage','dist','build'].includes(name)) {
    const deps = {...project.node.dependencies,...project.node.devDependencies};
    const recognized = (name === '.next' && deps.next && await regular(path.join(file,'BUILD_ID'))) || (name === '.nuxt' && (deps.nuxt || deps.nuxt3)) || (name === '.turbo' && deps.turbo) || (name === 'coverage' && ['jest','vitest','nyc','c8'].some(x=>deps[x])) || (['dist','build'].includes(name) && project.node.scripts?.build);
    if (!recognized) return null;
    return descriptor('node','build-output',{score:65,evidencePaths:[project.manifest],reasons:['Project tooling and artifact location identify a probable generated output; unique content has not been excluded.'],restore:['Run the documented project build or test command yourself after reviewing its effects.'],risks:['Custom output directories may contain source or user files.']});
  }
  const normalized=file.split(path.sep).join('/');
  if ((name==='_cacache' && path.basename(path.dirname(file))==='.npm' && await directory(path.join(file,'content-v2'))) || (name==='_npx' && path.basename(path.dirname(file))==='.npm') || (name==='store' && /(?:pnpm|\.pnpm)\/store$/.test(normalized)) || (name==='cache' && /(?:\.yarn|yarn|\.bun\/install)\/cache$/.test(normalized))) {
    return descriptor('node','shared-package-cache',{manager:normalized.includes('pnpm')?'pnpm':normalized.includes('yarn')?'yarn':normalized.includes('.bun')?'bun':'npm',score:60,reasons:['Recognized package-manager cache layout. Shared-cache mutation requires a manager-specific bounded operation.'],restore:['Download packages again with the owning package manager; registry availability is not guaranteed.'],risks:['Shared cache users and exclusive reclaimable space are unknown.']});
  }
  return null;
}
