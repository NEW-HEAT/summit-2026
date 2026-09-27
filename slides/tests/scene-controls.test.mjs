import test from 'node:test';import assert from 'node:assert/strict';
import {SceneControls} from '../scene-controls.mjs';
test('connections wait for the operator and each press advances a reversible fade',()=>{
 const c=new SceneControls();c.tick(25,25);assert.equal(c.connectionTime,0);
 c.boost('connections');c.tick(.1,25.1);assert.ok(c.connectionTime>0&&c.connectionTime<2.5);
 for(let i=0;i<7;i++)c.boost('connections');c.tick(2,27.1);assert.equal(c.connectionTime,20);
 c.boost('connections',-1);c.tick(2,29.1);assert.equal(c.connectionTime,17.5);
 c.reset();assert.equal(c.connectionTime,0);
});
test('clock changes rate without jumping phase or accelerating the morph',()=>{
 const c=new SceneControls();c.boost('clock');c.tick(1,1);assert.equal(c.clockTime,0);
 c.tick(1.5,2.5);assert.equal(c.clockTime,4);
 c.boost('clock');assert.equal(c.clockTime,4);c.tick(.5,3);assert.equal(c.clockTime,12);
 c.boost('clock',-1);c.tick(1,4);assert.equal(c.clockTime,16);
});
test('shine grows smoothly and restart restores every runtime value',()=>{
 const c=new SceneControls();c.boost('shiny-globe');c.boost('shiny-globe');assert.equal(c.shineTarget,4);
 c.tick(.05,.05);assert.ok(c.shine>1&&c.shine<4);
 for(let i=0;i<100;i++){c.boost('shiny-globe');c.boost('clock')}
 assert.equal(c.shineTarget,64);assert.equal(c.clockSpeed,4096);
 c.reset();assert.deepEqual(c.snapshot(),{shine:1,connectionTime:0,clockTime:0,clockSpeed:1});
});
