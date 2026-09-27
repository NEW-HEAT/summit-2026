import {ScatterplotLayer,LineLayer} from '@deck.gl/layers';
import {COORDINATE_SYSTEM} from '@deck.gl/core';
const seeds=Array.from({length:110},(_,i)=>({x:(i*691)%1280,speed:10+(i*37)%18,phase:(i*71)%440,size:.6+(i*13%20)/12}));
const shared={coordinateSystem:COORDINATE_SYSTEM.CARTESIAN,pickable:false,parameters:{depthWriteEnabled:false,depthCompare:'always'}};
export const embersScene={label:'Poem · embers',description:'Quiet native deck.gl embers behind the closing poem. Each Next replaces one stanza.',requires:'OrthographicView',animated:true,duration:120,interactive:false,
 layers:({time})=>{
  const data=seeds.map((p,i)=>{const rise=(p.phase+time*p.speed)%490;return {position:[p.x+Math.sin(time*.35+i)*16,750-rise,0],size:p.size,color:[255,142+(i%80),57,Math.round(115*Math.pow(1-rise/490,2))]}});
  return [new ScatterplotLayer({...shared,id:'poem-ember-halos',data,getPosition:d=>d.position,getRadius:d=>d.size*5,radiusUnits:'pixels',getFillColor:d=>[...d.color.slice(0,3),Math.round(d.color[3]*.08)]}),new ScatterplotLayer({...shared,id:'poem-embers',data,getPosition:d=>d.position,getRadius:d=>d.size,radiusUnits:'pixels',getFillColor:d=>d.color}),new LineLayer({...shared,id:'poem-ember-trails',data:data.filter((_,i)=>i%5===0),getSourcePosition:d=>d.position,getTargetPosition:d=>[d.position[0]-1,d.position[1]+11,0],getColor:d=>[...d.color.slice(0,3),Math.round(d.color[3]*.5)],getWidth:1,widthUnits:'pixels'})];
 }
};
