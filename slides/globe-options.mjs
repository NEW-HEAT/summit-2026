export const globeFeatures=[
 {key:'ball',label:'Ball navigation',hint:'Off: map · On: roll through the poles',since:'2026-08-30',commits:['93f0fe01df','bc65df77c3']},
 {key:'pointerZoom',label:'Zoom to pointer',hint:'Keep the point under your cursor',since:'2026-08-30',commits:['8126bb90f1']},
 {key:'inertia',label:'Momentum',hint:'Glide after releasing a drag',since:'2026-05-14',commits:['5405738f07']}
];
export const globeDefaults={
 surface:'satellite',atmosphere:true,graticule:false,points:false,arcs:false,picking:true,
 ball:false,pointerZoom:true,navigation:'map',spin:false,spinSpeed:3,dragPan:true,dragRotate:true,dragMode:'pan',scrollZoom:true,
 scrollSpeed:.006,scrollSmooth:false,zoomAround:'pointer',doubleClickZoom:true,
 doubleClickDragZoom:true,touchZoom:true,multiTouchDrag:'rotate',trackpadGesture:false,
 keyboard:true,keyboardZoom:2,keyboardMove:100,keyboardRotateX:15,keyboardRotateY:15,
 inertia:true,inertiaTime:280,rubberBand:true,bounds:false,
 west:-30,south:-10,east:60,north:75,boundsPadding:20,
 minZoom:-.75,maxZoom:8,minPitch:0,maxPitch:85,
 orthographic:false,altitude:1.5,resolution:2,nearZMultiplier:.1,farZMultiplier:1.01,padding:0
};
export function controllerOptions(o,focused=false){return {
 navigation:o.navigation,dragPan:o.dragPan,dragRotate:o.dragRotate,dragMode:o.dragMode,
 scrollZoom:o.scrollZoom?{speed:o.scrollSpeed,smooth:o.scrollSmooth}:false,
 zoomAround:o.zoomAround,doubleClickZoom:o.doubleClickZoom,doubleClickDragZoom:o.doubleClickDragZoom,
 touchZoom:o.touchZoom,multiTouchDrag:o.multiTouchDrag==='none'?null:o.multiTouchDrag,
 trackpadGesture:o.trackpadGesture,
 keyboard:o.keyboard&&focused?{zoomSpeed:o.keyboardZoom,moveSpeed:o.keyboardMove,rotateSpeedX:o.keyboardRotateX,rotateSpeedY:o.keyboardRotateY}:false,
 inertia:o.inertia?o.inertiaTime:false,rubberBand:o.rubberBand,
 maxBounds:o.bounds?[[o.west,o.south],[o.east,o.north]]:null,
 maxBoundsPadding:{left:o.boundsPadding,right:o.boundsPadding,top:o.boundsPadding,bottom:o.boundsPadding}
}}
export function viewOptions(o){return {orthographic:o.orthographic,altitude:o.altitude,resolution:o.resolution,nearZMultiplier:o.nearZMultiplier,farZMultiplier:o.farZMultiplier,padding:{left:o.padding,right:o.padding,top:o.padding,bottom:o.padding}}}
export function limitState(s,o){return {...s,zoom:Math.max(o.minZoom,Math.min(o.maxZoom,s.zoom)),pitch:Math.max(o.minPitch,Math.min(o.maxPitch,s.pitch)),minZoom:o.minZoom,maxZoom:o.maxZoom,minPitch:o.minPitch,maxPitch:o.maxPitch}}
export function globeOwnsKey(target,key){return target?.id==='scene-canvas'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','=','_'].includes(key)}

export function featurePatch(key,enabled){if(!globeFeatures.some(f=>f.key===key))throw Error('Unknown GlobeView feature');return key==='ball'?{ball:enabled,navigation:enabled?'ball':'map'}:key==='pointerZoom'?{pointerZoom:enabled,zoomAround:enabled?'pointer':'center'}:{[key]:enabled}}
