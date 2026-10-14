import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createPlan, eligible } from '../src/planner.js';

const base = path.join(os.tmpdir(), 'diskroom-planner-fixture');
function candidate(id, bytes, overrides = {}) {
  return {
    id, path: path.join(base, id), project: path.join(base, id),
    ecosystem: 'node', category: 'installed-dependencies', operation: 'delete-tree',
    status: 'recommended', reclaimableBytes: bytes, logicalBytes: bytes,
    safety: { score: 90, confidence: 'high' }, need: { score: 10, confidence: 'medium' },
    protection: [], ...overrides,
  };
}
function report(candidates, overrides = {}) {
  return { schemaVersion: 1, kind: 'scan', id: 'scan-planner-fixture', targetFree: 100,
    volume: { totalBytes: 10000, freeBytes: 20 }, candidates, ...overrides };
}

test('planner interprets target as total free space and chooses one sufficient environment', () => {
  const scan = report([candidate('small', 60), candidate('sufficient', 90), candidate('oversized', 800)]);
  const plan = createPlan(scan);
  assert.equal(plan.scanId, scan.id);
  assert.equal(plan.neededBytes, 80);
  assert.equal(plan.estimatedBytes, 90);
  assert.equal(plan.remainingBytes, 0);
  assert.deepEqual(plan.selectedIds, ['sufficient']);
});

test('fresh free-space measurement supersedes the initial measurement and can make cleanup unnecessary', () => {
  const scan = report([candidate('big', 200)], { freeAfterBytes: 101 });
  const plan = createPlan(scan);
  assert.equal(plan.neededBytes, 0);
  assert.equal(plan.estimatedBytes, 0);
  assert.deepEqual(plan.selectedIds, []);
});

test('larger protected, uncertain and review candidates cannot fill a recommended-plan shortfall', () => {
  const scan = report([
    candidate('eligible', 30),
    candidate('active', 500, { status: 'protected' }),
    candidate('user-protected', 500, { protection: ['User protection'] }),
    candidate('risky', 500, { status: 'risky' }),
    candidate('review', 500, { status: 'review' }),
    candidate('unknown-gain', null),
    candidate('detect-only', 500, { operation: 'detect-only' }),
  ]);
  const plan = createPlan(scan);
  assert.deepEqual(plan.selectedIds, ['eligible']);
  assert.equal(plan.remainingBytes, 50);
});

test('safety and need outrank file size when a recommended plan is selected', () => {
  const scan = report([
    candidate('least-safe', 100, { safety: { score: 80 }, need: { score: 0 } }),
    candidate('less-needed', 45, { safety: { score: 98 }, need: { score: 5 } }),
    candidate('more-needed', 100, { safety: { score: 98 }, need: { score: 20 } }),
  ]);
  assert.deepEqual(createPlan(scan).selectedIds, ['less-needed', 'more-needed']);
});

test('overlapping filesystem operations are never counted twice', () => {
  const outer = candidate('whole-environment', 60);
  const inner = candidate('nested-environment', 50, { path: path.join(outer.path, 'nested') });
  const scan = report([outer, inner, candidate('independent', 10)]);
  const plan = createPlan(scan);
  assert.deepEqual(plan.selectedIds, ['whole-environment', 'independent']);
  assert.equal(plan.estimatedBytes, 70);
  assert.equal(plan.remainingBytes, 10);
  assert.throws(() => createPlan(scan, { selectedIds: [outer.id, inner.id] }), /Overlapping candidate/);
});

test('resource identifiers deduplicate manager operations independently of display paths', () => {
  const scan = report([
    candidate('image', 60, { ecosystem: 'docker', operation: 'docker-image-remove', resourceId: 'sha256:same' }),
    candidate('same-image', 60, { ecosystem: 'docker', operation: 'docker-image-remove', resourceId: 'sha256:same' }),
  ]);
  const plan = createPlan(scan);
  assert.equal(plan.selectedIds.length, 1);
  assert.equal(plan.estimatedBytes, 60);
  assert.throws(() => createPlan(scan, { selectedIds: ['image', 'same-image'] }), /Overlapping candidate/);
});

test('explicit selection preserves unknown gain as unknown and does not auto-add other operations', () => {
  const scan = report([candidate('manual', null, { status: 'review' }), candidate('suggested', 100)]);
  const plan = createPlan(scan, { selectedIds: ['manual'] });
  assert.deepEqual(plan.selectedIds, ['manual']);
  assert.equal(plan.unknownGain, true);
  assert.equal(plan.estimatedBytes, 0);
  assert.equal(plan.remainingBytes, 80);
  assert.deepEqual(createPlan(scan, { selectedIds: [] }).selectedIds, []);
});

test('manual selection still rejects missing, duplicate, protected and unsupported resources', () => {
  const scan = report([candidate('protected', 100, { protection: ['Active'] }), candidate('unknown-action', 100, { operation: 'shell' }), candidate('valid', 100)]);
  for (const selectedIds of [['missing'], ['valid', 'valid'], ['protected'], ['unknown-action'], 'valid']) {
    assert.throws(() => createPlan(scan, { selectedIds }), /cannot be selected|Invalid candidate selection/);
  }
  assert.equal(Boolean(eligible(null)), false);
});

test('unsupported schema and nonsensical targets fail before a plan is created', () => {
  const scan = report([]);
  for (const targetFree of [0, -1, NaN, Infinity, 1.5, '100', 10001]) assert.throws(() => createPlan(scan, { targetFree }));
  assert.throws(() => createPlan({ ...scan, schemaVersion: 2 }), /Unsupported scan schema/);
  assert.throws(() => createPlan({ ...scan, kind: 'clean' }), /Unsupported scan schema/);
  assert.equal(createPlan(scan, { targetFree: 10000 }).targetFree, 10000);
});

test('equivalent candidate sets produce deterministic selection without mutating the scan', () => {
  const candidates = [candidate('z', 40), candidate('a', 40), candidate('m', 40)];
  const scan = report(candidates);
  const before = JSON.stringify(scan);
  const first = createPlan(scan);
  const second = createPlan(report([...candidates].reverse()));
  assert.deepEqual(first.selectedIds, ['a', 'm']);
  assert.deepEqual(second.selectedIds, first.selectedIds);
  assert.equal(JSON.stringify(scan), before);
});

test('comparable small units avoid extreme unnecessary overshoot', () => {
  const plan = createPlan(report([candidate('one',45),candidate('two',45),candidate('huge',800)]));
  assert.deepEqual(plan.selectedIds, ['one','two']);
  assert.equal(plan.estimatedBytes,90);
});

test('manager identity cannot hide overlap with a filesystem operation', () => {
  const manager=candidate('image',100,{ecosystem:'docker',operation:'docker-image-remove',resourceId:'sha256:x'});
  const file=candidate('file',100,{path:path.join(manager.path,'data')});
  assert.throws(()=>createPlan(report([manager,file]),{selectedIds:['image','file']}),/Overlapping/);
});
