export const wsjPreviewURL='https://www.wsj.com/video/infiltrated-north-korea-secret-us-workforce/A221B1E7-3D49-404A-9132-9C3907CBE661';
export const viewDefaults={
  OrthographicView:{target:[640,360,0],zoom:0},
  GlobeView:{longitude:0,latitude:20,zoom:.4,bearing:0,pitch:0},
  MapView:{longitude:0,latitude:0,zoom:1,bearing:0,pitch:0},
  OrbitView:{target:[0,0,0],zoom:0,rotationX:30,rotationOrbit:0}
};
export const viewFields={OrthographicView:['target','zoom'],GlobeView:['longitude','latitude','zoom','bearing','pitch'],MapView:['longitude','latitude','zoom','bearing','pitch'],OrbitView:['target','zoom','rotationX','rotationOrbit']};
export const clone=x=>JSON.parse(JSON.stringify(x));
export function cameraState(type,raw){return Object.fromEntries(viewFields[type].map(k=>[k,raw[k]??viewDefaults[type][k]]));}
export function validateSlide(s){
  const fail=x=>{throw new Error(x)};
  const finite=(x,min,max,name)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)fail('Invalid '+name)};
  const string=(x,max,name)=>{if(typeof x!=='string'||x.length>max)fail('Invalid '+name)};
  const color=x=>{if(!/^#[0-9a-f]{6}$/i.test(x))fail('Use a six-digit hex color')};
  if(!s||s.schemaVersion!==1||!/^slide-\d{2}(?:-\d{1,2})?$/.test(s.id))fail('Invalid slide identity');
  finite(s.number,1,99,'slide number');if(!Number.isInteger(s.number))fail('Invalid slide number');
  if(s.part!==undefined){finite(s.part,1,99,'slide part');if(!Number.isInteger(s.part))fail('Invalid slide part')}
  string(s.title,150,'title');string(s.notes,20000,'notes');color(s.background);
  if(s.speaker!==undefined){
    if(!s.speaker||!['cues','exact'].includes(s.speaker.mode))fail('Invalid speaker mode');
    if(!Array.isArray(s.speaker.points)||s.speaker.points.length>12)fail('Use up to twelve talking points');
    s.speaker.points.forEach(p=>string(p,1000,'talking point'));
    if(s.speaker.text!==undefined)string(s.speaker.text,6000,'exact speaker text');
  }
  if(s.duration!==null)finite(s.duration,1,3600,'duration');
  if(!['cover','cue','media','numbers','sequence','film','flame','black'].includes(s.kind))fail('Invalid slide kind');
  if(!viewFields[s.view?.type])fail('Unsupported view');
  const state=s.view.state;
  for(const key of viewFields[s.view.type]){
    if(key==='target'){if(!Array.isArray(state.target)||state.target.length!==3)fail('Target must contain three numbers');state.target.forEach(v=>finite(v,-1e6,1e6,'target'))}
    else finite(state[key],...({latitude:s.view.type==='MapView'?[-85.051129,85.051129]:[-90,90],longitude:[-180,180],zoom:[-5,20],pitch:[0,85],bearing:[-360,360],rotationX:[-90,90],rotationOrbit:[-3600,3600]}[key]),key);
  }
  if(Object.keys(state).some(k=>!viewFields[s.view.type].includes(k)))fail('Unknown camera field');
  for(const k of ['x','y'])finite(s.view.frame[k],0,k==='x'?1279:719,'viewport '+k);
  finite(s.view.frame.width,1,1280,'viewport width');finite(s.view.frame.height,1,720,'viewport height');
  if(s.view.frame.x+s.view.frame.width>1280||s.view.frame.y+s.view.frame.height>720)fail('Viewport must fit inside the slide');
  if(!['placeholder','empty','globe','grid','shiny-globe','connections','clock','globe-playground','contributions','embers'].includes(s.scene?.preset))fail('Unsupported scene');
  if(['shiny-globe','connections','clock','globe-playground'].includes(s.scene.preset)&&s.view.type!=='GlobeView')fail('This scene uses GlobeView');
  if(['contributions','embers'].includes(s.scene.preset)&&s.view.type!=='OrthographicView')fail('This scene uses OrthographicView');
  if(s.scene.textBuild!==undefined&&s.scene.textBuild!=='replace')fail('Invalid text build');
  if(s.scene.audioLoop!==undefined){const loop=s.scene.audioLoop;if(!loop||typeof loop!=='object')fail('Invalid audio loop');if(loop.src!==null&&(!/^assets\/[a-zA-Z0-9_-]+\.(mp3|wav|m4a|aac|ogg|mp4|webm)$/.test(loop.src)))fail('Audio loop must be a local asset');finite(loop.volume,0,1,'loop volume');}
  if(s.scene.preset==='globe'&&s.view.type==='OrbitView')fail('Use the reference grid with OrbitView');
  if(s.scene.preset==='grid'&&s.view.type!=='OrbitView')fail('Reference grid requires OrbitView');
  string(s.scene.label,300,'placeholder label');
  if(s.scene.media!==null&&(!/^assets\/[a-zA-Z0-9/_-]+\.(mp4|webm|png|jpg|jpeg|gif|svg|webp)$/.test(s.scene.media)||s.scene.media.includes('..')))fail('Media must be a local assets path');
  if(s.scene.projectLink!==undefined){const link=s.scene.projectLink;if(!link||(!/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+(?:\/(?:issues|pull)\/\d+)?$/.test(link.url)&&!['https://agintel.ai/','https://github.com/charlieforward9',wsjPreviewURL].includes(link.url)))fail('Use an approved project or source link');string(link.label,100,'project link label')}
  if(s.scene.linkPreview!==undefined){const preview=s.scene.linkPreview,c=preview?.crop;if(preview?.url!==wsjPreviewURL||!c||!s.scene.media?.endsWith('.png'))fail('Invalid linked preview');for(const k of ['x','y','width','height','imageWidth','imageHeight'])finite(c[k],['x','y'].includes(k)?0:1,16000,'preview '+k);if(c.x+c.width>c.imageWidth||c.y+c.height>c.imageHeight)fail('Preview crop must fit the source');}
  if(s.scene.gallery!==undefined){if(!Array.isArray(s.scene.gallery)||s.scene.gallery.length!==3)fail('Gallery needs three images');for(const image of s.scene.gallery){if(!/^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(image.src))fail('Gallery image must be local');string(image.label,100,'gallery label');string(image.alt,300,'image description')}}
  if(s.scene.flow!==undefined&&!['points','pr','trees'].includes(s.scene.flow))fail('Invalid agintel flow cue');
  if(s.scene.embed!==undefined&&!['http://127.0.0.1:8084/','http://127.0.0.1:5178/','http://127.0.0.1:8085/oasis'].includes(s.scene.embed))fail('Use an approved local live demo');
  if(s.scene.playback!==undefined&&!['manual','autoplay-muted'].includes(s.scene.playback))fail('Invalid media playback');
  if(s.scene.fit!==undefined&&!['contain','cover'].includes(s.scene.fit))fail('Invalid media fit');
  if(s.scene.position!==undefined){if(!Array.isArray(s.scene.position)||s.scene.position.length!==2)fail('Media position needs two percentages');s.scene.position.forEach(v=>finite(v,0,100,'media position'))}
  if(s.scene.scrim!==undefined&&!['none','bottom'].includes(s.scene.scrim))fail('Invalid photo scrim');
  if(!Array.isArray(s.overlays)||s.overlays.length>30)fail('Too many text overlays');
  const ids=new Set();
  for(const t of s.overlays){
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(t.id)||ids.has(t.id))fail('Invalid overlay identity');ids.add(t.id);
    string(t.text,6000,'overlay text');color(t.color);finite(t.x,0,1280,'text x');finite(t.y,0,720,'text y');finite(t.width,10,1280,'text width');finite(t.size,8,250,'font size');
    if(!['Roboto Black','Roboto'].includes(t.font)||!['left','center','right'].includes(t.align))fail('Invalid text style');
    if(t.reveal!==undefined){finite(t.reveal,1,30,'reveal step');if(!Number.isInteger(t.reveal))fail('Reveal step must be a whole number')}
    if(t.bullet!==undefined&&typeof t.bullet!=='boolean')fail('Invalid bullet style');
  }
  if(s.scene.afterMedia!==undefined){
    const after=s.scene.afterMedia;
    if(!after?.scene?.linkPreview||after.scene.afterMedia!==undefined||s.scene.textBuild||s.overlays.some(t=>t.reveal))fail('Invalid media reveal');
    validateSlide({...s,view:{...s.view,frame:after.frame},scene:after.scene,overlays:after.overlays});
  }
  return s;
}
