const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x)};
let seed=73821;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
export const NODE_ALTITUDE=220000;
// Illustrative network only. These coordinates are not anyone's real location.
export const people=[[0,20],[-52,52],[70,45],[-140,15],[150,-20],[-65,-40],[45,-35]].map((p,i)=>({position:[...p,NODE_ALTITUDE],keep:true,fadeAt:20,id:i,portrait:i%3}));
for(let i=7;i<96;i++)people.push({position:[random()*360-180,Math.asin(random()*1.8-.9)*180/Math.PI,NODE_ALTITUDE],keep:false,fadeAt:3+random()*17,id:i,portrait:i%3});
export const connections=Array.from({length:6},(_,i)=>({from:people[0],to:people[i+1],id:i}));
const key=(a,b)=>[a,b].sort((x,y)=>x-y).join(':');
const pairs=new Set(connections.map(a=>key(a.from.id,a.to.id)));
while(connections.length<480){const a=Math.floor(random()*people.length),b=Math.floor(random()*people.length);if(a===b||(people[a].keep&&people[b].keep)||pairs.has(key(a,b)))continue;pairs.add(key(a,b));connections.push({from:people[a],to:people[b],id:connections.length})}
export const personAlpha=(person,progress)=>person.keep?1:1-smooth((progress-(person.fadeAt-3))/3);
export const connectionAlpha=(edge,progress)=>Math.min(personAlpha(edge.from,progress),personAlpha(edge.to,progress));
export function connectionStats(progress){return {points:people.filter(p=>personAlpha(p,progress)>.001).length,arcs:connections.filter(a=>connectionAlpha(a,progress)>.001).length}}
export const ARC_STYLE={greatCircle:true,numSegments:96,getHeight:.20,getWidth:1.6,widthUnits:'pixels',getTilt:0};
