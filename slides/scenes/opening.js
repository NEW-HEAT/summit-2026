import {CLOCK_MORPH_END,clockMorph} from '../scene-timing.mjs';
import {ArcLayer,BitmapLayer} from '@deck.gl/layers';
import {GlowLayer} from './glow-layer.js';
import {PortraitLayer,avatarAtlas,avatarMapping} from './portrait-layer.js';
import {people,connections,personAlpha,connectionAlpha,connectionStats,ARC_STYLE} from './people-network.mjs';
export {connectionStats} from './people-network.mjs';
const globeBounds=[-180,-90,180,90];
const glow=(time,morph=0,controls={},atmosphereOnly=false)=>new GlowLayer({id:'opening-globe',time,morph,atmosphereOnly,strength:controls.shine??1,clockTime:controls.clockTime??Math.max(0,time-CLOCK_MORPH_END),parameters:{cullMode:'none',depthWriteEnabled:!atmosphereOnly,depthCompare:'less-equal'}});
const depth={cullMode:'none',depthWriteEnabled:false,depthCompare:'less-equal'};
export const openingScenes={
 'shiny-globe':{label:'Shiny GlobeView',description:'Backlit native GlobeView. ↑ grows the halo; ↓ reduces it. No tiles.',animated:true,duration:20,spin:3,bleed:true,requires:'GlobeView',layers:({time,controls})=>[glow(time,0,controls)]},
 connections:{label:'Satellite · people',description:'NASA Blue Marble BitmapLayer, portrait IconLayers and uniform ArcLayer. ↑ fades people with their edges; ↓ restores them. Random avatar icons; illustrative network. NASA Earth Observatory imagery.',animated:true,duration:20,spin:3,bleed:true,requires:'GlobeView',stats:connectionStats,layers:({time,controls={}})=>{const progress=controls.connectionTime??time;return [
   glow(time,0,{},true),
   new BitmapLayer({id:'opening-satellite',image:'/assets/earth-blue-marble.jpg',bounds:globeBounds,_imageCoordinateSystem:'lnglat',tintColor:[190,190,190],parameters:{cullMode:'back',depthWriteEnabled:true,depthCompare:'less-equal'}}),
   new ArcLayer({id:'opening-connections',data:connections,...ARC_STYLE,getSourcePosition:d=>d.from.position,getTargetPosition:d=>d.to.position,getSourceColor:d=>[221,159,73,Math.round(connectionAlpha(d,progress)*155)],getTargetColor:d=>[221,159,73,Math.round(connectionAlpha(d,progress)*155)],updateTriggers:{getSourceColor:progress,getTargetColor:progress},parameters:depth}),
   new PortraitLayer({id:'opening-people',data:people,iconAtlas:avatarAtlas,iconMapping:avatarMapping,getIcon:d=>String(d.id),getPosition:d=>d.position,getSize:40,sizeUnits:'pixels',billboard:true,getColor:d=>[255,255,255,Math.round(personAlpha(d,progress)*255)],alphaCutoff:.001,updateTriggers:{getColor:progress},parameters:depth})
 ]}},
 clock:{label:'Globe → clock',description:'The globe becomes a clock in 1.5 seconds. ↑ speeds up its hands; ↓ slows them down.',animated:true,duration:12,spin:time=>3*(1-clockMorph(time)),bleed:true,requires:'GlobeView',layers:({time,controls})=>[glow(time,clockMorph(time),controls)]}
};
