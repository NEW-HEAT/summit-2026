// One active stage owns the notes feed. Merely opening another tab does not steal it.
export class PresenterSync {
  constructor(readState) {
    this.readState=readState;this.client=crypto.randomUUID();this.sequence=0;
    this.timer=setInterval(()=>this.send(),2500);
    addEventListener('pagehide',()=>{
      const state=readState();if(!state?.id)return;
      navigator.sendBeacon('/api/presentation',new Blob([JSON.stringify({...state,presenting:false,client:this.client,sequence:++this.sequence})],{type:'application/json'}));
    });
  }
  send(claim=false) {
    const state=this.readState();if(!state?.id)return;
    if(document.hidden && state.presenting)return;
    this.pending={...state,claim:claim||this.pending?.claim||false,client:this.client,sequence:++this.sequence};
    this.flush();
  }
  async flush() {
    if(this.sending)return;this.sending=true;
    while(this.pending){
      const body=this.pending;this.pending=null;
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),2000);
      try {await fetch('/api/presentation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:abort.signal});} catch {} finally {clearTimeout(timer);}
    }
    this.sending=false;
  }
}
