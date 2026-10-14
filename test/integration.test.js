import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
// These subprocesses are deliberately offline; disable the host's optional
// proxy experiment so runtime warnings do not masquerade as CLI diagnostics.
const exec = (file, args, options) => execFileAsync(file, args, { ...options, env: { ...process.env, NODE_USE_ENV_PROXY: '0' } });
const cli = fileURLToPath(new URL('../bin/diskroom.js', import.meta.url));
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'diskroom-cli-integration-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'audit workspace');
  const project = path.join(root, 'projects', 'Příliš žluťoučký project');
  await mkdir(workspace);
  await mkdir(path.join(project, '__pycache__'), { recursive: true });
  await writeFile(path.join(project, 'pyproject.toml'), '[project]\nname="example"\n');
  await writeFile(path.join(project, 'main.py'), 'print("source must survive")\n');
  await writeFile(path.join(project, '__pycache__', 'main.cpython-311.pyc'), Buffer.alloc(4096, 42));
  return { root, workspace, project };
}

test('real non-TTY CLI scans Unicode paths, persists compressed history, and never deletes', async t => {
  const f = await fixture(t);
  const beforeSource = await readFile(path.join(f.project, 'main.py'));
  const beforeCache = await readFile(path.join(f.project, '__pycache__', 'main.cpython-311.pyc'));
  const { stdout } = await exec(process.execPath, [cli, 'scan', f.project, '--workspace', f.workspace, '--target-free', '100kB', '--json'], { cwd: f.root });
  const report = JSON.parse(stdout);
  assert.equal(report.kind, 'scan');
  assert.equal(report.status, 'complete');
  assert.equal(report.targetFree, 100000);
  assert.deepEqual(report.roots, [f.project]);
  assert.equal(report.workspace, f.workspace);
  assert.equal(report.candidates.some(c => c.category === 'bytecode-cache'), true);
  assert.deepEqual(await readFile(path.join(f.project, 'main.py')), beforeSource);
  assert.deepEqual(await readFile(path.join(f.project, '__pycache__', 'main.cpython-311.pyc')), beforeCache);
  await assert.rejects(access(path.join(f.project, '.diskroom')), { code: 'ENOENT' });
  const runFiles = await readdir(report.auditPath);
  assert.ok(runFiles.some(name => name.startsWith('inventory-') && name.endsWith('.json.gz')));
  assert.ok(runFiles.every(name => name.endsWith('.json.gz')));
  const detail = JSON.parse((await exec(process.execPath, [cli, 'history', report.id, '--workspace', f.workspace, '--json'], { cwd: f.root })).stdout);
  assert.equal(detail.id, report.id);
  assert.deepEqual(detail.candidates, report.candidates);
  const history = JSON.parse((await exec(process.execPath, [cli, 'history', '--workspace', f.workspace, '--json'], { cwd: f.root })).stdout);
  assert.deepEqual(history.map(run => run.id), [report.id]);
});

test('real non-TTY cleanup refusal creates no audit or changes even with a scan identifier', async t => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.project, '__pycache__', 'main.cpython-311.pyc'));
  await assert.rejects(exec(process.execPath, [cli, 'clean', '--scan', 'scan-not-read-before-tty-gate', '--workspace', f.workspace], { cwd: f.root }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /requires a real terminal/);
    return true;
  });
  assert.deepEqual(await readdir(f.workspace), []);
  assert.deepEqual(await readFile(path.join(f.project, '__pycache__', 'main.cpython-311.pyc')), before);
});

test('help, version and absent history have no scan or cleanup side effects', async t => {
  const f = await fixture(t);
  for (const args of [['--help'], ['--version'], ['about'], ['history', '--json']]) {
    const result = await exec(process.execPath, [cli, ...args], { cwd: f.workspace });
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.length > 0);
  }
  assert.deepEqual(await readdir(f.workspace), []);
});
