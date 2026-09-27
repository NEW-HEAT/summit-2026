import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {createStore} from '../store.mjs';
import {speakerCatalog,createStageState} from '../speaker-model.mjs';
import {startSpeakerServer} from '../speaker-server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entries=await createStore(root).list(),catalog=speakerCatalog(entries);
const packet=(sequence,extra={})=>({client:'presenter-111',sequence,presenting:true,id:'slide-22',step:1,...extra});

test('all main and optional cues have phone notes without exporting scene or source data',()=>{
  assert.equal(catalog.filter(s=>!s.optional).length,24);
  assert.equal(catalog.filter(s=>s.optional).length,4);
  for(const cue of catalog){assert.ok(cue.points.length||cue.blocks.length);assert.ok(!('scene' in cue));assert.ok(!('view' in cue));assert.ok(!('revision' in cue));assert.ok(!('file' in cue));}
  const specimen=structuredClone(entries[0]);specimen.file='/private/supplier';specimen.slide.view.state={longitude:123,latitude:45};specimen.slide.scene.privateData='private-marker';
  const exported=JSON.stringify(speakerCatalog([specimen]));assert.ok(!exported.includes('private-marker'));assert.ok(!exported.includes('/private/supplier'));assert.ok(!exported.includes('longitude'));
});
test('phone poems preserve every current stage stanza and cue notes',async()=>{
  const poem=entries.find(e=>e.slide.id==='slide-22').slide,phone=catalog.find(c=>c.id===poem.id);
  assert.equal(phone.mode,'poem');assert.equal(phone.blocks.length,5);assert.equal(phone.firstStep,1);
  for(const block of phone.blocks)assert.equal(block.text,poem.overlays.filter(t=>t.reveal===block.step).map(t=>t.text).join('\n\n'));
  assert.equal(phone.blocks.at(-1).text,'vis.gl triggers every sense except for odor\nThis shit fires me up, our work is never over.');
  assert.equal(catalog.find(c=>c.id==='slide-24').exact,'are you ready?');
  assert.match(catalog.find(c=>c.id==='slide-24').full,/stop the loop before film sound begins/);
});
test('a preview cannot steal the active stage; explicit navigation can',()=>{
  const state=createStageState();assert.equal(state.update(packet(1),catalog),true);
  assert.equal(state.update(packet(1,{client:'preview-222',id:'slide-13',step:0}),catalog),false);
  assert.equal(state.snapshot().current.id,'slide-22');
  assert.equal(state.update(packet(2,{client:'preview-222',id:'slide-13',step:0,claim:true}),catalog),true);
  assert.equal(state.update(packet(2),catalog),false);
  assert.equal(state.snapshot().current.id,'slide-13');
});
test('late requests do not rewind builds; releasing and expired stages can recover',()=>{
  let now=100;const state=createStageState({now:()=>now,leaseMs:9000});
  state.update(packet(2,{step:3}),catalog);assert.equal(state.update(packet(1,{step:1}),catalog),false);assert.equal(state.snapshot().current.step,3);
  assert.equal(state.update(packet(3,{client:'preview-222',presenting:false}),catalog),false);assert.equal(state.snapshot().live,true);
  state.update(packet(3,{presenting:false}),catalog);assert.equal(state.snapshot().live,false);assert.equal(state.snapshot().current.step,3);
  state.update(packet(1,{client:'preview-222',step:4}),catalog);assert.equal(state.snapshot().live,true);
  now+=9001;assert.equal(state.snapshot().live,false);
  state.update(packet(4,{step:5}),catalog);assert.equal(state.snapshot().current.step,5);
});
test('invalid identities and builds are rejected and normalized poem heartbeats stay stable',()=>{
  const state=createStageState();
  for(const invalid of [{id:'missing'},{step:-1},{step:6},{step:1.5},{client:'x'},{sequence:-1}])assert.throws(()=>state.update(packet(1,invalid),catalog));
  state.update(packet(1,{step:0}),catalog);const revision=state.snapshot().revision;
  state.update(packet(2,{step:0}),catalog);assert.equal(state.snapshot().current.step,1);assert.equal(state.snapshot().revision,revision);
});
test('network speaker server is read-only and streams stage changes',async t=>{
  const service=await startSpeakerServer({root,listSlides:async()=>entries,host:'127.0.0.1',port:0});t.after(()=>service.close());
  const base='http://127.0.0.1:'+service.server.address().port;
  assert.match(await (await fetch(base+'/speaker')).text(),/Jump to slide notes/);
  assert.equal((await fetch(base+'/speaker.js')).status,200);
  for(const url of ['/api/slides','/assets/film.mp4','/server.mjs','/slides/022-poem.json'])assert.equal((await fetch(base+url)).status,404);
  assert.equal((await fetch(base+'/api/presentation',{method:'POST',body:'{}'})).status,405);
  const abort=new AbortController();t.after(()=>abort.abort());
  const stream=await fetch(base+'/speaker-events',{signal:abort.signal});const reader=stream.body.getReader();
  let pending='';const decoder=new TextDecoder();
  async function event(){for(;;){const end=pending.indexOf('\n\n');if(end>=0){const message=pending.slice(0,end);pending=pending.slice(end+2);const data=message.split('\n').find(line=>line.startsWith('data: '));if(data)return JSON.parse(data.slice(6));}else{const chunk=await reader.read();if(chunk.done)throw Error('Stream ended before cue');pending+=decoder.decode(chunk.value,{stream:true});}}}
  assert.equal((await event()).stage.current,null);
  service.publish(packet(1,{step:2}));
  assert.deepEqual((await event()).stage.current,{id:'slide-22',step:2});
  const before=(await (await fetch(base+'/api/speaker')).json()).stage;
  await fetch(base+'/speaker');await fetch(base+'/api/speaker');
  assert.deepEqual((await (await fetch(base+'/api/speaker')).json()).stage,before);
  await reader.cancel();
});
