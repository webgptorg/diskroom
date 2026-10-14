import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createAudit, readRun, listRuns, loadConfig, saveConfig, validateRun } from '../src/audit.js';

async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diskroom-audit-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return fs.realpath(root); }
function scanData(root) { return { schemaVersion: 1, kind: 'scan', status: 'complete', cwd: root, workspace: root, roots: [root], volume: { id: 'test', root, totalBytes: 100, freeBytes: 20 }, candidates: [], targetFree: null, activityDays: 30, config: { protect: [], exclude: [], archived: [], activityDays: 30 } }; }

test('audit stores individually readable gzip JSON, completion and ordered revisions', async t => {
  const root = await fixture(t), writer = await createAudit(root, 'scan');
  await writer.write('inventory-000001', { entries: [{ path: path.join(root, 'file') }] });
  await writer.finish(scanData(root));
  const raw = JSON.parse(gunzipSync(await fs.readFile(path.join(writer.path, 'inventory-000001.json.gz'))));
  assert.equal(raw.runId, writer.id); assert.equal(raw.schemaVersion, 1); assert.equal(raw.sequence, 2);
  const summary = await readRun(root, writer.id);
  assert.equal(summary.status, 'complete'); assert.equal(summary.id, writer.id);
  assert.equal((await listRuns(root)).length, 1);
  assert.ok((await fs.readdir(writer.path)).every(name => name.endsWith('.json.gz')));
});

test('an intent without a durable result remains unverified after a crash', async t => {
  const root = await fixture(t), writer = await createAudit(root, 'clean');
  await writer.write('intent-operation-000001-000001', { entries: [{ relativePath: 'a' }, { relativePath: 'b' }] });
  let summary = await readRun(root, writer.id);
  assert.equal(summary.interrupted, true); assert.equal(summary.unresolvedIntents.length, 1);
  await writer.write('result-operation-000001-000001', { complete: false, entries: [{ relativePath: 'a', status: 'removed' }] });
  summary = await readRun(root, writer.id);
  assert.equal(summary.unresolvedIntents.length, 1, 'partial result does not imply all intended files were removed');
});

test('audit rejects path traversal, symlink files and unsupported schema', async t => {
  const root = await fixture(t), writer = await createAudit(root, 'scan');
  await writer.finish(scanData(root));
  await assert.rejects(readRun(root, '../outside'), /Invalid run ID/);
  assert.throws(() => writer.write('../outside', {}), /Invalid audit part/);
  const summary = path.join(writer.path, 'summary.json.gz');
  await fs.writeFile(summary, gzipSync(JSON.stringify({ ...scanData(root), id: writer.id, schemaVersion: 9000 })));
  await assert.rejects(readRun(root, writer.id), /Unsupported/);
  if (process.platform !== 'win32') {
    await fs.unlink(summary); await fs.writeFile(path.join(root, 'outside'), '{}'); await fs.symlink(path.join(root, 'outside'), summary);
    await assert.rejects(readRun(root, writer.id));
  }
});

test('configuration defaults, persists explicit absolute paths, and rejects unknown or malformed settings', async t => {
  const root = await fixture(t);
  assert.deepEqual(await loadConfig(root), { protect: [], exclude: [], archived: [], activityDays: 30 });
  await saveConfig(root, { protect: [root], activityDays: 60 });
  assert.deepEqual((await loadConfig(root)).protect, [root]);
  await assert.rejects(saveConfig(root, { protect: ['relative'] }), /absolute/);
  await assert.rejects(saveConfig(root, { unsafe: true }), /Unknown/);
  await assert.rejects(saveConfig(root, { activityDays: -1 }), /activityDays/);
  await assert.rejects(saveConfig(root, { activityDays: 1.5 }), /activityDays/);
});

test('saved scans reject invalid or inconsistent activity policy before they can be reused', async t => {
  const root = await fixture(t), writer = await createAudit(root, 'scan');
  const base = { ...scanData(root), id: writer.id };
  for (const activityDays of [undefined, null, 0, -1, 0.5, 36501, Infinity, '30']) {
    assert.throws(() => validateRun({ ...base, activityDays }), /activityDays/);
  }
  for (const config of [undefined, null, [], 'default', { unsafe: true }, { protect: ['relative'] }, { exclude: null }, { archived: {} }, { activityDays: 0 }, { activityDays: 1.5 }]) {
    assert.throws(() => validateRun({ ...base, config }), /configuration|absolute|activityDays/);
  }
  assert.throws(() => validateRun({ ...base, activityDays: 1 }), /does not match/);
  assert.throws(() => validateRun({ ...base, config: { activityDays: 60 } }), /does not match/);
  assert.deepEqual(validateRun({ ...base, config: { activityDays: 30 } }).config, base.config);
  await writer.finish({ ...base, activityDays: 0, config: { activityDays: 0 } });
  await assert.rejects(readRun(root, writer.id), /activityDays/);
  assert.equal((await listRuns(root))[0].status, 'invalid');
});

test('Windows audit never executes a project attrib shadow or trusts its SystemRoot', async t => {
  if (process.platform !== 'win32') return t.skip('Requires the real Windows system directory and executable loader.');
  const root = await fixture(t), originalCwd = process.cwd(),originalSystemRoot=process.env.SystemRoot;
  await fs.writeFile(path.join(root, 'attrib.exe'), 'This project file must never be executed.');
  process.chdir(root);process.env.SystemRoot=root;
  try {
    const writer = await createAudit(root, 'scan');
    await writer.finish(scanData(root));
    assert.equal((await readRun(root, writer.id)).status, 'complete');
  } finally { process.chdir(originalCwd);process.env.SystemRoot=originalSystemRoot; }
});

test('poisoned audit directory cannot redirect compressed writes outside workspace', async t => {
  if (process.platform === 'win32') return t.skip('Unprivileged Windows symlink creation is not universally available.');
  const root = await fixture(t), outside = path.join(root, 'outside');
  await fs.mkdir(outside); await fs.symlink(outside, path.join(root, '.diskroom'));
  await assert.rejects(createAudit(root, 'clean'), /symbolic link/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('edited candidates cannot introduce unknown actions or escape scan roots', async t => {
  const root = await fixture(t), writer = await createAudit(root, 'scan');
  const base = { ...scanData(root), id: writer.id };
  assert.throws(() => validateRun({ ...base, candidates: [{ id: 'evil', path: path.dirname(root), operation: 'delete-tree' }] }), /outside/);
  assert.throws(() => validateRun({ ...base, candidates: [{ id: 'evil', path: root, operation: 'shell' }] }), /Unknown candidate/);
});

test('failed durable write permanently poisons writer and preserves earlier readable parts', async t => {
  const root = await fixture(t), writer = await createAudit(root, 'clean');
  await fs.mkdir(path.join(writer.path, 'blocked.json.gz'));
  await assert.rejects(writer.write('blocked', {}), /Cannot durably write audit/);
  await assert.rejects(writer.write('later', {}), /Audit has failed/);
  const summary = await readRun(root, writer.id);
  assert.equal(summary.status, 'running');
  await assert.rejects(fs.access(path.join(writer.path, 'later.json.gz')));
});
