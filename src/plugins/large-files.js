import path from 'node:path';
import { descriptor, pluginMeta } from './shared.js';
export const metadata=pluginMeta('large-files',['detect-only','delete-file'],[]);
export async function detect({file,stat,largeThreshold}) {
  if(!stat.isFile() || stat.size<largeThreshold) return null;
  const name=path.basename(file); const log=/\.(?:log|trace|dump|dmp)$/i.test(name);
  return descriptor('large-files',log?'log-or-dump':'unclassified-large-file',{operation:'delete-file',score:log?25:10,confidence:'low',validationKind:'explicit-file',reasons:[log?'A large log, trace or dump file needs explicit review. Age and filename do not establish that its contents are disposable.':'A large file with unverified value and restoration options needs explicit review.'],restore:['Restore from your own verified backup. DiskRoom does not back up deleted files.'],risks:['This may be the only copy. Deletion is permanent and cannot be undone by DiskRoom.']});
}
