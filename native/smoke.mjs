import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/** Run against the installed tarball's loader, not an unpackaged build directory. */
export async function runNativeSmoke(loader = new URL('./index.js', import.meta.url)) {
  const native = await import(loader instanceof URL ? loader.href : pathToFileURL(path.resolve(loader)).href);
  assert.equal(native.available, true, native.unavailableReason);
  // macOS /tmp is a system symlink; canonicalize the fixture before nofollow opening.
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'diskroom-native-smoke-')));
  let root;
  let child;
  try {
    await mkdir(path.join(directory, 'cache'));
    await writeFile(path.join(directory, 'cache', 'entry.txt'), 'safe fixture');
    await writeFile(path.join(directory, 'keep.txt'), 'must remain');
    root = native.openRoot(directory);
    assert.deepEqual(native.readDirectory(root).sort(), ['cache', 'keep.txt']);
    const cacheStat = native.statChild(root, 'cache');
    child = native.openDirectory(root, 'cache');
    const entryStat = native.statChild(child, 'entry.txt');
    assert.equal(entryStat.type, 'file');
    assert.equal(native.removeChild(child, 'entry.txt', entryStat), true);
    native.close(child); child = null;
    assert.equal(native.removeChild(root, 'cache', cacheStat, { directoryIdentityOnly: true }), true);
    assert.throws(() => native.statChild(root, '../keep.txt'), { code: 'ERR_INVALID_PATH' });
    assert.equal(await readFile(path.join(directory, 'keep.txt'), 'utf8'), 'must remain');

    // Windows directory junction creation does not require Developer Mode privilege.
    await mkdir(path.join(directory, 'target'));
    await symlink(path.join(directory, 'target'), path.join(directory, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const linkStat = native.statChild(root, 'link');
    assert.equal(linkStat.type, 'symlink');
    assert.throws(() => native.openDirectory(root, 'link'));
    assert.equal(native.removeChild(root, 'link', linkStat), true);
    const targetStat = native.statChild(root, 'target');
    assert.equal(targetStat.type, 'directory');
  } finally {
    if (child) native.close(child);
    if (root) native.close(root);
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runNativeSmoke(process.argv[2] || new URL('./index.js', import.meta.url));
  console.log(`Native installed-package safety smoke passed (${process.platform}/${process.arch}).`);
}
