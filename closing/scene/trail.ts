import {WebMercatorViewport} from '@deck.gl/core';
import {bridgeDeckHeight, resolveBridgeRenderCamera} from './camera';
import {bridgeVideoView, routePosition, sampleMonotoneCubic, ROUTE_CLOCK_DURATION_SECONDS} from './timeline';
import {roadHeightAt, bridgeSurfaceRevision} from './surface';
import type {LngLatZ, SceneConfig, TimelineState} from './types';
import {coverGeometry, footfallPulse, footfallStamps, STEP_TRAIL_WIDTH_METERS} from './gait';
import cameraShake from '../registration/camera-shake.json';
import laneLock from '../registration/lane-lock.json';

type SolePlane = {anchor: LngLatZ; screenAnchor: number[]; routeHead: LngLatZ; grade: number; direction: number[]};
const solePlanes = new WeakMap<SceneConfig, {revision: number; planes: Map<string, SolePlane>}>();
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function projectRegistration(matrix: number[], point: number[]) {
  const w = matrix[6] * point[0] + matrix[7] * point[1] + matrix[8];
  return [(matrix[0] * point[0] + matrix[1] * point[1] + matrix[2]) / w,
    (matrix[3] * point[0] + matrix[4] * point[1] + matrix[5]) / w];
}

/** A four-corner plane map keeps width and rounded caps attached to the same surface. */
export function fitRegistration(from: number[][], to: number[][]) {
  const equations = from.flatMap(([x, y], i) => {
    const [u, v] = to[i];
    return [[x, y, 1, 0, 0, 0, -u*x, -u*y, u], [0, 0, 0, x, y, 1, -v*x, -v*y, v]];
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(equations[row][col]) > Math.abs(equations[pivot][col])) pivot = row;
    if (Math.abs(equations[pivot][col]) < 1e-10) return [...IDENTITY];
    [equations[col], equations[pivot]] = [equations[pivot], equations[col]];
    const divisor = equations[col][col];
    equations[col] = equations[col].map(v => v / divisor);
    for (let row = 0; row < 8; row++) if (row !== col) {
      const factor = equations[row][col];
      equations[row] = equations[row].map((v, i) => v - factor * equations[col][i]);
    }
  }
  const result = [...equations.map(row => row[8]), 1];
  return result.every(Number.isFinite) ? result : [...IDENTITY];
}

export function roadMotionBetween(scene: SceneConfig, start: number, end: number) {
  if (scene.captureReference.gait?.sourceSha256 !== cameraShake.sourceSha256 || start === end) return [...IDENTITY];
  const a = cameraShake.matrices[Math.max(0, Math.min(419, start))];
  const b = cameraShake.matrices[Math.max(0, Math.min(419, end))];
  const corners = [[0, 0], [1920, 0], [0, 1080], [1920, 1080]];
  return fitRegistration(corners.map(p => projectRegistration(a, p)), corners.map(p => projectRegistration(b, p)));
}

function stepRegistration(scene: SceneConfig, state: TimelineState, contact: TimelineState, width: number, height: number, sourceFoot: [number, number]) {
  if (scene.captureReference.gait?.sourceSha256 !== cameraShake.sourceSha256) return [...IDENTITY];
  const first = Math.max(0, Math.min(419, Math.round(contact.videoTimeSeconds * 30)));
  const last = Math.max(0, Math.min(419, Math.floor(state.videoTimeSeconds * 30 + 1e-5)));
  const {anchor, grade, direction} = resolveFootAnchor(scene, contact, width, height, sourceFoot);
  const offset = (along: number, across: number): LngLatZ => [
    anchor[0] + (direction[0]*along - direction[1]*across) / (111320*Math.cos(anchor[1]*Math.PI/180)),
    anchor[1] + (direction[1]*along + direction[0]*across) / 110540, anchor[2] + along*grade];
  const quad = [anchor, offset(-2, 0), offset(0, .5), offset(-2, .5)];
  const makeViewport = (s: TimelineState, landed: boolean) => {
    const head = routePosition(scene.route, s.routeProgress);
    const view = landed ? {longitude: head[0], latitude: head[1], ...bridgeVideoView(scene, s.videoProgress)} : s.camera;
    const camera = resolveBridgeRenderCamera(view, s.heroProgress, width, height);
    return new WebMercatorViewport({...camera.viewState, fovy: camera.fovy, width, height});
  };
  const now = makeViewport(state, false), then = makeViewport(contact, true);
  const cover = coverGeometry(scene.captureReference.gait!, width, height);
  const toSource = (p: number[]) => [(p[0] + (cover.width-width)/2) * 1920/cover.width,
    (p[1] + (cover.height-height)/2) * 1080/cover.height];
  const toNdc = (p: number[]) => [(p[0]*cover.width/1920-(cover.width-width)/2)/width*2-1,
    1-(p[1]*cover.height/1080-(cover.height-height)/2)/height*2];
  const reference = quad.map(p => toSource(then.project(p)));
  const current = quad.map(p => toSource(now.project(p)));
  const oldLine = laneLock.rows[first], line = laneLock.rows[last];
  const shake = roadMotionBetween(scene, first, last);
  // The filmed pass stays beside the same lane. Do not inherit the approximate
  // map camera's growing cross-road scale as old marks move toward the edge.
  const scale = 1;
  const soleDistance = reference[0][1] - oldLine.slope*reference[0][0] - oldLine.intercept;
  const crossDistance = reference[2][1]-reference[0][1] - oldLine.slope*(reference[2][0]-reference[0][0]);
  const target = current.map((p, i) => {
    const x = projectRegistration(shake, p)[0];
    return [x, line.slope*x + line.intercept + (soleDistance + (i >= 2 ? crossDistance : 0))*scale];
  });
  const matrix = fitRegistration(current.map(toNdc), target.map(toNdc));
  const weight = state.videoOpacity ** 2;
  return matrix.map((v, i) => IDENTITY[i] + (v-IDENTITY[i])*weight);
}

/** The plate is not a reconstruction. These authored contact guides register its feet to the road. */
export function resolveFootAnchor(scene: SceneConfig, state: TimelineState, width: number, height: number, sourceFoot?: [number, number]) {
  const revision = bridgeSurfaceRevision();
  let cache = solePlanes.get(scene);
  if (!cache || cache.revision !== revision) {
    cache = {revision, planes: new Map()};
    solePlanes.set(scene, cache);
  }
  const key = sourceFoot ? [state.videoTimeSeconds, width, height, ...sourceFoot].join(':') : null;
  if (key && cache.planes.has(key)) return cache.planes.get(key)!;
  const seconds = state.videoTimeSeconds;
  const track = scene.captureReference.footAnchorTrack;
  let x = sampleMonotoneCubic(track.map(([t, x]) => [t, x]), seconds);
  let y = sampleMonotoneCubic(track.map(([t, , y]) => [t, y]), seconds);
  if (sourceFoot && scene.captureReference.gait) {
    const cover = coverGeometry(scene.captureReference.gait, width, height);
    x = (sourceFoot[0] * cover.width - (cover.width - width) / 2) / width;
    y = (sourceFoot[1] * cover.height - (cover.height - height) / 2) / height;
  }
  const routeHead = routePosition(scene.route, state.routeProgress);
  // Solve in the landed camera even during the dive/outro. This locks the trail
  // geographically instead of letting its tip follow the flying camera in screen space.
  const camera = resolveBridgeRenderCamera({
    longitude: routeHead[0], latitude: routeHead[1], ...bridgeVideoView(scene, state.videoProgress)
  }, state.heroProgress, width, height);
  const viewport = new WebMercatorViewport({...camera.viewState, fovy: camera.fovy, width, height});
  const expectedHeight = bridgeDeckHeight(state.heroProgress);
  let ground = viewport.unproject([x * width, y * height], {targetZ: expectedHeight});
  for (let i = 0; i < 3; i++) {
    const groundHeight = roadHeightAt(ground, expectedHeight);
    if (groundHeight === null) break;
    ground = viewport.unproject([x * width, y * height], {targetZ: groundHeight});
  }
  const [east, north] = scene.trail.companionOffsetMeters;
  const anchor: LngLatZ = [
    ground[0] + east / (111320 * Math.cos(ground[1] * Math.PI / 180)),
    ground[1] + north / 110540,
    ground[2]
  ];
  const first = scene.route[0], last = scene.route.at(-1)!;
  const routeEast = (last[0] - first[0]) * 111320 * Math.cos(anchor[1] * Math.PI / 180);
  const routeNorth = (last[1] - first[1]) * 110540;
  const length = Math.hypot(routeEast, routeNorth) || 1;
  const direction = [routeEast / length, routeNorth / length];
  let grade = 0;
  if (sourceFoot) {
    const probe = (meters: number) => roadHeightAt([
      anchor[0] + direction[0] * meters / (111320 * Math.cos(anchor[1] * Math.PI / 180)),
      anchor[1] + direction[1] * meters / 110540
    ], expectedHeight);
    const behind = probe(-.75), ahead = probe(.75);
    // Fit the short roadway plane, not individual coarse mesh bumps. Keep its
    // origin exactly on the sole and reject railing-scale slope outliers.
    if (behind !== null && ahead !== null) grade = Math.max(-.035, Math.min(.035, (ahead - behind) / 1.5));
  }
  const result = {anchor, screenAnchor: [x, y], routeHead, grade, direction};
  if (key) cache.planes.set(key, result);
  return result;
}

export function footRegisteredTrip(scene: SceneConfig, state: TimelineState, width: number, height: number) {
  const pulse = footfallPulse(scene, state);
  const trip = groundTrip(scene, pulse?.state ?? state, width, height,
    pulse ? [pulse.event.x, pulse.event.y] : undefined);
  return {...trip, pulse, currentTime: pulse?.state.trailTimeSeconds ?? state.trailTimeSeconds,
    trailLength: pulse?.state.trailLengthSeconds ?? state.trailLengthSeconds};
}

export function footRegisteredTrips(scene: SceneConfig, state: TimelineState, width: number, height: number) {
  const trips = [];
  if (state.videoOpacity < 1) {
    const trip = groundTrip(scene, state, width, height);
    trips.push({...trip, kind: 'flight', sourceFrame: -1, registration: [...IDENTITY], opacity: (1 - state.videoOpacity) ** 2,
      width: scene.trail.widthMeters + 2.66 * (1 - smooth((state.camera.zoom - 17) / 3.5)),
      timestamps: trip.timestamps.map((_, i, list) => i / (list.length - 1) - 1)});
  }
  for (const stamp of footfallStamps(scene, state)) {
    const trip = groundTrip(scene, stamp.state, width, height, [stamp.event.x, stamp.event.y]);
    trips.push({...trip, kind: 'step', sourceFrame: stamp.event.sourceFrame,
      registration: stepRegistration(scene, state, stamp.state, width, height, [stamp.event.x, stamp.event.y]),
      opacity: state.videoOpacity * stamp.opacity, width: STEP_TRAIL_WIDTH_METERS,
      timestamps: trip.timestamps.map((_, i, list) => i / (list.length - 1) - 1)});
  }
  return trips;
}

function groundTrip(scene: SceneConfig, state: TimelineState, width: number, height: number, sourceFoot?: [number, number]) {
  const {anchor: footAnchor, routeHead, grade, direction} = resolveFootAnchor(scene, state, width, height, sourceFoot);
  const registration = sourceFoot ? 1 : smooth((state.camera.zoom - 18) / 2.5);
  const anchor = footAnchor.map((value, index) => routeHead[index] + (value - routeHead[index]) * registration) as LngLatZ;
  const begin = state.routeProgress - state.trailLengthSeconds / ROUTE_CLOCK_DURATION_SECONDS;
  const steps = Math.max(8, Math.ceil(state.trailLengthSeconds * 14));
  const path: LngLatZ[] = [], timestamps: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const progress = begin + (state.routeProgress - begin) * i / steps;
    const position = routePositionExtended(scene.route, progress);
    position[0] += anchor[0] - routeHead[0];
    position[1] += anchor[1] - routeHead[1];
    const along = (position[0] - footAnchor[0]) * 111320 * Math.cos(footAnchor[1] * Math.PI / 180) * direction[0]
      + (position[1] - footAnchor[1]) * 110540 * direction[1];
    // No lift: the locally fitted road plane pivots around the exact sole.
    position[2] = sourceFoot ? footAnchor[2] + along * grade
      : (roadHeightAt(position, bridgeDeckHeight(state.heroProgress)) ?? footAnchor[2]) + 0.035;
    if (sourceFoot && i === steps) position.splice(0, 3, ...footAnchor);
    path.push(position);
    timestamps.push(progress * ROUTE_CLOCK_DURATION_SECONDS);
  }
  return {path, timestamps};
}

// The lead-up follows the existing straight bridge-road alignment beyond the
// clipped sprint route. No additional private location data is manufactured.
function routePositionExtended(route: LngLatZ[], progress: number): LngLatZ {
  if (progress >= 0 && progress <= 1) return routePosition(route, progress);
  const a = route[0], b = route.at(-1)!;
  return a.map((value, index) => value + (b[index] - value) * progress) as LngLatZ;
}
function smooth(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}
