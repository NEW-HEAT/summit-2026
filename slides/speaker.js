const $=s=>document.querySelector(s);
let catalog=[],stage={current:null,live:false},version='',seenVersion=null,following=true,selection=null,view='cues',connected=false,fingerprint='';
let size=32;
try{size=Math.min(44,Math.max(24,Number(localStorage.getItem('newheat-speaker-size'))||32));}catch{}
function fontSize(){document.documentElement.style.setProperty('--cue-size',size+'px');$('#smaller').disabled=size<=24;$('#larger').disabled=size>=44;try{localStorage.setItem('newheat-speaker-size',size)}catch{}}
fontSize();
function chooseCurrent(){
  if(following){const live=catalog.find(c=>c.id===stage.current?.id);if(live)return {cue:live,step:Math.max(live.firstStep,stage.current.step)};}
  const cue=catalog.find(c=>c.id===selection?.id)||catalog.find(c=>!c.optional)||catalog[0];
  return cue?{cue,step:selection?.id===cue.id?selection.step:cue.firstStep}:null;
}
function renderStatus(){
  $('#connection').textContent=!connected?'Reconnecting…':stage.live?'Stage connected':'Stage paused';
  $('#connection').dataset.live=String(connected&&stage.live);
  $('#following').hidden=!following;$('#follow').hidden=following;
  $('#following').textContent=stage.live?'Following stage':'Last stage cue';
}
function addText(parent,text,className){const p=document.createElement('p');p.className=className;p.textContent=text;parent.append(p);}
function render(){
  renderStatus();const active=chooseCurrent();if(!active)return;
  const {cue,step}=active;
  if(seenVersion!==version){
    const picker=$('#slide-picker');picker.replaceChildren();
    for(const optional of [false,true]){const group=document.createElement('optgroup');group.label=optional?'Optional slides':'Show order';for(const item of catalog.filter(c=>c.optional===optional)){const option=document.createElement('option');option.value=item.id;option.textContent=item.label+' · '+item.title;group.append(option)}if(group.children.length)picker.append(group)}
    seenVersion=version;
  }
  $('#slide-picker').value=cue.id;
  const signature=JSON.stringify([version,cue.id,step,view]);if(signature===fingerprint)return;fingerprint=signature;
  $('#cue-number').textContent='Slide '+cue.label+(cue.optional?' · Optional':'');$('#cue-title').textContent=cue.title;
  const poem=cue.mode==='poem',block=cue.blocks.find(b=>b.step===step)||cue.blocks[0];
  $('#build').hidden=!poem;$('#build').textContent=poem?`Stanza ${cue.blocks.indexOf(block)+1} of ${cue.blocks.length}`:'';
  const words=$('#words');words.replaceChildren();
  if(view==='full')addText(words,cue.full||cue.exact||'No full script for this cue. Use Cues for your talking points.','exact');
  else if(poem)addText(words,block?.text||'','exact');
  else{
    if(cue.mode==='exact'&&cue.exact)addText(words,cue.exact,'exact');
    if(cue.points.length){const list=document.createElement('ul');if(cue.mode==='exact'&&cue.exact)list.className='cue-after-exact';for(const point of cue.points){const li=document.createElement('li');li.textContent=point;list.append(li)}words.append(list)}
    else if(!cue.exact)addText(words,'No talking points for this cue.','empty');
  }
  $('#position').textContent=cue.optional?'Optional':cue.position+' / '+cue.total;
  const route=catalog.filter(c=>!c.optional),index=route.findIndex(c=>c.id===cue.id);
  $('#previous').disabled=index===0&&(!poem||step<=cue.firstStep);
  $('#next').disabled=index===route.length-1&&(!poem||step>=cue.builds);
  window.scrollTo({top:0,behavior:'instant'});
}
function browse(direction){
  const active=chooseCurrent();if(!active)return;let {cue,step}=active;
  if(cue.mode==='poem'&&((direction>0&&step<cue.builds)||(direction<0&&step>cue.firstStep)))step+=direction;
  else{
    const route=catalog.filter(c=>!c.optional),index=route.findIndex(c=>c.id===cue.id);
    const fullIndex=catalog.indexOf(cue);
    // Optional cues are not part of the spoken route. Return to the nearest main cue.
    let target=index>=0?route[Math.max(0,Math.min(route.length-1,index+direction))]:null;
    if(index<0){const neighbors=direction>0?catalog.slice(fullIndex+1):catalog.slice(0,fullIndex).reverse();target=neighbors.find(c=>!c.optional)||route[direction>0?route.length-1:0];}
    if(target){cue=target;step=direction<0&&cue.mode==='poem'?cue.builds:cue.firstStep;}
  }
  selection={id:cue.id,step};following=false;render();
}
$('#previous').onclick=()=>browse(-1);$('#next').onclick=()=>browse(1);
$('#slide-picker').onchange=e=>{const cue=catalog.find(c=>c.id===e.target.value);if(!cue)return;selection={id:cue.id,step:cue.firstStep};following=false;render();};
$('#follow').onclick=()=>{following=true;render();};
for(const id of ['cues','full'])$('#'+id).onclick=()=>{view=id;$('#cues').setAttribute('aria-pressed',String(id==='cues'));$('#full').setAttribute('aria-pressed',String(id==='full'));render();};
$('#smaller').onclick=()=>{size=Math.max(24,size-2);fontSize()};$('#larger').onclick=()=>{size=Math.min(44,size+2);fontSize()};
addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.metaKey||e.ctrlKey||e.altKey)return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();browse(e.key==='ArrowLeft'?-1:1)}});
// Only read operations exist here. Phone browsing never sends a stage command.
function receive(packet){catalog=packet.catalog;stage={...packet.stage,current:packet.stage.current||stage.current};version=JSON.stringify(catalog);connected=true;render();}
if(location.protocol==='https:'){
  // Quick Tunnels do not support SSE. Conditional polling keeps changes immediate
  // without resending the full script when the cue has not changed.
  let etag=null;
  async function poll(){
    try{const response=await fetch('/api/speaker',{headers:etag?{'If-None-Match':etag}:{},signal:AbortSignal.timeout(6000)});
      if(response.status===401){location.reload();return;}
      if(response.status===304){connected=true;renderStatus();}
      else {if(!response.ok)throw Error();etag=response.headers.get('ETag');receive(await response.json());}
    }catch{connected=false;renderStatus();}
    setTimeout(poll,connected?700:1600);
  }
  poll();
}else{
  const events=new EventSource('/speaker-events');
  events.onmessage=e=>{try{receive(JSON.parse(e.data))}catch{connected=false;renderStatus()}};
  events.onerror=()=>{connected=false;renderStatus()};
}
