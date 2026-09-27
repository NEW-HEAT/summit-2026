import {
  HEIGHT,
  WIDTH,
} from "./calendar-model";
import {
  CONTRIBUTION_FOCUS_SECTION_COUNT,
  CONTRIBUTION_FOCUS_TRANSITION_FRACTION,
} from "./globe-focus-model";
import {
  CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX,
  CLIP_02_ORLANDO_HANDOFF_VIEW_STATE,
} from "./globe-camera-model";

export const CONTRIBUTION_GLOBE_LAYOUT = {
  x: 0,
  y: 0,
  width: WIDTH,
  height: HEIGHT,
  zoom: CLIP_02_ORLANDO_HANDOFF_VIEW_STATE.zoom,
  targetGlobeHeightRatio: CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX / HEIGHT,
  meshResolutionDegrees: 0.25,
  // Retired atlas dimensions remain as compatibility metadata; the active scene
  // does not construct, fetch, or render any atlas or BitmapLayer.
  earthAtlasColumns: 8,
  earthAtlasRows: 4,
  focusSectionCount: CONTRIBUTION_FOCUS_SECTION_COUNT,
  focusTransitionFraction: CONTRIBUTION_FOCUS_TRANSITION_FRACTION,
} as const;
