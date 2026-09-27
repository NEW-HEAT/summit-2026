import test from 'node:test';
import assert from 'node:assert/strict';
import {globeDefaults,globeFeatures,featurePatch,controllerOptions} from '../globe-options.mjs';
import {InputModel,stagePoint,isPageZoomKey} from '../input-model.mjs';

test('three independently reversible GlobeView features come from the past year',()=>{
 assert.equal(globeFeatures.length,3);
 for(const feature of globeFeatures){
  assert.ok(feature.since>='2025-09-10'&&feature.since<='2026-09-10');
  const on={...globeDefaults,...featurePatch(feature.key,true)},off={...on,...featurePatch(feature.key,false)};
  assert.equal(on[feature.key],true);assert.equal(off[feature.key],false);
 }
 const free=controllerOptions({...globeDefaults,...featurePatch('ball',true)});
 const fixed=controllerOptions({...globeDefaults,...featurePatch('ball',false)});
 assert.equal(free.navigation,'ball');assert.equal(fixed.navigation,'map');assert.equal(fixed.dragRotate,true);assert.equal(fixed.multiTouchDrag,'rotate');assert.equal(globeDefaults.navigation,'map');assert.equal(globeDefaults.ball,false);
 assert.equal(controllerOptions({...globeDefaults,...featurePatch('pointerZoom',false)}).zoomAround,'center');
 assert.equal(controllerOptions({...globeDefaults,...featurePatch('inertia',false)}).inertia,false);
 assert.equal(controllerOptions(globeDefaults).maxBounds,null);assert.throws(()=>featurePatch('bounds',true));
 assert.equal(globeDefaults.spin,false);
 assert.equal(controllerOptions(globeDefaults).scrollZoom.smooth,false);
 assert.equal(controllerOptions(globeDefaults).trackpadGesture,false);
 assert.ok(globeDefaults.maxZoom<12,'demo stays in the spherical projection');
});

test('actual pointer contacts stay correct under CSS scale and independent cancellation',()=>{
 const rect={left:200,top:100,width:640,height:360},model=new InputModel();
 assert.deepEqual(stagePoint({clientX:520,clientY:280},rect),{x:640,y:360});
 const event={clientX:520,clientY:280,pointerId:12,pointerType:'touch',buttons:1,pressure:.5,type:'pointerdown'};
 model.record(event,rect,0);model.record({...event,pointerId:44,clientX:570},rect,10);
 assert.equal(model.visible(5000).length,2,'active contacts do not expire');
 model.record({...event,type:'pointercancel'},rect,5001);assert.deepEqual(model.visible(5002).map(p=>p.id),[44]);
 model.record({...event,pointerId:44,type:'pointerup',buttons:0},rect,5003);assert.equal(model.visible(6204).length,0);
 assert.equal(new InputModel().visible(1).length,0,'no simulated contacts');
});

test('page zoom shortcuts are blocked without blocking globe keys or browser reset',()=>{
 for(const key of ['+','-','=','_'])assert.equal(isPageZoomKey({key,metaKey:true}),true);
 assert.equal(isPageZoomKey({key:'+',ctrlKey:true}),true);
 for(const key of ['ArrowUp','ArrowDown','+','-','0'])assert.ok(!isPageZoomKey({key}));
 assert.equal(isPageZoomKey({key:'0',metaKey:true}),false);
 assert.equal(isPageZoomKey({key:'s',metaKey:true}),false);
});
