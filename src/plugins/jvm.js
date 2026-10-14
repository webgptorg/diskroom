import path from 'node:path';
import { descriptor, directory, pluginMeta } from './shared.js';
export const metadata = pluginMeta('jvm',['detect-only','delete-tree'],['maven','gradle']);
export async function detect({file,name,project}) {
  const norm=file.split(path.sep).join('/');
  if (project?.jvm) {
    const rel=path.relative(project.path,file).split(path.sep).join('/');
    let sourceRoot=null;
    if (project.jvm==='maven' && rel==='target/classes') sourceRoot=path.join(project.path,'src/main/java');
    if (project.jvm==='maven' && rel==='target/test-classes') sourceRoot=path.join(project.path,'src/test/java');
    if (project.jvm==='gradle' && /^build\/classes\/java\/(main|test)$/.test(rel)) sourceRoot=path.join(project.path,'src',rel.endsWith('/main')?'main':'test','java');
    if (sourceRoot && await directory(sourceRoot)) return descriptor('jvm','compiled-classes',{operation:'delete-tree',score:96,confidence:'high',validationKind:'jvm-classes',sourceRoot,evidencePaths:[project.manifest],manager:project.jvm,reasons:['Build-tool layout and preserved source tree identify compiler output; only class files with corresponding Java sources are eligible.'],restore:[project.jvm==='maven'?'Run Maven compile/test-compile using the preserved POM and source files.':'Run Gradle classes/testClasses using the preserved build configuration and source files.'],risks:['Rebuilding needs a compatible JDK and available dependencies.']});
  }
  if ((name==='repository'&&path.basename(path.dirname(file))==='.m2') || (name==='caches'&&path.basename(path.dirname(file))==='.gradle')) return descriptor('jvm','shared-artifact-cache',{manager:norm.includes('.m2')?'maven':'gradle',score:35,reasons:['Recognized Maven/Gradle shared artifact storage. Locally published artifacts cannot be assumed downloadable.'],restore:['Restore local publications from their source or backups and download remote artifacts where still available.'],risks:['This store may hold the only copy of unpublished local artifacts.']});
  return null;
}
