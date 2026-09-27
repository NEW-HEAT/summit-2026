import {Deck,OrthographicView,COORDINATE_SYSTEM} from '@deck.gl/core';
import {ScatterplotLayer,PathLayer,TextLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {InputModel,stagePoint,isPageZoomKey} from './input-model.mjs';

const gestureNames=['panstart','panmove','panend','pinchstart','pinchmove','pinchend','multipanstart','multipanmove','multipanend','wheel','dblclick','dblclickdragstart','dblclickdragmove','dblclickdragend'];
const number=value=>Number.isFinite(value)?Math.round(value*100)/100:'—';
export class PointerOverlay {
 constructor(parent){
  this.parent=parent;this.model=new InputModel();this.cleanups=[];
  this.root=document.createElement('div');this.root.id='pointer-overlay';this.root.hidden=true;
  this.canvas=document.createElement('canvas');this.canvas.setAttribute('aria-hidden','true');this.root.append(this.canvas);
  const hud=document.createElement('div');hud.id='input-readout';
  const title=document.createElement('strong');title.textContent='Live input';this.raw=document.createElement('div');this.detail=document.createElement('div');this.recognized=document.createElement('div');hud.append(title,this.raw,this.detail,this.recognized);this.root.append(hud);parent.append(this.root);
  this.blockWheel=e=>{if(this.active&&(e.ctrlKey||e.metaKey||e.target===this.target))e.preventDefault()};
  this.blockGesture=e=>{if(this.active)e.preventDefault()};
  this.blockKey=e=>{if(this.active&&isPageZoomKey(e))e.preventDefault()};
  document.addEventListener('wheel',this.blockWheel,{capture:true,passive:false});
  for(const name of ['gesturestart','gesturechange','gestureend'])document.addEventListener(name,this.blockGesture,{capture:true,passive:false});
  document.addEventListener('keydown',this.blockKey,{capture:true});
 }
 sync(renderer){
  const active=!!renderer.playground;this.active=active;this.root.hidden=!active;document.body.classList.toggle('globe-demo',active);
  if(!active){this.detach();return}
  const canvas=renderer.parent.querySelector('canvas');if(canvas===this.target){this.watch(renderer.deck.eventManager);return}
  this.detach();this.target=canvas;this.model.clear();
  this.raw.textContent='Waiting for pointer or wheel';this.detail.textContent='Actual browser events · slide pixels';this.recognized.textContent='mjolnir · waiting';
  this.deck=new Deck({canvas:this.canvas,width:1280,height:720,useDevicePixels:1,deviceProps:{type:'webgl',adapters:[webgl2Adapter]},views:new OrthographicView({id:'pointer-events',flipY:true}),initialViewState:{target:[640,360,0],zoom:0},controller:false,layers:[]});
  const listen=(name,handler)=>{canvas.addEventListener(name,handler);this.cleanups.push(()=>canvas.removeEventListener(name,handler))};
  const pointer=e=>{
   const p=this.model.record(e,canvas.getBoundingClientRect(),performance.now());this.raw.textContent=`DOM ${e.type} · ${p.type} #${p.id}`;
   this.detail.textContent=`x ${number(p.x)}  y ${number(p.y)} · buttons ${p.buttons} · pressure ${number(p.pressure)}`;
   this.root.dataset.lastEvent=e.type;this.wheel=null;this.schedule();
  };
  for(const name of ['pointerdown','pointermove','pointerup','pointercancel','pointerleave'])listen(name,pointer);
  for(const name of ['pointerup','pointercancel']){const end=e=>{if(e.target!==canvas&&this.model.points.has(e.pointerId))pointer(e)};window.addEventListener(name,end);this.cleanups.push(()=>window.removeEventListener(name,end))}
  listen('wheel',e=>{
   const p=stagePoint(e,canvas.getBoundingClientRect());this.wheel={...p,id:'wheel',type:'wheel',buttons:0,event:'wheel',time:performance.now()};
   this.raw.textContent='DOM wheel'+(e.ctrlKey?' · Ctrl / pinch signal':'');
   this.detail.textContent=`Δx ${number(e.deltaX)}  Δy ${number(e.deltaY)}  Δz ${number(e.deltaZ)} · mode ${e.deltaMode}`;
   this.root.dataset.lastEvent='wheel';this.schedule();
  });
  this.watch(renderer.deck.eventManager);this.schedule();
 }
 watch(manager){
  // The event manager becomes available after WebGL initialization.
  if(!manager||this.watchedManager===manager)return;
  this.watchedManager=manager;
  if(manager){const handlers=Object.fromEntries(gestureNames.map(name=>[name,e=>{
   const delta=e.type==='wheel'?` · delta ${number(e.delta)}`:` · Δ ${number(e.deltaX)}, ${number(e.deltaY)}`;
   this.recognized.textContent=`mjolnir ${e.type} · ${e.pointerType||e.device||'input'}${delta}${Number.isFinite(e.scale)?' · scale '+number(e.scale):''}`;
   this.root.dataset.gesture=e.type;
  }]));manager.watch(handlers);this.cleanups.push(()=>manager.off(handlers))}
 }
 schedule(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw()})}
 draw(){
  if(!this.deck||!this.active)return;const now=performance.now();let points=this.model.visible(now);
  if(this.wheel&&now-this.wheel.time<1200)points=[...points.filter(p=>p.type!=='mouse'),this.wheel];
  const down=points.filter(p=>p.buttons&&p.type!=='mouse');
  const shared={coordinateSystem:COORDINATE_SYSTEM.CARTESIAN,pickable:false,parameters:{depthWriteEnabled:false,depthCompare:'always'}};
  this.deck.setProps({layers:[
   new PathLayer({...shared,id:'input-contact-span',data:down.length>1?[down.map(p=>[p.x,p.y,0])]:[],getPath:d=>d,getColor:[126,218,255,210],getWidth:2,widthUnits:'pixels'}),
   new ScatterplotLayer({...shared,id:'input-contact-rings',data:points,getPosition:p=>[p.x,p.y,0],getRadius:p=>p.type==='wheel'?23:p.buttons?18:10,radiusUnits:'pixels',stroked:true,filled:true,getLineColor:[255,225,167,255],getFillColor:p=>[221,159,73,p.buttons?110:25],lineWidthUnits:'pixels',getLineWidth:2}),
   new TextLayer({...shared,id:'input-contact-labels',data:points,getPosition:p=>[p.x,p.y,0],getText:p=>p.type==='wheel'?'wheel':`${p.type} #${p.id}`,getSize:15,sizeUnits:'pixels',getColor:[255,238,206,255],getPixelOffset:[25,-25],getTextAnchor:'start',fontFamily:'Roboto',fontSettings:{sdf:true},outlineWidth:3,outlineColor:[25,25,25,255]})
  ]});this.root.dataset.pointerCount=String(points.length);this.root.dataset.contacts=JSON.stringify(points.map(({id,type,x,y,buttons})=>({id,type,x,y,buttons})));
  clearTimeout(this.expiry);if(points.some(p=>!p.buttons))this.expiry=setTimeout(()=>this.schedule(),1210);
 }
 detach(){for(const cleanup of this.cleanups)cleanup();this.cleanups=[];this.watchedManager=null;cancelAnimationFrame(this.frame);clearTimeout(this.expiry);this.frame=0;this.deck?.finalize();this.deck=null;this.target=null;this.model.clear();this.wheel=null}
}
