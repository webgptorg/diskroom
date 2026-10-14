import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAudit, loadConfig, validateRun } from './audit.js';
import { revalidateCandidate, measureVolume, verifyCandidateUse } from './scanner.js';

const FILESYSTEM_ACTIONS = new Set(['delete-file', 'delete-tree']);
const MANAGER_ACTIONS = new Set(['git-gc','docker-image-remove','docker-container-remove']);
const ROOT_DIRECTORY = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHUNK_SIZE = 64;
const NOFOLLOW = constants.O_NOFOLLOW || 0;

function assert(condition, message) { if (!condition) throw new Error(message); }
function inside(child, parent) { const relative = path.relative(parent, child); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); }
function snapshot(stat) { return { dev: Number(stat.dev), ino: Number(stat.ino), size: Number(stat.size), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs), mode: Number(stat.mode) }; }
function same(a, b, identityOnly = false) { return a && b && ['dev', 'ino', 'mode', ...(identityOnly ? [] : ['size', 'mtimeMs', 'ctimeMs'])].every(key => a[key] === b[key]); }
function fileType(stat) { return stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'special'; }
function abort(signal) { if (signal?.aborted) { const error = new Error('Cleanup interrupted by user.'); error.name = 'AbortError'; throw error; } }
function cleanMessage(error) { return String(error?.message || error).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[redacted]@'); }

/** One lock per OS user, independent of the selected audit workspace. Stale locks require manual review. */
export async function acquireCleanupLock() {
  const user = createHash('sha256').update(String(process.getuid?.() ?? os.userInfo().username)).digest('hex').slice(0, 16);
  const directory = path.join(os.tmpdir(), `diskroom-clean-${user}.lock`);
  try { await fs.mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another DiskRoom cleanup may be active. Lock: ${directory}. If it crashed, inspect its audit before manually removing this lock; interrupted cleanup will never resume automatically.`);
    throw error;
  }
  const token = randomUUID();
  try { await fs.writeFile(path.join(directory, 'owner.json'), JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { await fs.rmdir(directory).catch(() => {}); throw error; }
  return async () => {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    const owner = JSON.parse(await fs.readFile(path.join(directory, 'owner.json'), 'utf8'));
    if (owner.token !== token) return;
    await fs.unlink(path.join(directory, 'owner.json'));
    await fs.rmdir(directory);
  };
}

/** Linux directory handles keep traversal attached to the checked inode after ancestor renames. */
async function linuxBackend() {
  assert(process.platform === 'linux', 'This platform requires the DiskRoom native filesystem bridge before cleanup. Scanning is available.');
  await fs.access('/proc/self/fd');
  const handlePath = handle => `/proc/self/fd/${handle.fd}`;
  function nameOnly(name) { assert(typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\0'), 'Unsafe filename component.'); }
  return {
    async openRoot(absolute) {
      assert(path.isAbsolute(absolute), 'Deletion root must be absolute.');
      let handle = await fs.open('/', constants.O_RDONLY | constants.O_DIRECTORY | NOFOLLOW);
      try {
        for (const name of absolute.split('/').filter(Boolean)) {
          nameOnly(name);
          const child = await fs.open(`${handlePath(handle)}/${name}`, constants.O_RDONLY | constants.O_DIRECTORY | NOFOLLOW);
          await handle.close(); handle = child;
        }
        return handle;
      } catch (error) { await handle.close(); throw error; }
    },
    async openDirectory(parent, name) { nameOnly(name); return fs.open(`${handlePath(parent)}/${name}`, constants.O_RDONLY | constants.O_DIRECTORY | NOFOLLOW); },
    async statChild(parent, name) { nameOnly(name); const stat = await fs.lstat(`${handlePath(parent)}/${name}`); return { ...snapshot(stat), type: fileType(stat) }; },
    async stat(handle) { return snapshot(await handle.stat()); },
    async *entries(handle) {
      const directory = await fs.opendir(handlePath(handle));
      try { for await (const entry of directory) yield entry.name; }
      finally { await directory.close().catch(error => { if (error.code !== 'ERR_DIR_CLOSED') throw error; }); }
    },
    async removeChild(parent, name, expected, isDirectory) {
      nameOnly(name);
      const absolute = `${handlePath(parent)}/${name}`;
      const stat = await fs.lstat(absolute);
      assert(same(snapshot(stat), expected, isDirectory), 'Resource changed since its approved inventory; refusing deletion.');
      if (isDirectory) { assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Directory was replaced by a symlink.'); await fs.rmdir(absolute); }
      else { assert(!stat.isDirectory(), 'File was replaced by a directory.'); await fs.unlink(absolute); }
    },
    async close(handle) { await handle.close(); },
  };
}

async function filesystemBackend() {
  if (process.platform === 'linux') return linuxBackend();
  try {
    const native = await import('../native/index.js');
    assert(native.available, native.unavailableReason || 'The native bridge is not available.');
    return { ...native, async *entries(handle) { for (const name of native.readDirectory(handle)) yield name; }, removeChild(parent, name, expected, isDirectory) { return native.removeChild(parent, name, expected, { directoryIdentityOnly: isDirectory }); } };
  } catch (error) {
    throw new Error(`Safe filesystem cleanup is unavailable on ${process.platform}: ${cleanMessage(error)}. Scanning remains available; install a package with a verified native bridge.`);
  }
}

async function collectInventory(candidate, writer, prefix, backend, signal) {
  const parent = await backend.openRoot(path.dirname(candidate.path));
  const basename = path.basename(candidate.path);
  let chunk = [], chunks = 0, count = 0;
  const digest = Buffer.alloc(32);
  const emit = async entry => {
    const entryPath = entry.relativePath ? path.join(candidate.path, entry.relativePath) : candidate.path;
    const hash = createHash('sha256').update(JSON.stringify([entryPath, entry.fingerprint])).digest();
    for (let index = 0; index < digest.length; index++) digest[index] ^= hash[index];
    chunk.push(entry); count++;
    if (chunk.length === CHUNK_SIZE) { await writer.write(`${prefix}-inventory-${String(++chunks).padStart(6, '0')}`, { candidateId: candidate.id, entries: chunk }); chunk = []; }
  };
  const walk = async (directory, relative, expected, ancestors = []) => {
    abort(signal);
    for await (const name of backend.entries(directory)) {
      abort(signal);
      const stat = await backend.statChild(directory, name);
      const childRelative = relative ? path.join(relative, name) : name;
      assert(stat.dev === candidate.fingerprint.dev, 'A mount point crosses the approved filesystem boundary.');
      assert(stat.type !== 'special', 'A special filesystem entry cannot be safely removed.');
      if (stat.type === 'directory') {
        assert(name !== '.diskroom', 'Audit history inside a candidate must be preserved; choose a narrower action.');
        const child = await backend.openDirectory(directory, name);
        try { assert(same(await backend.stat(child), stat), 'Directory identity changed during inventory.'); await walk(child, childRelative, stat, [...ancestors, snapshot(expected)]); }
        finally { await backend.close(child); }
      } else await emit({ relativePath: childRelative, type: stat.type, fingerprint: snapshot(stat), ancestors: [...ancestors, snapshot(expected)] });
    }
    assert(same(await backend.stat(directory), expected), 'Directory changed while its inventory was collected.');
    await emit({ relativePath: relative, type: 'directory', fingerprint: snapshot(expected), ancestors });
  };
  try {
    const root = await backend.statChild(parent, basename);
    assert(same(root, candidate.fingerprint), 'Candidate identity changed before inventory.');
    if (candidate.operation === 'delete-tree') {
      assert(root.type === 'directory', 'Tree candidate is no longer a directory.');
      const directory = await backend.openDirectory(parent, basename);
      try { assert(same(await backend.stat(directory), root), 'Root identity changed before inventory.'); await walk(directory, '', root); }
      finally { await backend.close(directory); }
    } else { assert(root.type === 'file', 'File candidate is no longer a regular file.'); await emit({ relativePath: '', type: 'file', fingerprint: snapshot(root) }); }
    if (chunk.length) await writer.write(`${prefix}-inventory-${String(++chunks).padStart(6, '0')}`, { candidateId: candidate.id, entries: chunk });
    assert(typeof candidate.metadata?.treeDigest === 'string' && digest.toString('hex') === candidate.metadata.treeDigest, 'The tree changed after its approved scan; create and confirm a fresh plan.');
    const auditSpace = await fs.statfs(writer.path);
    assert(Number(auditSpace.bavail) * Number(auditSpace.bsize) >= 128 * 1024, 'There is insufficient space for durable cleanup results. Free at least 128 KiB in the selected audit workspace first.');
    return { chunks, count, parent, basename };
  } catch (error) { await backend.close(parent); throw error; }
}

async function removeInventoriedEntry(candidate, entry, inventory, backend) {
  // Every ancestor is opened without following links; replacing an ancestor never redirects the traversal.
  let directory = inventory.parent;
  const opened = [];
  const parts = entry.relativePath ? [inventory.basename, ...entry.relativePath.split(path.sep)] : [inventory.basename];
  try {
    for (const [index, name] of parts.slice(0, -1).entries()) {
      const child = await backend.openDirectory(directory, name);
      opened.push(child);
      assert(same(await backend.stat(child), entry.ancestors[index], true), 'An ancestor was replaced after inventory; refusing deletion.');
      directory = child;
    }
    await backend.removeChild(directory, parts.at(-1), entry.fingerprint, entry.type === 'directory');
  } finally { for (const handle of opened.reverse()) await backend.close(handle); }
}

async function deleteCandidate(candidate, writer, prefix, backend, signal, onProgress) {
  const inventory = await collectInventory(candidate, writer, prefix, backend, signal);
  let removed = 0, bytes = 0;
  try {
    await onProgress?.({ phase: 'inventory-complete', candidate, entries: inventory.count });
    let lastUseCheck=0;
    const verifyUse=async()=>{
      const result=await verifyCandidateUse(candidate);
      assert(result.ok,result.reasons.join(' '));
      lastUseCheck=Date.now();
    };
    await verifyUse();
    for (let index = 1; index <= inventory.chunks; index++) {
      abort(signal);
      if(index>1)await verifyUse();
      const records = await writer.read(`${prefix}-inventory-${String(index).padStart(6, '0')}`);
      const suffix = `${prefix}-${String(index).padStart(6, '0')}`;
      // A bounded batch of intents is durable before its first removal. Results are synced after EVERY entry.
      await writer.write(`intent-${suffix}`, { candidateId: candidate.id, operation: candidate.operation, root: candidate.path, entries: records.entries });
      const results = [];
      for (const entry of records.entries) {
        abort(signal);
        if(Date.now()-lastUseCheck>=250)await verifyUse();
        let result;
        try {
          await removeInventoriedEntry(candidate, entry, inventory, backend);
          removed++; if (entry.type === 'file') bytes += entry.fingerprint.size;
          result = { relativePath: entry.relativePath, status: 'removed', at: new Date().toISOString() };
        } catch (error) {
          result = { relativePath: entry.relativePath, status: 'failed', error: cleanMessage(error), at: new Date().toISOString() };
          results.push(result);
          await writer.write(`result-${suffix}`, { candidateId: candidate.id, complete: false, entries: results });
          throw error;
        }
        results.push(result);
        await writer.write(`result-${suffix}`, { candidateId: candidate.id, complete: results.length === records.entries.length, entries: results });
      }
    }
    return { status: 'completed', removedEntries: removed, removedLogicalBytes: bytes };
  } catch (error) {
    error.removedEntries = removed;
    throw error;
  } finally { await backend.close(inventory.parent); }
}

function validatePlan(scan, plan, options) {
  validateRun(scan);
  assert(scan.kind === 'scan' && ['complete', 'incomplete'].includes(scan.status), 'Only a completed or explicitly reviewed incomplete scan can be cleaned.');
  assert(options.interactiveConfirmed === true && plan?.confirmation?.approved === true, 'Cleanup requires explicit interactive confirmation of this exact plan.');
  assert(typeof plan.confirmation.at === 'string' && !Number.isNaN(Date.parse(plan.confirmation.at)), 'Confirmation timestamp is missing.');
  assert(Array.isArray(plan.confirmation.riskAcknowledgements), 'Risk acknowledgements are missing.');
  assert(plan.scanId === scan.id && typeof plan.id === 'string', 'Plan does not belong to this scan.');
  assert(Number.isSafeInteger(plan.targetFree) && plan.targetFree > 0 && plan.targetFree <= scan.volume.totalBytes, 'Invalid target free-space value.');
  assert(Array.isArray(plan.selectedIds) && new Set(plan.selectedIds).size === plan.selectedIds.length, 'Invalid or duplicate selected candidate IDs.');
  assert(options.workspace === scan.workspace, 'Workspace changed after the scan; create a new scan in the selected workspace.');
  const selected = plan.selectedIds.map(id => {
    const candidate = scan.candidates.find(item => item.id === id);
    assert(candidate, `Unknown selected candidate: ${id}`);
    assert(candidate.status !== 'protected' && candidate.protection.length === 0, 'Protected candidates cannot be cleaned.');
    assert(candidate.operation !== 'detect-only', 'A detection-only candidate cannot be executed.');
    if (candidate.status !== 'recommended') assert(plan.confirmation.riskAcknowledgements.includes(id), `Explicit risk acknowledgement is missing for ${id}.`);
    return candidate;
  });
  for (let index = 0; index < selected.length; index++) for (let other = index + 1; other < selected.length; other++) {
    const a=selected[index],b=selected[other];
    const distinctDockerResources=a.ecosystem==='docker'&&b.ecosystem==='docker'&&MANAGER_ACTIONS.has(a.operation)&&MANAGER_ACTIONS.has(b.operation)&&a.resourceId&&b.resourceId&&a.resourceId!==b.resourceId;
    assert(distinctDockerResources||(!inside(a.path,b.path)&&!inside(b.path,a.path)), 'Overlapping candidates cannot share a cleanup plan.');
  }
  return selected;
}

function protectedPath(candidate, scan, options, config) {
  const reserved = [path.join(options.workspace, '.diskroom'), ROOT_DIRECTORY, process.execPath];
  for (const item of reserved) if (inside(item, candidate.path) || inside(candidate.path, item)) return 'The candidate contains DiskRoom, its runtime, or its active audit.';
  const current = options.cwd || process.cwd();
  if (candidate.project && (inside(current, candidate.project) || inside(scan.cwd, candidate.project))) return 'The project from which DiskRoom was launched is protected.';
  for (const item of [...config.protect, ...config.exclude]) if (inside(candidate.path, item) || inside(item, candidate.path)) return 'The candidate overlaps a currently protected or excluded path.';
  if (candidate.path === path.parse(candidate.path).root) return 'Filesystem roots cannot be removed.';
  return null;
}

/** Executes only a separately reviewed plan. This function never prompts or broadens its actions. */
export async function executePlan(scan, plan, options = {}) {
  const selected = validatePlan(scan, plan, options);
  const release = await acquireCleanupLock();
  let writer, report;
  try {
    const config = await loadConfig(options.workspace);
    // A saved report is editable local data. It cannot waive the current workspace policy.
    const activityDays = Math.max(config.activityDays, scan.activityDays);
    writer = await createAudit(options.workspace, 'clean', { scanId: scan.id, planId: plan.id, cwd: options.cwd || process.cwd(), roots: scan.roots, targetFree: plan.targetFree });
    report = { schemaVersion: 1, id: writer.id, kind: 'clean', scanId: scan.id, planId: plan.id, version: scan.version, startedAt: new Date().toISOString(), status: 'running', cwd: options.cwd || process.cwd(), workspace: options.workspace, roots: scan.roots, targetFree: plan.targetFree, activityDays, config, environment: { platform: process.platform, arch: process.arch, node: process.version }, plugins: scan.plugins, auditPath: writer.path, operations: [], issues: [], goalReached: false };
    await writer.write('plan', { ...plan, scanId: scan.id, originalScanStatus: scan.status, candidates: selected });
    let volume = await measureVolume(scan.volume.root);
    assert(String(volume.id) === String(scan.volume.id), 'The target filesystem identity changed; create a new scan.');
    report.volume = volume; report.freeBeforeBytes = volume.freeBytes;
    await writer.write('summary', report);
    for (let index = 0; index < selected.length; index++) {
      abort(options.signal);
      volume = await measureVolume(scan.volume.root);
      assert(String(volume.id) === String(scan.volume.id), 'The target filesystem changed during cleanup.');
      if (volume.freeBytes >= plan.targetFree) { report.goalReached = true; report.stopReason = 'target-reached'; break; }
      const approved = selected[index];
      const prefix = `operation-${String(index + 1).padStart(6, '0')}`;
      const operation = { candidateId: approved.id, path: approved.path, operation: approved.operation, startedAt: new Date().toISOString(), status: 'checking' };
      report.operations.push(operation);
      options.onProgress?.({ phase: 'clean', candidate: approved, completed: index, total: selected.length });
      const reason = protectedPath(approved, scan, options, config);
      if (reason) { operation.status = 'skipped'; operation.reasons = [reason]; await writer.write(`${prefix}-summary`, operation); continue; }
      const currentScan={ ...scan, activityDays, config:{...config,activityDays}, workspace: options.workspace, cwd: options.cwd || scan.cwd };
      const fresh = await revalidateCandidate(approved, currentScan);
      if (!fresh.ok) { operation.status = 'skipped'; operation.reasons = fresh.reasons; await writer.write(`${prefix}-summary`, operation); continue; }
      const candidate = fresh.candidate || approved;
      assert(candidate.path === approved.path && candidate.operation === approved.operation && (MANAGER_ACTIONS.has(candidate.operation)?candidate.resourceId===approved.resourceId:same(candidate.fingerprint, approved.fingerprint)), 'Revalidation changed the approved action or identity.');
      assert(candidate.status !== 'protected' && candidate.protection.length === 0, 'Revalidation found a protected candidate.');
      if (candidate.status !== approved.status && candidate.status !== 'recommended') { operation.status = 'skipped'; operation.reasons = ['Risk changed after confirmation; review a fresh plan.']; await writer.write(`${prefix}-summary`, operation); continue; }
      if (!FILESYSTEM_ACTIONS.has(candidate.operation)&&!MANAGER_ACTIONS.has(candidate.operation)) {
        operation.status = 'skipped'; operation.reasons = ['This manager action has no verified narrowly scoped executor in this release. No command was run.'];
        await writer.write(`${prefix}-summary`, operation); continue;
      }
      const candidateVolume = await measureVolume(candidate.path);
      if (String(candidateVolume.id) !== String(volume.id)) { operation.status = 'skipped'; operation.reasons = ['This candidate is on a different filesystem from the target.']; await writer.write(`${prefix}-summary`, operation); continue; }
      await writer.write(`${prefix}-summary`, { ...operation, status: 'running', restore: candidate.restore, risks: candidate.risks });
      try {
        if(MANAGER_ACTIONS.has(candidate.operation)) {
          assert(candidate.metadata?.managerAction===true,'Manager action lacks verified manager metadata.');
          if(candidate.operation==='git-gc') {const use=await verifyCandidateUse(candidate);assert(use.ok,use.reasons.join(' '));}
          await writer.write(`intent-${prefix}-manager`,{candidateId:candidate.id,operation:candidate.operation,path:candidate.path,resourceId:candidate.resourceId||null,metadata:candidate.metadata});
          try {
            const result=await (await import('./managers.js')).executeManagerCandidate(candidate,{scan:currentScan,workspace:options.workspace,signal:options.signal});
            assert(result.status==='completed'&&result.operation===candidate.operation,'Manager returned an unverifiable operation result.');
            await writer.write(`result-${prefix}-manager`,{candidateId:candidate.id,complete:true,entries:[result]});
            Object.assign(operation,result);
          } catch(error) {
            await writer.write(`result-${prefix}-manager`,{candidateId:candidate.id,complete:false,entries:[{status:'unverified',error:cleanMessage(error)}]});
            throw error;
          }
        } else {
          const backend = await filesystemBackend();
          Object.assign(operation, await deleteCandidate(candidate, writer, prefix, backend, options.signal, options.onProgress));
        }
      } catch (error) {
        operation.status = error.removedEntries ? 'partial' : (error.name === 'AbortError' ? 'cancelled' : 'failed');
        operation.removedEntries = error.removedEntries || 0;
        operation.error = cleanMessage(error);
        // Any failure, including failed audit, stops the entire plan; no next destructive action is started.
        throw error;
      }
      operation.finishedAt = new Date().toISOString();
      volume = await measureVolume(scan.volume.root);
      operation.freeAfterBytes = volume.freeBytes;
      await writer.write(`${prefix}-summary`, operation);
      await writer.write('summary', report);
    }
    volume = await measureVolume(scan.volume.root);
    report.freeAfterBytes = volume.freeBytes;
    report.observedFreeDeltaBytes = volume.freeBytes - report.freeBeforeBytes;
    report.goalReached = volume.freeBytes >= plan.targetFree;
    report.remainingBytes = Math.max(0, plan.targetFree - volume.freeBytes);
    report.status = report.goalReached ? 'complete' : 'target-not-reached';
    report.stopReason ||= report.goalReached ? 'target-reached' : 'approved-plan-exhausted';
    report.finishedAt = new Date().toISOString();
    await writer.finish(report);
    return report;
  } catch (error) {
    if (!report) throw error;
    report.status = error.name === 'AbortError' ? 'cancelled' : 'failed';
    report.stopReason = error.name === 'AbortError' ? 'user-interrupted' : 'safety-or-audit-error';
    report.issues.push({ message: cleanMessage(error) });
    report.finishedAt = new Date().toISOString();
    try { const volume = await measureVolume(scan.volume.root); report.freeAfterBytes = volume.freeBytes; report.goalReached = volume.freeBytes >= plan.targetFree; report.remainingBytes = Math.max(0, plan.targetFree - volume.freeBytes); await writer.finish(report); }
    catch (auditError) { report.auditError = cleanMessage(auditError); report.unverified = true; }
    return report;
  } finally { await release().catch(() => {}); }
}
