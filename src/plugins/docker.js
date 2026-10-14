import path from 'node:path';
import { descriptor, directory, pluginMeta } from './shared.js';
export const metadata=pluginMeta('docker',['detect-only','docker-image-remove','docker-container-remove'],['docker']);
export async function detect({file,name}) {
  const norm=file.split(path.sep).join('/');
  const root = name==='docker' && (await directory(path.join(file,'containers')) || await directory(path.join(file,'image')) || await directory(path.join(file,'volumes')));
  const desktop=/\/(?:Docker\.raw|Docker\.qcow2|docker_data\.vhdx|ext4\.vhdx)$/.test(norm) && /docker/i.test(norm);
  if(!root&&!desktop) return null;
  return descriptor('docker',desktop?'docker-virtual-disk':'docker-storage',{score:15,reasons:[desktop?'Recognized Docker virtual disk. Daemon storage inside a VM cannot be credited as host disk space and is detection-only.':'Recognized Docker daemon storage. Individual resources are separately inventoried only when a local daemon and this exact selected storage volume can be verified.'],restore:['Use Docker’s own resource inventory and explicitly bounded operations after reviewing container data and volumes.'],risks:['Never delete daemon storage directly. Stopped containers and volumes can contain unique data.','Freeing space inside a Docker virtual disk may not release host disk space.','Build cache and volumes are detection-only; no wide prune operation is offered.']});
}
