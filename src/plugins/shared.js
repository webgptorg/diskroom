import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';

export async function regular(file) {
  try { const s = await lstat(file); return s.isFile() && !s.isSymbolicLink(); } catch { return false; }
}
export async function directory(file) {
  try { const s = await lstat(file); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; }
}
export async function smallText(file, max = 262144) {
  const s = await lstat(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max) throw new Error('Metadata is not a bounded regular file');
  return readFile(file, 'utf8');
}
export async function smallJson(file,max) { return JSON.parse(await smallText(file,max)); }
export async function firstFile(root, names) {
  for (const name of names) { const file = path.join(root, name); if (await regular(file)) return file; }
  return null;
}
export function descriptor(ecosystem, category, options = {}) {
  return {ecosystem,category,operation:'detect-only',score:40,confidence:'medium',reasons:[],restore:[],risks:[],evidencePaths:[],...options};
}
export const pluginMeta = (id, operations, managers) => ({id,version:'1.0.0',platforms:['linux','darwin','win32'],managers,operations});
