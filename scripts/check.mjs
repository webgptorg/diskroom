import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(/\.(m?js)$/.test(e.name)){const r=spawnSync(process.execPath,['--check',p],{stdio:'inherit'});if(r.status)process.exit(r.status);}}}
for(const dir of ['bin','src','native','scripts','examples'])await walk(dir);
const pkg=JSON.parse(await readFile('package.json','utf8'));
if(pkg.name!=='diskroom'||pkg.homepage!=='https://diskroom.dev'||!pkg.bin.diskroom)throw new Error('Product identity mismatch');
console.log('Source syntax and package identity checked.');
