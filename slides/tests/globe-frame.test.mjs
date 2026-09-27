import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {globeFrame} from '../globe-frame.mjs';import {clockMorph,CLOCK_MORPH_END} from '../scene-timing.mjs';
const require=createRequire(new URL('../../package.json',import.meta.url));
const {_GlobeViewport:GlobeViewport}=require('@deck.gl/core');
test('full-canvas atmosphere preserves native globe screen coordinates and camera position',()=>{
 for(const frame of [{x:580,y:70,width:650,height:580},{x:50,y:160,width:480,height:480}])for(const state of [{longitude:0,latitude:20,zoom:1.9,bearing:0,pitch:0},{longitude:95,latitude:-35,zoom:2.1,bearing:30,pitch:20}]){
  const a=new GlobeViewport({...frame,...state}),b=new GlobeViewport({...globeFrame(frame),...state});
  for(const point of [[0,0],[30,20],[-80,-20],[95,-35]]){const pa=a.project(point),pb=b.project(point);assert.ok(Math.abs(pa[0]+frame.x-pb[0])<1e-7);assert.ok(Math.abs(pa[1]+frame.y-pb[1])<1e-7)}
  a.cameraPosition.forEach((v,i)=>assert.ok(Math.abs(v-b.cameraPosition[i])<1e-7));
 }
});
test('clock settles in 1.5 seconds independently of hand speed',()=>{assert.equal(CLOCK_MORPH_END,1.5);assert.equal(clockMorph(0),0);assert.equal(clockMorph(.1),0);assert.ok(clockMorph(.8)>.49&&clockMorph(.8)<.51);assert.equal(clockMorph(1.5),1);assert.equal(clockMorph(30),1)});
