import {BitmapLayer,GeoJsonLayer,PolygonLayer,PathLayer,ArcLayer} from '@deck.gl/layers';
import {GlowLayer} from './glow-layer.js';
import {PortraitLayer,avatarAtlas,avatarMapping} from './portrait-layer.js';
import {people,connections,ARC_STYLE} from './people-network.mjs';
const ocean=Array.from({length:648},(_,i)=>{const x=-180+i%36*10,y=-90+Math.floor(i/36)*10;return [[x,y,-2000],[x+10,y,-2000],[x+10,y+10,-2000],[x,y+10,-2000]]});
const graticule=[...Array.from({length:11},(_,i)=>Array.from({length:181},(_,j)=>[-180+j*2,-75+i*15,2000])),...Array.from({length:24},(_,i)=>Array.from({length:91},(_,j)=>[-180+i*15,-90+j*2,2000]))];
const depth={cullMode:'back',depthWriteEnabled:true,depthCompare:'less-equal'};
export const playgroundScene={label:'Interactive GlobeView',description:'Four additions from 2026: map/ball navigation, pointer zoom, momentum and geographic bounds. Drag to explore; Use live camera in slide captures the result in the Camera editor.',requires:'GlobeView',animated:true,duration:120,
 layers:({land,time,playOptions:o,viewState})=>{
 const layers=[];
 if(o.atmosphere&&viewState.zoom<=12)layers.push(new GlowLayer({id:'play-atmosphere',time,morph:0,strength:1,clockTime:0,atmosphereOnly:true,parameters:{cullMode:'none',depthWriteEnabled:false,depthCompare:'less-equal'}}));
 if(o.surface==='satellite')layers.push(new BitmapLayer({id:'play-satellite',image:'/assets/earth-blue-marble.jpg',bounds:[-180,-90,180,90],_imageCoordinateSystem:'lnglat',parameters:depth}));
 if(o.surface==='vector')layers.push(new PolygonLayer({id:'play-ocean',data:ocean,getPolygon:d=>d,getFillColor:[20,35,47],stroked:false,parameters:depth}),new GeoJsonLayer({id:'play-land',data:land,filled:true,stroked:true,getFillColor:[70,90,53],getLineColor:[221,159,73,190],lineWidthUnits:'pixels',getLineWidth:.7,pickable:o.picking,autoHighlight:true,parameters:depth}));
 if(o.bounds)layers.push(new PathLayer({id:'play-bounds',data:[[[o.west,o.south,20000],[o.east,o.south,20000],[o.east,o.north,20000],[o.west,o.north,20000],[o.west,o.south,20000]]],getPath:d=>d,getColor:[255,188,84,255],getWidth:3,widthUnits:'pixels',parameters:{...depth,cullMode:'none',depthWriteEnabled:false}}));
 if(o.graticule)layers.push(new PathLayer({id:'play-graticule',data:graticule,getPath:d=>d,getColor:[221,159,73,90],getWidth:1,widthUnits:'pixels',parameters:depth}));
 if(o.arcs)layers.push(new ArcLayer({id:'play-arcs',data:connections,...ARC_STYLE,getSourcePosition:d=>d.from.position,getTargetPosition:d=>d.to.position,getSourceColor:[221,159,73,120],getTargetColor:[221,159,73,120],pickable:o.picking,parameters:{...depth,cullMode:'none',depthWriteEnabled:false}}));
 if(o.points)layers.push(new PortraitLayer({id:'play-people',data:people,iconAtlas:avatarAtlas,iconMapping:avatarMapping,getIcon:d=>String(d.id),getPosition:d=>d.position,getSize:34,sizeUnits:'pixels',billboard:true,getColor:[255,255,255,255],alphaCutoff:.001,pickable:o.picking,parameters:{...depth,cullMode:'none',depthWriteEnabled:false}}));
 return layers;
 }};
