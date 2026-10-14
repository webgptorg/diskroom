import { readFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = metadata.version;
export const SCHEMA_VERSION = 1;
export const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const newId = () => randomUUID();

export function parseSize(input) {
  if (typeof input !== 'string') throw new Error('Enter a size such as 5GB, 2.5GiB or 100kB.');
  const match = input.trim().match(/^(\d+(?:\.\d+)?|\.\d+)\s*(B|kB|MB|GB|TB|KiB|MiB|GiB|TiB)$/i);
  if (!match) throw new Error(`Invalid size "${input}". Use a positive number and B, kB, MB, GB, TB, KiB, MiB, GiB or TiB.`);
  const units = {b:1,kb:1000,mb:1e6,gb:1e9,tb:1e12,kib:1024,mib:1024**2,gib:1024**3,tib:1024**4};
  const value = Number(match[1]) * units[match[2].toLowerCase()];
  if (!Number.isFinite(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) throw new Error('Size must be at least one byte and fit in a safe byte count.');
  return Math.ceil(value);
}
export function formatBytes(value) {
  if (value == null || !Number.isFinite(value)) return 'unknown';
  if (Math.abs(value) < 1000) return `${value} B`;
  const units = ['kB','MB','GB','TB','PB'];
  let n=value / 1000, i=0;
  while(Math.abs(n)>=1000 && i<units.length-1) { n/=1000; i++; }
  return `${n.toFixed(n>=100 ? 0 : n>=10 ? 1 : 2)} ${units[i]}`;
}
export function within(target, root) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
export function fingerprint(s) {
  return Object.fromEntries(['dev','ino','size','mtimeMs','ctimeMs','mode'].map(k=>[k, Number(s[k])]));
}
export function sameFingerprint(a,b) {
  return !!a && !!b && ['dev','ino','size','mtimeMs','ctimeMs','mode'].every(k=>a[k]===b[k]);
}
export async function readJson(filename, maxBytes = 1024*1024) {
  const st=await lstat(filename);
  if (!st.isFile() || st.isSymbolicLink() || st.size>maxBytes) throw new Error(`Not a small regular JSON file: ${filename}`);
  return JSON.parse(await readFile(filename,'utf8'));
}
export function runCommand(command,args=[],options={}) {
  return new Promise((resolve,reject)=>{
    const {cwd,signal,timeout=10000,maxBytes=1024*1024,env=process.env}=options;
    let output='',error='',size=0,done=false;
    const child=spawn(command,args,{cwd,signal,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{child.kill();finish(new Error(`${command} timed out.`));},timeout);
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);err?reject(err):resolve(value);};
    child.on('error',e=>finish(e));
    for(const [stream,type] of [[child.stdout,'out'],[child.stderr,'err']]) stream.on('data',chunk=>{
      size+=chunk.length;
      if(size>maxBytes){child.kill();finish(new Error(`${command} returned too much output.`));return;}
      if(type==='out')output+=chunk.toString();else error+=chunk.toString();
    });
    child.on('close',(code,sig)=>finish(null,{code,exitCode:code,stdout:output,stderr:error,signal:sig}));
  });
}
export function abortIfNeeded(signal) { if(signal?.aborted) throw signal.reason || Object.assign(new Error('Cancelled'),{name:'AbortError'}); }
