import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'native', 'prebuilds', `${process.platform}-${process.arch}`, 'diskroom_native.node');
const nodeGypVersion = '13.1.0';
await mkdir(path.dirname(output), { recursive: true });

// A provided Node development-header directory permits reproducible offline Unix builds.
// Standard CI builds use node-gyp and the matching official Node headers.
if (process.env.DISKROOM_NODE_HEADERS && process.platform !== 'win32') {
  const include = path.resolve(process.env.DISKROOM_NODE_HEADERS);
  await stat(path.join(include, 'node_api.h'));
  const flags = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-shared', '-DNAPI_VERSION=8', '-D_FILE_OFFSET_BITS=64', '-I', include, 'native/diskroom_native.c', '-o', output];
  if (process.platform === 'darwin') flags.unshift('-undefined', 'dynamic_lookup');
  const result = spawnSync(process.env.CC || 'cc', flags, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
} else {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  const supportedBuildNode = (major === 22 && (minor > 22 || (minor === 22 && patch >= 2))) || (major === 24 && minor >= 15) || major >= 26;
  if (!supportedBuildNode) throw new Error(`Building with node-gyp@${nodeGypVersion} requires Node 22.22.2+ (22.x), Node 24.15.0+ (24.x), or Node 26+. Current build runtime: ${process.version}. Install a supported build runtime; published prebuilt binaries have separate runtime support.`);
  // npm's entrypoint runs with node on Windows too; no shell or .cmd interpolation.
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
  // Includes Visual Studio 2026 (18.x) discovery and its subsequent version fix.
  const result = spawnSync(process.execPath, [npmCli, 'exec', '--yes', `--package=node-gyp@${nodeGypVersion}`, '--', 'node-gyp', 'rebuild'], { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  await copyFile(path.join(root, 'build', 'Release', 'diskroom_native.node'), output);
}
console.log(`Built native safety support: ${path.relative(root, output)}`);
