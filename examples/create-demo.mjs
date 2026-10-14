#!/usr/bin/env node
/** Create synthetic test data only inside a fresh mkdtemp directory. Never deletes. */
import { mkdir, mkdtemp, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';

if (process.argv.length > 3 || process.argv.includes('--help')) {
  console.log('Usage: node examples/create-demo.mjs [existing-parent-directory]');
  console.log('Creates a unique diskroom-demo-* directory with synthetic data; never deletes existing files.');
  process.exit(process.argv.includes('--help') ? 0 : 1);
}
const parent = path.resolve(process.argv[2] || os.tmpdir());
if (!(await stat(parent)).isDirectory()) throw new Error('The parent must be an existing directory.');
const demo = await mkdtemp(path.join(parent, 'diskroom-demo-'));
// Deliberately fabricated registry metadata exercises recognition without network access.
// example.invalid cannot serve a package; this fixture is not an installable project.
const dependencyName = 'diskroom-synthetic-dependency';
const dependencyKey = `node_modules/${dependencyName}`;
const dependencyEntry = {
  version: '1.0.0',
  resolved: 'https://example.invalid/diskroom-synthetic-dependency-1.0.0.tgz',
  integrity: `sha512-${createHash('sha512').update('DiskRoom synthetic fixture, not a package archive').digest('base64')}`,
};
const manifest = (name) => JSON.stringify({ name, version: '1.0.0', private: true, dependencies: { [dependencyName]: '1.0.0' } }, null, 2);
const projectLock = (name) => JSON.stringify({ name, version: '1.0.0', lockfileVersion: 3, packages: { '': { name, version: '1.0.0', dependencies: { [dependencyName]: '1.0.0' } }, [dependencyKey]: dependencyEntry } }, null, 2);
const installMarker = JSON.stringify({ lockfileVersion: 3, packages: { [dependencyKey]: dependencyEntry } }, null, 2);
const installedManifest = JSON.stringify({ name: dependencyName, version: '1.0.0' });
const files = new Map([
  ['README.txt', 'Synthetic DiskRoom demonstration. No real installed packages or executable binary artifacts.\nOld project timestamps are deliberately set back for testing. All contents may be discarded after review. Package registry metadata is fabricated and uses example.invalid; do not install these fixtures.\n'],
  ['old-node/package.json', manifest('synthetic-demo')],
  ['old-node/package-lock.json', projectLock('synthetic-demo')],
  ['old-node/index.js', '// Preserved synthetic source.\nexport const demo = true;\n'],
  ['old-node/node_modules/.package-lock.json', installMarker],
  [`old-node/node_modules/${dependencyName}/package.json`, installedManifest],
  [`old-node/node_modules/${dependencyName}/index.js`, '// Synthetic fixture only, not a published dependency.\n'.repeat(1200)],
  ['old-python/pyproject.toml', '[project]\nname = "synthetic-python-demo"\nversion = "1.0.0"\n'],
  ['old-python/requirements.txt', '# Synthetic empty dependency input, not a real environment.\n'],
  ['old-python/app.py', 'print("Preserved synthetic source")\n'],
  ['old-python/__pycache__/app.cpython-312.pyc', Buffer.alloc(24 * 1024, 0)],
  ['old-python/.venv/pyvenv.cfg', 'home = /synthetic/interpreter\ninclude-system-site-packages = false\nversion = 3.12.0\n'],
  ['old-python/.venv/bin/python', '# Synthetic placeholder, deliberately not executable.\n'],
  ['old-python/.venv/lib/python3.12/site-packages/synthetic.py', '# Synthetic installed-environment fixture.\n'.repeat(500)],
  ['old-python/.pytest_cache/CACHEDIR.TAG', 'Signature: 8a477f597d28d172789f06886806bc55\n'],
  ['old-python/.pytest_cache/README.md', 'Synthetic pytest cache metadata.\n'],
  ['old-python/.pytest_cache/v/cache/nodeids', '["synthetic_test.py::test_example"]\n'],
  ['old-java/pom.xml', '<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>synthetic-demo</artifactId><version>1.0.0</version></project>\n'],
  ['old-java/src/main/java/example/App.java', 'package example; public class App { public static void main(String[] args) {} }\n'],
  ['old-java/target/classes/example/App.class', Buffer.alloc(16 * 1024, 0)],
  ['active-project/package.json', manifest('active-synthetic-project')],
  ['active-project/package-lock.json', projectLock('active-synthetic-project')],
  ['active-project/index.js', '// Recent source keeps the project active.\n'],
  ['active-project/node_modules/.package-lock.json', installMarker],
  [`active-project/node_modules/${dependencyName}/package.json`, installedManifest],
  [`active-project/node_modules/${dependencyName}/index.js`, '// Synthetic active dependency.\n'.repeat(600)],
  ['review-data/debug.log', 'SYNTHETIC LOG: nothing sensitive; review before removing.\n'.repeat(2400)],
  ['unrecognized/node_modules/notes.txt', 'This is a folder name, not proven installed dependencies.\n']
]);
for (const [relative, contents] of files) {
  const destination = path.join(demo, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents, { flag: 'wx', mode: 0o600 });
}
const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
async function ageTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await ageTree(target);
    else await utimes(target, old, old);
  }
  await utimes(directory, old, old);
}
for (const name of ['old-node', 'old-python', 'old-java', 'review-data']) await ageTree(path.join(demo, name));
console.log(demo);
console.error('\nCreated an isolated synthetic demo. No existing files were modified or removed.');
console.error('From your checkout, scan it using:');
console.error(`node bin/diskroom.js scan ${JSON.stringify(demo)} --target-free 1MB --json`);
console.error('A 1MB goal is normally already met; the small goal also makes the example log visible.');
console.error('Nothing is cleaned by the fixture script or by the scan command.');
