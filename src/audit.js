import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { VERSION } from './common.js';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const RUN_ID = /^[a-z][a-z0-9-]{0,20}-[a-f0-9-]{36}$/;
const PART = /^[a-z][a-z0-9-]{0,100}$/;
const MAX_PART_BYTES = 64 * 1024 * 1024;
const NOFOLLOW = constants.O_NOFOLLOW || 0;
const KINDS = new Set(['scan', 'clean', 'plan']);
const OPERATIONS = new Set(['delete-tree', 'delete-file', 'git-gc', 'docker-image-remove', 'docker-container-remove', 'detect-only']);
const STAT_KEYS = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'mode'];
let hiddenAttributeWarningShown=false;

function assert(condition, message) { if (!condition) throw new Error(message); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validPath(value) { return typeof value === 'string' && value.length > 0 && !value.includes('\0') && path.isAbsolute(value) && path.resolve(value) === value; }
function strings(value) { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function number(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function descendant(child, parent) { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }

/** Validate data at the trust boundary; reports can be edited by any local user. */
export function validateRun(summary, expectedId) {
  assert(plain(summary), 'Invalid audit summary: expected an object.');
  assert(summary.schemaVersion === 1, 'Unsupported DiskRoom audit schema; no actions were performed.');
  assert(typeof summary.id === 'string' && RUN_ID.test(summary.id), 'Invalid DiskRoom run ID.');
  assert(!expectedId || summary.id === expectedId, 'Audit run ID does not match its directory.');
  assert(KINDS.has(summary.kind), 'Unknown audit run kind.');
  assert(typeof summary.status === 'string', 'Audit summary is missing its status.');
  if (summary.cwd !== undefined) assert(validPath(summary.cwd), 'Invalid cwd in audit.');
  if (summary.workspace !== undefined) assert(validPath(summary.workspace), 'Invalid workspace in audit.');
  if (summary.roots !== undefined) assert(Array.isArray(summary.roots) && summary.roots.length > 0 && summary.roots.every(validPath), 'Invalid scan roots in audit.');
  if (summary.targetFree !== undefined && summary.targetFree !== null) assert(number(summary.targetFree), 'Invalid target free space in audit.');
  if (summary.kind !== 'scan' || summary.status === 'running') return summary;
  assert(['complete', 'incomplete', 'cancelled', 'failed'].includes(summary.status), 'Unknown scan status.');
  assert(Number.isInteger(summary.activityDays) && summary.activityDays >= 1 && summary.activityDays <= 36500, 'Scan activityDays must be an integer between 1 and 36500.');
  const config = validateConfig(summary.config);
  assert(summary.activityDays === config.activityDays, 'Scan activityDays does not match its recorded configuration.');
  assert(validPath(summary.cwd) && validPath(summary.workspace), 'Scan paths are missing.');
  assert(Array.isArray(summary.roots) && summary.roots.length > 0 && summary.roots.every(validPath), 'Scan roots are missing.');
  assert(plain(summary.volume) && validPath(summary.volume.root) && number(summary.volume.freeBytes) && number(summary.volume.totalBytes), 'Invalid scan volume.');
  assert(Array.isArray(summary.candidates), 'Scan candidates are missing.');
  const ids = new Set();
  for (const candidate of summary.candidates) {
    assert(plain(candidate) && typeof candidate.id === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(candidate.id) && !ids.has(candidate.id), 'Invalid or duplicate candidate ID.');
    ids.add(candidate.id);
    assert(validPath(candidate.path), 'Candidate path must be a normalized absolute path.');
    assert(summary.roots.some(root => descendant(candidate.path, root)), 'Candidate is outside the approved scan roots.');
    assert(candidate.project === null || candidate.project === undefined || validPath(candidate.project), 'Invalid candidate project.');
    assert(OPERATIONS.has(candidate.operation), 'Unknown candidate operation.');
    assert(['recommended', 'review', 'risky', 'protected'].includes(candidate.status), 'Unknown candidate status.');
    assert(typeof candidate.category === 'string' && typeof candidate.ecosystem === 'string', 'Candidate classification is missing.');
    assert(candidate.logicalBytes===null||number(candidate.logicalBytes), 'Invalid candidate size.');
    for (const field of ['allocatedBytes', 'reclaimableBytes']) assert(candidate[field] === null || number(candidate[field]), `Invalid candidate ${field}.`);
    for (const field of ['reasons', 'restore', 'risks', 'protection']) assert(strings(candidate[field]), `Invalid candidate ${field}.`);
    for (const field of ['safety', 'need']) {
      const score = candidate[field];
      assert(plain(score) && (score.score === null || (number(score.score) && score.score <= 100)) && ['high', 'medium', 'low'].includes(score.confidence) && strings(score.reasons), `Invalid candidate ${field} assessment.`);
    }
    if (candidate.operation.startsWith('delete') || candidate.operation === 'git-gc') {
      assert(plain(candidate.fingerprint) && STAT_KEYS.every(key => number(candidate.fingerprint[key])), 'Invalid candidate identity.');
    }
    if (candidate.resourceId !== undefined) assert(typeof candidate.resourceId === 'string' && (candidate.ecosystem==='docker'?/^[A-Za-z0-9:_.@/-]{1,300}$/:/^(sha256:)?[a-f0-9]{12,64}$/).test(candidate.resourceId), 'Invalid managed resource ID.');
  }
  return { ...summary, config };
}

async function ensureDirectory(target, { create = false } = {}) {
  assert(validPath(target), 'Workspace must be a normalized absolute path.');
  const parsed = path.parse(target);
  let current = parsed.root;
  for (const component of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (create) { try { await fs.mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
    const stat = await fs.lstat(current);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), `Audit directory must not be a symbolic link: ${current}`);
  }
  return target;
}

async function syncDirectory(directory) {
  let handle;
  try { handle = await fs.open(directory, constants.O_RDONLY | (constants.O_DIRECTORY || 0) | NOFOLLOW); await handle.sync(); }
  catch (error) {
    // Windows cannot fsync directory handles through the Node core API. The file itself is synced.
    if (!(process.platform === 'win32' && ['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes(error.code))) throw error;
  } finally { await handle?.close(); }
}

async function atomicWrite(directory, name, buffer) {
  await ensureDirectory(directory);
  const before = await fs.lstat(directory);
  const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
  const target = path.join(directory, name);
  let handle;
  try {
    handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW, 0o600);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close(); handle = null;
    const after = await fs.lstat(directory);
    assert(before.dev === after.dev && before.ino === after.ino && !after.isSymbolicLink(), 'Audit directory changed while writing.');
    await fs.rename(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw new Error(`Cannot durably write audit; no further cleanup is allowed: ${error.message}`, { cause: error });
  }
}

async function readPart(directory, name) {
  await ensureDirectory(directory);
  const file = path.join(directory, `${name}.json.gz`);
  const handle = await fs.open(file, constants.O_RDONLY | NOFOLLOW);
  try {
    const stat = await handle.stat();
    assert(stat.isFile() && stat.size <= MAX_PART_BYTES, 'Audit part is not a regular file or exceeds the safe read limit.');
    const buffer = await handle.readFile();
    return JSON.parse(await decompress(buffer, { maxOutputLength: MAX_PART_BYTES }));
  } finally { await handle.close(); }
}

async function auditRoot(workspace, create = false) {
  assert(validPath(workspace), 'Workspace must be a normalized absolute path.');
  // Canonicalizing explicitly selected workspace allows ordinary platform aliases such as macOS /var.
  const canonical = await fs.realpath(workspace);
  const root = path.join(canonical, '.diskroom');
  await ensureDirectory(root, { create });
  if (create && process.platform === 'win32') {
    const native=await import('../native/index.js');
    if(native.available)native.markHidden(root);
    else if(!hiddenAttributeWarningShown) {
      hiddenAttributeWarningShown=true;
      process.emitWarning('Native Windows support is unavailable. The .diskroom audit directory remains visible; scanning is available and native filesystem cleanup stays disabled.',{code:'DISKROOM_AUDIT_VISIBLE'});
    }
  }
  return root;
}

export async function createAudit(workspace, kind, initial = {}) {
  assert(KINDS.has(kind), 'Unknown audit run kind.');
  const root = await auditRoot(workspace, true);
  const runs = path.join(root, 'runs');
  await ensureDirectory(runs, { create: true });
  const id = `${kind}-${randomUUID()}`;
  const directory = path.join(runs, id);
  await fs.mkdir(directory, { mode: 0o700 });
  await syncDirectory(runs);
  let sequence = 0;
  let failed = false;
  let queue = Promise.resolve();
  const base = { ...initial, version: VERSION, schemaVersion: 1, id, runId: id, kind, workspace, startedAt: new Date().toISOString(), status: 'running', environment: { platform: process.platform, arch: process.arch, node: process.version, hostname: os.hostname() }, auditPath: directory };
  if(process.platform==='win32'&&!(await import('../native/index.js')).available)base.auditWarnings=['Native hidden-attribute support is unavailable; .diskroom remains visible. No system or project program was executed to change attributes.'];
  const writer = {
    id, path: directory,
    write(name, data) {
      assert(PART.test(name), 'Invalid audit part name.');
      const result = queue.then(async () => {
        assert(!failed, 'Audit has failed; cleanup must stop.');
        const record = { ...data, schemaVersion: 1, runId: id, part: name, sequence: ++sequence, writtenAt: new Date().toISOString() };
        const encoded = Buffer.from(JSON.stringify(record));
        assert(encoded.length <= MAX_PART_BYTES, 'Audit part exceeds 64 MiB; use bounded inventory chunks.');
        try { await atomicWrite(directory, `${name}.json.gz`, await compress(encoded, { level: 6 })); }
        catch (error) { failed = true; throw error; }
        return record;
      });
      queue = result.catch(() => {});
      return result;
    },
    async finish(summary) {
      return writer.write('summary', { ...base, ...summary, id, kind, schemaVersion: 1, auditPath: directory, finishedAt: summary.finishedAt || new Date().toISOString() });
    },
    async read(name) { assert(PART.test(name), 'Invalid audit part name.'); return readPart(directory, name); },
  };
  await writer.write('summary', base);
  return writer;
}

export async function readRun(workspace, id) {
  assert(typeof id === 'string' && RUN_ID.test(id), 'Invalid run ID. Use an ID from diskroom history.');
  const root = await auditRoot(workspace);
  const directory = path.join(root, 'runs', id);
  const summary = validateRun(await readPart(directory, 'summary'), id);
  const parts = (await fs.readdir(directory)).filter(name => /^[a-z][a-z0-9-]*\.json\.gz$/.test(name)).sort();
  const unresolved = [], auditIssues = [];
  for (const name of parts) {
    if (!name.startsWith('intent-')) continue;
    const result = `result-${name.slice('intent-'.length)}`;
    if (!parts.includes(result)) unresolved.push(name.replace('.json.gz', ''));
    else {
      try {
        const results = await readPart(directory, result.replace('.json.gz', ''));
        if (results.complete !== true) unresolved.push(name.replace('.json.gz', ''));
      } catch (error) {
        unresolved.push(name.replace('.json.gz', ''));
        auditIssues.push({ part: result, message: `Result is unreadable; treat its outcomes as unverified: ${error.message}` });
      }
    }
  }
  return { ...summary, auditPath: directory, auditParts: parts, ...(auditIssues.length ? { auditIssues } : {}), ...(unresolved.length ? { unresolvedIntents: unresolved, recovery: 'Some operations have intent records without durable results. Their outcomes are unverified. Inspect these records; DiskRoom will never resume them automatically.' } : {}), ...(summary.status === 'running' ? { interrupted: true, recovery: 'This run has no durable completion record. Treat pending operations as unverified; it will not be resumed automatically.' } : {}) };
}

export async function listRuns(workspace) {
  let root;
  try { root = await auditRoot(workspace); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  let entries;
  try { entries = await fs.readdir(path.join(root, 'runs'), { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const summaries = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !RUN_ID.test(entry.name)) continue;
    try { summaries.push(await readRun(workspace, entry.name)); }
    catch (error) { summaries.push({ id: entry.name, kind: entry.name.split('-')[0], status: 'invalid', error: error.message }); }
  }
  return summaries.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

export function validateConfig(config) {
  assert(plain(config) && Object.keys(config).every(key => ['protect', 'exclude', 'archived', 'activityDays'].includes(key)), 'Unknown or invalid DiskRoom configuration field.');
  const result = { protect: [], exclude: [], archived: [], activityDays: 30, ...config };
  for (const key of ['protect', 'exclude', 'archived']) assert(Array.isArray(result[key]) && result[key].every(validPath), `${key} must contain normalized absolute paths.`);
  assert(Number.isInteger(result.activityDays) && result.activityDays >= 1 && result.activityDays <= 36500, 'activityDays must be an integer between 1 and 36500.');
  return result;
}

export async function loadConfig(workspace) {
  try {
    const root = await auditRoot(workspace);
    const handle = await fs.open(path.join(root, 'config.json'), constants.O_RDONLY | NOFOLLOW);
    try { const stat = await handle.stat(); assert(stat.isFile() && stat.size <= 1024 * 1024, 'Configuration is not a regular file or is too large.'); return validateConfig(JSON.parse(await handle.readFile('utf8'))); }
    finally { await handle.close(); }
  } catch (error) { if (error.code === 'ENOENT') return validateConfig({}); throw error; }
}

export async function saveConfig(workspace, config) {
  const validated = validateConfig(config);
  const root = await auditRoot(workspace, true);
  await atomicWrite(root, 'config.json', Buffer.from(`${JSON.stringify(validated, null, 2)}\n`));
  return validated;
}
