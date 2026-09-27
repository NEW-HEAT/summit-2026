import {CLOCK_MORPH_END} from './scene-timing.mjs';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export const sceneActions={
 'shiny-globe':{up:'More shine',down:'Less shine'},
 connections:{up:'Remove connections',down:'Restore connections'},
 clock:{up:'Faster clock',down:'Slower clock'}
};

// Operator input is transient: it never edits a slide, camera, or text draft.
export class SceneControls{
 constructor(){this.reset()}
 reset(){this.shine=1;this.shineTarget=1;this.connectionTime=0;this.connectionTarget=0;this.clockTime=0;this.clockSpeed=1;this.previousTime=0}
 boost(preset,direction=1){
  if(preset==='shiny-globe')this.shineTarget=clamp(this.shineTarget*2**direction,1,64);
  if(preset==='connections')this.connectionTarget=clamp(this.connectionTarget+direction*2.5,0,20);
  if(preset==='clock')this.clockSpeed=clamp(this.clockSpeed*4**direction,1,4096);
 }
 tick(delta,time){
  const blend=1-Math.exp(-Math.max(0,delta)*8);
  this.shine+=(this.shineTarget-this.shine)*blend;
  this.connectionTime+=(this.connectionTarget-this.connectionTime)*blend;
  if(Math.abs(this.connectionTime-this.connectionTarget)<.001)this.connectionTime=this.connectionTarget;
  // Integrate the rate: changing speed cannot jump the clock hands.
  this.clockTime+=Math.max(0,Math.max(0,time-CLOCK_MORPH_END)-Math.max(0,this.previousTime-CLOCK_MORPH_END))*this.clockSpeed;
  this.previousTime=time;
 }
 scrub(time){this.connectionTime=this.connectionTarget=clamp(time,0,20);this.clockTime=Math.max(0,time-CLOCK_MORPH_END)*this.clockSpeed;this.previousTime=time}
 snapshot(){return {shine:this.shine,connectionTime:this.connectionTime,clockTime:this.clockTime,clockSpeed:this.clockSpeed}}
}
