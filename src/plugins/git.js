import path from 'node:path';
import { descriptor, directory, pluginMeta, regular, smallText } from './shared.js';
import { inspectGitRepository } from '../managers.js';
export const metadata=pluginMeta('git',['detect-only','git-gc'],['git']);
export async function detect({file,name,project,stat}) {
  if(name==='.git'&&stat.isFile()){let text;try{text=await smallText(file,4096);}catch{return null;}if(/^gitdir:\s*[^\r\n]+/.test(text))return descriptor('git','worktree-link',{score:10,reasons:['Git worktree or submodule pointer detected. The referenced storage is outside this file and is not followed or added to scope.'],restore:['Preserve the owning Git repository and its worktree/submodule metadata.'],risks:['Removing this metadata can disconnect a worktree from its history.']});return null;}
  if(name!=='.git' || !await regular(path.join(file,'HEAD')) || !await directory(path.join(file,'objects'))) return null;
  const inspected=await inspectGitRepository(file);
  return descriptor('git','repository-storage',{
    operation:inspected.supported&&inspected.executable?'git-gc':'detect-only',score:inspected.supported?70:25,
    project:project?.path||path.dirname(file),
    reasons:[...inspected.reasons,...(inspected.supported?[
      `${inspected.local.references} local reference(s); stash ${inspected.local.stashPresent?'present':'not observed'}. Dirty, untracked and ignored worktree data remain unverified and are preserved.`,
      `Temporary reserve required: ${inspected.reserveBytes} bytes. Actual reclaim is unknown; repacking is never preselected.`,
    ]:['Git storage remains visible, but unsupported configuration or repository structure prevents safe automated maintenance.'])],
    restore:['Repacking preserves object contents and local refs. Keep your normal repository backups; DiskRoom cannot roll back an interrupted pack operation.'],
    risks:['Repacking requires additional temporary disk space and may yield no net gain. Concurrent Git writes must finish before maintenance.',
      'Remote availability is not verified. Clean status does not prove that local branches, ignored files, stashes or LFS data are backed up.',
      'Whole-project deletion and shallow-clone replacement are detection-only: unique local data and replacement integrity have not been independently verified.'],
    evidencePaths:[path.join(file,'HEAD'),...(inspected.supported?[path.join(file,'config')]:[])],
    metadata:{managerAction:inspected.supported&&inspected.executable,gitSnapshot:inspected.snapshot,gitDigest:inspected.digest,reserveBytes:inspected.reserveBytes,localState:inspected.local,remoteVerified:false,maintenance:'git repack -a -d -n --keep-unreachable; no pruning or reflog expiration',volumeId:String(stat.dev)},
  });
}
