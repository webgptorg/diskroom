import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scan } from '../src/scanner.js';
import { createPlan } from '../src/planner.js';
import { createAudit, loadConfig, readRun, saveConfig } from '../src/audit.js';
import { executePlan, acquireCleanupLock } from '../src/executor.js';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import { available as nativeAvailable } from '../native/index.js';

async function fixture(t, { node = false, files = 1 } = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'diskroom-executor-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = await fs.realpath(temp), workspace = path.join(root, 'workspace'), scope = path.join(root, 'projects'), project = path.join(scope, 'old-project');
  await fs.mkdir(workspace); await fs.mkdir(project, { recursive: true });
  let artifact;
  if (node) {
    artifact = path.join(project, 'node_modules');
    await fs.mkdir(path.join(artifact, 'example'), { recursive: true });
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { example: '1.0.0' } }));
    const packages={'node_modules/example':{version:'1.0.0',resolved:'https://registry.npmjs.org/example/-/example-1.0.0.tgz',integrity:'sha512-Zml4dHVyZQ=='}};
    await fs.writeFile(path.join(project, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
    await fs.writeFile(path.join(artifact, '.package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
    await fs.writeFile(path.join(artifact,'example','package.json'), JSON.stringify({name:'example',version:'1.0.0'}));
    await fs.writeFile(path.join(artifact, 'example', 'index.js'), 'export default 42;');
  } else {
    artifact = path.join(project, '__pycache__');
    await fs.mkdir(artifact);
    await fs.writeFile(path.join(project, 'pyproject.toml'), '[project]\nname="fixture"\nversion="1.0.0"\n');
    for (let index = 0; index < files; index++) {
      await fs.writeFile(path.join(project, `module${index}.py`), `answer = ${index}\n`);
      await fs.writeFile(path.join(artifact, `module${index}.cpython-311.pyc`), Buffer.alloc(4096, index % 255));
    }
  }
  await saveConfig(workspace, { archived: [project] });
  const scanNow = async () => {
    const writer = await createAudit(workspace, 'scan');
    const report = await scan({ roots: [scope], cwd: workspace, workspace, config: await loadConfig(workspace), audit: writer });
    await writer.finish(report);
    return report;
  };
  const report = await scanNow();
  const candidate = report.candidates.find(item => item.path === artifact);
  assert.ok(candidate, 'fixture is recognized by the actual scanner');
  assert.notEqual(candidate.status, 'protected', JSON.stringify(candidate.protection));
  const planFor = (reportValue = report, targetFree = reportValue.volume.totalBytes) => {
    const plan = createPlan(reportValue, { selectedIds: [candidate.id], targetFree });
    plan.confirmation = { approved: true, at: new Date().toISOString(), riskAcknowledgements: [candidate.id] };
    return plan;
  };
  return { root, workspace, scope, project, artifact, report, candidate, planFor, scanNow, options: { workspace, cwd: workspace, interactiveConfirmed: true } };
}

const canClean = process.platform === 'linux' || nativeAvailable;

test('public executor refuses missing confirmation before modifying files or creating a clean run', async t => {
  const f = await fixture(t), plan = f.planFor();
  await assert.rejects(executePlan(f.report, plan, { ...f.options, interactiveConfirmed: false }), /interactive confirmation/);
  delete plan.confirmation;
  await assert.rejects(executePlan(f.report, plan, f.options), /interactive confirmation/);
  await fs.access(f.artifact);
});

test('actual free-space goal already reached stops before any selected action', async t => {
  const f = await fixture(t), result = await executePlan(f.report, f.planFor(f.report, 1), f.options);
  assert.equal(result.status, 'complete'); assert.equal(result.goalReached, true); assert.equal(result.operations.length, 0);
  await fs.access(f.artifact);
});

test('cleanup removes only freshly verified bytecode and writes exact chunked file outcomes', async t => {
  if (!canClean) return t.skip('Native bridge cleanup is verified by the platform integration test matrix.');
  const f = await fixture(t, { files: 70 }), result = await executePlan(f.report, f.planFor(), f.options);
  assert.equal(result.status, 'target-not-reached', JSON.stringify(result));
  assert.equal(result.operations[0].status, 'completed'); assert.equal(result.operations[0].removedEntries, 71);
  await assert.rejects(fs.access(f.artifact));
  assert.equal(await fs.readFile(path.join(f.project, 'module0.py'), 'utf8'), 'answer = 0\n');
  const history = await readRun(f.workspace, result.id);
  assert.equal(history.unresolvedIntents, undefined);
  assert.equal(history.auditParts.filter(name => name.startsWith('intent-')).length, 2);
  assert.equal(history.auditParts.filter(name => name.startsWith('result-')).length, 2);
});

test('changed files and newly added unapproved content are skipped after fresh revalidation', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.artifact, 'unapproved.txt'), 'unique work');
  const result = await executePlan(f.report, f.planFor(), f.options);
  assert.equal(result.operations[0].status, 'skipped', JSON.stringify(result));
  assert.equal(await fs.readFile(path.join(f.artifact, 'unapproved.txt'), 'utf8'), 'unique work');
});

test('fresh source activity invalidates the approved project snapshot', async t => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.project, 'module0.py'), 'new_work = True\n');
  const result = await executePlan(f.report, f.planFor(), f.options);
  assert.equal(result.operations[0].status, 'skipped', JSON.stringify(result));
  await fs.access(f.artifact);
});

test('symlink entries are removed as links while their external source targets survive', async t => {
  if (!canClean || process.platform === 'win32') return t.skip('This native symlink scenario requires unprivileged symlink creation.');
  const f = await fixture(t, { node: true });
  const external = path.join(f.root, 'outside-source'); await fs.mkdir(external); await fs.writeFile(path.join(external, 'keep.js'), 'unique');
  await fs.mkdir(path.join(f.artifact, '.bin')); await fs.symlink(path.join(external, 'keep.js'), path.join(f.artifact, '.bin', 'tool'));
  const fresh = await f.scanNow();
  const result = await executePlan(fresh, f.planFor(fresh), f.options);
  assert.equal(result.operations[0].status, 'completed', JSON.stringify(result));
  assert.equal(await fs.readFile(path.join(external, 'keep.js'), 'utf8'), 'unique');
  await assert.rejects(fs.access(f.artifact));
});

test('a candidate replaced with a symlink never redirects deletion to its target', async t => {
  if (process.platform === 'win32') return t.skip('Windows symlink creation may require developer mode.');
  const f = await fixture(t), moved = path.join(f.project, 'preserved-cache');
  await fs.rename(f.artifact, moved); await fs.symlink(moved, f.artifact);
  const result = await executePlan(f.report, f.planFor(), f.options);
  assert.equal(result.operations[0].status, 'skipped');
  await fs.access(path.join(moved, 'module0.cpython-311.pyc'));
});

test('global cleanup lock coordinates separate workspaces and is never silently bypassed', async t => {
  const f = await fixture(t), release = await acquireCleanupLock();
  try { await assert.rejects(executePlan(f.report, f.planFor(), f.options), /Another DiskRoom cleanup/); }
  finally { await release(); }
  await fs.access(f.artifact);
});

test('cancellation before a removal leaves a readable cancelled audit and intact environment', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  const result = await executePlan(f.report, f.planFor(), { ...f.options, signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal((await readRun(f.workspace, result.id)).status, 'cancelled');
  await fs.access(f.artifact);
});

test('newly protected paths override a formerly approved plan', async t => {
  const f = await fixture(t);
  await saveConfig(f.workspace, { protect: [f.project], archived: [f.project] });
  const result = await executePlan(f.report, f.planFor(), f.options);
  assert.equal(result.operations[0].status, 'skipped');
  await fs.access(f.artifact);
});

test('replacing an inventoried ancestor with a link cannot redirect an in-progress cleanup', async t => {
  if (process.platform !== 'linux') return t.skip('Descriptor-anchored Linux race test.');
  const f = await fixture(t, { node: true }), outside = path.join(f.root, 'outside');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'index.js'), 'unique external source');
  const result = await executePlan(f.report, f.planFor(), { ...f.options, async onProgress(progress) {
    if (progress.phase !== 'inventory-complete') return;
    await fs.rename(path.join(f.artifact, 'example'), path.join(f.artifact, 'original-example'));
    await fs.symlink(outside, path.join(f.artifact, 'example'));
  } });
  assert.equal(result.status, 'failed');
  assert.equal(await fs.readFile(path.join(outside, 'index.js'), 'utf8'), 'unique external source');
  await fs.access(path.join(f.artifact, 'original-example', 'index.js'));
});

test('failure to persist a per-file result stops before the next file and leaves an unverified intent', async t => {
  if (!canClean) return t.skip('Linux filesystem mutation fixture.');
  const f = await fixture(t, { files: 3 });
  const result = await executePlan(f.report, f.planFor(), { ...f.options, async onProgress(progress) {
    if (progress.phase !== 'inventory-complete') return;
    const runs = path.join(f.workspace, '.diskroom', 'runs');
    const cleanRun = (await fs.readdir(runs)).find(name => name.startsWith('clean-'));
    await fs.mkdir(path.join(runs, cleanRun, 'result-operation-000001-000001.json.gz'));
  } });
  assert.equal(result.status, 'failed'); assert.equal(result.unverified, true);
  assert.equal(result.operations[0].removedEntries, 1, 'only the first intent-backed deletion may precede the failed result write');
  assert.equal((await fs.readdir(f.artifact)).length, 2);
  // The last durable summary remains running; no fabricated completion can replace it.
  const history = await readRun(f.workspace, result.id);
  assert.equal(history.status, 'running');
  assert.equal(history.unresolvedIntents.length, 1);
  assert.equal(history.auditIssues.length, 1);
});

test('process use beginning after inventory stops before the first deletion',{skip:process.platform!=='linux'},async t=>{
 const f=await fixture(t);let child;
 t.after(()=>child?.kill());
 const result=await executePlan(f.report,f.planFor(),{...f.options,async onProgress(progress){
  if(progress.phase!=='inventory-complete')return;
  child=spawn(process.execPath,['-e','process.stdout.write("ready");setInterval(()=>{},1000)'],{cwd:f.artifact,stdio:['ignore','pipe','ignore']});await once(child.stdout,'data');
 }});
 assert.equal(result.status,'failed');assert.equal(result.operations[0].removedEntries,0);assert.match(result.issues[0].message,/Observed cwd/);await fs.access(f.artifact);
 child.kill();await once(child,'exit');
});

test('edited saved zero-day policy is rejected and current workspace policy is not weakened',async t=>{
 const f=await fixture(t);await saveConfig(f.workspace,{});
 f.report.activityDays=0;f.report.config.activityDays=0;
 await assert.rejects(executePlan(f.report,f.planFor(),f.options),/activity|Activity/);await fs.access(f.artifact);
 f.report.activityDays=1;f.report.config.activityDays=1;
 const result=await executePlan(f.report,f.planFor(),f.options);
 assert.equal(result.activityDays,30);assert.equal(result.operations[0].status,'skipped');await fs.access(f.artifact);
});

test('Git manager execution keeps sources and refs and records durable managed outcomes',{skip:process.platform!=='linux'},async t=>{
 const {resolveManagerExecutable}=await import('../src/managers.js');
 let git;try{git=await resolveManagerExecutable('git');}catch{return t.skip('Trusted Git executable unavailable.');}
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'diskroom-git-executor-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const workspace=path.join(root,'workspace'),project=path.join(root,'project'),hooks=path.join(root,'hooks');
 for(const directory of [workspace,project,hooks])await fs.mkdir(directory);
 const command=async args=>{
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  for(const key of Object.keys(env))if(/^GIT_/.test(key)&&!['GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL'].includes(key))delete env[key];
  const child=spawn(git,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c',`core.hooksPath=${hooks}`,'-c','core.fsmonitor=false','-C',project,...args],{env,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>err+=data);const [code]=await once(child,'exit');assert.equal(code,0,err);return out;
 };
 await command(['init','--initial-branch=main']);await fs.writeFile(path.join(project,'source.txt'),'preserve this source');await command(['add','source.txt']);await command(['commit','-m','fixture']);
 const head=await command(['rev-parse','HEAD']);
 await saveConfig(workspace,{archived:[project]});
 const report=await scan({roots:[project],cwd:workspace,workspace,config:await loadConfig(workspace)});
 const candidate=report.candidates.find(item=>item.operation==='git-gc');assert.ok(candidate,JSON.stringify(report.candidates));assert.equal(candidate.reclaimableBytes,null);
 const plan=createPlan(report,{selectedIds:[candidate.id],targetFree:report.volume.totalBytes});plan.confirmation={approved:true,at:new Date().toISOString(),riskAcknowledgements:[candidate.id]};
 const result=await executePlan(report,plan,{workspace,cwd:workspace,interactiveConfirmed:true});
 assert.equal(result.operations[0].status,'completed',JSON.stringify(result));
 assert.equal(await fs.readFile(path.join(project,'source.txt'),'utf8'),'preserve this source');assert.equal(await command(['rev-parse','HEAD']),head);
 const audit=await readRun(workspace,result.id);assert.equal(audit.unresolvedIntents,undefined);assert.ok(audit.auditParts.includes('intent-operation-000001-manager.json.gz'));assert.ok(audit.auditParts.includes('result-operation-000001-manager.json.gz'));
});
