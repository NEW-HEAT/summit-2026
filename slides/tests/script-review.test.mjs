import test from 'node:test';
import assert from 'node:assert/strict';
import {displayMode} from '../display-mode.mjs';
import {createStore} from '../store.mjs';
import {buildCount,slideAtStep} from '../text-build.mjs';
import {speakerCatalog,createStageState} from '../speaker-model.mjs';
import {adjacentSlide} from '../navigation.mjs';
import {validateSlide,wsjPreviewURL} from '../model.mjs';
import {fileURLToPath} from 'node:url';

test('old editor links review the script and never expose editing in the default show',()=>{
  assert.deepEqual(displayMode(''),{presenting:true,reviewing:false});
  for(const query of ['?script','?edit=','?edit=&present'])assert.deepEqual(displayMode(query),{presenting:true,reviewing:true});
  assert.deepEqual(displayMode('?studio'),{presenting:false,reviewing:false});
});
test('WSJ is a reversible reveal within VisualPT, followed by analysis',async()=>{
  const entries=await createStore(fileURLToPath(new URL('../',import.meta.url))).list();
  const slide=entries.find(e=>e.slide.id==='slide-08-2').slide;
  assert.equal(entries.some(e=>e.slide.id==='slide-14-1'),false);
  assert.equal(adjacentSlide(entries,'slide-14',1).slide.id,'slide-16');
  assert.equal(adjacentSlide(entries,slide.id,1).slide.id,'slide-08-3');
  assert.equal(buildCount(slide),1);
  assert.ok(slideAtStep(slide,0).scene.media.endsWith('.mp4'));
  const reveal=slideAtStep(slide,1);
  assert.equal(reveal.id,slide.id);
  assert.equal(reveal.scene.linkPreview.url,wsjPreviewURL);
  assert.equal(reveal.scene.projectLink.url,slide.scene.projectLink.url);
  assert.equal(slideAtStep(slide,0),slide);
  validateSlide(slide);
  const invalid=structuredClone(slide);invalid.scene.afterMedia.scene.linkPreview.crop.width=16000;assert.throws(()=>validateSlide(invalid));
});
test('phone accepts the in-slide WSJ build without exporting its scene',async()=>{
  const entries=await createStore(fileURLToPath(new URL('../',import.meta.url))).list();
  const catalog=speakerCatalog(entries),cue=catalog.find(c=>c.id==='slide-08-2');
  assert.equal(cue.builds,1);assert.ok(!JSON.stringify(cue).includes('afterMedia'));
  const state=createStageState();state.update({client:'presenter-visualpt',sequence:1,presenting:true,id:cue.id,step:1},catalog);
  assert.deepEqual(state.snapshot().current,{id:cue.id,step:1});
});
