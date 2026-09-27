export const firstBuild=slide=>slide?.scene.textBuild==='replace'?1:0;
export const buildCount=slide=>Math.max(slide?.scene.afterMedia?1:0,...(slide?.overlays||[]).map(t=>t.reveal||0));
export function slideAtStep(slide,step){
 const after=step>0&&slide?.scene.afterMedia;
 return after?{...slide,view:{...slide.view,frame:after.frame},scene:after.scene,overlays:after.overlays}:slide;
}
export function visibleBuild(overlay,{slide,step,editing=false,selected=null}){
 if(!overlay.reveal)return true;
 if(slide.scene.textBuild==='replace'){
  const selectedStep=slide.overlays.find(t=>t.id===selected)?.reveal;
  return overlay.reveal===(editing?(selectedStep||step||1):step);
 }
 return editing||overlay.reveal<=step;
}
