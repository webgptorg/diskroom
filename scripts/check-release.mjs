import { readFile, stat } from 'node:fs/promises';
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
if(pkg.name!=='diskroom'||pkg.license==='UNLICENSED'||!pkg.license)throw new Error('Choose and record the owner-approved release license before publishing.');
if(!pkg.repository?.url?.startsWith('git+https://github.com/'))throw new Error('Record the verified source repository before publishing.');
for(const target of ['linux-x64','linux-arm64','darwin-x64','darwin-arm64','win32-x64']) {
  const file=new URL(`../native/prebuilds/${target}/diskroom_native.node`,import.meta.url);
  if(!(await stat(file)).isFile())throw new Error(`Missing verified native prebuild: ${target}`);
}
console.log('Release metadata and required native prebuilds are present. Publish only the exact tarball tested by the full CI matrix.');
