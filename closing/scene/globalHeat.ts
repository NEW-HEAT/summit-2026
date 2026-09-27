import {TripsLayer} from '@deck.gl/geo-layers';
import type {Layer} from '@deck.gl/core';
import type {TimelineState} from './types';

export type HeatRoute = {ordinal:number; activity:string; paths:[number,number][][]};
export type HeatInput = {payload:{routes:HeatRoute[]}; evidence:{drawableRoutes:number;pathCount:number;payloadSha256:string;routeCoverage:string;ownerMatch:string;allTimeIndexPagination:string}};
declare global {interface Window {__NEWHEAT_HEAT_INPUT__?:HeatInput}}
type Stroke={path:[number,number,number][];timestamps:number[];color:[number,number,number,number]};
const cache=new WeakMap<HeatInput,{base:Stroke[];pulse:Stroke[]}>();
const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*t*(t*(t*6-15)+10);};

export function heatPresentation(seconds:number) {
  return {opacity:smooth((seconds-23)/1.8),reveal:smooth((seconds-23)/4),pulseTime:((seconds-23)%4.8+4.8)%4.8};
}
export function heatColor(activity:string):[number,number,number,number] {
  const a=activity.toLowerCase();
  if(/run|jog|sprint/.test(a))return [255,69,0,235];
  if(/e.?bike/.test(a))return [255,223,0,235];
  if(/bike|biking|cycl|ride|mtb/.test(a))return [255,165,0,235];
  if(/swim|pool/.test(a))return [47,155,255,235];
  if(/hike|trek/.test(a))return [34,139,34,235];
  if(/walk/.test(a))return [76,175,80,235];
  if(/flight/.test(a))return [0,255,127,235];
  if(/drive|car/.test(a))return [124,92,255,235];
  if(/ski/.test(a))return [138,43,226,235];
  if(/train|rail/.test(a))return [217,70,239,235];
  if(/boat|ferry/.test(a))return [125,211,252,235];
  if(/surf|sail|kayak|paddle/.test(a))return [0,191,255,235];
  return [255,107,53,235];
}
export function prepareHeatStrokes(input:HeatInput) {
  const existing=cache.get(input);if(existing)return existing;
  if(input.evidence.routeCoverage!=='PASS'||input.evidence.ownerMatch!=='PASS'||input.evidence.allTimeIndexPagination!=='PASS'||input.payload.routes.length!==input.evidence.drawableRoutes)throw Error('Global HEAT input is not complete');
  const base:Stroke[]=[],pulse:Stroke[]=[];
  for(const route of input.payload.routes)for(const points of route.paths){
    if(points.length<2)continue;
    const path=points.map(p=>[p[0],p[1],15000] as [number,number,number]);
    // Only the edit clock is normalized. Route shapes are real account routes;
    // no fabricated global connections or historical velocity are implied.
    const timestamps=path.map((_,i)=>i/(path.length-1));
    const color=heatColor(route.activity),phase=((route.ordinal*.61803398875)%1)*4.8;
    base.push({path,timestamps,color});
    for(const shift of [-4.8,0])pulse.push({path,timestamps:timestamps.map(t=>phase+shift+t*2.4),color:[Math.min(255,color[0]+60),Math.min(255,color[1]+60),Math.min(255,color[2]+60),255]});
  }
  if(base.length!==input.evidence.pathCount)throw Error('Global HEAT path coverage mismatch');
  const data={base,pulse};cache.set(input,data);return data;
}
export function buildGlobalHeatLayers(state:TimelineState,input?:HeatInput):Layer[] {
  const presentation=heatPresentation(state.timeSeconds);
  if(!input||presentation.opacity<=0||state.sceneOpacity<=0)return [];
  const data=prepareHeatStrokes(input);
  const common={getPath:(d:Stroke)=>d.path,getTimestamps:(d:Stroke)=>d.timestamps,getColor:(d:Stroke)=>d.color,
    widthUnits:'pixels' as const,capRounded:true,jointRounded:true,billboard:true,wrapLongitude:true,pickable:false,
    parameters:{depthCompare:'less-equal' as const,depthWriteEnabled:false}};
  return [
    new TripsLayer<Stroke>({...common,id:'all-newheat-route-glow',data:data.base,currentTime:presentation.reveal,trailLength:2,fadeTrail:false,getWidth:6,opacity:presentation.opacity*.19}),
    new TripsLayer<Stroke>({...common,id:'all-newheat-route-network',data:data.base,currentTime:presentation.reveal,trailLength:2,fadeTrail:false,getWidth:2.2,opacity:presentation.opacity*.84}),
    new TripsLayer<Stroke>({...common,id:'all-newheat-route-motion',data:data.pulse,currentTime:presentation.pulseTime,trailLength:1.2,fadeTrail:true,getWidth:2.8,opacity:presentation.opacity*presentation.reveal*.85})
  ];
}
