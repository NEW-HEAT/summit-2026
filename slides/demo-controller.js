import {_GlobeController} from '@deck.gl/core';
// Scroll always zooms; native pinch still uses mjolnir and GlobeController.
// Trackpad-scroll multipan is disabled so one stream cannot both pan and zoom.
export class DemoGlobeController extends _GlobeController {
 _isTrackpadGestureAllowed(){return true}
 _onWheel(event){
  // A trackpad pinch also emits wheel; let the native pinch path own it once.
  if(event.srcEvent.ctrlKey&&event.device==='trackpad')return false;
  return super._onWheel(event);
 }
}
