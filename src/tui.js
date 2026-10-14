import readline from 'node:readline';
import path from 'node:path';
import { VERSION, formatBytes } from './common.js';

/** Remove terminal control characters from untrusted names and paths. */
export function safeText(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

export function wrapText(value, width = 78) {
  const result = [];
  for (const source of String(value ?? '').split('\n')) {
    let line = safeText(source);
    if (!line) result.push('');
    while (line.length > width) {
      const cut = Math.max(line.lastIndexOf(' ', width), Math.floor(width / 2));
      result.push(line.slice(0, cut));
      line = line.slice(cut).trimStart();
    }
    if (line) result.push(line);
  }
  return result;
}

export function candidateDetails(candidate) {
  const score = (item) => item?.score == null ? 'unknown' : `${item.score}/100`;
  return [
    `ID: ${candidate.id}`, `Path / resource: ${candidate.path || candidate.resourceId}`,
    `Project: ${candidate.project || 'not identified'}`, `Ecosystem: ${candidate.ecosystem}`,
    `Category: ${candidate.category}`, `Status: ${candidate.status}`, `Operation: ${candidate.operation}`,
    `Logical size: ${formatBytes(candidate.logicalBytes || 0)}`,
    `Allocated size: ${candidate.allocatedBytes == null ? 'unknown' : formatBytes(candidate.allocatedBytes)}`,
    `Conservative recoverable estimate: ${candidate.reclaimableBytes == null ? 'unknown' : formatBytes(candidate.reclaimableBytes)}`,
    `Safety: ${score(candidate.safety)}; confidence ${candidate.safety?.confidence || 'unknown'}`,
    ...(candidate.safety?.reasons || []).map(x => `  ${x}`),
    `Current need: ${score(candidate.need)}; confidence ${candidate.need?.confidence || 'unknown'}`,
    ...(candidate.need?.reasons || []).map(x => `  ${x}`),
    `Observed activity: ${candidate.activityAt || 'unknown'}`,
    '', 'What changes / why:', ...(candidate.reasons || []).map(x => `- ${x}`),
    '', 'What could go wrong:', ...(candidate.risks?.length ? candidate.risks : ['See the safety evidence; recovery is not guaranteed.']).map(x => `- ${x}`),
    '', 'How to restore:', ...(candidate.restore?.length ? candidate.restore : ['No verified restoration instructions available.']).map(x => `- ${x}`),
    '', 'Protection:', ...(candidate.protection?.length ? candidate.protection : ['No additional protection recorded.']).map(x => `- ${x}`),
    '', 'The operation is limited to this resource. Audit is not a backup or general undo.',
  ];
}

export class TerminalUI {
  constructor({ input = process.stdin, output = process.stdout, signal, onCancel } = {}) {
    this.input = input;
    this.output = output;
    this.signal = signal;
    this.onCancel = onCancel;
    this.opened = false;
    this.pending = null;
    this.keyQueue = [];
    this.acceptingKeys = false;
    this.lastView = null;
    this.keyListener = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') { this.onCancel?.(); this.rejectPending(); return; }
      if (this.pending) { const pending = this.pending; this.pending = null; pending.resolve({ text, key }); }
      else if (this.acceptingKeys && this.keyQueue.length < 4096) this.keyQueue.push({ text, key });
    };
    this.resizeListener = () => {
      if (this.pending) { const pending = this.pending; this.pending = null; pending.resolve({ key: { name: 'resize' } }); }
      else if (this.lastView) this.render(...this.lastView);
    };
    this.abortListener = () => this.rejectPending();
  }

  get width() { return Math.max(20, (this.output.columns || 80) - 2); }
  get bodyHeight() { return Math.max(4, (this.output.rows || 24) - 6); }

  open() {
    if (this.opened) return;
    if (!this.input.isTTY || !this.output.isTTY || !this.input.setRawMode) throw new Error('Interactive commands require a terminal. Use diskroom scan . --json for a read-only scan.');
    this.oldRaw = this.input.isRaw;
    this.oldFlowing = this.input.readableFlowing;
    readline.emitKeypressEvents(this.input);
    this.input.setRawMode(true);
    this.input.resume();
    this.input.on('keypress', this.keyListener);
    this.output.on('resize', this.resizeListener);
    this.signal?.addEventListener('abort', this.abortListener, { once: true });
    this.output.write('\x1b[?1049h\x1b[?25l');
    this.opened = true;
  }

  close() {
    if (!this.opened) return;
    this.input.off('keypress', this.keyListener);
    this.output.off('resize', this.resizeListener);
    this.signal?.removeEventListener('abort', this.abortListener);
    this.input.setRawMode(Boolean(this.oldRaw));
    if (this.oldFlowing !== true) this.input.pause();
    this.output.write('\x1b[?25h\x1b[?1049l');
    this.keyQueue.length = 0;
    this.acceptingKeys = false;
    this.opened = false;
  }

  rejectPending() {
    if (this.pending) { const pending = this.pending; this.pending = null; const error = new Error('Interrupted by user.'); error.name = 'AbortError'; pending.reject(error); }
  }

  render(title, body, help = 'Esc back  |  Ctrl+C stop') {
    const screen = title.replace(/ \[\d+-\d+\/\d+\]$/, '');
    if (screen !== this.screen) { this.keyQueue.length = 0; this.acceptingKeys = false; this.screen = screen; }
    this.lastView = [title, body, help];
    const clip = x => Array.from(safeText(x)).slice(0, this.width).join('');
    const lines = [`DiskRoom ${VERSION}  |  diskroom.dev`, title, '', ...body.slice(0, this.bodyHeight), '', help];
    this.output.write(`\x1b[H\x1b[2J${lines.map(clip).join('\n')}`);
  }

  readKey() {
    if (this.signal?.aborted) return Promise.reject(Object.assign(new Error('Interrupted by user.'), { name: 'AbortError' }));
    this.acceptingKeys = true;
    if (this.keyQueue.length) return Promise.resolve(this.keyQueue.shift());
    return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
  }

  async menu(title, options, { intro = [], initial = 0, help } = {}) {
    let selected = Math.min(initial, options.length - 1);
    while (true) {
      const room = Math.max(2, this.bodyHeight - Math.min(intro.length, this.bodyHeight - 2));
      const start = Math.max(0, selected - room + 1);
      this.render(title, [...intro.slice(0, this.bodyHeight - 2), ...options.slice(start, start + room).map((item, i) => `${start + i === selected ? '>' : ' '} ${item.label}`)], help || 'Up/Down/Tab choose  |  Enter select  |  Esc back');
      const { key } = await this.readKey();
      if (key.name === 'escape') return null;
      if (key.name === 'up' || (key.name === 'tab' && key.shift)) selected = (selected - 1 + options.length) % options.length;
      if (key.name === 'down' || (key.name === 'tab' && !key.shift)) selected = (selected + 1) % options.length;
      if (key.name === 'return') return options[selected].value;
    }
  }

  async inputText(title, { initial = '', intro = [], validate = () => null } = {}) {
    const characters = Array.from(initial);
    let cursor = characters.length;
    let error = '';
    while (true) {
      const start = Math.max(0, cursor - this.width + 6);
      const field = `${characters.slice(start, cursor).join('')}|${characters.slice(cursor).join('')}`;
      this.render(title, [...intro, '', `> ${field}`, '', error], 'Type value  |  Enter accept  |  Esc back');
      const { text, key } = await this.readKey();
      if (key.name === 'escape') return null;
      if (key.name === 'return') { const value = characters.join(''); error = validate(value) || ''; if (!error) return value; }
      else if (key.name === 'backspace') { if (cursor > 0) { characters.splice(cursor - 1, 1); cursor--; } }
      else if (key.name === 'delete') characters.splice(cursor, 1);
      else if (key.name === 'left') cursor = Math.max(0, cursor - 1);
      else if (key.name === 'right') cursor = Math.min(characters.length, cursor + 1);
      else if (key.name === 'home') cursor = 0;
      else if (key.name === 'end') cursor = characters.length;
      else if (text && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f-\u009f]/.test(text)) { const inserted = Array.from(text); characters.splice(cursor, 0, ...inserted); cursor += inserted.length; }
    }
  }

  async details(title, lines, { continueLabel } = {}) {
    let offset = 0;
    while (true) {
      const wrapped = lines.flatMap(line => wrapText(line, this.width));
      const max = Math.max(0, wrapped.length - this.bodyHeight);
      offset = Math.min(offset, max);
      this.render(`${title} [${offset + 1}-${Math.min(offset + this.bodyHeight, wrapped.length)}/${wrapped.length}]`, wrapped.slice(offset, offset + this.bodyHeight), `Up/Down/PgUp/PgDn scroll  |  ${continueLabel ? `Enter ${continueLabel}  |  ` : ''}Esc back`);
      const { key } = await this.readKey();
      if (key.name === 'escape') return false;
      if (key.name === 'return') return Boolean(continueLabel);
      if (key.name === 'down' || key.name === 'tab') offset = Math.min(max, offset + 1);
      if (key.name === 'up') offset = Math.max(0, offset - 1);
      if (key.name === 'pagedown') offset = Math.min(max, offset + this.bodyHeight);
      if (key.name === 'pageup') offset = Math.max(0, offset - this.bodyHeight);
      if (key.name === 'home') offset = 0;
      if (key.name === 'end') offset = max;
    }
  }

  async chooseVolumes(volumes) {
    const selected = new Set();
    let cursor = 0;
    while (true) {
      const all = [...volumes.map(volume => `${selected.has(volume.id) ? '[x]' : '[ ]'} ${volume.root}  free ${formatBytes(volume.freeBytes)}`), `Continue with ${selected.size} selected volume(s)`];
      const start = Math.max(0, cursor - this.bodyHeight + 2);
      this.render('System overview: explicitly select local volumes', all.slice(start, start + this.bodyHeight).map((line, i) => `${start + i === cursor ? '>' : ' '} ${line}`), 'Up/Down/Tab focus  |  Space select  |  Enter continue  |  Esc back');
      const { key } = await this.readKey();
      if (key.name === 'escape') return null;
      if (key.name === 'up' || (key.name === 'tab' && key.shift)) cursor = (cursor - 1 + all.length) % all.length;
      if (key.name === 'down' || (key.name === 'tab' && !key.shift)) cursor = (cursor + 1) % all.length;
      if (key.name === 'space' && cursor < volumes.length) { const id = volumes[cursor].id; if (selected.has(id)) selected.delete(id); else selected.add(id); }
      if (key.name === 'return' && selected.size > 0) return volumes.filter(v => selected.has(v.id));
    }
  }
}

export function filterCandidates(candidates, { search = '', category = 'all', sort = 'recommended' } = {}) {
  const filtered = candidates.filter(candidate => `${candidate.path} ${candidate.project || ''} ${candidate.id}`.toLowerCase().includes(search.toLowerCase()) && (category === 'all' || candidate.category === category));
  const rank = { recommended: 0, review: 1, risky: 2, protected: 3 };
  const compare = {
    recommended: (a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || (b.reclaimableBytes || 0) - (a.reclaimableBytes || 0),
    size: (a, b) => (b.logicalBytes || 0) - (a.logicalBytes || 0),
    safety: (a, b) => (b.safety?.score ?? -1) - (a.safety?.score ?? -1),
    activity: (a, b) => (b.need?.score ?? -1) - (a.need?.score ?? -1),
    ecosystem: (a, b) => String(a.ecosystem).localeCompare(String(b.ecosystem)),
    project: (a, b) => String(a.project || a.path).localeCompare(String(b.project || b.path)),
  };
  return filtered.sort(compare[sort] || compare.recommended);
}

/** Full keyboard review. Every accepted selection writes a durable plan revision. */
export async function reviewPlan(ui, scan, { createPlan, eligible, onRevision, readOnly = false }) {
  let plan = createPlan(scan, readOnly ? { selectedIds: [], targetFree: Math.max(1, scan.freeAfterBytes ?? scan.volume.freeBytes) } : {});
  let cursor = 0;
  let search = '';
  let category = 'all';
  let sort = 'recommended';
  let tree = false;
  let note = '';
  const collapsed = new Set();
  if (!readOnly) await onRevision(plan);
  const revise = async selectedIds => {
    let next;
    try { next = createPlan(scan, { selectedIds: [...new Set(selectedIds)], targetFree: plan.targetFree }); }
    catch (error) { note = error.message; return false; }
    await onRevision(next);
    plan = next;
    return true;
  };
  while (true) {
    const candidates = filterCandidates(scan.candidates, { search, category, sort });
    let rows = candidates.map(candidate => ({ candidate }));
    if (tree) {
      const groups = new Map();
      for (const candidate of candidates) { const project = candidate.project || path.dirname(candidate.path || 'Resources'); if (!groups.has(project)) groups.set(project, []); groups.get(project).push(candidate); }
      rows = [...groups].flatMap(([project, items]) => [{ project, count: items.length }, ...(collapsed.has(project) ? [] : items.map(candidate => ({ candidate }))) ]);
    }
    if (!readOnly) rows.push({ action: 'confirm' });
    rows.push({ action: 'exit' });
    cursor = Math.max(0, Math.min(cursor, rows.length - 1));
    const selected = new Set(plan.selectedIds);
    const free = scan.freeAfterBytes ?? scan.volume.freeBytes;
    const projects = new Set(scan.candidates.filter(c => selected.has(c.id)).map(c => c.project || c.path));
    const top = [
      `Volume: ${scan.volume.root} | Scan: ${scan.status}`,
      readOnly ? `Free ${formatBytes(free)} | ${scan.candidates.length} findings | read-only` : `Free ${formatBytes(free)} / target ${formatBytes(plan.targetFree)} | selected ${plan.selectedIds.length}, projects ${projects.size}`,
      readOnly ? `Audit: ${scan.auditPath}` : `Estimated gain ${formatBytes(plan.estimatedBytes)}${plan.unknownGain ? ' + unknown' : ''} | still missing ${formatBytes(plan.remainingBytes || 0)}`,
      ...(readOnly ? [] : [`Estimated free after plan: ${formatBytes(free + plan.estimatedBytes)}${plan.unknownGain ? ' + unknown gain' : ''}`]),
      `${tree ? 'Tree' : 'List'} | ${category} | sort ${sort}${search ? ` | search: ${search}` : ''}`,
    ].slice(0, Math.max(1, ui.bodyHeight - 3));
    const room = Math.max(2, ui.bodyHeight - top.length - 1);
    const start = Math.max(0, cursor - room + 1);
    const display = rows.slice(start, start + room).map((row, i) => {
      const focus = start + i === cursor ? '>' : ' ';
      if (row.action) return `${focus} [${row.action === 'confirm' ? 'Review exact plan and confirmation...' : readOnly ? 'Close report' : 'Exit without cleanup'}]`;
      if (row.project) return `${focus} ${collapsed.has(row.project) ? '[+]' : '[-]'} ${row.project} (${row.count})`;
      const c = row.candidate;
      const gain = c.reclaimableBytes == null ? '?' : formatBytes(c.reclaimableBytes);
      return `${focus} ${selected.has(c.id) ? '[x]' : '[ ]'} ${gain} ${c.status} ${tree ? path.basename(c.path || c.resourceId) : c.path || c.resourceId}`;
    });
    ui.render(readOnly ? 'Read-only scan report' : 'Report and plan: nothing has been deleted', [...top, ...display, note], readOnly ? 'Enter detail | / search | ? keys | Esc exit' : 'Space select | Enter detail | / search | ? keys | c confirm | Esc exit');
    const { text, key } = await ui.readKey();
    note = '';
    if (key.name === 'escape' || text === 'q') return null;
    if (key.name === 'up' || (key.name === 'tab' && key.shift)) cursor = (cursor - 1 + rows.length) % rows.length;
    if (key.name === 'down' || (key.name === 'tab' && !key.shift)) cursor = (cursor + 1) % rows.length;
    if (key.name === 'home') cursor = 0;
    if (key.name === 'end') cursor = rows.length - 1;
    if (key.name === 'pageup') cursor = Math.max(0, cursor - room);
    if (key.name === 'pagedown') cursor = Math.min(rows.length - 1, cursor + room);
    if (text === '/') { const value = await ui.inputText('Search by path, project or ID', { initial: search }); if (value !== null) search = value; cursor = 0; }
    if (text === 'f') { const value = await ui.menu('Filter category', ['all', ...new Set(scan.candidates.map(c => c.category))].map(v => ({ value: v, label: v }))); if (value) category = value; cursor = 0; }
    if (text === 's') { const value = await ui.menu('Sort candidates', ['recommended', 'size', 'safety', 'activity', 'ecosystem', 'project'].map(v => ({ value: v, label: v }))); if (value) sort = value; cursor = 0; }
    if (text === 't') { tree = !tree; cursor = 0; }
    if (text === '?') await ui.details('Report keyboard controls', [
      'Up/Down/Tab: focus candidate or action. Enter: show candidate details.',
      'Space: select or deselect an eligible candidate.',
      '/: search path, project or candidate ID. f: category filter. s: sort.',
      't: project tree/list. Left/Right: collapse/expand tree project.',
      'i: largest directories and project inventory.',
      'a: add visible recommended candidates. n: clear selection.',
      'c: review the exact plan before a separate confirmation screen.',
      'Escape: exit without approval. Ctrl+C: stop further work.',
      'Unknown gain is not included in the conservative byte estimate.',
    ]);
    if (text === 'i') await ui.details('Largest directories and project inventory', [
      'Largest observed directories (nested sizes overlap; do not add them):',
      ...(scan.directories || []).slice(0, 100).map(directory => `${formatBytes(directory.logicalBytes)}  ${directory.path}`),
      '', 'Recognized projects:',
      ...(scan.projects || []).map(project => `${project.path}  ${project.ecosystem || project.ecosystems?.join(', ') || ''}`),
      '', 'Plugin coverage:',
      ...(scan.plugins || []).map(plugin => `${plugin.id || plugin.name}: ${plugin.status || 'unknown'}`),
      '', 'Issues and exclusions:',
      ...(scan.issues || []).map(issue => typeof issue === 'string' ? issue : JSON.stringify(issue)),
    ]);
    if (!readOnly && text === 'a') await revise([...selected, ...candidates.filter(c => c.status === 'recommended' && eligible(c)).map(c => c.id)]);
    if (!readOnly && text === 'n') await revise([]);
    const row = rows[cursor];
    if (row.project && (key.name === 'return' || key.name === 'space' || key.name === 'left' || key.name === 'right')) {
      if (key.name === 'left') collapsed.add(row.project);
      else if (key.name === 'right') collapsed.delete(row.project);
      else if (collapsed.has(row.project)) collapsed.delete(row.project); else collapsed.add(row.project);
    }
    if (row.candidate && key.name === 'return') await ui.details('Candidate details', candidateDetails(row.candidate));
    if (!readOnly && row.candidate && key.name === 'space') {
      if (!eligible(row.candidate)) note = 'Protected or detection-only: cannot select. Open details for the reason.';
      else { if (selected.has(row.candidate.id)) selected.delete(row.candidate.id); else selected.add(row.candidate.id); await revise([...selected]); }
    }
    if (row.action === 'exit' && key.name === 'return') return null;
    if (!readOnly && (text === 'c' || (row.action === 'confirm' && key.name === 'return'))) {
      if (!plan.selectedIds.length) { note = 'No operations selected. Exit without cleanup or select eligible candidates.'; continue; }
      const approved = await confirmPlan(ui, scan, plan);
      if (approved) { plan = approved; await onRevision(plan); return plan; }
    }
  }
}

export async function confirmPlan(ui, scan, plan) {
  const selected = scan.candidates.filter(c => plan.selectedIds.includes(c.id));
  const lines = [
    `Scan: ${scan.id} (${scan.status})`, `Volume: ${scan.volume.root}`,
    `Target free: ${formatBytes(plan.targetFree)}; conservative estimated gain ${formatBytes(plan.estimatedBytes)}`,
    `Audit: ${scan.auditPath}`, '',
    ...(scan.status !== 'complete' ? ['WARNING: scan is incomplete. Missing information may prevent individual operations.', ''] : []),
    ...selected.flatMap(c => [`${c.id} | ${c.status} | ${c.operation}`, `  ${c.path || c.resourceId}`, ...(c.risks || []).map(x => `  Risk: ${x}`), ...(c.restore || []).map(x => `  Restore: ${x}`), '']),
    'Only these operations are authorized. Execution revalidates each resource and stops once the actual target is met.',
    'Deleted data is not moved to a trash bin. The audit cannot restore deleted files.',
  ];
  if (!await ui.details('Exact cleanup plan: review before confirmation', lines, { continueLabel: 'continue to confirmation' })) return null;
  const riskAcknowledgements = [];
  for (const candidate of selected.filter(c => c.status !== 'recommended')) {
    const typed = await ui.inputText('Additional resource acknowledgement', {
      intro: [`${candidate.status}: ${candidate.path || candidate.resourceId}`, ...(candidate.risks || []).slice(0, 3), `Type exact candidate ID: ${candidate.id}`],
      validate: value => value === candidate.id ? null : 'The exact ID is required; Escape cancels.',
    });
    if (typed === null) return null;
    riskAcknowledgements.push(candidate.id);
  }
  const approved = await ui.menu('FINAL CONFIRMATION: execute this cleanup plan?', [
    { value: false, label: 'NO - return without changing files (default)' },
    { value: true, label: `YES - execute ${selected.length} approved operation(s)` },
  ], { intro: [`Target: ${scan.volume.root}; ${formatBytes(plan.targetFree)} free`, `Estimated gain: ${formatBytes(plan.estimatedBytes)}; this is not guaranteed.`, 'Deleted files are not backed up by DiskRoom.'], initial: 0 });
  return approved ? { ...plan, confirmation: { approved: true, at: new Date().toISOString(), riskAcknowledgements } } : null;
}
