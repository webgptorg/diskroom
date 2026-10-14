# Internal implementation contract (Node 22+ plain ESM JavaScript, no runtime dependencies)
All modules live under src. All paths are absolute. Tests node:test. No shell:true.
Root owns src/common.js (VERSION, parseSize, formatBytes, within(path,root), fingerprint(stat), sameFingerprint, readJson, runCommand), src/planner.js, package metadata and release.

## scanner.js (scanner owner)
export async function scan(options)
options: {roots:string[],cwd:string,workspace:string,targetFree:number|null,activityDays:30,config:{protect:[],exclude:[],archived:[]},signal,onProgress:fn}
Return ScanReport: {schemaVersion:1,kind:'scan',id,version,startedAt,finishedAt,status:'complete'|'incomplete'|'cancelled',cwd,workspace,roots,targetFree,volume:{id,root,totalBytes,freeBytes},freeAfterBytes,activityDays,plugins:[],candidates:[],projects:[],issues:[],directories:[],auditPath?}
Caller creates audit writer BEFORE scan and saves initial skeleton. scanner may take options.audit to save chunked inventory/progress.
Candidate: {id,path,project:string|null,ecosystem,category,operation:'delete-tree'|'delete-file'|'git-gc'|'docker-image-remove'|'docker-container-remove'|'detect-only',status:'recommended'|'review'|'risky'|'protected',logicalBytes,allocatedBytes:number|null,reclaimableBytes:number|null,safety:{score:number|null,confidence:'high'|'medium'|'low',reasons:string[]},need:{score:number|null,confidence,reasons:[]},reasons:string[],restore:string[],risks:string[],protection:string[],fingerprint:{dev,ino,size,mtimeMs,ctimeMs,mode},activityAt,manager?,resourceId?,metadata?:object}
Scanner never executes project code. Scanner exports revalidateCandidate(candidate,scan) => {ok:boolean,reasons:string[]} (fresh activity/process/identity/protection verification) and measureVolume(path)=>volume. Export discoverVolumes() and resolveScope(scope,path,cwd) => roots. Builtin plugins shared interface, all seven detector families real.

## audit.js / executor.js (executor owner)
export async function createAudit(workspace,kind,initial={})=>writer with {id,path,write(name,data),finish(summary)}; every durable part gzip JSON, atomic fsync + rename. writer.path is absolute run folder.
export async function readRun(workspace,id)=>summary (strict schema+path validation)
export async function listRuns(workspace)=>summaries
export async function loadConfig(workspace)=>{protect:[],exclude:[],archived:[],activityDays:30}
export async function saveConfig(workspace,config)
export async function executePlan(scan,plan,options)=>CleanReport
plan = {id,scanId,selectedIds:string[],targetFree:number,estimatedBytes:number,createdAt,confirmation?:{approved:true,at,riskAcknowledgements:string[]}}
options = {workspace,cwd,signal,onProgress,interactiveConfirmed:true}; fail without explicit confirmation. Executor does NOT prompt. Uses scanner revalidation and measureVolume (may export/inject test helpers). Fresh rescan/identity checks, stop after actual target achieved, no broad deletes, no shells, no process killing, no implicit escalation. Per-file intent/results journal. Lock across workspaces. Unknown schema/action refused. Native malicious races cannot be assumed safe; fail closed where needed.

## planner.js (root)
export function createPlan(scan, {selectedIds?,targetFree?}={}) => plan with selectedIds,estimatedBytes,neededBytes,remainingBytes,targetFree,id,scanId,createdAt,reasons
export function eligible(candidate) boolean (no protected/detect-only). Default selection only recommended. Dedup overlapping paths. Manual risky selection requires per-candidate acknowledgement in UI.

## cli.js / tui.js (TUI owner)
export async function main(argv=process.argv.slice(2))=>exitCode; bin invokes. All requested flags. Uses scanner, audit, planner, executor. Full keyboard TUI dependency-free. Non-TTY scan/history JSON okay, clean fails. --yes unsupported. Config protect/exclude/archive command may be added and documented. Scanner report persistence done via createAudit before scan; scanner id becomes writer.id, write('summary',report), finish. CLI controls abort handling.

## web + docs (website owner)
Static buildless web/ with English landing + docs, keyboard accessible, no analytics. Repo/npm links must be marked pending until verified. Include release manifest web/release.json to enable real links. Root handles deployment. Docs truthful capability table, examples, history schema. Do not modify CLI sources/package metadata.
