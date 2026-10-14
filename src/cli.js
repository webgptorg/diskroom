import path from 'node:path';
import process from 'node:process';
import { VERSION, parseSize, formatBytes } from './common.js';
import { TerminalUI, reviewPlan, candidateDetails, safeText } from './tui.js';

export const HELP = `DiskRoom ${VERSION} - Goal-driven disk cleanup for developers.

Usage
  diskroom                             Interactive scan, review and clean
  diskroom scan [path]                  Scan only; never deletes files
  diskroom clean --scan <run-id>        Review a saved scan and confirm cleanup
  diskroom history [run-id]             Read local compressed audit history
  diskroom config [show]                Show local protection settings
  diskroom config protect add <path>    Protect a file or tree
  diskroom config exclude add <path>    Exclude a tree from scanning
  diskroom config archive add <path>    Mark a project archived (not safe to delete)
  diskroom config <rule> remove <path>  Remove a protect/exclude/archive rule
  diskroom config activity-days <days>  Set recent activity window (default 30)
  diskroom about                       Product and version information

Options
  --scope cwd|project|disk|system       Default: cwd. System needs a terminal
  --path <path>                        Scan path; does not move audit history
  --target-free <size>                 Total desired free space, not extra space
  --workspace <path>                   Store .diskroom in this folder (default cwd)
  --activity-days <days>               Recent activity window for a new scan
  --json                              Machine output for scan/history only
  --no-color                          Monochrome output (also the default)
  --help, -h                          Show help without scanning
  --version, -v                       Show actual installed version

Examples
  diskroom --target-free 5GB
  diskroom scan . --json
  diskroom scan ../projects --target-free 2GiB
  diskroom scan --scope disk --path C:/ --workspace C:/Users/me
  diskroom clean --scan <run-id>

Sizes: B, kB, MB, GB, KiB, MiB, GiB; decimals allowed (100kB, 2.5GiB).
The target is free space on one volume. A met target selects no cleanup.
Clean requires a real terminal and separate final confirmation, default NO.
There is no --yes or unattended deletion. Audit is not a backup or undo.
Exit codes: 0 complete; 1 error/incomplete; 2 clean target unmet; 130 cancelled.
Website: https://diskroom.dev
`;

export function parseArgs(argv, cwd = process.cwd()) {
  const options = { command: 'wizard', positional: [], scope: 'cwd', path: undefined, workspace: cwd, targetFree: null, json: false, noColor: false };
  const valueFlags = new Set(['--scope', '--path', '--workspace', '--target-free', '--scan', '--activity-days']);
  const boolFlags = new Set(['--help', '-h', '--version', '-v', '--json', '--no-color']);
  let positionalOnly = false;
  let commandSeen = false;
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    let argument = argv[index];
    if (argument === '--' && !positionalOnly) { positionalOnly = true; continue; }
    if (!positionalOnly && argument.startsWith('-')) {
      const equal = argument.indexOf('=');
      let value;
      if (equal !== -1) { value = argument.slice(equal + 1); argument = argument.slice(0, equal); }
      if (argument === '--yes' || argument === '-y') throw new Error('Unattended cleanup is not supported. Remove --yes and review the plan in a terminal.');
      if (boolFlags.has(argument)) {
        if (value !== undefined) throw new Error(`${argument} does not accept a value.`);
        if (argument === '--help' || argument === '-h') options.help = true;
        if (argument === '--version' || argument === '-v') options.version = true;
        if (argument === '--json') options.json = true;
        if (argument === '--no-color') options.noColor = true;
        continue;
      }
      if (!valueFlags.has(argument)) throw new Error(`Unknown option: ${argument}. Run diskroom --help.`);
      if (seen.has(argument)) throw new Error(`Specify ${argument} only once.`);
      seen.add(argument);
      if (value === undefined) value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} needs a value.`);
      if (argument === '--scope') options.scope = value;
      if (argument === '--path') options.path = path.resolve(cwd, value);
      if (argument === '--workspace') options.workspace = path.resolve(cwd, value);
      if (argument === '--target-free') options.targetFree = parseSize(value);
      if (argument === '--scan') options.scanId = value;
      if (argument === '--activity-days') {
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 36500) throw new Error('--activity-days must be an integer from 1 to 36500.');
        options.activityDays = Number(value);
      }
    } else if (!commandSeen && !positionalOnly) { options.command = argument; commandSeen = true; }
    else options.positional.push(argument);
  }
  if (options.help || options.version) return options;
  if (!['wizard', 'scan', 'clean', 'history', 'about', 'config'].includes(options.command)) throw new Error(`Unknown command: ${options.command}. Run diskroom --help.`);
  if (!['cwd', 'project', 'disk', 'system'].includes(options.scope)) throw new Error('--scope must be cwd, project, disk or system.');
  if (options.json && !['scan', 'history'].includes(options.command)) throw new Error('--json is supported only for scan and history.');
  if (options.command === 'scan') {
    if (options.positional.length > 1) throw new Error('scan accepts one path.');
    const positionalPath = options.positional[0] && path.resolve(cwd, options.positional[0]);
    if (positionalPath && options.path && positionalPath !== options.path) throw new Error('The positional path and --path disagree. Specify one scan path.');
    options.path ||= positionalPath;
  } else if (options.command === 'history') {
    if (options.positional.length > 1) throw new Error('history accepts at most one run ID.');
  } else if (options.command !== 'config' && options.positional.length) throw new Error(`${options.command} does not accept positional arguments.`);
  if (options.command === 'clean' && !options.scanId) throw new Error('Use diskroom clean --scan <run-id>. Find IDs with diskroom history.');
  if (options.scanId && options.command !== 'clean') throw new Error('--scan is only supported by clean.');
  const scanFlags = ['--scope', '--path'];
  if (!['wizard', 'scan'].includes(options.command) && scanFlags.some(flag => seen.has(flag))) throw new Error('--scope and --path are only supported by the wizard and scan.');
  if (!['wizard', 'scan', 'clean'].includes(options.command) && ['--target-free', '--activity-days'].some(flag => seen.has(flag))) throw new Error('Target/activity options require scan, clean or the wizard.');
  if (options.command === 'clean' && seen.has('--activity-days')) throw new Error('--activity-days applies to new scans. Set the activity window and create a new scan before cleanup.');
  options.path ||= cwd;
  options.scopeExplicit = seen.has('--scope');
  return options;
}

export function scanSummary(scan) {
  const count = status => scan.candidates.filter(candidate => candidate.status === status).length;
  return [
    `DiskRoom ${VERSION} | scan ${scan.id} | ${scan.status}`,
    `Scope: ${scan.roots.join(', ')}`,
    `Volume: ${scan.volume?.root || 'unavailable'}; free ${formatBytes(scan.freeAfterBytes ?? scan.volume?.freeBytes ?? 0)}`,
    scan.targetFree == null ? 'Information-only scan; no cleanup target.' : `Target free: ${formatBytes(scan.targetFree)} (total, not additional space)`,
    `Found ${scan.candidates.length} candidates: ${count('recommended')} recommended, ${count('review')} review, ${count('risky')} risky, ${count('protected')} protected.`,
    ...scan.issues.slice(0, 6).map(issue => `Issue: ${typeof issue === 'string' ? issue : issue.message || issue.reason || JSON.stringify(issue)}`),
    ...(scan.issues.length > 6 ? [`${scan.issues.length - 6} more issue(s) in the audit.`] : []),
    `Audit: ${scan.auditPath}`,
    `Read details: diskroom history ${scan.id}`,
    `Audit workspace: ${scan.workspace} (pass the same --workspace when reading history)`,
    'Scan only: no cleanup operations performed.',
  ];
}

export function cleanExitCode(report, aborted = false) {
  if (aborted || report.status === 'cancelled') return 130;
  if (['failed', 'error', 'partial', 'incomplete'].includes(report.status) || report.errors?.length || report.operations?.some(op => ['failed', 'error', 'partial', 'unverified'].includes(op.status))) return 1;
  if (report.goalReached === false || report.targetReached === false || report.targetMet === false || ['target-unmet', 'target-not-met', 'target-not-reached'].includes(report.status)) return 2;
  return 0;
}

async function pickTarget(ui, volume, current = null, allowScanOnly = true) {
  while (true) {
    const choices = [
      ...(current != null ? [{ value: current, label: `Use ${formatBytes(current)} total free` }] : []),
      ...['2GB', '5GB', '10GB'].map(size => ({ value: size, label: `${size} total free` })),
      { value: 'custom', label: 'Enter a custom size (for example 100kB or 2.5GiB)' },
      ...(allowScanOnly ? [{ value: 'scan-only', label: 'Scan only; do not prepare cleanup' }] : []),
    ];
    const choice = await ui.menu('Target: how much free space should remain?', choices, { intro: [`Volume: ${volume.root}`, `Available now: ${formatBytes(volume.freeBytes)} / capacity ${formatBytes(volume.totalBytes)}`] });
    if (choice === null) return undefined;
    if (choice === 'scan-only') return null;
    let result = choice;
    if (choice === 'custom') {
      result = await ui.inputText('Enter total desired free space', { initial: current == null ? '' : `${current}B`, validate: text => {
        try { const size = parseSize(text); return size > volume.totalBytes ? 'The target exceeds this volume capacity.' : null; } catch (error) { return error.message; }
      } });
      if (result === null) continue;
    }
    result = typeof result === 'number' ? result : parseSize(result);
    if (result > volume.totalBytes) { await ui.details('Target exceeds volume capacity', [`${formatBytes(result)} is above this volume's ${formatBytes(volume.totalBytes)} capacity.`, 'Choose a smaller target.']); continue; }
    return result;
  }
}

async function chooseScope(ui, options, api, cwd) {
  if (options.scopeExplicit) return { scope: options.scope, path: options.path };
  while (true) {
    const projectRoots = await api.resolveScope('project', options.path, cwd);
    const scope = await ui.menu('1 / 6 - choose scan scope', [
      { value: 'cwd', label: `Current folder: ${options.path}` },
      ...(projectRoots[0] !== options.path ? [{ value: 'project', label: `Project root: ${projectRoots[0]}` }] : []),
      { value: 'other', label: 'Another folder...' },
      { value: 'disk', label: 'Entire volume containing the selected folder' },
      { value: 'system', label: 'System overview: explicitly select local volumes...' },
    ], { intro: [`Audit workspace: ${options.workspace}/.diskroom`, 'Shared stores outside this scope are not silently included.'] });
    if (scope === null) return null;
    if (scope === 'other') {
      const input = await ui.inputText('Folder to scan', { initial: options.path, validate: value => value.trim() ? null : 'Enter a folder path.' });
      if (input === null) continue;
      return { scope: 'cwd', path: path.resolve(cwd, input) };
    }
    return { scope, path: options.path };
  }
}

async function prepareJobs(ui, options, api, cwd, wizard) {
  while (true) {
    const selection = wizard ? await chooseScope(ui, options, api, cwd) : { scope: options.scope, path: options.path };
    if (!selection) return null;
    let roots;
    if (selection.scope === 'system') {
      const volumes = await api.discoverVolumes();
      if (!volumes.length) throw new Error('No eligible local volumes were discovered. Use --path for an explicit local folder.');
      const selected = await ui.chooseVolumes(volumes);
      if (!selected) { if (!wizard || options.scopeExplicit) return null; continue; }
      roots = selected.map(volume => [volume.root]);
    } else roots = [await api.resolveScope(selection.scope, selection.path, cwd)];
    const jobs = [];
    let back = false;
    for (const volumeRoots of roots) {
      const volume = await api.measureVolume(volumeRoots[0]);
      const targetFree = wizard || selection.scope === 'system' ? await pickTarget(ui, volume, options.targetFree) : options.targetFree;
      if (targetFree === undefined) { back = true; break; }
      if (targetFree != null && targetFree > volume.totalBytes) throw new Error(`Target ${formatBytes(targetFree)} exceeds volume capacity ${formatBytes(volume.totalBytes)}.`);
      jobs.push({ roots: volumeRoots, volume, targetFree });
    }
    if (back) { if (!wizard || options.scopeExplicit) return null; continue; }
    return jobs;
  }
}

async function configCommand(options, api, output, cwd) {
  const config = await api.loadConfig(options.workspace);
  const [rule = 'show', action, rawPath, ...extra] = options.positional;
  if (rule === 'show' && !action) { output.write(`${JSON.stringify(config, null, 2)}\n`); return 0; }
  if (rule === 'activity-days' && /^\d+$/.test(action || '') && !rawPath && Number(action) >= 1 && Number(action) <= 36500) config.activityDays = Number(action);
  else if (['protect', 'exclude', 'archive'].includes(rule) && ['add', 'remove'].includes(action) && rawPath && !extra.length) {
    const field = rule === 'archive' ? 'archived' : rule;
    const absolute = path.resolve(cwd, rawPath);
    const values = new Set(config[field] || []);
    if (action === 'add') values.add(absolute); else values.delete(absolute);
    config[field] = [...values];
  } else throw new Error('Use config show; config protect|exclude|archive add|remove <path>; or config activity-days <days>.');
  await api.saveConfig(options.workspace, config);
  output.write(`Updated ${safeText(path.join(options.workspace, '.diskroom', 'config.json'))}\n${JSON.stringify(config, null, 2)}\n`);
  return 0;
}

/** Dependency injection keeps tests on isolated fixtures and fake IO. */
export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const input = dependencies.input || process.stdin;
  const output = dependencies.output || process.stdout;
  const errorOutput = dependencies.errorOutput || process.stderr;
  const cwd = dependencies.cwd || process.cwd();
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  let ui;
  let options;
  const completionMessages = [];
  try {
    options = parseArgs(argv, cwd);
    if (options.help) { output.write(HELP); return 0; }
    if (options.version) { output.write(`${VERSION}\n`); return 0; }
    if (options.command === 'about') {
      output.write(`DiskRoom ${VERSION}\nGoal-driven disk cleanup for developers.\nLocal scan -> review -> explicit confirmation -> clean.\nhttps://diskroom.dev\nAudit stays in your chosen workspace/.diskroom. No telemetry.\n`);
      return 0;
    }
    const interactive = Boolean(input.isTTY && output.isTTY);
    if ((options.command === 'wizard' || options.command === 'clean') && !interactive) throw new Error('Interactive cleanup requires a real terminal. Run diskroom scan . --json for a read-only report, then diskroom clean --scan <run-id> in a terminal.');
    if (options.scope === 'system' && (!interactive || options.json)) throw new Error('--scope system requires interactive volume selection. For JSON or non-TTY use an explicit --scope disk --path <path> for each volume.');
    const api = dependencies.api || { ...await import('./scanner.js'), ...await import('./planner.js'), ...await import('./audit.js'), ...await import('./executor.js') };
    if (options.command === 'config') return await configCommand(options, api, output, cwd);
    if (options.command === 'history') {
      const result = options.positional[0] ? await api.readRun(options.workspace, options.positional[0]) : await api.listRuns(options.workspace);
      if (options.json) output.write(`${JSON.stringify(result, null, 2)}\n`);
      else if (Array.isArray(result)) output.write(`DiskRoom ${VERSION} | history in ${safeText(path.join(options.workspace, '.diskroom'))}\n${result.length ? result.map(run => `${safeText(run.id)}  ${safeText(run.kind)}  ${safeText(run.status)}  ${safeText(run.startedAt || run.createdAt || '')}`).join('\n') : 'No recorded runs.'}\n`);
      else if (interactive) {
        ui = dependencies.ui || new TerminalUI({ input, output, signal: controller.signal, onCancel: interrupt });
        ui.open();
        if (result.kind === 'scan' && result.volume && Array.isArray(result.candidates) && result.status !== 'running') await reviewPlan(ui, result, { createPlan: api.createPlan, eligible: api.eligible, readOnly: true });
        else {
          const historyLines = [JSON.stringify({ ...result, candidates: undefined }, null, 2), ...(result.candidates || []).flatMap(candidate => ['', ...candidateDetails(candidate)])];
          await ui.details(`History: ${result.id}`, historyLines);
        }
      } else output.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    const needsUI = options.command === 'wizard' || options.command === 'clean' || options.scope === 'system';
    if (needsUI) { ui = dependencies.ui || new TerminalUI({ input, output, signal: controller.signal, onCancel: interrupt }); ui.open(); }
    let config = await api.loadConfig(options.workspace);
    if (options.activityDays) config = { ...config, activityDays: options.activityDays };

    const runCleanup = async report => {
      if (report.schemaVersion !== 1 || report.kind !== 'scan' || !Array.isArray(report.candidates) || !report.volume) throw new Error('Only a supported scan report can be used for cleanup. Create a new scan.');
      if (report.status === 'cancelled') { await ui.details('Cancelled scans cannot be cleaned', ['Create a new complete scan before preparing a cleanup plan.']); return 130; }
      report = { ...report, targetFree: options.targetFree ?? report.targetFree };
      // Historic measurements are displayed as such; fresh measurement updates only the planning basis.
      const freshVolume = await api.measureVolume(report.roots[0]);
      if (String(report.volume.id) !== String(freshVolume.id)) throw new Error('The scan volume identity changed. Create a new scan on the intended disk.');
      report = { ...report, volume: freshVolume, freeAfterBytes: freshVolume.freeBytes };
      if (report.targetFree == null) report.targetFree = await pickTarget(ui, freshVolume, null, false);
      if (report.targetFree === undefined) return 0;
      if (report.targetFree > freshVolume.totalBytes) throw new Error('Target exceeds the selected volume capacity. Choose a smaller target.');
      const planAudit = await api.createAudit(options.workspace, 'plan', { scanId: report.id, status: 'reviewing' });
      let revision = 0;
      let lastPlan;
      let approved = false;
      try {
        const plan = await reviewPlan(ui, report, {
          createPlan: api.createPlan, eligible: api.eligible,
          onRevision: async value => { await planAudit.write(`revision-${String(++revision).padStart(6, '0')}`, value); lastPlan = value; },
        });
        if (!plan) return 0;
        approved = true;
        await planAudit.finish({ scanId: report.id, status: 'approved', plan, revisions: revision });
        ui.render('5 / 6 - executing confirmed plan', ['Each operation is revalidated before it starts.', 'Ctrl+C stops subsequent work; completed deletions cannot be undone.']);
        const clean = await api.executePlan(report, plan, {
          workspace: options.workspace, cwd, signal: controller.signal, interactiveConfirmed: true,
          onProgress: event => ui.render('5 / 6 - executing confirmed plan', [safeText(event.message || event.path || event.candidateId || event.status || 'Working...'), 'Ctrl+C stops subsequent work; completed deletions cannot be undone.']),
        });
        await ui.details('6 / 6 - cleanup result', [JSON.stringify(clean, null, 2)]);
        completionMessages.push(`DiskRoom ${VERSION} | cleanup ${clean.id} | ${clean.status}\nAudit: ${safeText(clean.auditPath)}\n`);
        return cleanExitCode(clean, controller.signal.aborted);
      } finally {
        if (!approved) await planAudit.finish({ scanId: report.id, status: controller.signal.aborted ? 'cancelled' : 'not-approved', plan: lastPlan, revisions: revision });
      }
    };

    if (options.command === 'clean') return await runCleanup(await api.readRun(options.workspace, options.scanId));
    const jobs = await prepareJobs(ui, options, api, cwd, options.command === 'wizard');
    if (!jobs) return 0;
    if (ui) {
      while (true) {
        const choice = await ui.menu('Before scan: confirm scope and audit workspace', [
          { value: 'scan', label: 'Start scan (read-only except local audit)' },
          { value: 'details', label: 'Review full scope, exclusions and protection...' },
          { value: 'workspace', label: 'Change audit workspace...' },
          { value: 'cancel', label: 'Cancel without scanning' },
        ], { intro: [...jobs.flatMap(job => [`Scope: ${job.roots.join(', ')}`, `Volume: ${job.volume.root}; target ${job.targetFree == null ? 'scan only' : formatBytes(job.targetFree)}`]), `Audit: ${path.join(options.workspace, '.diskroom')}`, `Protected: ${config.protect?.join(', ') || 'none configured'}`, `Excluded: ${config.exclude?.join(', ') || 'none configured'}`] });
        if (choice === null || choice === 'cancel') return 0;
        if (choice === 'scan') break;
        if (choice === 'details') { await ui.details('Full scan scope and protection settings', [...jobs.flatMap(job => [`Volume: ${job.volume.root}`, ...job.roots.map(root => `Root: ${root}`)]), `Audit: ${path.join(options.workspace, '.diskroom')}`, '', ...config.protect.map(value => `Protect: ${value}`), ...config.exclude.map(value => `Exclude: ${value}`), ...config.archived.map(value => `Archived: ${value}`)]); continue; }
        const workspace = await ui.inputText('Audit workspace folder', { initial: options.workspace, validate: value => value.trim() ? null : 'Enter a folder path.' });
        if (workspace !== null) { options.workspace = path.resolve(cwd, workspace); config = await api.loadConfig(options.workspace); if (options.activityDays) config.activityDays = options.activityDays; }
      }
    }
    let exitCode = 0;
    for (const job of jobs) {
      if (controller.signal.aborted) return 130;
      const initial = { schemaVersion: 1, kind: 'scan', version: VERSION, startedAt: new Date().toISOString(), status: 'running', cwd, workspace: options.workspace, roots: job.roots, targetFree: job.targetFree, volume: job.volume, candidates: [], projects: [], directories: [], issues: [] };
      let audit;
      while (!audit) {
        try { audit = await api.createAudit(options.workspace, 'scan', initial); }
        catch (error) {
          if (!ui) throw new Error(`Cannot write audit in ${options.workspace}/.diskroom. Choose a writable --workspace before scanning. ${error.message}`);
          const retry = await ui.menu('Cannot write the audit; scanning has not started', [
            { value: false, label: 'Cancel without scanning (default)' },
            { value: true, label: 'Choose a different audit workspace...' },
          ], { intro: [error.message, `Current workspace: ${options.workspace}`, 'DiskRoom will not silently move the audit.'] });
          if (!retry) return 1;
          const replacement = await ui.inputText('Choose and confirm a writable audit workspace', { initial: cwd, validate: value => value.trim() ? null : 'Enter a folder path.' });
          if (replacement === null) return 1;
          options.workspace = path.resolve(cwd, replacement);
          initial.workspace = options.workspace;
          config = await api.loadConfig(options.workspace);
          if (options.activityDays) config.activityDays = options.activityDays;
          await ui.details('Settings for the replacement workspace', [
            `Audit: ${path.join(options.workspace, '.diskroom')}`, `Scan roots: ${job.roots.join(', ')}`,
            ...config.protect.map(value => `Protect: ${value}`), ...config.exclude.map(value => `Exclude: ${value}`),
          ]);
        }
      }
      let report;
      let lastProgress = 0;
      try {
        report = await api.scan({ ...initial, activityDays: config.activityDays || 30, config, signal: controller.signal, audit,
          onProgress: event => {
            const now = Date.now(); if (now - lastProgress < 100) return; lastProgress = now;
            const lines = [`Scope: ${job.roots.join(', ')}`, `Target volume: ${job.volume.root}`, `Processed ${event.processed ?? '?'}; found ${event.candidates ?? '?'} candidates`, safeText(event.path || ''), 'Scanning the full selected scope. Total size is not yet known.', `Audit: ${audit.path}`];
            if (ui) ui.render('3 / 6 - scanning (no deletion)', lines, 'Ctrl+C cancel and preserve audit');
            else if (errorOutput.isTTY) errorOutput.write(`\r\x1b[2KScanning: ${event.processed ?? '?'} entries; ${event.candidates ?? '?'} candidates`);
          },
        });
        report = { ...report, id: audit.id, auditPath: audit.path, workspace: options.workspace };
      } catch (error) {
        report = { ...initial, id: audit.id, auditPath: audit.path, finishedAt: new Date().toISOString(), status: controller.signal.aborted || error.name === 'AbortError' ? 'cancelled' : 'incomplete', issues: [{ message: error.message, code: error.code || error.name }] };
      }
      await audit.finish(report);
      if (!ui && errorOutput.isTTY) errorOutput.write('\n');
      if (options.json) output.write(`${JSON.stringify(report, null, 2)}\n`);
      else if (ui) {
        completionMessages.push(`${scanSummary(report).map(safeText).join('\n')}\n`);
        const proceed = await ui.details('4 / 6 - scan complete; no files cleaned', scanSummary(report), { continueLabel: job.targetFree === null || options.command === 'scan' ? 'browse report' : 'review plan' });
        if (!proceed) return report.status === 'complete' ? 0 : report.status === 'cancelled' ? 130 : 1;
      }
      else output.write(`${scanSummary(report).map(safeText).join('\n')}\n`);
      if (report.status === 'cancelled' || controller.signal.aborted) return 130;
      if (report.status !== 'complete') exitCode = 1;
      if (options.command === 'wizard' && job.targetFree !== null) { const cleanCode = await runCleanup(report); if (cleanCode) exitCode = cleanCode; }
      else if (ui) await reviewPlan(ui, report, { createPlan: api.createPlan, eligible: api.eligible, readOnly: true });
    }
    return exitCode;
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError') {
      ui?.close();
      errorOutput.write('DiskRoom interrupted. Completed operations are not undone; inspect .diskroom history.\n');
      if (error.name !== 'AbortError') errorOutput.write(`Finalization issue: ${safeText(error.message)}\n`);
      return 130;
    }
    ui?.close();
    errorOutput.write(`DiskRoom: ${safeText(error.message)}\n`);
    return 1;
  } finally {
    ui?.close();
    for (const message of completionMessages) output.write(message);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
