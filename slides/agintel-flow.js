// One retained scene across cues 10 / 11 / 12.1. The live canvas warms behind
// the orchard and PR; navigation changes opacity without recreating the iframe.
export class AgintelFlow {
  constructor(host) {
    this.host=host;
    this.onMessage=e=>{
      if(e.origin!=='http://127.0.0.1:8084'||e.source!==this.frame?.contentWindow)return;
      if(e.data?.type==='newheat-tree-ready'){
        this.ready=true;
        this.root.dataset.ready='true';
        this.status.hidden=true;
        this.sync();
      }
      if(e.data?.type==='newheat-tree-key'&&this.phase==='trees'){
        this.onNavigate?.(e.data.direction);
      }
    };
    addEventListener('message',this.onMessage);
  }
  show(slide, orchardSlide, prSlide) {
    if(!slide.scene.flow){this.clear();return false}
    if(!this.root)this.mount(orchardSlide,prSlide);
    this.phase=slide.scene.flow;
    this.root.dataset.phase=this.phase;
    this.sync();
    return true;
  }
  mount(orchardSlide,prSlide){
    this.ready=false;
    this.root=document.createElement('div');this.root.className='agintel-flow';this.root.dataset.ready='false';
    this.frame=document.createElement('iframe');this.frame.src='http://127.0.0.1:8084/';this.frame.title='TreeLayer — metre-scale groves';this.frame.className='live-demo flow-trees';this.frame.allow='fullscreen';this.frame.referrerPolicy='no-referrer';
    this.orchard=document.createElement('div');this.orchard.className='flow-orchard';
    this.versions=document.createElement('div');this.versions.className='flow-versions';this.versions.setAttribute('aria-label','Agintel RFC versions');
    const gallery=orchardSlide.scene.gallery;
    this.images=gallery.map((item,index)=>{
      const img=document.createElement('img');img.src='/'+item.src;img.alt=item.alt;img.className='flow-version';this.orchard.append(img);
      const button=document.createElement('button');button.textContent='V'+index;button.title=item.label;button.onclick=()=>this.select(index);this.versions.append(button);return img;
    });
    this.select(0);
    this.pr=document.createElement('div');this.pr.className='flow-pr';
    const image=document.createElement('img');image.src='/'+prSlide.scene.media;image.alt=prSlide.scene.label;this.pr.append(image);
    this.status=document.createElement('div');this.status.className='flow-status';this.status.setAttribute('role','status');this.status.textContent='Loading TreeLayer…';this.status.hidden=true;
    this.root.append(this.frame,this.orchard,this.pr,this.versions,this.status);this.host.replaceChildren(this.root);
    // The explicit ready handshake is emitted only after Deck has rendered.
    this.frame.onload=()=>this.frame.contentWindow?.postMessage({type:'newheat-tree-ready-request'},'http://127.0.0.1:8084');
  }
  select(index){
    this.images?.forEach((img,i)=>{img.classList.toggle('active',i===index);img.setAttribute('aria-hidden',String(i!==index))});
    [...this.versions.children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  }
  sync(){
    if(!this.root)return;
    const trees=this.phase==='trees';
    this.frame.inert=!trees||!this.ready;this.frame.setAttribute('aria-hidden',String(!trees||!this.ready));
    this.pr.setAttribute('aria-hidden',String(this.phase!=='pr'&&!(trees&&!this.ready)));
    this.orchard.setAttribute('aria-hidden',String(trees&&this.ready));
    this.versions.inert=this.phase!=='points';this.versions.setAttribute('aria-hidden',String(this.phase!=='points'));
    this.status.hidden=!trees||this.ready;
  }
  clear(){this.root?.remove();this.root=null;this.frame=null;this.phase=null;this.ready=false}
}
