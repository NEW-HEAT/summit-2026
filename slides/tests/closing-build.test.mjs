import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {firstBuild,visibleBuild} from '../text-build.mjs';
const poem=JSON.parse(fs.readFileSync(new URL('../slides/022-poem.json',import.meta.url)));
const calendar=JSON.parse(fs.readFileSync(new URL('../assets/contribution-calendar.json',import.meta.url)));
test('poem replaces stanzas and holds the exact closing line',()=>{
 assert.equal(firstBuild(poem),1);
 for(let step=1;step<=5;step++){
  const visible=poem.overlays.filter(t=>visibleBuild(t,{slide:poem,step}));
  assert.ok(visible.length>0);assert.ok(visible.every(t=>t.reveal===step));
 }
 assert.equal(poem.overlays.at(-1).text,'vis.gl triggers every sense except for odor\nThis shit fires me up, our work is never over.');
 assert.equal(poem.duration,null);
 assert.equal(visibleBuild(poem.overlays[0],{slide:poem,step:5,editing:true,selected:poem.overlays[0].id}),true);
 assert.equal(firstBuild({scene:{}}),0);
 assert.equal(visibleBuild({reveal:2},{slide:{scene:{}},step:1}),false);
 assert.equal(visibleBuild({reveal:2},{slide:{scene:{}},step:3}),true);
});
test('contribution calendar contains unique dated observations with exact year totals',()=>{
 assert.equal(calendar.login,'charlieforward9');
 for(const {year,total,days} of calendar.years){
  assert.equal(new Set(days.map(d=>d.date)).size,days.length);
  assert.ok(days.every(d=>d.date.startsWith(String(year))&&d.date<=calendar.capturedAt.slice(0,10)));
  assert.equal(days.reduce((sum,d)=>sum+d.contributionCount,0),total);
 }
});
