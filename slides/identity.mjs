// Exact colors and typography roles: identity-newheat.pdf pages 5 and 6.
// Layout measurements below are presentation adaptations, not claims from the guide.
export const identity = {
  palette: {charcoal:'#1D1D1E', amber:'#DD9F49', orange:'#F56603', red:'#BB2803', green:'#465A35', blue:'#0C5395', white:'#FFFFFF'},
  fonts: {heading:'Roboto Black', bodyHeading:'Roboto', body:'Roboto', requestedBody:'Modex Sans', bodyStatus:'Awaiting original font files'},
  canvas: {width:1280,height:720},
  spacing: {margin:88},
  sizes: {cue:78, one:104, project:50, body:31, placeholder:26, number:116, sequence:84},
  media: {left:160,top:156,width:960,height:540,fill:'#252525',label:'#DD9F49'},
  transition: {duration:1000,easing:'ease-in-out'},
  wordmark: {left:250,top:322,width:780,height:76},
  sourcePages: {wordmarks:[1,2],symbols:[3,4],palette:[5],type:[6],auxiliaryPattern:[7]}
};
export function treatment(slide) {
  const p=identity.palette;
  if(slide.type==='black'||slide.type==='film'||slide.type==='flame') return {bg:'#000000',fg:p.amber,secondary:p.amber,logo:'logo.png'};
  if(slide.type==='cue'&&slide.title==='Hotrod') return {bg:p.orange,fg:p.charcoal,secondary:p.charcoal};
  if(slide.type==='cue'&&slide.title==='newheat.co') return {bg:p.amber,fg:p.charcoal,secondary:p.charcoal};
  return {bg:p.charcoal,fg:p.amber,secondary:p.amber,logo:'wordmark-amber.svg'};
}
