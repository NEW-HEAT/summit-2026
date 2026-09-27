// A cue owns its loop. The film must release it before starting its own sound.
export class CueAudio {
  constructor({createAudio=()=>new Audio(),onChange=()=>{}}={}){this.createAudio=createAudio;this.onChange=onChange;this.audio=null;this.src=null;this.generation=0;}
  setCue(config){
    if((config?.src||null)===this.src)return;
    this.stop();if(!config?.src)return;
    const audio=this.audio=this.createAudio();this.src=config.src;
    audio.src='/'+config.src;audio.loop=true;audio.volume=config.volume??.8;audio.preload='auto';
    void this.play();
  }
  async play(){const audio=this.audio,generation=this.generation;if(!audio)return;
    try{await audio.play();if(generation!==this.generation){audio.pause();return;}this.onChange({available:true,playing:true});}
    catch{if(generation===this.generation)this.onChange({available:true,playing:false});}
  }
  toggle(){if(!this.audio)return;if(this.audio.paused){void this.play();}else{this.audio.pause();this.onChange({available:true,playing:false});}}
  stop(){this.generation++;if(this.audio){this.audio.pause();this.audio.removeAttribute('src');this.audio.load();}this.audio=null;this.src=null;this.onChange({available:false,playing:false});}
}
