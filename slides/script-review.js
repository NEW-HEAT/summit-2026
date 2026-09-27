import {speakerCatalog} from './speaker-model.mjs';

export class ScriptReview {
  constructor(host,{onClose,onNavigate,onStep,onBoost,onPhone}) {
    this.host=host;this.full=false;
    host.innerHTML=`<header><h2>Script</h2><button id="script-close" aria-label="Close script">×</button></header>
      <label class="sr-only" for="script-slide">Choose slide</label><select id="script-slide"></select>
      <div id="script-copy" aria-live="polite"></div><div id="script-links"></div>
      <footer><div class="script-options"><button id="script-full" aria-pressed="false">Full script</button><button id="script-phone">Phone script</button></div>
      <nav aria-label="Script and slide navigation"><button id="script-prev" aria-label="Previous slide or stanza">← Previous</button><button id="script-down" hidden>↓</button><button id="script-up" hidden>↑</button><button id="script-next" aria-label="Next slide or stanza">Next →</button></nav></footer>`;
    this.$=q=>host.querySelector(q);
    this.$('#script-close').onclick=onClose;
    this.$('#script-slide').onchange=e=>onNavigate(e.target.value);
    this.$('#script-prev').onclick=()=>onStep(-1);this.$('#script-next').onclick=()=>onStep(1);
    this.$('#script-down').onclick=()=>onBoost(-1);this.$('#script-up').onclick=()=>onBoost(1);
    this.$('#script-phone').onclick=onPhone;
    this.$('#script-full').onclick=()=>{this.full=!this.full;this.renderCopy();};
  }
  setOpen(value){this.host.hidden=!value;}
  render(entries,slide,step,action){
    const catalog=speakerCatalog(entries.map(e=>e.slide.id===slide.id?{...e,slide}:e));
    this.cue=catalog.find(c=>c.id===slide.id);this.step=step;
    const picker=this.$('#script-slide');picker.replaceChildren(...catalog.map(c=>{
      const option=document.createElement('option');option.value=c.key;option.textContent=c.label+' · '+c.title+(c.optional?' · Optional':'');return option;
    }));picker.value=this.cue.key;
    const links=this.$('#script-links');links.replaceChildren();
    for(const source of entries.find(e=>e.slide.id===slide.id)?.sourceLinks||[]){const a=document.createElement('a');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=source.label+' ↗';links.append(a);}
    for(const direction of ['up','down']){const button=this.$('#script-'+direction);button.hidden=!action;if(action){button.title=action[direction];button.setAttribute('aria-label',action[direction]);}}
    this.renderCopy();
  }
  renderCopy(){
    if(!this.cue)return;
    const cue=this.cue,copy=this.$('#script-copy');copy.replaceChildren();copy.scrollTop=0;
    const paragraph=text=>{if(!text)return;const p=document.createElement('p');p.textContent=text;copy.append(p);};
    if(this.full)paragraph(cue.full);
    else if(cue.mode==='poem')paragraph(cue.blocks.find(b=>b.step===Math.max(cue.firstStep,this.step))?.text);
    else {if(cue.mode==='exact')paragraph(cue.exact);if(cue.points.length){const ul=document.createElement('ul');for(const text of cue.points){const li=document.createElement('li');li.textContent=text;ul.append(li);}copy.append(ul);}else if(!cue.exact)paragraph(cue.full);}
    const button=this.$('#script-full');button.textContent=this.full?'Talking points':'Full script';button.setAttribute('aria-pressed',String(this.full));
  }
}
