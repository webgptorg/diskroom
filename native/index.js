import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const binary = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prebuilds', `${process.platform}-${process.arch}`, 'diskroom_native.node');
let addon;
let loadError;
try { addon = require(binary); } catch (error) { loadError = error; }

export const available = Boolean(addon);
export const unavailableReason = loadError?.message ?? null;

function invoke(name, args) {
  if (!addon) {
    const error = new Error(`Native filesystem safety support is unavailable for ${process.platform}/${process.arch}. Cleanup is disabled. ${loadError?.message ?? ''}`);
    error.code = 'ERR_NATIVE_UNAVAILABLE';
    throw error;
  }
  return addon[name](...args);
}

export const openRoot = (...args) => invoke('openRoot', args);
export const openDirectory = (...args) => invoke('openDirectory', args);
export const stat = (...args) => invoke('stat', args);
export const statChild = (...args) => invoke('statChild', args);
export const readDirectory = (...args) => invoke('readDirectory', args);
export const removeChild = (...args) => invoke('removeChild', args);
export const close = (...args) => invoke('close', args);
export const systemDirectory = () => invoke('systemDirectory', []);
export function markHidden(root) {
  const directory = openRoot(root);
  try { return invoke('markHidden', [directory]); }
  finally { close(directory); }
}
