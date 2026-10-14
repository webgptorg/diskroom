/** Bounded, read-only OS process observations. No PATH search, shell, user
 * profile, project command, or untrusted PowerShell module is executed.
 * Returned snapshots contain only path/kind/PID, never raw command lines.
 * Neither backend proves inactivity: snapshots are deliberately partial. */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { lstat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import * as native from '../native/index.js';

const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_REFS = 100000;
const MAX_PATH = 32768;
const TIMEOUT_MS = 10000;
const GENERAL_LIMIT = 'Process inspection is a point-in-time observation of same-user processes; other-user processes, permission-restricted paths and future opens are not fully observable. Absence of observed use is not proof of inactivity.';
const WINDOWS_PHASES = new Set(['startup', 'system-modules', 'identity', 'process-list', 'owner-query', 'serialization']);

/** Internal runner: errors/stderr are intentionally never exposed in reports. */
export function runProcessProbe(executable, args, { env, timeoutMs = TIMEOUT_MS, maxBytes = MAX_OUTPUT } = {}) {
  return new Promise(resolve => {
    let child, timer, finished = false, timedOut = false, truncated = false, stderr = false;
    let bytes = 0; const chunks = [];
    function finish(code = null, failed = false) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      resolve({ stdout: Buffer.concat(chunks, bytes), code, failed, timedOut, truncated, stderr });
    }
    function stop() {
      try { child?.kill('SIGKILL'); } catch {}
      child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref();
      finish(null, true);
    }
    try {
      child = spawn(executable, args, {
        shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env,
        cwd: (process.platform === 'win32' ? path.win32 : path.posix).dirname(executable),
      });
    } catch { finish(null, true); return; }
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.stdout.on('data', chunk => {
      const remaining = Math.max(0, maxBytes - bytes);
      if (remaining) { const part = chunk.subarray(0, remaining); chunks.push(part); bytes += part.length; }
      if (chunk.length > remaining) { truncated = true; stop(); }
    });
    // Only remember that a warning occurred: diagnostic output may contain paths,
    // commands, environment variables, or credentials and is never retained.
    child.stderr.on('data', () => { stderr = true; });
    child.on('error', () => finish(null, true));
    child.on('close', code => finish(code, false));
  });
}

async function trustedExecutable(file, platform) {
  try {
    // Reject links and user-writable Unix ancestors, not merely the final file.
    const flavor = platform === 'win32' ? path.win32 : path.posix;
    let current = flavor.parse(file).root;
    for (const part of file.slice(current.length).split(flavor.sep).filter(Boolean)) {
      current = flavor.join(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink()) return false;
      if (platform !== 'win32' && (info.uid !== 0 || (info.mode & 0o022))) return false;
      if (current === file ? !info.isFile() : !info.isDirectory()) return false;
    }
    await access(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch { return false; }
}

function textOutput(value) {
  if (typeof value === 'string') return value.length <= MAX_OUTPUT ? value : null;
  if (!Buffer.isBuffer(value) || value.length > MAX_OUTPUT) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value); } catch { return null; }
}
function collector(maxRefs = MAX_REFS) {
  const refs = [], keys = new Set(); let limited = false;
  return {
    refs, get limited() { return limited; },
    add(file, kind, pid) {
      if (typeof file !== 'string' || !file || file.length > MAX_PATH || file.includes('\0')) return;
      const key = `${pid}\0${kind}\0${file}`;
      if (keys.has(key)) return;
      if (refs.length >= maxRefs) { limited = true; return; }
      keys.add(key); refs.push({ path: file, kind, pid });
    },
  };
}

// lsof renders nonprintable bytes even in machine mode. Preserve the literal
// interpretation too: a real filename can itself contain an escape sequence.
function lsofNames(value) {
  const names = new Set([value]);
  const escapes = { b: 8, f: 12, r: 13, n: 10, t: 9 };
  const pieces = []; let offset = 0;
  for (const match of value.matchAll(/\\x([0-9a-fA-F]{2})|\\([bfrnt])|\^([@-_?])/g)) {
    pieces.push(Buffer.from(value.slice(offset, match.index)));
    let byte;
    if (match[1]) byte = parseInt(match[1], 16);
    else if (match[2] && Object.hasOwn(escapes, match[2])) byte = escapes[match[2]];
    else if (match[3]) byte = match[3] === '?' ? 127 : match[3].charCodeAt(0) - 64;
    if (byte === undefined || byte < 0 || byte > 255) pieces.push(Buffer.from(match[0]));
    else pieces.push(Buffer.from([byte]));
    offset = match.index + match[0].length;
  }
  if (pieces.length) try { pieces.push(Buffer.from(value.slice(offset))); names.add(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(pieces))); } catch {}
  for (const name of [...names]) if (name.endsWith(' (deleted)')) names.add(name.slice(0, -10));
  return names;
}

/** Parse lsof -F0pufn without splitting path fields on newlines. */
export function parseLsofProcessFields(output, { uid, selfPid = process.pid, maxRefs = MAX_REFS } = {}) {
  const text = textOutput(output), found = collector(maxRefs);
  if (text === null || !Number.isInteger(uid) || uid < 0) return { refs: [], incomplete: true };
  let pid = null, owner = null, descriptor = null, incomplete = false;
  const fields = text.split('\0');
  // Ignore a truncated final field, but retain complete observations before it.
  if (fields.at(-1)?.replace(/\n/g, '')) incomplete = true;
  fields.pop();
  for (let field of fields) {
    field = field.replace(/^\n+/, '');
    if (!field) continue;
    const key = field[0], value = field.slice(1);
    if (key === 'p') {
      pid = /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
      owner = null; descriptor = null;
      if (!pid) incomplete = true;
    } else if (key === 'u') owner = /^\d+$/.test(value) ? Number(value) : null;
    else if (key === 'f') descriptor = value;
    else if (key === 'n' && pid && pid !== selfPid && owner === uid && descriptor) {
      if (value.length > MAX_PATH) { incomplete = true; continue; }
      const kind = descriptor === 'cwd' ? 'cwd' : descriptor === 'txt' ? 'exe' : descriptor === 'mem' ? 'memory-map' : 'open-file';
      for (const name of lsofNames(value)) if (path.posix.isAbsolute(name)) found.add(name, kind, pid);
      if (found.limited) break;
    }
  }
  return { refs: found.refs, incomplete: incomplete || found.limited };
}

function absoluteWindowsPath(value) {
  if (typeof value !== 'string' || value.length > MAX_PATH || /[\0\r\n]/.test(value)) return null;
  if (/^\\\\\?\\UNC\\/i.test(value)) value = `\\\\${value.slice(8)}`;
  else if (/^\\\\\?\\[a-z]:\\/i.test(value)) value = value.slice(4);
  if (!/^[a-z]:[\\/]/i.test(value) && !/^\\\\[^\\/?.]+[\\/][^\\/]+(?:[\\/]|$)/.test(value)) return null;
  return path.win32.normalize(value);
}

/** Extract only whole absolute-path arguments using Windows CRT quote rules.
 * Relative arguments, shell syntax and --key=value are deliberately not inferred. */
export function windowsAbsoluteArguments(commandLine) {
  if (typeof commandLine !== 'string' || commandLine.length > MAX_PATH || commandLine.includes('\0')) return [];
  const result = []; let cursor = 0, argumentIndex = 0;
  while (cursor < commandLine.length) {
    while (/[ \t]/.test(commandLine[cursor] || '') && cursor < commandLine.length) cursor++;
    if (cursor === commandLine.length) break;
    let token = '', quoted = false;
    while (cursor < commandLine.length) {
      if (!quoted && /[ \t]/.test(commandLine[cursor])) break;
      let slashes = 0;
      while (commandLine[cursor] === '\\') { slashes++; cursor++; }
      if (commandLine[cursor] === '"') {
        token += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) { token += '"'; cursor++; }
        else if (quoted && commandLine[cursor + 1] === '"') { token += '"'; cursor += 2; }
        else { quoted = !quoted; cursor++; }
      } else {
        token += '\\'.repeat(slashes);
        if (cursor < commandLine.length && (quoted || !/[ \t]/.test(commandLine[cursor]))) token += commandLine[cursor++];
      }
    }
    if (argumentIndex++ > 0 && !quoted) { const file = absoluteWindowsPath(token); if (file) result.push(file); }
  }
  return [...new Set(result)];
}

/** NDJSON is streamed so a terminated query still preserves completed records. */
export function parseWindowsProcessLines(output, { selfPid = process.pid, maxRefs = MAX_REFS } = {}) {
  const text = textOutput(output), found = collector(maxRefs);
  if (text === null) return { refs: [], incomplete: true };
  let complete = false, incomplete = false, phase = null, failure = null;
  for (const line of text.replace(/^\ufeff/, '').split(/\r?\n/)) {
    if (!line) continue;
    let row; try { row = JSON.parse(line); } catch { incomplete = true; continue; }
    if (row?.type === 'status' && WINDOWS_PHASES.has(row.stage)) { phase = row.stage; continue; }
    if (row?.type === 'failure' && WINDOWS_PHASES.has(row.stage)) {
      phase = row.stage;
      failure = { phase, code: Number.isSafeInteger(row.code) && Math.abs(row.code) <= 0xffffffff ? row.code : null };
      incomplete = true; continue;
    }
    if (row?.type === 'complete') { complete = true; incomplete ||= row.omitted !== false; continue; }
    if (!row || row.type !== 'process' || row.sameUser !== true || !Number.isSafeInteger(row.pid) || row.pid <= 0) { incomplete = true; continue; }
    if (row.pid === selfPid) continue;
    const executable = absoluteWindowsPath(row.executablePath);
    if (executable) found.add(executable, 'exe', row.pid);
    else incomplete = true;
    if (typeof row.commandLine !== 'string') incomplete = true;
    for (const file of windowsAbsoluteArguments(row.commandLine)) found.add(file, 'process-argument', row.pid);
    if (found.limited) break;
  }
  return { refs: found.refs, incomplete: !complete || incomplete || found.limited, phase, failure };
}

const WINDOWS_QUERY = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PSModuleAutoLoadingPreference = 'None'
$stage = 'startup'
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  [Console]::WriteLine('{"type":"status","stage":"startup"}')
  $stage = 'system-modules'
  Import-Module -Name ($PSHOME + '\Modules\CimCmdlets\CimCmdlets.psd1') -ErrorAction Stop
  Import-Module -Name ($PSHOME + '\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
  $stage = 'identity'
  $ownerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $omitted = $false
  $count = 0
  $stage = 'process-list'
  CimCmdlets\Get-CimInstance -ClassName Win32_Process -Property Handle,ProcessId,ExecutablePath,CommandLine -OperationTimeoutSec 3 | ForEach-Object {
    $item = $_
    if ($item.ProcessId -ne $PID) {
      $count++
      if ($count -gt 20000) { throw 'Process observation limit' }
      try {
        $stage = 'owner-query'
        $owner = CimCmdlets\Invoke-CimMethod -InputObject $item -MethodName GetOwnerSid -OperationTimeoutSec 2
        if ($owner.ReturnValue -eq 0 -and $owner.Sid -eq $ownerSid) {
          $stage = 'serialization'
          $record = @{ type='process'; sameUser=$true; pid=[int]$item.ProcessId; executablePath=$item.ExecutablePath; commandLine=$item.CommandLine }
          [Console]::WriteLine((Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $record -Compress))
        } elseif ($owner.ReturnValue -ne 0) { $omitted = $true }
      } catch { $omitted = $true }
    }
  }
  $stage = 'serialization'
  [Console]::WriteLine((Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject @{ type='complete'; omitted=$omitted } -Compress))
} catch {
  [Console]::WriteLine('{"type":"failure","stage":"' + $stage + '","code":' + ([int]$_.Exception.HResult) + '}')
  exit 1
}
`;

function unavailable(message) { return { refs: [], coverage: 'unavailable', limitations: [message, GENERAL_LIMIT] }; }
function diagnostics(result, incomplete) {
  const limits = [];
  if (result.timedOut) limits.push('The process query reached its time limit; only completed observations were retained.');
  if (result.truncated) limits.push('The process query reached its output limit; only completed observations were retained.');
  if (result.failed || result.code !== 0 || result.stderr || incomplete) limits.push('Some process records could not be inspected or decoded; observations are incomplete.');
  return limits;
}

/** Dependencies may be supplied by tests; scanner calls this without arguments. */
export async function nativeProcessSnapshot({
  platform = process.platform, uid = process.getuid?.(), selfPid = process.pid,
  run = runProcessProbe, executableExists = trustedExecutable, systemDirectory = native.systemDirectory,
} = {}) {
  if (platform === 'darwin') {
    if (!Number.isInteger(uid) || uid < 0) return unavailable('The same-user macOS process owner could not be established.');
    let executable;
    for (const file of ['/usr/sbin/lsof', '/usr/bin/lsof']) if (await executableExists(file, platform)) { executable = file; break; }
    if (!executable) return unavailable('Trusted system lsof is unavailable; macOS open-file and working-directory observations are unavailable.');
    let result;
    // Apple's libproc lsof has no device-cache file support (and rejects -D).
    try { result = await run(executable, ['-n', '-P', '-l', '-F0pufn', '-u', String(uid), '-p', `^${selfPid}`], { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' } }); }
    catch { return unavailable('The macOS process query could not start.'); }
    const parsed = parseLsofProcessFields(result.stdout, { uid, selfPid });
    return { refs: parsed.refs, coverage: 'partial', limitations: [
      'macOS observes available same-user cwd, executable/text mappings and open-file paths through system lsof; argument-only references and permission-restricted paths are not fully observable. Ambiguous escaped filenames may protect both interpretations.',
      ...diagnostics(result, parsed.incomplete), GENERAL_LIMIT,
    ] };
  }
  if (platform === 'win32') {
    let directory;
    try { directory = systemDirectory(); } catch { return unavailable('Trusted native Windows system-directory discovery is unavailable; process observations are unavailable.'); }
    if (typeof directory !== 'string' || !/^[a-z]:\\[^\0\r\n]+$/i.test(directory) || path.win32.basename(directory).toLowerCase() !== 'system32') return unavailable('The native Windows system directory could not be validated.');
    const executable = path.win32.join(directory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!await executableExists(executable, platform)) return unavailable('Trusted system Windows PowerShell is unavailable; process observations are unavailable.');
    const windows = path.win32.dirname(directory), home = path.win32.dirname(executable);
    let result;
    // Encode the fixed script so CreateProcess/PowerShell command-line quoting
    // cannot reinterpret its syntax. No project input is inserted in the script.
    try { result = await run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_QUERY, 'utf16le').toString('base64')], { env: { SystemRoot: windows, WINDIR: windows, PATH: directory, PSModulePath: path.win32.join(home, 'Modules') } }); }
    catch { return unavailable('The Windows process query could not start.'); }
    const parsed = parseWindowsProcessLines(result.stdout, { selfPid });
    return { refs: parsed.refs, coverage: 'partial', limitations: [
      'Windows observes available same-user executable paths and whole absolute command-line arguments through system PowerShell/CIM. Process working directories and open-file handles are unavailable; relative arguments, embedded shell commands and --key=value paths are not resolved. Raw command lines are discarded and never written to reports.',
      ...(parsed.failure ? [`Windows process query failed during ${parsed.failure.phase}${parsed.failure.code === null ? '' : ` (system error ${parsed.failure.code})`}.`] : result.code !== 0 && !parsed.phase ? ['Windows process query did not initialize its machine-readable output.'] : []),
      ...diagnostics(result, parsed.incomplete), GENERAL_LIMIT,
    ] };
  }
  return unavailable(`Native process observation is not implemented for ${platform}.`);
}
