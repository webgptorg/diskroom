import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { main, parseArgs, cleanExitCode } from '../src/cli.js';
import { createPlan, eligible } from '../src/planner.js';

function stream(isTTY = false) { return { isTTY, value: '', write(value) { this.value += value; } }; }
const volume = { id: 'fixture-volume', root: '/fixture', totalBytes: 1e12, freeBytes: 1e9 };

test('parser keeps scope and audit workspace independent and supports decimal sizes', () => {
  const options = parseArgs(['scan', '/projects', '--workspace', '/audit', '--target-free', '2.5GiB', '--scope', 'disk', '--json'], '/start');
  assert.equal(options.path, path.resolve('/projects'));
  assert.equal(options.workspace, path.resolve('/audit'));
  assert.equal(options.targetFree, 2684354560);
  assert.equal(options.json, true);
});

test('ambiguous paths, unsafe automation and invalid flags fail clearly', () => {
  for (const args of [
    ['scan', '/a', '--path', '/b'], ['clean', '--scan', 'id', '--yes'],
    ['scan', '--target-free', '-2GB'], ['scan', '--target-free', 'wat'],
    ['scan', '--activity-days', '0'], ['scan', '--scope', 'all'], ['scan', '--wat'],
    ['clean'], ['about', '--json'], ['history', '--path', '/a'],
  ]) assert.throws(() => parseArgs(args, '/fixture'));
  assert.equal(parseArgs(['scan', '/a', '--path', '/a'], '/fixture').path, path.resolve('/a'));
});

test('help and version neither import scanner nor create audit state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diskroom-cli-help-'));
  try {
    for (const args of [['--help'], ['--version'], ['about']]) {
      const output = stream();
      const code = await main(args, { cwd: root, output, errorOutput: stream(), input: stream(), api: new Proxy({}, { get() { throw new Error('No API should be read.'); } }) });
      assert.equal(code, 0);
      assert.ok(output.value.length > 0);
    }
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('non-TTY cleanup and wizard refuse before accessing any resource', async () => {
  for (const args of [[], ['clean', '--scan', 'id'], ['scan', '--scope', 'system'], ['clean', '--scan', 'id', '--yes']]) {
    const stderr = stream();
    const code = await main(args, { input: stream(), output: stream(), errorOutput: stderr, api: new Proxy({}, { get() { throw new Error('Must refuse before touching disk.'); } }) });
    assert.equal(code, 1);
    assert.match(stderr.value, /terminal|interactive|Unattended/);
  }
});

test('JSON scan creates audit before scan, finishes report and never calls executor', async () => {
  const calls = [];
  const output = stream();
  const api = {
    loadConfig: async () => ({ protect: [], exclude: [], archived: [], activityDays: 30 }),
    resolveScope: async () => ['/fixture'],
    measureVolume: async () => volume,
    createAudit: async (_workspace, kind, initial) => {
      calls.push('audit-created');
      assert.equal(kind, 'scan');
      assert.equal(initial.status, 'running');
      return { id: 'scan-fixture', path: '/audit/.diskroom/runs/scan-fixture', finish: async report => { assert.equal(report.status, 'complete'); calls.push('audit-finished'); } };
    },
    scan: async options => {
      calls.push('scan');
      assert.equal(options.audit.id, 'scan-fixture');
      assert.deepEqual(calls, ['audit-created', 'scan']);
      options.onProgress({ processed: 12, candidates: 0, path: '/fixture' });
      return { ...options, schemaVersion: 1, kind: 'scan', status: 'complete', volume, candidates: [], issues: [] };
    },
    executePlan: async () => assert.fail('scan may never execute cleanup'),
  };
  assert.equal(await main(['scan', '/fixture', '--json', '--workspace', '/audit'], { cwd: '/fixture', input: stream(), output, errorOutput: stream(), api }), 0);
  const result = JSON.parse(output.value);
  assert.equal(result.id, 'scan-fixture');
  assert.equal(result.auditPath, '/audit/.diskroom/runs/scan-fixture');
  assert.deepEqual(calls, ['audit-created', 'scan', 'audit-finished']);
});

test('scan error persists incomplete audit and emits valid JSON with nonzero status', async () => {
  const output = stream();
  let finished;
  const api = {
    loadConfig: async () => ({ protect: [], exclude: [], archived: [] }),
    resolveScope: async () => ['/fixture'], measureVolume: async () => volume,
    createAudit: async () => ({ id: 'failed-fixture', path: '/audit/failed-fixture', finish: async report => { finished = report; } }),
    scan: async () => { throw new Error('Disconnected fixture volume'); },
  };
  assert.equal(await main(['scan', '--json'], { cwd: '/fixture', input: stream(), output, errorOutput: stream(), api }), 1);
  assert.equal(finished.status, 'incomplete');
  assert.match(JSON.parse(output.value).issues[0].message, /Disconnected/);
});

test('history is read-only and returns clean JSON', async () => {
  const output = stream();
  const api = { listRuns: async () => [{ id: 'run-1', kind: 'scan', status: 'complete' }], createAudit: async () => assert.fail('History cannot create audit runs') };
  assert.equal(await main(['history', '--json'], { cwd: '/fixture', input: stream(), output, errorOutput: stream(), api }), 0);
  assert.deepEqual(JSON.parse(output.value), [{ id: 'run-1', kind: 'scan', status: 'complete' }]);
});

test('exit codes prioritize technical failure over target and cancellation', () => {
  assert.equal(cleanExitCode({ status: 'complete', goalReached: true }), 0);
  assert.equal(cleanExitCode({ status: 'target-not-reached', goalReached: false }), 2);
  assert.equal(cleanExitCode({ status: 'complete', goalReached: true, operations: [{ status: 'failed' }] }), 1);
  assert.equal(cleanExitCode({ status: 'incomplete', goalReached: false }), 1);
  assert.equal(cleanExitCode({ status: 'cancelled', goalReached: false }), 130);
});

test('archive annotation is explicit and preserves protection settings', async () => {
  const config = { protect: ['/safe'], exclude: ['/skip'], archived: [], activityDays: 30 };
  let saved;
  const api = { loadConfig: async () => config, saveConfig: async (workspace, data) => { assert.equal(workspace, path.resolve('/audit')); saved = data; } };
  assert.equal(await main(['config', 'archive', 'add', './old', '--workspace', '/audit'], { cwd: '/fixture', input: stream(), output: stream(), errorOutput: stream(), api }), 0);
  assert.deepEqual(saved.archived, [path.resolve('/fixture/old')]);
  assert.deepEqual(saved.protect, ['/safe']);
});

test('real scan and compressed history roundtrip preserve fixture sources and caches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diskroom-cli-roundtrip-'));
  const project = path.join(root, 'project');
  const cache = path.join(project, '__pycache__');
  try {
    await mkdir(cache, { recursive: true });
    await writeFile(path.join(project, 'module.py'), 'VALUE = 42\n');
    await writeFile(path.join(cache, 'module.cpython-312.pyc'), 'isolated test bytes');
    const output = stream(), errors = stream();
    const code = await main(['scan', project, '--json', '--workspace', root], { cwd: root, input: stream(), output, errorOutput: errors });
    assert.equal(code, 0, errors.value);
    const report = JSON.parse(output.value);
    assert.equal(report.kind, 'scan');
    assert.ok(report.candidates.some(candidate => candidate.path.endsWith('__pycache__')));
    assert.equal(await readFile(path.join(project, 'module.py'), 'utf8'), 'VALUE = 42\n');
    assert.equal(await readFile(path.join(cache, 'module.cpython-312.pyc'), 'utf8'), 'isolated test bytes');
    const history = stream();
    assert.equal(await main(['history', report.id, '--json', '--workspace', root], { cwd: root, input: stream(), output: history, errorOutput: errors }), 0, errors.value);
    const restored = JSON.parse(history.value);
    assert.equal(restored.id, report.id);
    assert.deepEqual(restored.candidates, report.candidates);
    assert.ok(restored.auditParts.includes('summary.json.gz'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('saved-scan cleanup records a plan but default NO never calls the executor', async () => {
  const candidate = { id: 'test-cache', path: '/fixture/cache', project: '/fixture/project', status: 'recommended', operation: 'delete-tree', category: 'cache', ecosystem: 'python', reclaimableBytes: 2e9, safety: { score: 98 }, need: { score: 1 }, protection: [], risks: [], restore: [] };
  const scan = { schemaVersion: 1, kind: 'scan', id: 'scan-fixture', status: 'complete', roots: ['/fixture'], workspace: '/fixture', targetFree: 2e9, volume, candidates: [candidate] };
  const keys = [{ text: 'c', key: {} }, { key: { name: 'escape' } }];
  let finalStatus;
  let revisions = 0;
  const api = {
    loadConfig: async () => ({ protect: [], exclude: [], archived: [], activityDays: 30 }),
    readRun: async () => scan, measureVolume: async () => volume, createPlan, eligible,
    createAudit: async () => ({ write: async () => { revisions++; }, finish: async value => { finalStatus = value.status; } }),
    executePlan: async () => assert.fail('Default NO must prevent executePlan entirely'),
  };
  const ui = { bodyHeight: 20, open() {}, close() {}, render() {}, readKey: async () => keys.shift(), details: async () => true, menu: async (_title, choices, options) => { assert.equal(options.initial, 0); return choices[0].value; } };
  assert.equal(await main(['clean', '--scan', 'scan-fixture'], { cwd: '/fixture', input: stream(true), output: stream(true), errorOutput: stream(), api, ui }), 0);
  assert.equal(finalStatus, 'not-approved');
  assert.equal(revisions, 1);
});
