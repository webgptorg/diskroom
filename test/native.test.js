import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, rename, symlink, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as native from '../native/index.js';
import { runNativeSmoke } from '../native/smoke.mjs';

const nativeTest = (name, fn) => test(name, { skip: !native.available && !process.env.DISKROOM_REQUIRE_NATIVE }, async () => {
  assert.equal(native.available, true, native.unavailableReason);
  await fn();
});
async function fixture(fn) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'diskroom-native-test-')));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

nativeTest('native packaged bridge deletes only expected fixture entries', runNativeSmoke);

nativeTest('native leaf replacement and post-snapshot write are refused', async () => fixture(async directory => {
  await writeFile(path.join(directory, 'victim'), 'original');
  const root = native.openRoot(directory);
  try {
    const expected = native.statChild(root, 'victim');
    await rename(path.join(directory, 'victim'), path.join(directory, 'old'));
    await writeFile(path.join(directory, 'victim'), 'replacement');
    assert.throws(() => native.removeChild(root, 'victim', expected), { code: 'ERR_CHANGED_ENTRY' });
    const changed = native.statChild(root, 'victim');
    await writeFile(path.join(directory, 'victim'), 'longer replacement content');
    assert.throws(() => native.removeChild(root, 'victim', changed), { code: 'ERR_CHANGED_ENTRY' });
    assert.equal(await readFile(path.join(directory, 'victim'), 'utf8'), 'longer replacement content');
  } finally { native.close(root); }
}));

nativeTest('native directory handles retain their ancestors after wrapper close', async () => fixture(async directory => {
  await mkdir(path.join(directory, 'child'));
  await writeFile(path.join(directory, 'child', 'file'), 'fixture');
  const root = native.openRoot(directory);
  const child = native.openDirectory(root, 'child');
  native.close(root);
  native.close(root);
  assert.throws(() => native.stat(root), { code: 'ERR_CLOSED_HANDLE' });
  try {
    const expected = native.statChild(child, 'file');
    native.removeChild(child, 'file', expected);
    assert.deepEqual(native.readDirectory(child), []);
  } finally { native.close(child); }
}));

nativeTest('native rejects forged and missing handle arguments', async () => {
  for (const fake of [null, undefined, 0, 'path', {}, { resource: 1 }]) {
    assert.throws(() => native.stat(fake), { code: 'ERR_INVALID_HANDLE' });
    assert.throws(() => native.close(fake), { code: 'ERR_INVALID_HANDLE' });
  }
  assert.throws(() => native.stat(), { code: 'ERR_INVALID_ARGUMENT' });
});

nativeTest('native refuses traversal, absolute child paths, links and nonempty-directory deletion', async () => fixture(async directory => {
  await mkdir(path.join(directory, 'cache'));
  await writeFile(path.join(directory, 'cache', 'file'), 'must remain');
  await symlink(path.join(directory, 'cache'), path.join(directory, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const root = native.openRoot(directory);
  try {
    for (const name of ['', '.', '..', '../cache', 'cache/file', '\0', path.join(directory, 'cache')]) {
      assert.throws(() => native.statChild(root, name), { code: 'ERR_INVALID_PATH' });
    }
    assert.throws(() => native.openRoot(path.join(directory, 'alias')));
    const expected = native.statChild(root, 'cache');
    assert.throws(() => native.removeChild(root, 'cache', expected, { directoryIdentityOnly: true }));
    assert.equal(await readFile(path.join(directory, 'cache', 'file'), 'utf8'), 'must remain');
    assert.throws(() => native.openRoot('relative/path'), { code: 'ERR_INVALID_PATH' });
  } finally { native.close(root); }
}));

nativeTest('native confinement survives an ancestor replacement attempt', async () => fixture(async directory => {
  await mkdir(path.join(directory, 'selected'));
  await mkdir(path.join(directory, 'outside'));
  await writeFile(path.join(directory, 'selected', 'file'), 'selected');
  await writeFile(path.join(directory, 'outside', 'file'), 'outside must remain');
  const root = native.openRoot(path.join(directory, 'selected'));
  try {
    const expected = native.statChild(root, 'file');
    if (process.platform === 'win32') {
      // Windows no-share-delete ancestor handles prevent this rename.
      await assert.rejects(rename(path.join(directory, 'selected'), path.join(directory, 'moved')));
    } else {
      await rename(path.join(directory, 'selected'), path.join(directory, 'moved'));
      await symlink(path.join(directory, 'outside'), path.join(directory, 'selected'), 'dir');
    }
    native.removeChild(root, 'file', expected);
    assert.equal(await readFile(path.join(directory, 'outside', 'file'), 'utf8'), 'outside must remain');
  } finally { native.close(root); }
}));

nativeTest('native directory cursors can be enumerated repeatedly', async () => fixture(async directory => {
  await writeFile(path.join(directory, 'a'), 'a');
  await writeFile(path.join(directory, 'b'), 'b');
  const root = native.openRoot(directory);
  try {
    assert.deepEqual(native.readDirectory(root).sort(), ['a', 'b']);
    assert.deepEqual(native.readDirectory(root).sort(), ['a', 'b']);
  } finally { native.close(root); }
}));

nativeTest('native metadata matches the scanner Node lstat fingerprint', async () => fixture(async directory => {
  await mkdir(path.join(directory, 'directory'));
  await writeFile(path.join(directory, 'file'), 'fixture');
  await symlink(path.join(directory, 'directory'), path.join(directory, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const root = native.openRoot(directory);
  try {
    for (const name of ['directory', 'file', 'link']) {
      const actual = native.statChild(root, name);
      const expected = await lstat(path.join(directory, name));
      for (const field of ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(actual[field], Number(expected[field]), `${name}.${field}`);
    }
  } finally { native.close(root); }
}));

if (process.platform !== 'win32') nativeTest('native refuses lossy UTF-8 filename inventories', async () => fixture(async directory => {
  const invalidName = Buffer.concat([Buffer.from(directory + path.sep), Buffer.from([0xff, 0x66])]);
  await writeFile(invalidName, 'do not lose identity');
  const root = native.openRoot(directory);
  try {
    assert.throws(() => native.readDirectory(root), { code: 'ERR_FILENAME_ENCODING' });
    assert.equal(await readFile(invalidName, 'utf8'), 'do not lose identity');
  } finally { native.close(root); }
}));
