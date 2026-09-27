import type {SceneConfig, TimelineState} from './types';
import {sampleMonotoneCubic, ROUTE_CLOCK_DURATION_SECONDS, videoDeckProgress} from './timeline';

export interface Footfall {seconds: number; sourceFrame: number; foot: 'left' | 'right'; x: number; y: number; confidence: number}
export interface GaitAnalysis {
  sourceSha256?: string;
  sourceWidth: number; sourceHeight: number; fps: number; maskFrameCount: number;
  maskDirectory: string; events: Footfall[];
}
export const FOOT_STAMP_RETENTION_SECONDS = 1.15;
export const STEP_TRAIL_WIDTH_METERS = .2;
export const STEP_TRAIL_PEAK_OPACITY = .82;
// Reviewed against the original 1920x1080 shoe-contact crops (v030d).
// Values are source-image sole pixels, not GPS. Motion blur still makes these
// estimates; cropped/unobservable contacts are deliberately not synthesized.
const SOLE_SOURCE_SHA256 = 'c615e8c7eedae264dd034153a4755c23b03234691cc58d46d60e2da7e83b1eaa';
export const REVIEWED_SOLE_PIXELS: ReadonlyArray<readonly [number, number, number]> = [
  [129, 550, 1052], [138, 569, 910], [147, 653, 900], [155, 565, 874],
  [163, 500, 998], [171, 554, 984], [179, 600, 1062], [187, 640, 992],
  [195, 646, 1016], [219, 625, 1072], [227, 640, 1060], [235, 616, 1058],
  [243, 615, 1074], [250, 554, 1038], [260, 609, 1074], [268, 605, 978],
  [276, 615, 928], [284, 498, 904], [291, 546, 942], [300, 596, 960],
  [309, 696, 982], [317, 663, 988], [325, 633, 1044], [333, 620, 1030],
  [341, 611, 1032], [350, 671, 1032], [358, 670, 1046], [367, 708, 1062],
  [374, 716, 1056], [383, 745, 1034], [392, 780, 1056], [401, 806, 1048],
  [409, 853, 1042]
];
const solePixels = new Map(REVIEWED_SOLE_PIXELS.map(([frame, x, y]) => [frame, [x, y] as const]));
export function footContacts(gait: GaitAnalysis): Footfall[] {
  if (gait.sourceSha256 !== SOLE_SOURCE_SHA256) return gait.events;
  return gait.events.flatMap(event => {
    const sole = solePixels.get(event.sourceFrame);
    return sole ? [{...event, x: sole[0] / gait.sourceWidth, y: sole[1] / gait.sourceHeight}] : [];
  });
}
export function coverGeometry(gait: GaitAnalysis, width: number, height: number) {
  const scale = Math.max(width / gait.sourceWidth, height / gait.sourceHeight);
  return {width: gait.sourceWidth * scale, height: gait.sourceHeight * scale};
}

/** Fast foot-strike reveal followed by a steady fade, never an opacity hold. */
export function footfallStamps(scene: SceneConfig, state: TimelineState) {
  const gait = scene.captureReference.gait;
  if (!gait || state.videoOpacity <= 0) return [];
  return footContacts(gait).filter(event => event.seconds <= state.videoTimeSeconds &&
    state.videoTimeSeconds - event.seconds < FOOT_STAMP_RETENTION_SECONDS).map(event => {
    const age = state.videoTimeSeconds - event.seconds;
    const routeProgress = sampleMonotoneCubic(scene.captureReference.cameraTrack, event.seconds);
    const growth = Math.min(1, age / .16);
    const entrance = smooth(age / .025);
    const retirement = Math.max(0, 1 - age / FOOT_STAMP_RETENTION_SECONDS);
    return {event, age, lifetime: FOOT_STAMP_RETENTION_SECONDS,
      opacity: STEP_TRAIL_PEAK_OPACITY * entrance * retirement, state: {...state,
      heroProgress: videoDeckProgress(scene, event.seconds),
      videoProgress: event.seconds / scene.captureReference.calibrationDurationSeconds,
      videoTimeSeconds: event.seconds, routeProgress,
      trailTimeSeconds: routeProgress * ROUTE_CLOCK_DURATION_SECONDS,
      trailLengthSeconds: Math.max(0.001, scene.trail.trailLengthSeconds * growth * growth * (3 - 2 * growth))
    } as TimelineState};
  });
}
function smooth(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}
export function footfallPulse(scene: SceneConfig, state: TimelineState) {
  return footfallStamps(scene, state).at(-1) ?? null;
}
export function gaitMask(scene: SceneConfig, state: TimelineState) {
  const gait = scene.captureReference.gait;
  if (!gait || state.videoOpacity <= 0.001) return null;
  const frame = Math.max(0, Math.min(gait.maskFrameCount - 1, Math.floor(state.videoTimeSeconds * gait.fps + 1e-5)));
  const directory = gait.sourceSha256 === SOLE_SOURCE_SHA256 ? '/analysis/bridge-occlusion' : gait.maskDirectory;
  return {frame, url: `${directory}/mask-${String(frame).padStart(5, '0')}.png`};
}
