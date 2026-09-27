import type {LngLatZ, SceneConfig, TimelineState} from './types';
import {BRIDGE_VIEW} from './camera';

export const SOURCE_FPS = 60;
export const DURATION_SECONDS = 37;
export const SOURCE_FRAME_COUNT = SOURCE_FPS * DURATION_SECONDS;
export const LAST_SOURCE_FRAME = SOURCE_FRAME_COUNT - 1;
export const MASTER_FPS = 30;
export const MASTER_FRAME_COUNT = MASTER_FPS * DURATION_SECONDS;
export const LAST_MASTER_FRAME = MASTER_FRAME_COUNT - 1;
export const HERO_ROUTE_START_PROGRESS = 0.3390666666666667;
export const HERO_ROUTE_END_PROGRESS = 0.7310666666666666;
export const VIDEO_DURATION_SECONDS = 14;
export const VIDEO_TRANSITION_SECONDS = 2;
export const BEATS = {flyInEnd: 10, videoEnd: 20, end: 37} as const;
export const VIDEO_START_SECONDS = BEATS.flyInEnd - VIDEO_TRANSITION_SECONDS;
export const VIDEO_END_SECONDS = BEATS.videoEnd + VIDEO_TRANSITION_SECONDS;
export const ROUTE_CLOCK_DURATION_SECONDS = VIDEO_DURATION_SECONDS / (HERO_ROUTE_END_PROGRESS - HERO_ROUTE_START_PROGRESS);
export const FPV_LOOK_AHEAD_METERS = 0;
export const INBOUND_SPIN_DEGREES = 360 * 16;
export const OUTBOUND_SPIN_DEGREES = INBOUND_SPIN_DEGREES;
export const APPROACH_LEAD_METERS = 100;
export const FLIGHT_TRAIL_LENGTH_MULTIPLIER = 1.4;
export const HEAT_GLOBE_CAMERA_PROGRESS = 2 / 3;

/** Clear the bridge quickly, give the HEAT globe time on screen, then collapse. */
export function outboundCameraProgress(p: number) {
  return sampleMonotoneCubic([
    [0, 0], [0.07, 0.2], [0.13, 0.4], [0.24, 0.62],
    [0.34, HEAT_GLOBE_CAMERA_PROGRESS], [0.84, HEAT_GLOBE_CAMERA_PROGRESS], [1, 1]
  ], clamp(p,0,1), true);
}

const VIDEO_CAMERA = BRIDGE_VIEW;
// One profile runs forward on entry and backward on exit. Both remain moving
// while a shared source-video clock drives the entire rolling overlap.
const INBOUND_ZOOM = [
  [0, -0.25], [0.1, 0.05], [0.24, 0.8], [0.38, 2.6], [0.5, 5.4],
  [0.59, 9.5], [0.68, 14.4], [0.75, 17.8], [0.82, 20.35],
  [0.9, 20.85], [1, VIDEO_CAMERA.zoom]
] as const;
const INBOUND_PITCH = [
  [0, 0], [0.2, 3], [0.38, 8], [0.54, 20], [0.68, 47],
  [0.76, 75], [0.84, 84], [1, VIDEO_CAMERA.pitch]
] as const;
const INBOUND_BEARING = [
  [0, 0], [0.2, 12], [0.4, 39], [0.58, 83], [0.72, 149],
  [0.83, 190], [1, VIDEO_CAMERA.bearing]
] as const;

export function videoDeckProgress(config: SceneConfig, seconds: number) {
  return clamp((seconds - config.captureReference.deckProfileTimeOffsetSeconds) / 10, 0, 1);
}

/** Continuous route motion before, throughout and after the rolling video. */
export function trackingRouteProgress(config: SceneConfig, timeSeconds: number): number {
  const track = config.captureReference.cameraTrack;
  const start = track[0][1], end = track.at(-1)![1];
  const startSpeed = (track[1][1] - start) / (track[1][0] - track[0][0]);
  const last = track.at(-2)!;
  const endSpeed = (end - last[1]) / (track.at(-1)![0] - last[0]);
  if (timeSeconds >= VIDEO_START_SECONDS && timeSeconds <= VIDEO_END_SECONDS) {
    return sampleMonotoneCubic(track, timeSeconds - VIDEO_START_SECONDS);
  }
  if (timeSeconds > VIDEO_END_SECONDS) return Math.min(1, end + endSpeed * (timeSeconds - VIDEO_END_SECONDS));
  const leadProgress = Math.min(start, APPROACH_LEAD_METERS / routeLengthMeters(config.route));
  const begin = VIDEO_START_SECONDS - 4;
  const u = rangeProgress(timeSeconds, begin, VIDEO_START_SECONDS);
  // Quintic Hermite matches the video's velocity and zero acceleration at
  // arrival. The camera never stops or changes clocks at the rolling overlap.
  return start - leadProgress + (6 * u ** 5 - 15 * u ** 4 + 10 * u ** 3) * leadProgress
    + (-3 * u ** 5 + 7 * u ** 4 - 4 * u ** 3) * 4 * startSpeed;
}

export function resolveTimeline(frameInput: number, config: SceneConfig): TimelineState {
  const frame = clamp(Math.round(frameInput), 0, LAST_SOURCE_FRAME);
  const timeSeconds = frame / SOURCE_FPS;
  const videoTimeSeconds = clamp(timeSeconds - VIDEO_START_SECONDS, 0, VIDEO_DURATION_SECONDS - 1 / SOURCE_FPS);
  const videoProgress = videoTimeSeconds / VIDEO_DURATION_SECONDS;
  const heroProgress = videoDeckProgress(config, videoTimeSeconds);
  const routeProgress = trackingRouteProgress(config, timeSeconds);
  const routeHead = bridgeFpvMapTarget(routePosition(config.route, routeProgress));
  const videoView = bridgeVideoView(config, videoProgress);
  let phase: TimelineState['phase'];
  let camera;
  let projectionBlend = 1;
  let sceneOpacity = 1;
  let viewportScale = 1;
  let videoOpacity = 1;
  let trailOpacity = 0.96;
  let trailLengthSeconds = config.trail.trailLengthSeconds;
  const flightDuration = BEATS.flyInEnd;
  if (timeSeconds < BEATS.flyInEnd) {
    const p = timeSeconds / flightDuration;
    const lock = smootherstep(rangeProgress(p, 0, 0.5));
    const landed = smootherstep(rangeProgress(p, 0.76, 1));
    phase = timeSeconds < 0.35 ? 'black-in' : 'fly-in';
    camera = cameraAt([
      routeHead[0] - INBOUND_SPIN_DEGREES * (1 - lock),
      mix(0, routeHead[1], lock), routeHead[2]
    ], sampleMonotoneCubic(INBOUND_ZOOM, p, true),
    sampleMonotoneCubic(INBOUND_PITCH, p, true) + (videoView.pitch - VIDEO_CAMERA.pitch) * landed,
    sampleMonotoneCubic(INBOUND_BEARING, p, true) + (videoView.bearing - VIDEO_CAMERA.bearing) * landed);
    projectionBlend = smootherstep(rangeProgress(p, 0.57, 0.67));
    sceneOpacity = smootherstep(rangeProgress(timeSeconds, 0.08, 0.78));
    viewportScale = mix(0.004, 1, smootherstep(rangeProgress(p, 0, 0.12)));
    videoOpacity = smootherstep(rangeProgress(timeSeconds, VIDEO_START_SECONDS, BEATS.flyInEnd));
    trailOpacity *= smootherstep(rangeProgress(p, 0.65, 0.7));
    trailLengthSeconds = mix(config.trail.approachLengthSeconds * FLIGHT_TRAIL_LENGTH_MULTIPLIER, config.trail.trailLengthSeconds,
      smootherstep(rangeProgress(camera.zoom, 17.8, 20.7)));
  } else if (timeSeconds < BEATS.videoEnd) {
    phase = 'video-focus';
    camera = cameraAt(routeHead, VIDEO_CAMERA.zoom, videoView.pitch, videoView.bearing);
  } else {
    const p = (timeSeconds - BEATS.videoEnd) / (LAST_SOURCE_FRAME / SOURCE_FPS - BEATS.videoEnd);
    const mirror = 1 - outboundCameraProgress(p);
    const release = sampleMonotoneCubic([[0,0],[0.2,0],[0.34,0.12],[0.84,0.34],[1,1]],p,true);
    const landed = smootherstep(rangeProgress(mirror, 0.76, 1));
    phase = p >= 0.94 ? 'black-out' : 'fly-out';
    camera = cameraAt([
      routeHead[0] + OUTBOUND_SPIN_DEGREES * release,
      mix(routeHead[1], 0, release), routeHead[2]
    ], sampleMonotoneCubic(INBOUND_ZOOM, mirror, true),
    sampleMonotoneCubic(INBOUND_PITCH, mirror, true) + (videoView.pitch - VIDEO_CAMERA.pitch) * landed,
    // An immediate, accelerating local orbit hands off into the super-spin.
    videoView.bearing + VIDEO_CAMERA.bearing - sampleMonotoneCubic(INBOUND_BEARING, mirror, true));
    projectionBlend = smootherstep(rangeProgress(mirror, 0.57, 0.67));
    videoOpacity = 1 - smootherstep(rangeProgress(timeSeconds, BEATS.videoEnd, VIDEO_END_SECONDS));
    trailLengthSeconds = mix(config.trail.approachLengthSeconds * FLIGHT_TRAIL_LENGTH_MULTIPLIER, config.trail.trailLengthSeconds,
      smootherstep(rangeProgress(camera.zoom, 17.8, 20.7)));
    trailOpacity *= smootherstep(rangeProgress(mirror, 0.65, 0.7));
    viewportScale = mix(0.004, 1, smootherstep(rangeProgress(mirror, 0, 0.12)));
    sceneOpacity = smootherstep(rangeProgress(BEATS.end - timeSeconds, 0.08, 0.78));
  }
  if (frame === 0 || frame === LAST_SOURCE_FRAME) sceneOpacity = videoOpacity = trailOpacity = 0;
  const skyOpacity = smootherstep(rangeProgress(camera.zoom, 16.5, 19)) * sceneOpacity;
  return {
    frame, timeSeconds, progress: frame / LAST_SOURCE_FRAME, phase, camera,
    projectionBlend, projectionVeilOpacity: 0, sceneOpacity, viewportScale,
    mapDimOpacity: 0, skyOpacity, heroOpacity: 0, heroProgress,
    routeProgress, heroResolve: 0, trailOpacity,
    trailTimeSeconds: routeProgress * ROUTE_CLOCK_DURATION_SECONDS,
    trailLengthSeconds, videoOpacity, videoScale: 1, videoProgress,
    videoTimeSeconds, compositionRouteProgress: videoProgress
  };
}

export function routeLengthMeters(route: LngLatZ[]): number {
  return route.slice(1).reduce((sum, point, index) => sum + distanceMeters(route[index], point), 0);
}

export function routePosition(route: LngLatZ[], progress: number): LngLatZ {
  const clamped = clamp(progress, 0, 1);
  const lengths = route.slice(1).map((point, index) => distanceMeters(route[index], point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = clamped * total;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      return mixPosition(route[index], route[index + 1], remaining / Math.max(lengths[index], 0.001));
    }
    remaining -= lengths[index];
  }
  return route[route.length - 1];
}

/** Smooth landmark registration follows the source's broad pan, not handheld shake. */
export function bridgeVideoView(config: SceneConfig, progress: number) {
  const seconds = clamp(progress, 0, 1) * config.captureReference.calibrationDurationSeconds;
  return {
    zoom: VIDEO_CAMERA.zoom,
    pitch: sampleMonotoneCubic(config.captureReference.viewTrack.map(([t, p]) => [t, p]), seconds),
    bearing: sampleMonotoneCubic(config.captureReference.viewTrack.map(([t, , b]) => [t, b]), seconds)
  };
}

export function bridgeFpvMapTarget(position: LngLatZ): LngLatZ {
  const bearingRadians = VIDEO_CAMERA.bearing * Math.PI / 180;
  const eastMeters = Math.sin(bearingRadians) * FPV_LOOK_AHEAD_METERS;
  const northMeters = Math.cos(bearingRadians) * FPV_LOOK_AHEAD_METERS;
  return [
    position[0] + eastMeters / (111_320 * Math.cos(position[1] * Math.PI / 180)),
    position[1] + northMeters / 110_540,
    position[2]
  ];
}

export function routeBearing(route: LngLatZ[], progress: number): number {
  const index = clamp(Math.floor(clamp(progress, 0, 0.999999) * (route.length - 1)), 0, route.length - 2);
  const [lngA, latA] = route[index];
  const [lngB, latB] = route[index + 1];
  const east = (lngB - lngA) * Math.cos(((latA + latB) * Math.PI) / 360);
  const north = latB - latA;
  return (Math.atan2(east, north) * 180) / Math.PI;
}

export function headOnBearing(config: SceneConfig, progress: number): number {
  return normalizeSignedDegrees(routeBearing(config.route, progress) + config.runner.headingOffsetDegrees + 180);
}

export function normalizeSignedDegrees(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function sampleMonotoneCubic(points: readonly (readonly [number, number])[], progress: number, restEndpoints = false): number {
  if (progress <= points[0][0]) return points[0][1];
  if (progress >= points[points.length - 1][0]) return points[points.length - 1][1];
  const endIndex = points.findIndex(point => progress <= point[0]);
  const startIndex = Math.max(0, endIndex - 1);
  const [x0, y0] = points[startIndex];
  const [x1, y1] = points[endIndex];
  const tangents = monotoneTangents(points);
  // Camera curves come to rest at the plate. Route/landmark tracks retain their
  // measured endpoint velocity; do not ease every interpolation indiscriminately.
  if (restEndpoints) { tangents[0] = 0; tangents[tangents.length - 1] = 0; }
  const span = Math.max(x1 - x0, 0.000001);
  const t = clamp((progress - x0) / span, 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * span * tangents[startIndex]
    + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * span * tangents[endIndex];
}

function monotoneTangents(points: readonly (readonly [number, number])[]): number[] {
  const slopes = points.slice(1).map((point, index) =>
    (point[1] - points[index][1]) / Math.max(point[0] - points[index][0], 0.000001)
  );
  return points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[slopes.length - 1];
    const left = slopes[index - 1];
    const right = slopes[index];
    if (left === 0 || right === 0 || Math.sign(left) !== Math.sign(right)) return 0;
    return (2 * left * right) / (left + right);
  });
}

function cameraAt(position: LngLatZ, zoom: number, pitch: number, bearing: number) {
  return {longitude: position[0], latitude: position[1], zoom, pitch, bearing};
}

function distanceMeters(a: LngLatZ, b: LngLatZ): number {
  const lat = ((a[1] + b[1]) * Math.PI) / 360;
  return Math.hypot((b[0] - a[0]) * 111_320 * Math.cos(lat), (b[1] - a[1]) * 110_540, b[2] - a[2]);
}

function mixPosition(a: LngLatZ, b: LngLatZ, amount: number): LngLatZ {
  return [mix(a[0], b[0], amount), mix(a[1], b[1], amount), mix(a[2], b[2], amount)];
}

function rangeProgress(value: number, start: number, end: number): number {
  return clamp((value - start) / Math.max(end - start, 0.000001), 0, 1);
}

function smootherstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
