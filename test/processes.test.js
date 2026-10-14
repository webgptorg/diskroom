import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { nativeProcessSnapshot, parseLsofProcessFields, parseWindowsProcessLines, windowsAbsoluteArguments, runProcessProbe } from '../src/processes.js';
import * as native from '../native/index.js';

const lsofRecord = (pid, uid, entries) => `p${pid}\0u${uid}\0\n${entries.map(([fd, file]) => `f${fd}\0n${file}\0\n`).join('')}`;
const winRecord = (pid, executablePath, commandLine, sameUser = true) => JSON.stringify({ type: 'process', pid, executablePath, commandLine, sameUser }) + '\n';
const winComplete = JSON.stringify({ type: 'complete', omitted: false }) + '\n';
const success = stdout => ({ stdout, code: 0, failed: false, timedOut: false, truncated: false, stderr: false });

test('lsof machine records protect same-user cwd, executable, mappings and open paths only', () => {
  const output = lsofRecord(42, 501, [['cwd', '/Users/test/project'], ['txt', '/usr/bin/node'], ['mem', '/Users/test/project/library'], ['7', '/Users/test/project/build file'], ['8', '127.0.0.1:9000'], ['9', 'relative']])
    + lsofRecord(99, 502, [['cwd', '/other-user']]) + lsofRecord(7, 501, [['cwd', '/self']]);
  assert.deepEqual(parseLsofProcessFields(output, { uid: 501, selfPid: 7 }), {
    refs: [
      { path: '/Users/test/project', kind: 'cwd', pid: 42 },
      { path: '/usr/bin/node', kind: 'exe', pid: 42 },
      { path: '/Users/test/project/library', kind: 'memory-map', pid: 42 },
      { path: '/Users/test/project/build file', kind: 'open-file', pid: 42 },
    ], incomplete: false,
  });
});

test('lsof preserves NUL field boundaries, escaped Unicode and ambiguous literal names', () => {
  const output = lsofRecord(42, 501, [['cwd', '/project/line\nname'], ['7', '/project/\\xc4\\x8desk\\xc3\\xbd'], ['8', '/project/file (deleted)']]);
  const { refs } = parseLsofProcessFields(output, { uid: 501, selfPid: 7 });
  for (const file of ['/project/line\nname', '/project/český', '/project/\\xc4\\x8desk\\xc3\\xbd', '/project/file (deleted)', '/project/file']) assert.ok(refs.some(ref => ref.path === file), file);
});

test('lsof requires a verified process owner, bounds output and retains complete fields before truncation', () => {
  assert.deepEqual(parseLsofProcessFields('p42\0fcwd\0n/unknown-owner\0\n', { uid: 501 }).refs, []);
  assert.equal(parseLsofProcessFields(lsofRecord(42, 501, [['cwd', '/one'], ['4', '/two']]), { uid: 501, maxRefs: 1 }).incomplete, true);
  const truncated = parseLsofProcessFields(lsofRecord(42, 501, [['cwd', '/one']]) + 'f4\0n/incomplete', { uid: 501 });
  assert.equal(truncated.incomplete, true);
  assert.deepEqual(truncated.refs.map(ref => ref.path), ['/one']);
  assert.equal(parseLsofProcessFields(Buffer.from([0xff]), { uid: 501 }).incomplete, true);
  assert.equal(parseLsofProcessFields('x'.repeat(8 * 1024 * 1024 + 1), { uid: 501 }).incomplete, true);
});

test('Windows whole absolute arguments support quoting, spaces, UNC and namespaced local paths', () => {
  assert.deepEqual(windowsAbsoluteArguments(String.raw`"C:\Program Files\node.exe" "C:\project space\app.js" C:\work\cache \\server\share\data "\\?\C:\long path\data" --token=secret relative.js --project=C:\embedded`), [
    'C:\\project space\\app.js', 'C:\\work\\cache', '\\\\server\\share\\data', 'C:\\long path\\data',
  ]);
  assert.deepEqual(windowsAbsoluteArguments(String.raw`node "C:\project space\\" C:\after`), ['C:\\project space\\', 'C:\\after']);
  assert.deepEqual(windowsAbsoluteArguments('node "C:\\unterminated'), []);
  assert.deepEqual(windowsAbsoluteArguments('node C:relative \\drive-relative \\.\\PIPE\\pipe'), []);
  assert.deepEqual(windowsAbsoluteArguments('x'.repeat(32769)), []);
});

test('Windows records retain only verified same-user executable and absolute references, never commands or secrets', () => {
  const raw = winRecord(42, 'C:\\node.exe', 'C:\\node.exe "C:\\work space\\app.js" --token=DO_NOT_PERSIST')
    + winRecord(7, 'C:\\self.exe', 'C:\\self.exe C:\\self')
    + winRecord(88, 'C:\\other.exe', 'C:\\other.exe C:\\other', false) + winComplete;
  const parsed = parseWindowsProcessLines(raw, { selfPid: 7 });
  assert.deepEqual(parsed.refs, [{ path: 'C:\\node.exe', kind: 'exe', pid: 42 }, { path: 'C:\\work space\\app.js', kind: 'process-argument', pid: 42 }]);
  assert.equal(JSON.stringify(parsed).includes('DO_NOT_PERSIST'), false);
  assert.equal(JSON.stringify(parsed).includes('commandLine'), false);
  assert.equal(parsed.incomplete, true);
});

test('Windows parsing handles missing, malformed and bounded records without losing earlier protection', () => {
  const valid = winRecord(42, 'C:\\node.exe', 'C:\\node.exe C:\\work');
  assert.equal(parseWindowsProcessLines(valid + winComplete).incomplete, false);
  assert.equal(parseWindowsProcessLines(valid).incomplete, true);
  assert.equal(parseWindowsProcessLines(valid + '{"truncated":').refs.length, 2);
  assert.equal(parseWindowsProcessLines(valid + winComplete, { maxRefs: 1 }).incomplete, true);
  assert.equal(parseWindowsProcessLines(winRecord(42, null, null) + winComplete).incomplete, true);
  assert.equal(parseWindowsProcessLines(Buffer.from([0xff])).incomplete, true);
});

test('macOS probes fixed trusted executables with a sanitized environment and remains partial', async () => {
  const attempts = [];
  const snapshot = await nativeProcessSnapshot({ platform: 'darwin', uid: 501, selfPid: 7,
    executableExists: async file => { attempts.push(file); return file === '/usr/bin/lsof'; },
    run: async (executable, args, options) => {
      assert.equal(executable, '/usr/bin/lsof');
      assert.ok(args.includes('-F0pufn')); assert.ok(args.includes('501')); assert.ok(args.includes('^7'));
      assert.deepEqual(Object.keys(options.env).sort(), ['LANG', 'LC_ALL', 'PATH']);
      return success(lsofRecord(42, 501, [['cwd', '/protected']]));
    },
  });
  assert.deepEqual(attempts, ['/usr/sbin/lsof', '/usr/bin/lsof']);
  assert.equal(snapshot.coverage, 'partial');
  assert.deepEqual(snapshot.refs, [{ path: '/protected', kind: 'cwd', pid: 42 }]);
  assert.match(snapshot.limitations.join(' '), /not proof of inactivity/);
});

test('Windows probes native-discovered system PowerShell without user profiles or arbitrary module paths', async () => {
  const snapshot = await nativeProcessSnapshot({ platform: 'win32', selfPid: 7,
    systemDirectory: () => 'D:\\Windows\\System32', executableExists: async file => file === 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    run: async (executable, args, options) => {
      assert.equal(executable, 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.ok(args.includes('-NoProfile')); assert.ok(args.includes('-NonInteractive'));
      assert.match(args.at(-1), /GetOwnerSid/); assert.match(args.at(-1), /owner\.Sid -eq \$ownerSid/);
      assert.equal(options.env.SystemRoot, 'D:\\Windows');
      assert.equal(options.env.PSModulePath, 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
      assert.equal(Object.hasOwn(options.env, 'NODE_OPTIONS'), false);
      return success(winRecord(42, 'D:\\node.exe', 'D:\\node.exe D:\\protected') + winComplete);
    },
  });
  assert.equal(snapshot.coverage, 'partial');
  assert.equal(snapshot.refs.length, 2);
  assert.match(snapshot.limitations.join(' '), /working directories and open-file handles are unavailable/);
});

test('missing trusted helper and unavailable native discovery fail closed without PATH or environment fallback', async () => {
  let ran = false; const run = async () => { ran = true; throw new Error('must not execute'); };
  assert.equal((await nativeProcessSnapshot({ platform: 'darwin', uid: 501, executableExists: async () => false, run })).coverage, 'unavailable');
  assert.equal((await nativeProcessSnapshot({ platform: 'win32', systemDirectory: () => { throw new Error('missing addon'); }, run })).coverage, 'unavailable');
  assert.equal((await nativeProcessSnapshot({ platform: 'win32', systemDirectory: () => '\\\\remote\\System32', run })).coverage, 'unavailable');
  assert.equal(ran, false);
});

test('query warnings and limits retain observations while excluding diagnostic secrets', async () => {
  const snapshot = await nativeProcessSnapshot({ platform: 'darwin', uid: 501, executableExists: async () => true,
    run: async () => ({ ...success(lsofRecord(42, 501, [['cwd', '/protected']])), timedOut: true, truncated: true, stderr: 'DO_NOT_PERSIST', code: 1 }),
  });
  assert.equal(snapshot.refs.length, 1);
  assert.match(snapshot.limitations.join(' '), /time limit/);
  assert.match(snapshot.limitations.join(' '), /output limit/);
  assert.equal(JSON.stringify(snapshot).includes('DO_NOT_PERSIST'), false);
});

test('bounded process runner stops excessive output and does not retain stderr', async () => {
  const result = await runProcessProbe(process.execPath, ['-e', 'process.stderr.write("private");process.stdout.write("x".repeat(65536));setInterval(()=>{},1000)'], { maxBytes: 1024, timeoutMs: 3000, env: {} });
  assert.equal(result.truncated, true); assert.equal(result.stdout.length, 1024);
  assert.equal(typeof result.stderr, 'boolean'); assert.equal(JSON.stringify(result).includes('private'), false);
});

test('bounded process runner enforces deadlines and contains spawn errors', async () => {
  const result = await runProcessProbe(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100, env: {} });
  assert.equal(result.timedOut, true);
  const missing = await runProcessProbe(path.join(os.tmpdir(), 'diskroom-nonexistent-executable'), [], { env: {} });
  assert.equal(missing.failed, true);
});

test('native Windows helper discovers OS directory and safely hides an ordinary audit directory', { skip: process.platform !== 'win32' || !native.available }, async t => {
  assert.match(native.systemDirectory(), /^[a-z]:\\.+\\System32$/i);
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'diskroom-native-audit-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  await writeFile(path.join(base, 'keep.txt'), 'unchanged');
  assert.equal(native.markHidden(base), true);
  assert.equal(native.markHidden(base), true);
  assert.equal(await readFile(path.join(base, 'keep.txt'), 'utf8'), 'unchanged');
  const alias = `${base}-junction`;
  await symlink(base, alias, 'junction'); t.after(() => rm(alias, { force: true, recursive: true }));
  assert.throws(() => native.markHidden(alias));
});

test('real macOS observer sees a same-user child working directory', { skip: process.platform !== 'darwin' }, async t => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'diskroom-process-')));
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'], { cwd: directory, stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } await rm(directory, { recursive: true, force: true }); });
  await once(child.stdout, 'data');
  const snapshot = await nativeProcessSnapshot();
  assert.equal(snapshot.coverage, 'partial');
  assert.ok(snapshot.refs.some(ref => ref.pid === child.pid && ref.kind === 'cwd' && ref.path === directory), JSON.stringify(snapshot.limitations));
});

test('real Windows observer protects a child absolute argument', { skip: process.platform !== 'win32' || !native.available }, async t => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'diskroom-process-')));
  const file = path.join(directory, 'worker.js');
  await writeFile(file, 'process.stdout.write("ready");setInterval(()=>{},1000)');
  const child = spawn(process.execPath, [file], { cwd: directory, stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } await rm(directory, { recursive: true, force: true }); });
  await once(child.stdout, 'data');
  const snapshot = await nativeProcessSnapshot();
  assert.equal(snapshot.coverage, 'partial');
  assert.ok(snapshot.refs.some(ref => ref.pid === child.pid && ref.kind === 'process-argument' && ref.path.toLowerCase() === file.toLowerCase()), JSON.stringify(snapshot.limitations));
});
