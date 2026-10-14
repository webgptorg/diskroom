import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { descriptor, directory, firstFile, pluginMeta, regular, smallText } from './shared.js';
export const metadata = pluginMeta('python',['detect-only','delete-tree'],['venv','pip','uv','poetry','pytest']);
export async function detect({file,name,project}) {
  if (name==='__pycache__') return descriptor('python','bytecode-cache',{operation:'delete-tree',project:project?.path||path.dirname(file),score:98,confidence:'high',validationKind:'python-bytecode',reasons:['CPython bytecode cache; every cache entry must have a corresponding preserved Python source file.'],restore:['Python regenerates bytecode when the preserved source modules are imported.'],risks:['First imports may be slower.']});
  const cfg=path.join(file,'pyvenv.cfg');
  if (await regular(cfg)) {
    let text; try { text=await smallText(cfg); } catch {return null;}
    let interpreter=await regular(path.join(file,'Scripts','python.exe'));
    for(const binary of ['bin/python','bin/python3'])try{const s=await lstat(path.join(file,binary));interpreter ||= s.isFile()||s.isSymbolicLink();}catch{}
    if (!/^home\s*=.+/mi.test(text) || !interpreter) return null;
    const lock=project && await firstFile(project.path,['uv.lock','poetry.lock','Pipfile.lock','requirements.txt','requirements.lock']);
    const systemPackages=/include-system-site-packages\s*=\s*true/i.test(text);
    return descriptor('python','virtual-environment',{operation:lock&&!systemPackages?'delete-tree':'detect-only',score:lock?86:40,confidence:lock?'medium':'low',validationKind:'python-venv',evidencePaths:[cfg,lock,project?.manifest].filter(Boolean),reasons:[lock?'Virtual-environment configuration and dependency restoration inputs are present.':'Virtual environment detected, but dependency restoration inputs are missing.'],restore:['Recreate the environment with the original Python version, then install dependencies from the preserved lock or requirements file.','An unpinned requirements file is not an exact recreation; package indexes and credentials may be needed.'],risks:['Manually installed packages and modifications inside the environment may be lost.','Editable installations require their original source folders.']});
  }
  if (name==='.pytest_cache' && project?.python && await regular(path.join(file,'CACHEDIR.TAG'))) return descriptor('python','test-cache',{operation:'delete-tree',score:95,validationKind:'pytest-cache',evidencePaths:[path.join(file,'CACHEDIR.TAG'),project.manifest],reasons:['A Python project and pytest cache marker identify test execution metadata.'],restore:['Pytest recreates its execution cache on the next run.'],risks:['Previous test failure and incremental execution metadata will be lost.']});
  const normalized=file.split(path.sep).join('/');
  if ((name==='pip'&& /\/(?:\.cache|Caches)\/pip$/.test(normalized)) || (name==='uv'&& /\/(?:\.cache|Caches)\/uv$/.test(normalized))) return descriptor('python','shared-package-cache',{manager:name,score:60,reasons:['Recognized pip/uv cache location; a bounded manager operation is not available in this release.'],restore:['The package manager can fetch available packages again.'],risks:['Unique wheels or unpublished package builds may be present.']});
  return null;
}
