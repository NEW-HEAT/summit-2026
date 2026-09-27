import {slideKey, slideLabel} from './navigation.mjs';
import {buildCount} from './text-build.mjs';

// Deliberately send only words and cue identities to the phone, never scene data.
export function speakerCatalog(entries) {
  let position = 0;
  const total = entries.filter(e => !e.optional).length;
  return entries.map(({slide:s, optional=false}) => {
    const poem = s.scene.textBuild === 'replace';
    const steps = poem ? [...new Set(s.overlays.map(t => t.reveal).filter(Boolean))].sort((a,b)=>a-b) : [];
    const blocks = steps.map(step => ({step, text:s.overlays.filter(t=>t.reveal===step).map(t=>t.text).join('\n\n')}));
    return {
      id:s.id, key:slideKey(s), label:slideLabel(s), title:s.title, optional,
      position:optional ? null : ++position, total,
      mode:poem ? 'poem' : s.speaker?.mode || 'cues',
      points:s.speaker?.points || [], exact:s.speaker?.text || '', blocks,
      full:poem ? blocks.map(b=>b.text).join('\n\n') : s.notes,
      builds:buildCount(s), firstStep:poem ? 1 : 0
    };
  });
}

export function createStageState({now=Date.now, leaseMs=9000}={}) {
  let owner=null, sequence=-1, seen=0, current=null, revision=0;
  return {
    snapshot() {return {current, revision, live:Boolean(owner && now()-seen<leaseMs)};},
    update(packet, catalog) {
      if (!packet || typeof packet.client!=='string' || !/^[a-zA-Z0-9-]{8,80}$/.test(packet.client) || !Number.isSafeInteger(packet.sequence) || packet.sequence<0 || typeof packet.presenting!=='boolean') throw Error('Invalid stage state');
      const cue=catalog.find(s=>s.id===packet.id);
      if (!cue || !Number.isInteger(packet.step) || packet.step<0 || packet.step>cue.builds) throw Error('Unknown slide or build');
      const expired=!owner || now()-seen>=leaseMs;
      if (!packet.presenting) {
        if (owner===packet.client && packet.sequence>sequence) {owner=null; revision++;}
        return false;
      }
      if (!expired && owner!==packet.client && packet.claim!==true) return false;
      if (owner===packet.client && packet.sequence<=sequence) return false;
      const step=Math.max(cue.firstStep,packet.step);
      const changed=expired || owner!==packet.client || current?.id!==packet.id || current?.step!==step;
      owner=packet.client; sequence=packet.sequence; seen=now();
      current={id:cue.id,step};
      if(changed) revision++;
      return true;
    }
  };
}
