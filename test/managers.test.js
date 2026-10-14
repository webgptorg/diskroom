import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, lstat, rm, chmod, symlink, rename } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { collectDockerCandidates, revalidateManagerCandidate, executeManagerCandidate, inspectGitRepository, resolveManagerExecutable } from '../src/managers.js';
import { detect as detectRuntime } from '../src/plugins/runtime.js';
import { runCommand } from '../src/common.js';

const exec = promisify(execFile);
const imageId = `sha256:${'a'.repeat(64)}`, unusedId = `sha256:${'b'.repeat(64)}`, containerId = 'c'.repeat(64);
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'diskroom-managers-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function dockerFixture(t) {
  const root = await fixture(t), storage = path.join(root, 'docker'); await mkdir(storage);
  const calls = [];
  const state = { daemon: 'local-daemon-identity', images: [
    { Id: imageId, RepoTags: ['example:latest'], RepoDigests: [], Created: '2020-01-01T00:00:00Z', Size: 1024, RootFS: { Layers: ['sha256:layer'] } },
    { Id: unusedId, RepoTags: [], RepoDigests: [], Created: '2020-01-01T00:00:00Z', Size: 2048, RootFS: { Layers: ['sha256:other'] } },
  ], containers: [{ Id: containerId, Image: imageId, Name: '/example', Created: '2020-01-01T00:00:00Z', State: { Status: 'exited', Running: false, StartedAt: '2020-01-01T00:00:00Z', FinishedAt: '2020-01-02T00:00:00Z' }, SizeRw: 50, Mounts: [{ Type: 'volume', Name: 'important', Source: path.join(storage, 'volumes', 'important'), Destination: '/data' }] }] };
  const run = async (executable, args, options) => {
    calls.push({ executable, args, options });
    let value;
    if (args[0] === 'context') value = [{ Endpoints: { docker: { Host: 'unix:///run/docker.sock' } } }];
    else {
      assert.equal(args[0], '--host'); assert.equal(args[1], 'unix:///run/docker.sock');
      const [type, action, ...rest] = args.slice(2);
      if (type === 'info') value = { ID: state.daemon, DockerRootDir: storage, ServerVersion: 'test-only' };
      else if (type === 'image' && action === 'ls') return { code: 0, stdout: state.images.map(v => v.Id).join('\n'), stderr: '' };
      else if (type === 'container' && action === 'ls') return { code: 0, stdout: state.containers.map(v => v.Id).join('\n'), stderr: '' };
      else if (type === 'image' && action === 'inspect') value = state.images.filter(v => rest.includes(v.Id));
      else if (type === 'container' && action === 'inspect') value = state.containers.filter(v => rest.includes(v.Id));
      else if (type === 'volume' && action === 'ls') return { code: 0, stdout: JSON.stringify({ Name: 'important', Driver: 'local' }) + '\n', stderr: '' };
      else if (type === 'image' && action === 'rm') { assert.deepEqual(rest, ['--no-prune', unusedId]); state.images = state.images.filter(v => v.Id !== unusedId); return { code: 0, stdout: 'deleted', stderr: '' }; }
      else if (type === 'container' && action === 'rm') { assert.deepEqual(rest, [containerId]); state.containers = state.containers.filter(v => v.Id !== containerId); return { code: 0, stdout: containerId, stderr: '' }; }
      else throw new Error(`Unexpected Docker command: ${args.join(' ')}`);
    }
    return { code: 0, stdout: JSON.stringify(value), stderr: '' };
  };
  const options = { roots: [root], storageRoots: [storage], volume: { id: String((await lstat(storage)).dev) }, config: { protect: [], exclude: [] }, env: {}, run };
  return { root, storage, state, calls, run, options, report: { roots: [root], volume: options.volume, config: options.config } };
}

test('ordinary project scan does not resolve or contact Docker', async () => {
  const result = await collectDockerCandidates({ roots: ['/unrelated'], run: () => { throw new Error('must not run'); } });
  assert.equal(result.coverage, 'outside-scope'); assert.deepEqual(result.candidates, []);
});

test('Docker inventories exact local resources, preserves unknown gains and protects referenced images', async t => {
  const f = await dockerFixture(t), result = await collectDockerCandidates(f.options);
  assert.equal(result.coverage, 'local-daemon-inventory', JSON.stringify(result.issues));
  assert.equal(result.candidates.length, 4);
  const referenced = result.candidates.find(c => c.metadata.resourceSnapshot.id === imageId);
  assert.equal(referenced.status, 'protected');
  assert.match(referenced.protection.join(' '), /references/);
  assert.equal(result.candidates.find(c => c.category === 'docker-volume').operation, 'detect-only');
  assert.ok(result.candidates.every(c => c.reclaimableBytes === null));
  assert.ok(f.calls.every(c => c.options.shell !== true));
});

test('Docker refuses remote endpoint before daemon information or inventory', async t => {
  const f = await dockerFixture(t);
  const result = await collectDockerCandidates({ ...f.options, env: { DOCKER_HOST: 'ssh://remote.example' } });
  assert.equal(result.coverage, 'unavailable'); assert.match(result.issues[0].message, /Remote daemons are not contacted/);
  assert.equal(f.calls.length, 0);
});

test('Docker storage outside explicit scope never enumerates resources', async t => {
  const f = await dockerFixture(t), other = path.join(f.root, 'project'); await mkdir(other);
  const result = await collectDockerCandidates({ ...f.options, roots: [other] });
  assert.equal(result.coverage, 'unavailable'); assert.match(result.issues[0].message, /outside/);
  assert.equal(f.calls.some(c => c.args.includes('ls')), false);
});

test('Docker image action removes only exact unreferenced image without force or parent pruning', async t => {
  const f = await dockerFixture(t), inventory = await collectDockerCandidates(f.options);
  const candidate = inventory.candidates.find(c => c.metadata.resourceSnapshot.id === unusedId);
  const result = await executeManagerCandidate(candidate, { scan: f.report, run: f.run, env: {} });
  assert.equal(result.status, 'completed'); assert.equal(result.verification.exactResourceAbsent, true);
  assert.deepEqual(f.calls.filter(c => c.args.includes('rm')).map(c => c.args), [['--host', 'unix:///run/docker.sock', 'image', 'rm', '--no-prune', unusedId]]);
  assert.equal(f.state.images.some(v => v.Id === imageId), true);
});

test('stopped Docker container removal preserves volumes and never forces a running container', async t => {
  const f = await dockerFixture(t), inventory = await collectDockerCandidates(f.options);
  const candidate = inventory.candidates.find(c => c.category === 'docker-container');
  assert.equal(candidate.status, 'risky');
  const result = await executeManagerCandidate(candidate, { scan: f.report, run: f.run, env: {} });
  assert.equal(result.status, 'completed');
  assert.equal(result.verification.volumeRemovalRequested, false);
  assert.deepEqual(f.calls.filter(c => c.args.includes('rm')).map(c => c.args), [['--host', 'unix:///run/docker.sock', 'container', 'rm', containerId]]);
});

test('Docker changes to daemon, running state, tags or writable layer invalidate an approved resource', async t => {
  const f = await dockerFixture(t), inventory = await collectDockerCandidates(f.options);
  const container = inventory.candidates.find(c => c.category === 'docker-container');
  f.state.containers[0].State.Running = true;
  assert.equal((await revalidateManagerCandidate(container, f.report, { run: f.run })).ok, false);
  f.state.containers[0].State.Running = false; f.state.containers[0].SizeRw++;
  assert.equal((await revalidateManagerCandidate(container, f.report, { run: f.run })).ok, false);
  const image = inventory.candidates.find(c => c.metadata.resourceSnapshot.id === unusedId);
  f.state.images[1].RepoTags.push('new:tag');
  assert.equal((await revalidateManagerCandidate(image, f.report, { run: f.run })).ok, false);
  f.state.images[1].RepoTags = []; f.state.daemon = 'replacement';
  assert.equal((await revalidateManagerCandidate(image, f.report, { run: f.run })).ok, false);
  assert.equal(f.calls.some(c => c.args.includes('rm')), false);
});

test('saved Docker status cannot downgrade fresh risky container classification', async t => {
  const f = await dockerFixture(t), inventory = await collectDockerCandidates(f.options);
  const candidate = inventory.candidates.find(c => c.category === 'docker-container');
  const result = await revalidateManagerCandidate({ ...candidate, status: 'recommended' }, f.report, { run: f.run });
  assert.equal(result.ok, true); assert.equal(result.candidate.status, 'risky');
});

async function gitFixture(t) {
  const root = await fixture(t), project = path.join(root, 'project'), git = await resolveManagerExecutable('git');
  await mkdir(project);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const run = async args => (await exec(git, args, { cwd: project, env })).stdout;
  await run(['init', '--quiet']); await run(['config', 'user.name', 'DiskRoom fixture']); await run(['config', 'user.email', 'fixture@example.invalid']);
  await writeFile(path.join(project, 'source.txt'), 'tracked source survives\n'); await run(['add', 'source.txt']); await run(['commit', '--quiet', '-m', 'fixture']);
  await writeFile(path.join(root, 'unreachable.txt'), 'unique unreachable object must survive\n');
  const unreachable = (await run(['hash-object', '-w', path.join(root, 'unreachable.txt')])).trim();
  const gitDir = path.join(project, '.git');
  const make = async () => {
    const inspected = await inspectGitRepository(gitDir); assert.equal(inspected.supported, true, inspected.reasons.join(' '));
    const candidate = { id: 'git-fixture', path: gitDir, project, ecosystem: 'git', operation: 'git-gc', status: 'review', protection: [], fingerprint: inspected.fingerprint, metadata: { managerAction: true, volumeId: String(inspected.fingerprint.dev), gitSnapshot: inspected.snapshot, gitDigest: inspected.digest } };
    return { candidate, scan: { roots: [root], volume: { id: String(inspected.fingerprint.dev) } } };
  };
  return { root, project, gitDir, run, unreachable, make };
}

test('real Git metadata inspection is read-only and rejects configured project execution', async t => {
  const f = await gitFixture(t), before = await readFile(path.join(f.gitDir, 'config'));
  const inspected = await inspectGitRepository(f.gitDir);
  assert.equal(inspected.supported, true); assert.equal(inspected.local.worktreeState, 'not-inspected');
  assert.deepEqual(await readFile(path.join(f.gitDir, 'config')), before);
  const sentinel = path.join(f.root, 'should-not-exist');
  await f.run(['config', 'core.fsmonitor', `touch ${sentinel}`]);
  const blocked = await inspectGitRepository(f.gitDir);
  assert.equal(blocked.supported, false); assert.match(blocked.reasons.join(' '), /unsupported repository configuration/);
  await assert.rejects(lstat(sentinel), { code: 'ENOENT' });
});

test('real Git maintenance retains every reachable and unreachable object, refs, worktree and hooks', { skip: process.platform !== 'linux' }, async t => {
  const f = await gitFixture(t), sentinel = path.join(f.root, 'hook-must-not-run');
  const hook = path.join(f.gitDir, 'hooks', 'pre-auto-gc');
  await writeFile(hook, `#!/bin/sh\nprintf wrong > '${sentinel}'\n`); await chmod(hook, 0o755);
  const objectsBefore = (await f.run(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'])).trim().split('\n').sort();
  const refsBefore = await f.run(['show-ref']); const sourceBefore = await readFile(path.join(f.project, 'source.txt'));
  const { candidate, scan } = await f.make();
  const result = await executeManagerCandidate(candidate, { scan });
  assert.equal(result.status, 'completed'); assert.equal(result.verification.refsPreserved, true);
  assert.deepEqual((await f.run(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'])).trim().split('\n').sort(), objectsBefore);
  assert.equal(await f.run(['show-ref']), refsBefore);
  assert.deepEqual(await readFile(path.join(f.project, 'source.txt')), sourceBefore);
  assert.match(await f.run(['cat-file', '-p', f.unreachable]), /unique unreachable/);
  await assert.rejects(lstat(sentinel), { code: 'ENOENT' });
});

test('Git metadata and object-store links are refused before maintenance', { skip: process.platform === 'win32' }, async t => {
  const f = await gitFixture(t), outside = path.join(f.root, 'external-objects');
  await rename(path.join(f.gitDir, 'objects'), outside); await symlink(outside, path.join(f.gitDir, 'objects'), 'dir');
  const result = await inspectGitRepository(f.gitDir);
  assert.equal(result.supported, false); assert.match(result.reasons.join(' '), /symlink/);
});

test('Git config changes after review prevent maintenance', { skip: process.platform !== 'linux' }, async t => {
  const f = await gitFixture(t), { candidate, scan } = await f.make();
  await f.run(['config', 'user.name', 'changed after review']);
  const result = await revalidateManagerCandidate(candidate, scan);
  assert.equal(result.ok, false); assert.match(result.reasons.join(' '), /changed after review/);
});

test('pinned Git object-store view cannot write through a replaced pack-directory link', { skip: process.platform !== 'linux' }, async t => {
  const f = await gitFixture(t), { candidate, scan } = await f.make();
  const external = path.join(f.root, 'outside'), git = await resolveManagerExecutable('git');
  await mkdir(external); await writeFile(path.join(external, 'keep'), 'unapproved directory survives');
  let replaced = false;
  const run = async (_command, args, settings) => {
    if (args.includes('repack') && !replaced) {
      replaced = true;
      await rename(path.join(f.gitDir, 'objects', 'pack'), path.join(f.root, 'original-pack'));
      await symlink(external, path.join(f.gitDir, 'objects', 'pack'), 'dir');
    }
    return runCommand(git, args, settings);
  };
  await assert.rejects(executeManagerCandidate(candidate, { scan, run }), /preservation could not be verified/);
  assert.equal(replaced, true);
  assert.deepEqual(await readdir(external), ['keep']);
  assert.equal(await readFile(path.join(external, 'keep'), 'utf8'), 'unapproved directory survives');
});

test('runtime metadata explicitly protects newest and configured default versions', async t => {
  const root = await fixture(t), collection = path.join(root, '.nvm', 'versions', 'node');
  for (const version of ['v20.0.0', 'v22.0.0']) { await mkdir(path.join(collection, version, 'bin'), { recursive: true }); await writeFile(path.join(collection, version, 'bin', 'node'), 'fixture runtime'); }
  await mkdir(path.join(root, '.nvm', 'alias')); await writeFile(path.join(root, '.nvm', 'alias', 'default'), 'v20.0.0\n');
  const latest = await detectRuntime({ file: path.join(collection, 'v22.0.0') }), defaultVersion = await detectRuntime({ file: path.join(collection, 'v20.0.0') });
  assert.equal(latest.operation, 'detect-only'); assert.match(latest.metadata.runtimeProtection.join(' '), /Newest/);
  assert.match(defaultVersion.metadata.runtimeProtection.join(' '), /default/);
});
