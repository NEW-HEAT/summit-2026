import {globeFeatures} from './globe-options.mjs';
export class GlobePanel {
 constructor(parent,renderer){
  this.renderer=renderer;this.inputs=new Map();
  this.el=document.createElement('section');this.el.id='globe-panel';this.el.hidden=true;this.el.setAttribute('aria-label','GlobeView additions in the past year');
  const title=document.createElement('h2');title.textContent='GlobeView · 2026';this.el.append(title);
  const body=document.createElement('div');body.className='globe-feature-list';this.el.append(body);
  for(const feature of globeFeatures){
   const row=document.createElement('label');row.className='globe-feature';
   const copy=document.createElement('span'),name=document.createElement('strong'),hint=document.createElement('small');name.textContent=feature.label;hint.textContent=feature.hint;copy.append(name,hint);
   const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.setAttribute('aria-label',feature.label);input.id='globe-'+feature.key;
   input.onchange=()=>{renderer.setPlayFeature(feature.key,input.checked);this.sync()};
   row.append(copy,input);body.append(row);this.inputs.set(feature.key,input);
  }
  const reset=document.createElement('button');reset.textContent='Reset view';reset.onclick=()=>{renderer.resetPlayground();this.sync()};this.el.append(reset);
  this.readout=document.createElement('p');this.readout.className='globe-demo-hint';this.el.append(this.readout);parent.append(this.el);
 }
 sync(){const r=this.renderer;this.el.hidden=!r.playground;if(!r.playground)return;for(const [key,input] of this.inputs)input.checked=!!r.playOptions[key];this.readout.textContent=r.playOptions.ball?'Ball · Drag to roll · Shift-drag to tilt':'Map · Drag to pan · Shift-drag to tilt'}
}
