// Let atmosphere render throughout the slide. Native projection padding keeps
// the authored globe center; altitude preserves camera distance and pixel size.
export function globeFrame(frame){
 const x=frame.x+frame.width/2-640,y=frame.y+frame.height/2-360;
 return {x:0,y:0,width:1280,height:720,altitude:1.5*frame.height/720,nearZMultiplier:.5*frame.height/720,
  padding:{left:Math.max(0,x*2),right:Math.max(0,-x*2),top:Math.max(0,y*2),bottom:Math.max(0,-y*2)}};
}
