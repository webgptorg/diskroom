import path from 'node:path';
import { readdir, readlink, realpath } from 'node:fs/promises';
import { descriptor, firstFile, pluginMeta } from './shared.js';
import { smallText } from './shared.js';
export const metadata=pluginMeta('runtime',['detect-only'],['nvm','fnm','pyenv','sdkman','asdf']);
export async function detect({file}) {
  const norm=file.split(path.sep).join('/');
  const match=norm.match(/\/(\.nvm\/versions\/node|\.pyenv\/versions|\.sdkman\/candidates\/java|\.asdf\/installs\/(?:nodejs|python|java)|fnm\/node-versions)\/([^/]+)$/);
  if(!match) return null;
  const executable=await firstFile(file,['bin/node','bin/python','bin/python3','bin/java','node.exe','python.exe','bin/java.exe','installation/bin/node','installation/node.exe']);
  if(!executable) return null;
  const manager=match[1].includes('nvm')?'nvm':match[1].includes('pyenv')?'pyenv':match[1].includes('sdkman')?'sdkman':match[1].includes('asdf')?'asdf':'fnm';
  const runtimeProtection=[];
  const version=match[2];
  const versionParts=v=>/^v?\d+(?:\.\d+){1,3}(?:[.-].*)?$/.test(v)?v.replace(/^v/,'').split(/[.-]/).slice(0,3).map(x=>Number(x)||0):null;
  const currentParts=versionParts(version);
  if(currentParts){
    const versions=(await readdir(path.dirname(file),{withFileTypes:true})).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>({name:e.name,parts:versionParts(e.name)})).filter(e=>e.parts);
    versions.sort((a,b)=>{for(let i=0;i<3;i++){const difference=(b.parts[i]||0)-(a.parts[i]||0);if(difference)return difference;}return b.name.localeCompare(a.name);});
    if(versions[0]?.name===version)runtimeProtection.push('Newest installed recognizable runtime version in this manager collection.');
  }
  try{if(await realpath(executable)===await realpath(process.execPath))runtimeProtection.push('This is the runtime executing DiskRoom.');}catch{}
  const collection=path.dirname(file);
  let defaultPath;
  if(manager==='nvm')defaultPath=path.resolve(collection,'..','..','alias','default');
  if(manager==='pyenv')defaultPath=path.resolve(collection,'..','version');
  try{
    if(defaultPath){const value=(await smallText(defaultPath,4096)).trim();if(value===version||value.replace(/^v/,'')===version.replace(/^v/,''))runtimeProtection.push('This version is configured as the manager default.');}
    if(manager==='sdkman'){const destination=await readlink(path.join(collection,'current'));if(path.resolve(collection,destination)===file)runtimeProtection.push('This version is the SDKMAN current/default Java runtime.');}
  }catch{}
  return descriptor('runtime','runtime-installation',{score:30,manager,evidencePaths:[executable],reasons:['Recognized version-manager installation. The known newest/default/running roles are protected; project pins and indirect application dependencies across the machine are not exhaustively resolved.',...runtimeProtection],restore:['Install this exact version using its owning version manager if it remains available.'],risks:['Projects and applications outside the scanned scope may depend on this runtime.','Runtime uninstallation is detection-only until all references and a bounded owning-manager operation can be verified.'],metadata:{runtimeProtection,version,manager,uninstallSupported:false}});
}
