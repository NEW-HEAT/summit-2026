export function stagePoint(event,rect){return {x:(event.clientX-rect.left)*1280/rect.width,y:(event.clientY-rect.top)*720/rect.height}}
export function isPageZoomKey(e){return (e.ctrlKey||e.metaKey)&&['+','-','=','_'].includes(e.key)}
export function pointRecord(event,rect){return {...stagePoint(event,rect),id:event.pointerId,type:event.pointerType||'mouse',buttons:event.buttons,pressure:event.pressure,event:event.type}}
export class InputModel {
 constructor(){this.points=new Map()}
 record(event,rect,time){
  const point={...pointRecord(event,rect),time};
  if(event.type==='pointercancel'||(event.type==='pointerleave'&&!event.buttons))this.points.delete(point.id);
  else this.points.set(point.id,point);
  return point;
 }
 visible(time){for(const [id,p] of this.points)if(time-p.time>1200&&!p.buttons)this.points.delete(id);return [...this.points.values()]}
 clear(){this.points.clear()}
}
