import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStore} from '../store.mjs';
import {validateSlide,clone,viewDefaults} from '../model.mjs';
import {findSlide,adjacentSlide,slideKey} from '../navigation.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(){
  const dir=await fs.mkdtemp(path.join(root,'.dev/test-'));
  await fs.mkdir(path.join(dir,'slides'));
  for(const file of ['007-02-beat-professor.json','013-globeview.json'])await fs.copyFile(path.join(root,'slides',file),path.join(dir,'slides',file));
  return {dir,store:createStore(dir)};
}

test('saving one camera and overlay leaves its neighbour untouched and preserves the previous file',async()=>{
  const {dir,store}=await fixture(),before=await store.list(),original=before.find(e=>e.slide.number===13);
  const untouched=await fs.readFile(path.join(dir,'slides','007-02-beat-professor.json'));
  const originalBytes=await fs.readFile(path.join(dir,'slides',original.file));
  const slide=clone(original.slide);slide.view.state={longitude:-40,latitude:25,zoom:2,bearing:15,pitch:10};
  slide.overlays[0].text='Camera and text round trip';slide.overlays[0].x=120;
  const saved=await store.update(slide.id,slide,original.revision);
  const after=(await createStore(dir).list()).find(e=>e.slide.number===13);
  assert.deepEqual(after.slide,slide);assert.equal(after.revision,saved.revision);assert.notEqual(saved.revision,original.revision);
  assert.deepEqual(await fs.readFile(path.join(dir,'slides','007-02-beat-professor.json')),untouched);
  const history=await fs.readdir(path.join(dir,'.history'));assert.equal(history.length,1);
  assert.deepEqual(await fs.readFile(path.join(dir,'.history',history[0])),originalBytes);
});

test('a stale or simultaneous save cannot silently overwrite a newer edit',async()=>{
  const {store}=await fixture(),entry=(await store.list())[1];
  const a=clone(entry.slide),b=clone(entry.slide);a.view.state.zoom=2;b.view.state.zoom=3;
  const results=await Promise.allSettled([store.update(a.id,a,entry.revision),store.update(b.id,b,entry.revision)]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
  assert.equal(results[1].reason.status,409);
  assert.equal((await store.list())[1].slide.view.state.zoom,2);
});

test('invalid cameras, viewport bounds and external media cannot alter saved slides',async()=>{
  const {store}=await fixture(),entry=(await store.list())[1];
  const changes=[
    s=>s.view.state.latitude=91,
    s=>s.view.state.zoom=NaN,
    s=>s.view.frame.width=1281,
    s=>s.scene.media='https://example.com/private.mp4',
    s=>s.scene.media='assets/../outside.mp4',
    s=>s.scene.embed='https://example.com/',
    s=>s.scene.embed='http://127.0.0.1:5173/',
    s=>s.scene.gallery=[{src:'assets/../secret.png',label:'x',alt:'x'},{},{ }],
    s=>s.scene.projectLink={url:'javascript:alert(1)',label:'Link'},
    s=>s.overlays[0].size=0,
    s=>s.number=12,
    s=>s.id='slide-12',
    s=>s.kind='cue',
    s=>{s.view.type='MapView';s.view.state.latitude=89},
    s=>{s.view.type='OrbitView';s.view.state={...viewDefaults.OrbitView,target:[0,0]};s.scene.preset='grid'}
  ];
  for(const change of changes){const slide=clone(entry.slide);change(slide);await assert.rejects(store.update(entry.slide.id,slide,entry.revision));}
  assert.equal((await store.list())[1].revision,entry.revision);
});

test('expanded sections keep top-level references and navigate in show order',async()=>{
  const all=await createStore(root).list();assert.equal(all.length,28);
  assert.deepEqual([...new Set(all.map(e=>e.slide.number))].sort((a,b)=>a-b),Array.from({length:26},(_,i)=>i+1).filter(n=>n!==9&&n!==15&&n!==21&&n!==23));
  assert.equal(slideKey(findSlide(all,'7').slide),'7.2');assert.equal(slideKey(findSlide(all,'8').slide),'8.1');
  assert.equal(slideKey(adjacentSlide(all,'slide-05',1).slide),'7.2');
  assert.deepEqual(all.filter(e=>e.slide.number===7).map(e=>[slideKey(e.slide),e.slide.scene.media]),[['7.2','assets/beat-professor-rating.png'],['7.3','assets/beat-demo.gif'],['7.5','assets/beat-thumbs-up.jpg']]);
  for(const e of all.filter(e=>e.slide.number===7)){assert.equal(e.slide.scene.projectLink.url,'https://github.com/NEW-HEAT/beat');assert.equal(e.slide.overlays.length,0)}
  assert.equal(slideKey(adjacentSlide(all,'slide-07-5',1).slide),'8.1');
  assert.equal(slideKey(adjacentSlide(all,'slide-08-3',1).slide),'10');
  assert.equal(slideKey(adjacentSlide(all,'slide-10',-1).slide),'8.3');
  assert.equal(findSlide(all,'13').slide.title,'GlobeView');
  assert.equal(slideKey(findSlide(all,'12').slide),'12.1');
  assert.equal(slideKey(findSlide(all,'9').slide),'10');
  assert.equal(slideKey(adjacentSlide(all,'slide-12-1',1).slide),'12.2');
  assert.equal(slideKey(adjacentSlide(all,'slide-12-2',1).slide),'13');
  assert.equal(findSlide(all,'12.1').slide.scene.embed,'http://127.0.0.1:8084/');
  for(const e of all.filter(e=>e.slide.number===8))assert.equal(e.slide.scene.projectLink.url,'https://github.com/VisualPT/visualPT');
  assert.equal(findSlide(all,'10').slide.scene.gallery.length,3);
  assert.equal(findSlide(all,'11').slide.scene.media,'assets/glify-catchall-pr.png');
  assert.equal(slideKey(adjacentSlide(all,'slide-04',1).slide),'6');
  assert.equal(slideKey(adjacentSlide(all,'slide-06',1).slide),'5');
  assert.equal(slideKey(findSlide(all,'7.1').slide),'7.2');
  assert.equal(slideKey(findSlide(all,'7.4').slide),'7.5');
  assert.equal(slideKey(adjacentSlide(all,'slide-07-3',1).slide),'7.5');
  assert.equal(slideKey(adjacentSlide(all,'slide-11',1).slide),'12.1');
  assert.equal(slideKey(adjacentSlide(all,'slide-17',1).slide),'19');
  assert.equal(slideKey(adjacentSlide(all,'slide-22',1).slide),'24');
  assert.equal(slideKey(adjacentSlide(all,'slide-24',1).slide),'25');
  assert.equal(slideKey(adjacentSlide(all,'slide-25',1).slide),'25');
  assert.equal(all.filter(e=>!e.optional).length,24);
  assert.equal(all.filter(e=>e.optional).length,4);
  assert.equal(findSlide(all,'6').sourceLinks[0].url,'https://www.instagram.com/p/CnA6tSjoNPj/');
  assert.equal(slideKey(findSlide(all,'23').slide),'22');
  assert.equal(findSlide(all,'22').slide.scene.textBuild,'replace');
  assert.equal(findSlide(all,'19').slide.scene.embed,'http://127.0.0.1:8085/oasis');
  assert.equal(findSlide(all,'24').slide.kind,'film');assert.equal(findSlide(all,'25').slide.kind,'flame');assert.equal(findSlide(all,'26').slide.kind,'black');
  for(const {slide} of all)assert.equal(validateSlide(slide),slide);
});

test('saving a subslide preserves its stable part identity',async()=>{
  const {dir,store}=await fixture();await fs.copyFile(path.join(root,'slides/007-02-beat-professor.json'),path.join(dir,'slides/007-02-beat-professor.json'));
  const e=(await store.list()).find(x=>x.slide.id==='slide-07-2'),s=clone(e.slide);s.notes+='\nFixture edit';
  const saved=await store.update(s.id,s,e.revision);assert.equal(saved.slide.part,2);
  const wrong=clone(saved.slide);wrong.part=3;await assert.rejects(store.update(wrong.id,wrong,saved.revision));
});

