import test from 'node:test';
import assert from 'node:assert/strict';
import {CueAudio} from '../cue-audio.mjs';
test('unbound audio is silent; bound loops release on cue exit or film start',async()=>{
  let created=0,lastState;const audio={paused:true,play:async function(){this.paused=false},pause(){this.paused=true},removeAttribute(){this.src=''},load(){}};
  const cue=new CueAudio({createAudio:()=>{created++;return audio},onChange:state=>lastState=state});
  cue.setCue({src:null,volume:.8});assert.equal(created,0);
  cue.setCue({src:'assets/test-loop.mp3',volume:.5});await Promise.resolve();
  assert.equal(audio.loop,true);assert.equal(audio.volume,.5);assert.equal(audio.paused,false);
  cue.setCue({src:'assets/test-loop.mp3',volume:.5});assert.equal(created,1);
  cue.stop();assert.equal(audio.paused,true);assert.equal(audio.src,'');assert.equal(lastState.available,false);
});
test('late play completion cannot restart a loop after the film takes over',async()=>{
  let resolve,paused=false;const audio={play:()=>new Promise(r=>resolve=r),pause(){paused=true},removeAttribute(){},load(){}};
  const cue=new CueAudio({createAudio:()=>audio});cue.setCue({src:'assets/test-loop.mp3'});cue.stop();resolve();await Promise.resolve();assert.equal(paused,true);assert.equal(cue.audio,null);
});
