import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { access, lstat, realpath, readFile, readlink, readdir, statfs, mkdtemp, rm, mkdir, writeFile, copyFile, open, symlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { runCommand, within, fingerprint, sameFingerprint } from './common.js';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const CONTAINER_ID = /^[a-f0-9]{64}$/;
const MANAGER_ACTIONS = new Set(['git-gc', 'docker-image-remove', 'docker-container-remove']);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const bytes = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const cleanError = error => String(error?.message || error).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[redacted]@');

/** Only known installation locations are trusted, never a project-supplied PATH entry. */
export async function resolveManagerExecutable(name) {
  assert(['git', 'docker'].includes(name), 'Unknown manager executable.');
  const candidates = process.platform === 'win32'
    ? name === 'git'
      ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'cmd', 'git.exe')]
      : [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe')]
    : [`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/opt/homebrew/bin/${name}`, ...(name === 'docker' ? ['/Applications/Docker.app/Contents/Resources/bin/docker'] : [])];
  for (const candidate of candidates) {
    try { const resolved = await realpath(candidate); const s = await lstat(resolved); if (s.isFile()) { await access(resolved, constants.X_OK); return resolved; } } catch {}
  }
  throw new Error(`${name} is unavailable in a trusted installation location; manager actions are disabled.`);
}

function managerEnvironment(name, executable, supplied = process.env) {
  const env = { ...supplied };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key) || /^LD_/i.test(key) || /^DYLD_/i.test(key)) delete env[key];
  env.PATH = process.platform === 'win32'
    ? [path.dirname(executable), path.join(env.SystemRoot || 'C:\\Windows', 'System32'), env.SystemRoot || 'C:\\Windows'].join(path.delimiter)
    : [path.dirname(executable), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter);
  env.LC_ALL = 'C'; env.LANG = 'C';
  if (name === 'git') {
    env.GIT_CONFIG_NOSYSTEM = '1'; env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
    env.GIT_OPTIONAL_LOCKS = '0'; env.GIT_TERMINAL_PROMPT = '0'; env.GIT_NO_REPLACE_OBJECTS = '1';
  }
  if (name === 'docker') for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
  return env;
}

async function runner(name, options = {}) {
  const executable = options.run ? name : await resolveManagerExecutable(name);
  const env = managerEnvironment(name, executable, options.env || process.env);
  const invoke = async (args, settings = {}) => {
    const result = await (options.run || runCommand)(executable, args, { env: { ...env, ...settings.env }, cwd: settings.cwd || (options.run ? os.tmpdir() : path.dirname(executable)), signal: options.signal, timeout: settings.timeout || 15000, maxBytes: 16 * 1024 * 1024 });
    return { ...result, code: result.code ?? result.exitCode };
  };
  return { executable, invoke };
}
async function checked(tool, args, settings) {
  const result = await tool.invoke(args, settings);
  assert(result.code === 0, `Manager command failed (${args[0]}): ${cleanError(result.stderr || `exit ${result.code}`)}`);
  return result.stdout;
}
async function json(tool, args) { return JSON.parse(await checked(tool, args)); }
function lines(value) { return value.trim() ? value.trim().split(/\r?\n/).filter(Boolean) : []; }
function localEndpoint(value) {
  if (typeof value !== 'string') return false;
  if (value.startsWith('unix://')) return path.posix.isAbsolute(value.slice(7)) && !value.includes('\0');
  return /^npipe:\/\/\/\/(?:\.|\?)\/pipe\/[A-Za-z0-9_.-]+$/i.test(value);
}

async function dockerSession(options = {}) {
  const tool = await runner('docker', options);
  const originalEnv = options.env || process.env;
  let endpoint = options.endpoint;
  if (!endpoint) {
    // Context selection itself is local metadata; reject network endpoints before `info`.
    if (originalEnv.DOCKER_CONTEXT) {
      const context = await json(tool, ['context', 'inspect', originalEnv.DOCKER_CONTEXT]);
      endpoint = context[0]?.Endpoints?.docker?.Host;
    } else if (originalEnv.DOCKER_HOST) endpoint = originalEnv.DOCKER_HOST;
    else {
      const context = await json(tool, ['context', 'inspect']);
      endpoint = context[0]?.Endpoints?.docker?.Host;
    }
  }
  assert(localEndpoint(endpoint), 'Docker endpoint is not an explicitly local Unix socket or local Windows named pipe. Remote daemons are not contacted.');
  const command = (...args) => ['--host', endpoint, ...args];
  const info = await json(tool, command('info', '--format', '{{json .}}'));
  assert(typeof info.ID === 'string' && info.ID.length > 0 && typeof info.DockerRootDir === 'string', 'Docker daemon did not provide a stable identity and storage directory.');
  let storageRoot, storageStat;
  try { storageRoot = await realpath(info.DockerRootDir); storageStat = await lstat(storageRoot); } catch {
    throw new Error('Docker storage is not directly on this host filesystem (for example Docker Desktop VM storage). Host-space cleanup cannot be verified; use the storage finding for review.');
  }
  assert(storageStat.isDirectory() && !storageStat.isSymbolicLink(), 'Docker storage root is not an ordinary local directory.');
  if (options.roots) assert(options.roots.some(root => within(storageRoot, root)), 'Docker storage is outside the explicitly selected scan scope; no Docker resource inventory was added.');
  if (options.volume) assert(String(storageStat.dev) === String(options.volume.id), 'Docker storage belongs to a different target volume.');
  return { tool, command, endpoint, daemonId: info.ID, storageRoot, storageStat, serverVersion: String(info.ServerVersion || 'unknown') };
}

function imageSnapshot(value) {
  assert(IMAGE_ID.test(value.Id), 'Docker returned a malformed full image ID.');
  return { id: value.Id, tags: [...(value.RepoTags || [])].sort(), digests: [...(value.RepoDigests || [])].sort(), created: value.Created || null, size: bytes(value.Size), layers: [...(value.RootFS?.Layers || [])] };
}
function containerSnapshot(value) {
  assert(CONTAINER_ID.test(value.Id), 'Docker returned a malformed full container ID.');
  return { id: value.Id, image: value.Image, created: value.Created || null, status: value.State?.Status || 'unknown', running: value.State?.Running === true, paused: value.State?.Paused === true, restarting: value.State?.Restarting === true, dead: value.State?.Dead === true, startedAt: value.State?.StartedAt || null, finishedAt: value.State?.FinishedAt || null, writableBytes: bytes(value.SizeRw), name: String(value.Name || '').replace(/^\//, ''), mounts: (value.Mounts || []).map(m => ({ type: m.Type, name: m.Name || null, source: m.Source, destination: m.Destination })).sort((a, b) => String(a.destination).localeCompare(String(b.destination))) };
}
const stopped = value => !value.running && !value.paused && !value.restarting && !value.dead && ['created', 'exited'].includes(value.status);

async function dockerInventory(session) {
  const { tool, command } = session;
  const ids = [...new Set(lines(await checked(tool, command('container', 'ls', '--all', '--quiet', '--no-trunc'))))];
  assert(ids.length <= 10000 && ids.every(id => CONTAINER_ID.test(id)), 'Docker container inventory is too large or has malformed identifiers.');
  const containers = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const values = await json(tool, command('container', 'inspect', '--size', ...ids.slice(offset, offset + 100)));
    containers.push(...values.map(containerSnapshot));
  }
  const imageIds = [...new Set(lines(await checked(tool, command('image', 'ls', '--all', '--quiet', '--no-trunc'))))];
  assert(imageIds.length <= 10000 && imageIds.every(id => IMAGE_ID.test(id)), 'Docker image inventory is too large or has malformed identifiers.');
  const images = [];
  for (let offset = 0; offset < imageIds.length; offset += 100) {
    images.push(...(await json(tool, command('image', 'inspect', ...imageIds.slice(offset, offset + 100)))).map(imageSnapshot));
  }
  const volumes = lines(await checked(tool, command('volume', 'ls', '--format', '{{json .}}'))).map(line => {
    const v = JSON.parse(line); return { name: String(v.Name), driver: String(v.Driver || 'unknown') };
  });
  assert(volumes.length <= 10000, 'Docker volume inventory limit exceeded.');
  return { containers, images, volumes };
}

function dockerCandidate(session, snapshot, type, options, inventory) {
  const protection = [];
  const resourceId = `${session.daemonId}/${type}/${snapshot.id || snapshot.name}`;
  const relevantPaths = [session.storageRoot, ...(snapshot.mounts || []).map(m => m.source).filter(p => typeof p === 'string' && path.isAbsolute(p))];
  for (const reserved of [...(options.config?.protect || []), ...(options.config?.exclude || [])]) if (relevantPaths.some(p => within(p, reserved) || within(reserved, p))) protection.push('Docker storage or a container mount overlaps an explicitly protected or excluded path.');
  if (type === 'container' && !stopped(snapshot)) protection.push('The container is running, paused, restarting, dead, or in an unrecognized state; DiskRoom never stops or forces a container.');
  if (type === 'image' && inventory.containers.some(c => c.image === snapshot.id)) protection.push('An existing container references this image, including stopped containers.');
  if (type === 'image' && snapshot.tags.length > 1) protection.push('Multiple tags refer to this image; removing it by ID would require force or additional unapproved untagging.');
  const operation = type === 'image' ? 'docker-image-remove' : type === 'container' ? 'docker-container-remove' : 'detect-only';
  const reasons = type === 'image'
    ? ['Exact local daemon image inventory. The selected full image ID is removed with --no-prune, without --force and without deleting untagged parent images.']
    : type === 'container'
      ? ['Exact container inventory. Removing this stopped container permanently removes its writable layer and metadata; attached volumes and bind-mount contents are preserved.']
      : ['Docker volume inventory. Volumes can contain unique application data and are never automatically selected or deleted.'];
  const risks = type === 'image'
    ? ['Image layers may be shared; logical size is not a reclaim guarantee.', 'Locally built images may have no registry or source copy.']
    : type === 'container'
      ? ['The container writable layer may be the only copy of application data.', 'Recreating a container requires its image and original configuration. DiskRoom does not save secrets or a runnable copy of that configuration.']
      : ['A stopped application does not make its persistent data disposable.'];
  return { id: hash(resourceId).slice(0, 20), path: session.storageRoot, project: null, ecosystem: 'docker', category: `docker-${type}`, operation, status: protection.length ? 'protected' : type === 'container' ? 'risky' : 'review', logicalBytes: type === 'image' ? snapshot.size : type === 'container' ? snapshot.writableBytes : null, allocatedBytes: null, reclaimableBytes: null, safety: { score: type === 'image' ? 55 : 10, confidence: 'medium', reasons }, need: { score: protection.length ? 100 : null, confidence: 'low', reasons: protection.length ? protection : ['Future application need is not inferable from current Docker state.'] }, reasons, restore: [type === 'image' ? 'Pull the exact digest if it remains accessible, rebuild from retained source, or restore a previously saved image archive.' : type === 'container' ? 'Recreate the container from your retained deployment definition and restore writable-layer data from your own backup.' : 'Restore persistent data from your own verified backup.'], risks, protection, fingerprint: fingerprint(session.storageStat), activityAt: snapshot.finishedAt || snapshot.created || null, manager: 'docker', resourceId, metadata: { managerAction: operation !== 'detect-only', resourceType: type, endpoint: session.endpoint, daemonId: session.daemonId, storageRoot: session.storageRoot, volumeId: String(session.storageStat.dev), serverVersion: session.serverVersion, resourceSnapshot: snapshot, resourceDigest: hash(snapshot) } };
}

/** Local read-only inventory; scope and volume checks precede resource enumeration. */
export async function collectDockerCandidates(options = {}) {
  if (!options.storageRoots?.length) return { candidates: [], issues: [], coverage: 'outside-scope' };
  try {
    const session = await dockerSession(options);
    assert((await Promise.all(options.storageRoots.map(p => realpath(p)))).includes(session.storageRoot), 'The Docker daemon does not own the storage directory identified inside this scan scope.');
    const inventory = await dockerInventory(session);
    return { candidates: [...inventory.images.map(v => dockerCandidate(session, v, 'image', options, inventory)), ...inventory.containers.map(v => dockerCandidate(session, v, 'container', options, inventory)), ...inventory.volumes.map(v => dockerCandidate(session, v, 'volume', options, inventory))], issues: [], coverage: 'local-daemon-inventory', limitations: ['Build cache is not executable: Docker builder prune does not provide the exact immutable resource selection required for this release.', 'Docker layer sharing makes individual host-space gains unknown; only actual target-volume measurements can satisfy the goal.'] };
  } catch (error) { return { candidates: [], issues: [{ code: 'DOCKER_UNAVAILABLE', message: cleanError(error) }], coverage: 'unavailable' }; }
}

// Unknown settings fail closed. In particular includes, hooks, filters, fsmonitor,
// object alternates, promisor extensions and custom pack commands are not run.
const SAFE_GIT_CONFIG = /^(?:core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|eol|safecrlf|longpaths|quotepath)|user\.(?:name|email)|remote\.[^.]+\.(?:url|pushurl|fetch)|branch\..+\.(?:remote|merge|pushremote)|init\.defaultbranch|extensions\.objectformat)$/i;
async function ordinaryFile(file, max = 4 * 1024 * 1024) {
  const s = await lstat(file); assert(s.isFile() && !s.isSymbolicLink() && s.size <= max, 'Git metadata must be a bounded ordinary file.');
  return { data: await readFile(file, 'utf8'), fingerprint: fingerprint(s) };
}
async function absent(file) { try { await lstat(file); return false; } catch (e) { if (e.code === 'ENOENT') return true; throw e; } }
async function safeGitSession(gitDirectory, options = {}) {
  const gitDir = path.resolve(gitDirectory);
  assert(await realpath(gitDir) === gitDir, 'Git directory aliases and symlink ancestors are not supported for maintenance.');
  const st = await lstat(gitDir); assert(st.isDirectory() && !st.isSymbolicLink(), 'Git maintenance requires an ordinary .git directory.');
  const tool = await runner('git', options);
  const configFile = path.join(gitDir, 'config');
  const config = await ordinaryFile(configFile);
  const configValues = await checked(tool, ['config', '--file', configFile, '--no-includes', '--null', '--list']);
  for (const item of configValues.split('\0').filter(Boolean)) {
    const split = item.indexOf('\n'), key = split < 0 ? item : item.slice(0, split), value = split < 0 ? '' : item.slice(split + 1);
    assert(SAFE_GIT_CONFIG.test(key), `Git maintenance is disabled by unsupported repository configuration: ${key}. No hooks or project commands were run.`);
    if (/^core\.repositoryformatversion$/i.test(key)) assert(['0', '1'].includes(value), 'Unsupported Git repository format.');
    if (/^extensions\.objectformat$/i.test(key)) assert(['sha1', 'sha256'].includes(value), 'Unsupported Git object format.');
    if (/^core\.bare$/i.test(key)) assert(value !== 'true', 'Bare repositories need separate scope handling and are detection-only.');
  }
  for (const entry of ['commondir', 'worktrees', 'shallow', 'config.worktree', 'objects/info/alternates', 'objects/info/http-alternates', 'gc.pid', 'index.lock', 'packed-refs.lock', 'objects/pack/pack.lock', 'rebase-apply', 'rebase-merge', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'BISECT_START']) assert(await absent(path.join(gitDir, entry)), `Git maintenance is disabled while ${entry} is present.`);
  for (const entry of await readdir(path.join(gitDir, 'objects', 'pack')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) assert(!entry.endsWith('.promisor'), 'Partial-clone/promisor object storage is detection-only.');
  const project = path.dirname(gitDir);
  const entries = [], refs = [], counts = { count: 0, size: 0, packs: 0, 'size-pack': 0 };
  let objectBytes = 0;
  const walk = async (directory, relative = '') => {
    for (const entry of (await readdir(directory)).sort()) {
      const rel = relative ? `${relative}/${entry}` : entry, file = path.join(directory, entry), info = await lstat(file);
      assert(!info.isSymbolicLink() && (info.isDirectory() || info.isFile()), 'Git metadata contains a symlink or special entry; maintenance cannot stay inside this object store.');
      assert(!entry.endsWith('.lock'), 'An active Git lock is present; finish the Git operation before maintenance.');
      assert(entries.length < 500000, 'Git maintenance metadata limit reached; storage remains detection-only.');
      entries.push([rel, fingerprint(info)]);
      if (info.isDirectory()) await walk(file, rel);
      else {
        if (rel.startsWith('objects/')) objectBytes += info.size;
        if (/^objects\/[a-f0-9]{2}\/[a-f0-9]{38,62}$/.test(rel)) { counts.count++; counts.size += Math.ceil(info.size / 1024); }
        if (/^objects\/pack\/.*\.pack$/.test(rel)) { counts.packs++; counts['size-pack'] += Math.ceil(info.size / 1024); }
        if (rel.startsWith('refs/') || rel === 'packed-refs' || rel === 'HEAD') refs.push([rel, (await ordinaryFile(file)).data]);
      }
    }
  };
  await walk(gitDir);
  const objectFormatEntry = configValues.split('\0').find(item => item.toLowerCase().startsWith('extensions.objectformat\n'));
  const objectFormat = objectFormatEntry?.slice(objectFormatEntry.indexOf('\n') + 1) || 'sha1';
  return { tool, gitDir, project, stat: st, config, entries, refs, counts, objectBytes, objectFormat };
}

export async function inspectGitRepository(gitDirectory, options = {}) {
  try {
    const session = await safeGitSession(gitDirectory, options);
    const head = await ordinaryFile(path.join(session.gitDir, 'HEAD'));
    const snapshot = { config: session.config.fingerprint, configDigest: hash(session.config.data), head: head.fingerprint, headDigest: hash(head.data), refsDigest: hash(session.refs), treeDigest: hash(session.entries), objectFormat: session.objectFormat, counts: session.counts };
    const referenceNames = new Set(session.refs.filter(([name]) => name.startsWith('refs/')).map(([name]) => name));
    const packed = session.refs.find(([name]) => name === 'packed-refs')?.[1] || '';
    for (const line of packed.split('\n')) { const match = line.match(/^[a-f0-9]+ (refs\/[^\r\n]+)$/); if (match) referenceNames.add(match[1]); }
    return { supported: true, executable: process.platform === 'linux', path: session.gitDir, project: session.project, fingerprint: fingerprint(session.stat), snapshot, digest: hash(snapshot), objectBytes: session.objectBytes, reserveBytes: Math.max(64 * 1024 * 1024, session.objectBytes * 2), local: { references: referenceNames.size, stashPresent: referenceNames.has('refs/stash'), worktreeState: 'not-inspected', remoteVerified: false }, reasons: ['Conservative local repacking retains reachable and unreachable objects, refs, reflogs, source files, ignored files, stashes, and remote state.', 'Only filesystem metadata and a non-including config parser are used for inspection. Project hooks and worktree commands are not run.', ...(process.platform !== 'linux' ? ['This platform has no descriptor-pinned Git subprocess storage view; maintenance is detection-only.'] : [])], limitations: ['Dirty/untracked/ignored file classification and remote backup are not verified; whole-project deletion and shallow replacement therefore remain unavailable.', 'Repacking needs temporary free space and may save little or no space.'] };
  } catch (error) { return { supported: false, reasons: [cleanError(error)] }; }
}

export async function revalidateManagerCandidate(candidate, report, options = {}) {
  try {
    assert(candidate?.metadata?.managerAction && MANAGER_ACTIONS.has(candidate.operation), 'Unknown manager action.');
    assert(candidate.status !== 'protected' && !candidate.protection?.length, 'Protected manager resource cannot be cleaned.');
    assert(report?.roots?.some(root => within(candidate.path, root)), 'Manager storage is outside the approved scope.');
    assert(String(candidate.metadata.volumeId ?? candidate.fingerprint.dev) === String(report.volume.id), 'Manager resource is on a different target volume.');
    if (candidate.operation === 'git-gc') {
      const current = await inspectGitRepository(candidate.path, options);
      assert(current.supported && current.executable, current.reasons.join(' '));
      assert(sameFingerprint(current.fingerprint, candidate.fingerprint), 'Git directory identity or metadata changed after review.');
      assert(current.digest === candidate.metadata.gitDigest, 'Git configuration, refs, objects or worktree status changed after review.');
      const volume = await statfs(candidate.path);
      assert(Number(volume.bavail) * Number(volume.bsize) >= current.reserveBytes, `Git repacking requires at least ${current.reserveBytes} bytes of temporary free-space reserve.`);
      return { ok: true, reasons: [], candidate };
    }
    const session = await dockerSession({ ...options, endpoint: candidate.metadata.endpoint, roots: report.roots, volume: report.volume });
    assert(session.daemonId === candidate.metadata.daemonId && session.storageRoot === candidate.path, 'Docker daemon identity or storage path changed.');
    assert(Number(session.storageStat.dev) === candidate.fingerprint.dev && Number(session.storageStat.ino) === candidate.fingerprint.ino, 'Docker storage identity changed.');
    const inventory = await dockerInventory(session);
    const type = candidate.operation === 'docker-image-remove' ? 'image' : 'container';
    const value = (type === 'image' ? inventory.images : inventory.containers).find(v => v.id === candidate.metadata.resourceSnapshot?.id);
    assert(value && hash(value) === candidate.metadata.resourceDigest, 'Docker resource metadata or writable state changed after review.');
    const fresh = dockerCandidate(session, value, type, { config: report.config }, inventory);
    assert(fresh.resourceId === candidate.resourceId && fresh.protection.length === 0, fresh.protection.join(' ') || 'Docker resource identity changed.');
    return { ok: true, reasons: [], candidate: fresh };
  } catch (error) { return { ok: false, reasons: [cleanError(error)] }; }
}

/** Caller owns explicit consent, global cleanup lock, durable intent/result and target measurement. */
export async function executeManagerCandidate(candidate, options = {}) {
  const report = options.scan;
  assert(report, 'Manager execution requires its approved scan scope.');
  const verified = await revalidateManagerCandidate(candidate, report, options);
  assert(verified.ok, verified.reasons.join(' '));
  candidate = verified.candidate;
  if (candidate.operation === 'git-gc') {
    const session = await safeGitSession(candidate.path, options);
    const view = await mkdtemp(path.join(os.tmpdir(), 'diskroom-git-view-'));
    const objectHandles = [];
    try {
      // A controlled metadata view isolates Git from concurrent edits to project
      // config, hooks, filters and environment. The original refs are never written.
      await mkdir(path.join(view, 'refs')); await mkdir(path.join(view, 'objects')); await mkdir(path.join(view, 'hooks'));
      await writeFile(path.join(view, 'config'), `[core]\nrepositoryformatversion = ${session.objectFormat === 'sha256' ? 1 : 0}\nbare = true\n${session.objectFormat === 'sha256' ? '[extensions]\nobjectFormat = sha256\n' : ''}`, { flag: 'wx', mode: 0o600 });
      for (const [name, expected] of session.entries) {
        if (name !== 'HEAD' && name !== 'packed-refs' && !name.startsWith('refs/') && !name.startsWith('logs/')) continue;
        const source = path.join(session.gitDir, ...name.split('/')), destination = path.join(view, ...name.split('/'));
        const info = await lstat(source);
        assert(!info.isSymbolicLink() && sameFingerprint(fingerprint(info), expected), 'Git preservation metadata changed while preparing maintenance.');
        if (info.isDirectory()) await mkdir(destination, { recursive: true });
        else { await mkdir(path.dirname(destination), { recursive: true }); await copyFile(source, destination, constants.COPYFILE_EXCL); }
      }
      const fresh = await inspectGitRepository(candidate.path, options);
      assert(fresh.supported && fresh.digest === candidate.metadata.gitDigest, 'Git state changed while preparing its isolated maintenance view.');
      // Pin every object-store directory through Linux descriptors. Git receives
      // only our controlled view, so a replaced original ancestor/pack directory
      // cannot redirect its reads or writes to an unapproved directory.
      assert(process.platform === 'linux', 'Descriptor-pinned Git maintenance is available only on Linux.');
      const procPid = path.basename(await readlink('/proc/self'));
      assert(/^\d+$/.test(procPid), 'Cannot identify the parent descriptor namespace for safe Git maintenance.');
      let objects = await open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        for (const part of path.join(session.gitDir, 'objects').split('/').filter(Boolean)) {
          const child = await open(`/proc/self/fd/${objects.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          await objects.close(); objects = child;
        }
        assert(sameFingerprint(fingerprint(await objects.stat()), session.entries.find(([name]) => name === 'objects')?.[1]), 'Git object directory identity changed before maintenance.');
        objectHandles.push(objects);
      } catch (error) { await objects.close(); throw error; }
      for (const name of await readdir(`/proc/self/fd/${objects.fd}`)) {
        assert(/^(?:[a-f0-9]{2}|pack|info)$/.test(name), 'Unrecognized entry at the Git object-store root; maintenance is refused.');
        const handle = await open(`/proc/self/fd/${objects.fd}/${name}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        objectHandles.push(handle);
        assert(sameFingerprint(fingerprint(await handle.stat()), session.entries.find(([relative]) => relative === `objects/${name}`)?.[1]), 'Git object-storage directory changed before maintenance.');
        await symlink(`/proc/${procPid}/fd/${handle.fd}`, path.join(view, 'objects', name), 'dir');
      }
      // Repack is the preservation-only part of maintenance. --keep-unreachable
      // also retains unreachable packed objects; loose unreachable objects remain.
      const args = ['--no-optional-locks', '-c', `core.hooksPath=${path.join(view, 'hooks')}`, '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '--git-dir', view, 'repack', '-a', '-d', '-n', '--keep-unreachable'];
      await checked(session.tool, args, { cwd: view, timeout: 30 * 60 * 1000, env: { GIT_OBJECT_DIRECTORY: path.join(view, 'objects') } });
      const after = await inspectGitRepository(candidate.path, options);
      assert(after.supported && after.snapshot.refsDigest === candidate.metadata.gitSnapshot.refsDigest && after.snapshot.headDigest === candidate.metadata.gitSnapshot.headDigest, 'Git maintenance finished but preservation could not be verified. Inspect the repository and audit before any further action.');
      return { status: 'completed', resourceId: candidate.resourceId || candidate.path, operation: candidate.operation, command: { executable: session.tool.executable, args: ['repack', '-a', '-d', '-n', '--keep-unreachable'], configuration: 'Isolated trusted metadata and descriptor-pinned object directories; hooks disabled; no pruning, reflog expiration or network commands.' }, verification: { refsPreserved: true, headPreserved: true, worktreeUntouched: true, beforeCounts: candidate.metadata.gitSnapshot.counts, afterCounts: after.snapshot.counts } };
    } finally { await rm(view, { recursive: true, force: true }); for (const handle of objectHandles.reverse()) await handle.close(); }
  }
  const session = await dockerSession({ ...options, endpoint: candidate.metadata.endpoint, roots: report.roots, volume: report.volume });
  assert(session.daemonId === candidate.metadata.daemonId && session.storageRoot === candidate.path, 'Docker daemon identity changed immediately before execution.');
  const id = candidate.metadata.resourceSnapshot.id;
  const type = candidate.operation === 'docker-image-remove' ? 'image' : 'container';
  assert(type === 'image' ? IMAGE_ID.test(id) : CONTAINER_ID.test(id), 'Invalid exact Docker resource ID.');
  const args = session.command(type, 'rm', ...(type === 'image' ? ['--no-prune'] : []), id);
  await checked(session.tool, args, { timeout: 120000 });
  const remaining = lines(await checked(session.tool, session.command(type, 'ls', '--all', '--quiet', '--no-trunc')));
  assert(!remaining.includes(id), 'Docker reported removal but the exact resource still exists; outcome is unverified.');
  return { status: 'completed', resourceId: candidate.resourceId, operation: candidate.operation, command: { executable: session.tool.executable, args }, verification: { exactResourceAbsent: true, forceUsed: false, volumeRemovalRequested: false, parentPruningRequested: false } };
}
