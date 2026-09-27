import {DemoGlobeController} from './demo-controller.js';
import {CLOCK_MORPH_END,clockMorph} from './scene-timing.mjs';
import {globeFrame} from './globe-frame.mjs';
import {Deck,_GlobeView,_GlobeViewport,MapView,OrbitView,OrthographicView} from '@deck.gl/core';import {webgl2Adapter} from '@luma.gl/webgl';
import {scenes} from './scenes/index.js';import {cameraState,clone} from './model.mjs';
import {globeDefaults,controllerOptions,viewOptions,limitState,featurePatch} from './globe-options.mjs';
const classes={GlobeView:_GlobeView,MapView,OrbitView,OrthographicView};
export class SceneRenderer{
 constructor(parent,onCamera,onStatus){this.parent=parent;this.onCamera=onCamera;this.onStatus=onStatus;this.type=null;this.deck=null;this.land=null;this.frame=0;this.spinOffset=0;this.spinPauseUntil=0;this.load=fetch('/assets/land.json').then(r=>r.json()).then(d=>{this.land=d;this.draw()}).catch(e=>onStatus('Scene data unavailable: '+e.message,true))}
 mount(type){
  this.deck?.finalize();this.parent.replaceChildren();const canvas=document.createElement('canvas');canvas.id='scene-canvas';canvas.setAttribute('aria-label','Interactive '+type+' scene');canvas.tabIndex=0;this.parent.append(canvas);this.type=type;
  canvas.addEventListener('pointerdown',()=>canvas.focus({preventScroll:true}));
  for(const name of ['focus','blur'])canvas.addEventListener(name,()=>{if(this.playground)this.draw()});
  this.deck=new Deck({canvas,width:1280,height:720,useDevicePixels:1,deviceProps:{type:'webgl',adapters:[webgl2Adapter]},views:new classes[type]({id:'scene',resolution:2}),...(this.playground?{initialViewState:limitState(this.runtimeState,this.playOptions)}:{viewState:clone(this.slide.view.state)}),layers:[],controller:null,
   onLoad:()=>{this.parent.dataset.gpu='ready';this.onStatus('Canvas ready');this.draw()},
   onError:e=>{this.parent.dataset.gpu='error';this.onStatus(e.message,true)},
   onViewStateChange:({viewState,interactionState})=>{if(!this.slide)return;this.tween=null;this.spinOffset=0;this.spinPauseUntil=performance.now()+1200;const state=cameraState(this.type,viewState);
    if(this.playground){this.runtimeState=state;this.playOptions.spin=false;this.publishPlayState();return viewState}
    this.slide.view.state=state;this.deck.setProps({viewState});this.onCamera(state,interactionState);return viewState}
  });this.parent.dataset.view=type;
 }
 set(slide,{animate=false,time=this.time||0,controls=this.controls||{}}={}){
  const previous=this.slide,wasPlayground=this.playground;this.playground=slide.scene.preset==='globe-playground';this.slide=clone(slide);this.time=time;this.controls=controls;
  if(this.playground&&(!wasPlayground||previous?.id!==slide.id)){this.playOptions={...globeDefaults};this.runtimeState=clone(slide.view.state)}
  this.playView=null;this.playViewSignature='';
  const changed=this.type!==slide.view.type||wasPlayground!==this.playground;if(changed)this.mount(slide.view.type);
  else if(this.playground&&JSON.stringify(previous?.view.state)!==JSON.stringify(slide.view.state)){this.runtimeState=clone(slide.view.state);this.applyPlayCamera()}
  this.tween=animate&&!changed&&!this.playground&&previous?{from:clone(previous.view.state),to:clone(slide.view.state),start:performance.now()}:null;this.draw();this.publishPlayState();
 }
 draw(time=this.time||0,controls=this.controls||{}){if(!this.deck||!this.slide)return;this.time=time;this.controls=controls;const s=this.slide,f=s.view.frame;if(this.playground){this.drawPlayground(time);return}let state=s.view.state;
  if(this.tween){const t=Math.min(1,(performance.now()-this.tween.start)/1000),e=t*t*(3-2*t);state=Object.fromEntries(Object.entries(this.tween.to).map(([k,v])=>[k,Array.isArray(v)?v.map((x,i)=>this.tween.from[k][i]+(x-this.tween.from[k][i])*e):this.tween.from[k]+(v-this.tween.from[k])*e]));if(t===1)this.tween=null}
  const scene=scenes[s.scene.preset];if(this.type==='GlobeView'&&scene.spin)state={...state,longitude:((state.longitude+this.spinOffset+180)%360+360)%360-180};this.parent.dataset.renderLongitude=String(state.longitude??'');this.parent.dataset.spinOffset=this.spinOffset.toFixed(3);const stats=scene.stats?.(controls.connectionTime??time);this.parent.dataset.sceneTime=time.toFixed(3);this.parent.dataset.clockMorph=String(clockMorph(time));this.parent.dataset.shine=(controls.shine??1).toFixed(3);this.parent.dataset.clockTime=(controls.clockTime??Math.max(0,time-CLOCK_MORPH_END)).toFixed(3);this.parent.dataset.clockSpeed=String(controls.clockSpeed??1);this.parent.dataset.connectionProgress=(controls.connectionTime??0).toFixed(3);this.parent.dataset.arcCount=stats?String(stats.arcs):'';this.parent.dataset.pointCount=stats?String(stats.points):'';
  const frame=scene.bleed?globeFrame(f):f;this.deck.setProps({views:new classes[this.type]({id:'scene',resolution:2,...frame,controller:scene.interactive===false?false:{navigation:'ball',keyboard:false,inertia:false}}),viewState:{...state,minZoom:-5,maxZoom:20},layers:scene.layers({slide:s,time,land:this.land,controls}),getTooltip:scene.getTooltip||null,getCursor:({isDragging})=>isDragging?'grabbing':'grab'});
 }
 resetRotation(){this.spinOffset=0;this.spinPauseUntil=0}
 tick(time,controls){if(this.playground){this.time=time;return}const scene=scenes[this.slide?.scene.preset],delta=Math.max(0,time-(this.time??time));if(this.type==='GlobeView'&&scene?.spin&&performance.now()>this.spinPauseUntil){const speed=typeof scene.spin==='function'?scene.spin(time):scene.spin;this.spinOffset=(this.spinOffset+speed*delta)%360}if(this.tween||scene?.animated)this.draw(time,controls)}
 drawPlayground(time=this.time||0){
  if(!this.deck||!this.playground)return;const o=this.playOptions;
  const signature=JSON.stringify([this.slide.view.frame,o,document.activeElement?.id==='scene-canvas']);if(signature!==this.playViewSignature){this.playViewSignature=signature;this.playView=new _GlobeView({id:'scene',...this.slide.view.frame,...viewOptions(o),controller:{type:DemoGlobeController,...controllerOptions(o,document.activeElement?.id==='scene-canvas')}})}
  this.deck.setProps({views:this.playView,layers:scenes['globe-playground'].layers({land:this.land,time,playOptions:o,viewState:this.runtimeState}),getCursor:({isDragging})=>isDragging?'grabbing':'grab',getTooltip:o.picking?({object})=>object?(object.from?'Illustrative connection':object.position?'Illustrative person '+(object.id+1):object.properties?.name||'Land'):null:null});
  this.publishPlayState();
 }
 publishPlayState(){if(!this.playground){this.onPlayState?.();return}this.parent.dataset.playCamera=JSON.stringify(this.runtimeState);this.parent.dataset.playOptions=JSON.stringify(this.playOptions);this.parent.dataset.renderLongitude=String(this.runtimeState.longitude);this.parent.dataset.playLayers=(this.deck?.props.layers||[]).map(l=>l.id).join(',');this.onPlayState?.()}
 setPlayOptions(patch){if(!this.playground)return;this.playOptions={...this.playOptions,...patch};if(Object.keys(patch).some(k=>['minZoom','maxZoom','minPitch','maxPitch','bounds','west','east','south','north'].includes(k))){this.runtimeState=cameraState('GlobeView',limitState(this.runtimeState,this.playOptions));this.applyPlayCamera()}this.drawPlayground()}
 setPlayFeature(key,enabled){const patch=featurePatch(key,enabled);this.setPlayOptions(patch);if(key==='bounds'&&enabled)this.moveCamera({longitude:15,latitude:32,zoom:3,bearing:0,pitch:0})}
 moveCamera(patch){if(!this.playground)return;this.playOptions.spin=false;this.runtimeState=cameraState('GlobeView',limitState({...this.runtimeState,...patch},this.playOptions));this.applyPlayCamera();this.drawPlayground()}
 applyPlayCamera(){
  // Deck ignores a repeated initialViewState even after its internal camera moves.
  // Clear the previous initial value before an explicit reset; gestures stay uncontrolled.
  this.deck.setProps({initialViewState:null});
  this.deck.setProps({initialViewState:{...limitState(this.runtimeState,this.playOptions),transitionDuration:0}});
 }
 resetPlayground(){if(!this.playground)return;this.playOptions={...globeDefaults};this.runtimeState=clone(this.slide.view.state);this.applyPlayCamera();this.drawPlayground()}
 jumpPole(latitude){const current=new _GlobeViewport({...this.slide.view.frame,...this.runtimeState}),pole=new _GlobeViewport({...this.slide.view.frame,latitude,zoom:0});this.moveCamera({latitude,zoom:Math.log2(current.scale/pole.scale),bearing:0,pitch:0})}
 savePlayCamera(){if(this.playground)this.onCamera(cameraState('GlobeView',this.runtimeState),{save:true})}

}
