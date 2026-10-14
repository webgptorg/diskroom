import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { TerminalUI, confirmPlan, reviewPlan, filterCandidates, safeText, candidateDetails } from '../src/tui.js';
import { createPlan, eligible } from '../src/planner.js';

function fixture(status = 'recommended') {
  const candidate = { id: 'candidate-exact', path: '/fixture/build', project: '/fixture', ecosystem: 'node', category: 'build', operation: 'delete-tree', status, logicalBytes: 1000, reclaimableBytes: 900, safety: { score: 90, confidence: 'high', reasons: ['Regeneratable output'] }, need: { score: 10, confidence: 'medium', reasons: ['Archived project'] }, risks: ['Rebuilding requires dependencies.'], restore: ['Run the trusted build yourself.'], reasons: ['Known build directory'], protection: [] };
  const scan = { schemaVersion: 1, kind: 'scan', id: 'scan-id', status: 'complete', targetFree: 2000, volume: { root: '/fixture', totalBytes: 10000, freeBytes: 1000 }, candidates: [candidate] };
  const plan = createPlan(scan, { selectedIds: eligible(candidate) ? [candidate.id] : [] });
  return { candidate, scan, plan };
}

test('untrusted paths cannot emit terminal control sequences', () => {
  assert.equal(safeText('a\x1b[2J\r\nb\x07'), 'a [2J  b ');
});

test('final confirmation defaults to NO even after reviewing exact plan', async () => {
  const { scan, plan } = fixture();
  let called = false;
  const ui = {
    details: async (_title, lines) => { assert.ok(lines.some(line => line.includes('/fixture/build'))); return true; },
    menu: async (_title, choices, options) => { called = true; assert.equal(options.initial, 0); assert.equal(choices[0].value, false); return choices[0].value; },
  };
  assert.equal(await confirmPlan(ui, scan, plan), null);
  assert.equal(called, true);
});

test('review/risky operations require exact candidate acknowledgement and final consent', async () => {
  const { scan, plan } = fixture('risky');
  const calls = [];
  const ui = {
    details: async () => { calls.push('review'); return true; },
    inputText: async (_title, { validate }) => {
      calls.push('acknowledge'); assert.ok(validate('yes')); assert.equal(validate('candidate-exact'), null); return 'candidate-exact';
    },
    menu: async () => { calls.push('confirm'); return true; },
  };
  const result = await confirmPlan(ui, scan, plan);
  assert.deepEqual(calls, ['review', 'acknowledge', 'confirm']);
  assert.deepEqual(result.confirmation.riskAcknowledgements, ['candidate-exact']);
  assert.equal(result.confirmation.approved, true);
});

test('escaping a resource acknowledgement cancels the full approval', async () => {
  const { scan, plan } = fixture('review');
  const ui = { details: async () => true, inputText: async () => null, menu: async () => assert.fail('No final consent after cancellation') };
  assert.equal(await confirmPlan(ui, scan, plan), null);
});

test('safe bulk selection excludes review, risky, protected and detection-only findings', async () => {
  const { scan, candidate } = fixture();
  scan.candidates = [candidate,
    { ...candidate, id: 'risky', path: '/risky', status: 'risky' },
    { ...candidate, id: 'review', path: '/review', status: 'review' },
    { ...candidate, id: 'protected', path: '/protected', status: 'protected' },
    { ...candidate, id: 'detect', path: '/detect', operation: 'detect-only' },
  ];
  const keys = [{ text: 'a', key: {} }, { text: 'a', key: {} }, { key: { name: 'escape' } }];
  const revisions = [];
  const ui = { bodyHeight: 20, render() {}, readKey: async () => keys.shift() };
  assert.equal(await reviewPlan(ui, scan, { createPlan, eligible, onRevision: async plan => revisions.push(plan) }), null);
  assert.equal(revisions.length, 3);
  assert.deepEqual(revisions.at(-1).selectedIds, ['candidate-exact']);
});

test('protected candidate cannot be toggled through Space', async () => {
  const { scan } = fixture('protected');
  const keys = [{ key: { name: 'space' } }, { key: { name: 'escape' } }];
  const revisions = [];
  const ui = { bodyHeight: 20, render() {}, readKey: async () => keys.shift() };
  await reviewPlan(ui, scan, { createPlan, eligible, onRevision: async plan => revisions.push(plan) });
  assert.equal(revisions.length, 1);
  assert.deepEqual(revisions[0].selectedIds, []);
});

test('terminal menu uses arrow/Tab focus and restores terminal raw mode', async () => {
  const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  const output = new PassThrough(); output.isTTY = true; output.columns = 32; output.rows = 12;
  let printed = ''; output.on('data', chunk => { printed += chunk; });
  const ui = new TerminalUI({ input, output });
  ui.open();
  assert.equal(input.isRaw, true);
  const answer = ui.menu('Confirm', [{ label: 'NO', value: false }, { label: 'YES', value: true }]);
  input.emit('keypress', '', { name: 'tab' });
  await new Promise(resolve => setImmediate(resolve));
  input.emit('keypress', '', { name: 'return' });
  assert.equal(await answer, true);
  ui.close();
  assert.equal(input.isRaw, false);
  assert.equal(input.isPaused(), true, 'The CLI must release its stdin handle so the process can exit.');
  assert.match(printed, /NO/);
  assert.match(printed, /\x1b\[\?25h/);
});

test('filtering searches both paths and projects while unknown scores stay unknown', () => {
  const { candidate } = fixture();
  assert.equal(filterCandidates([candidate], { search: 'FIXTURE', category: 'build' }).length, 1);
  assert.equal(filterCandidates([candidate], { search: 'absent' }).length, 0);
  const lines = candidateDetails({ ...candidate, safety: { score: null, confidence: 'low' }, allocatedBytes: null, reclaimableBytes: null });
  assert.ok(lines.includes('Safety: unknown; confidence low'));
  assert.ok(lines.includes('Allocated size: unknown'));
});

test('read-only report ignores cleanup keys without creating plan revisions', async () => {
  const { scan } = fixture();
  const keys = [{ text: 'a', key: {} }, { text: 'c', key: {} }, { key: { name: 'space' } }, { key: { name: 'escape' } }];
  const ui = { bodyHeight: 20, render() {}, readKey: async () => keys.shift(), menu: async () => assert.fail('Read-only report must never ask for cleanup') };
  assert.equal(await reviewPlan(ui, scan, { createPlan, eligible, readOnly: true, onRevision: async () => assert.fail('Browsing is not a plan change') }), null);
});

test('text editing preserves complete Unicode code points', async () => {
  const ui = new TerminalUI();
  const keys = [{ key: { name: 'left' } }, { key: { name: 'backspace' } }, { key: { name: 'return' } }];
  ui.render = () => {};
  ui.readKey = async () => keys.shift();
  assert.equal(await ui.inputText('Unicode path', { initial: 'a😀b' }), 'ab');
});

test('pasted text is buffered within a screen but cannot pre-confirm another screen', async () => {
  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  const output = new PassThrough(); output.isTTY = true; output.resume();
  const ui = new TerminalUI({ input, output });
  ui.open();
  const answer = ui.inputText('Exact ID');
  input.write('candidate-id-123\r');
  assert.equal(await answer, 'candidate-id-123');
  // An enter buffered after a completed field is cleared on the next screen.
  input.emit('keypress', '\r', { name: 'return' });
  let resolved = false;
  const consent = ui.menu('FINAL CONFIRMATION', [{ value: false, label: 'NO' }, { value: true, label: 'YES' }]).then(value => { resolved = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, false);
  input.emit('keypress', '\r', { name: 'return' });
  assert.equal(await consent, false);
  ui.close();
});
