import {contributionsScene} from './contributions.js';
import {embersScene} from './embers.js';
import {GeoJsonLayer,PolygonLayer,PathLayer} from '@deck.gl/layers';import {COORDINATE_SYSTEM} from '@deck.gl/core';
import {playgroundScene} from './playground.js';
import {openingScenes} from './opening.js';
const ocean=Array.from({length:216},(_,i)=>{const x=-180+(i%18)*20,y=-90+Math.floor(i/18)*15;return [[x,y,-200000],[x+20,y,-200000],[x+20,y+15,-200000],[x,y+15,-200000]]});
const graticule=[...Array.from({length:13},(_,i)=>Array.from({length:73},(_,j)=>[-180+j*5,-75+i*12.5])),...Array.from({length:18},(_,i)=>Array.from({length:61},(_,j)=>[-180+i*20,-90+j*3]))];
const grid=Array.from({length:22},(_,i)=>{const v=(i%11-5)*50;return i<11?[[v,-250,0],[v,250,0]]:[[-250,v,0],[250,v,0]]});
// A scene returns native deck.gl layers; the studio owns camera and text overlays.
// Add real animations here with a layers({slide,time,land}) function.
export const scenes={
 ...openingScenes,
 contributions:contributionsScene,
 embers:embersScene,
 'globe-playground':playgroundScene,
 empty:{label:'Empty canvas',layers:()=>[]},
 placeholder:{label:'Original media placeholder',layers:()=>[]},
 globe:{label:'Public globe reference',animated:true,duration:120,spin:3,layers:({land})=>[
  new PolygonLayer({id:'ocean',data:ocean,getPolygon:d=>d,getFillColor:[35,38,37],stroked:false,parameters:{cullMode:'none'}}),
  new GeoJsonLayer({id:'land',data:land,filled:true,stroked:true,getFillColor:[70,90,53],getLineColor:[221,159,73,190],lineWidthUnits:'pixels',getLineWidth:.7}),
  new PathLayer({id:'graticule',data:graticule,getPath:d=>d,getColor:[221,159,73,35],getWidth:1,widthUnits:'pixels'})
 ]},
 grid:{label:'Orbit reference grid',layers:()=>[
  new PathLayer({id:'grid',coordinateSystem:COORDINATE_SYSTEM.CARTESIAN,data:grid,getPath:d=>d,getColor:[221,159,73,60],getWidth:1,widthUnits:'pixels'}),
  new PathLayer({id:'axes',coordinateSystem:COORDINATE_SYSTEM.CARTESIAN,data:[{path:[[0,0,0],[200,0,0]],color:[245,102,3]},{path:[[0,0,0],[0,200,0]],color:[12,83,149]},{path:[[0,0,0],[0,0,200]],color:[221,159,73]}],getPath:d=>d.path,getColor:d=>d.color,getWidth:3,widthUnits:'pixels'})
 ]}
};
