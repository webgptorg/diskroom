import { randomUUID } from 'node:crypto';
import { within } from './common.js';

export function eligible(candidate) {
  return candidate && candidate.status !== 'protected' && candidate.operation !== 'detect-only' && !(candidate.protection?.length) && ['delete-tree','delete-file','git-gc','docker-image-remove','docker-container-remove'].includes(candidate.operation);
}
const gain = c => Math.max(0, c.reclaimableBytes ?? 0);
function overlaps(a,b) {
  if (a.resourceId && b.resourceId && a.ecosystem==='docker' && b.ecosystem==='docker') return a.resourceId===b.resourceId;
  return a.path && b.path && (within(a.path,b.path)||within(b.path,a.path));
}
export function createPlan(scan,{selectedIds,targetFree=scan.targetFree}={}) {
  if(scan.schemaVersion!==1 || scan.kind!=='scan')throw new Error('Unsupported scan schema. Run a new scan.');
  if(!Number.isSafeInteger(targetFree) || targetFree<1)throw new Error('A positive total free-space target in bytes is required.');
  if(targetFree>scan.volume.totalBytes)throw new Error('The free-space target exceeds this volume’s capacity.');
  const free=scan.freeAfterBytes ?? scan.volume.freeBytes;
  const needed=Math.max(0,targetFree-free), chosen=[], reasons=[];
  if(selectedIds!==undefined) {
    if(!Array.isArray(selectedIds)||new Set(selectedIds).size!==selectedIds.length)throw new Error('Invalid candidate selection.');
    for(const id of selectedIds){
      const c=scan.candidates.find(c=>c.id===id);
      if(!c||!eligible(c))throw new Error(`Candidate ${id} cannot be selected.`);
      if(chosen.some(other=>overlaps(c,other)))throw new Error(`Overlapping candidate ${id}: select only one operation per resource.`);
      chosen.push(c);
    }
    reasons.push('Only the explicitly selected eligible candidates are included.');
  } else if(needed>0) {
    const candidates=scan.candidates.filter(c=>eligible(c)&&c.status==='recommended'&&gain(c)>0);
    // Safety is a hard tier, never a size-weighted score. Within equally safe,
    // similarly needed options prefer a sufficient small unit, then fewer units.
    candidates.sort((a,b)=> (b.safety?.score??-1)-(a.safety?.score??-1) || (a.need?.score??101)-(b.need?.score??101) || a.path.localeCompare(b.path));
    let left=needed;
    while(candidates.length && left>0){
      const best=candidates[0];
      const peers=candidates.filter(c=>c.safety?.score===best.safety?.score && c.need?.score===best.need?.score);
      const sufficient=peers.filter(c=>gain(c)>=left).sort((a,b)=>gain(a)-gain(b));
      let picks = sufficient.length ? [sufficient[0]] : [];
      // Compare a bounded greedy combination with a single sufficient unit.
      // This avoids removing 800 MB when two 45 MB units meet an 80 MB need.
      const smaller = peers.filter(c=>gain(c)<left).sort((a,b)=>gain(b)-gain(a)||a.path.localeCompare(b.path));
      const combination=[];let combined=0;
      for(const item of smaller){
        if(combination.some(other=>overlaps(item,other)))continue;
        combination.push(item);combined+=gain(item);
        if(combined>=left||combination.length>=64)break;
      }
      if(combined>=left && (!picks.length || combined<gain(picks[0])))picks=combination;
      if(!picks.length)picks=[peers.sort((a,b)=>gain(b)-gain(a)||a.path.localeCompare(b.path))[0]];
      for(const pick of picks){
        chosen.push(pick);left-=gain(pick);
        for(let i=candidates.length-1;i>=0;i--)if(overlaps(candidates[i],pick))candidates.splice(i,1);
      }
    }
    reasons.push('Protection and recoverability come first, then current need; comparable choices limit overshoot and operation count.');
  } else reasons.push('The requested free space is already available. No cleanup is recommended.');
  const estimatedBytes=chosen.reduce((sum,c)=>sum+gain(c),0);
  return {schemaVersion:1,kind:'plan',id:randomUUID(),scanId:scan.id,createdAt:new Date().toISOString(),targetFree,selectedIds:chosen.map(c=>c.id),neededBytes:needed,estimatedBytes,remainingBytes:Math.max(0,needed-estimatedBytes),unknownGain:chosen.some(c=>c.reclaimableBytes==null),projects:[...new Set(chosen.map(c=>c.project).filter(Boolean))],reasons};
}
