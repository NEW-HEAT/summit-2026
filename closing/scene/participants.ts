import {PathLayer, PointCloudLayer} from '@deck.gl/layers';
import type {BiometricSample, LngLatZ, SceneConfig, TimelineState} from './types';
import {createProceduralRunnerPoints} from './runner';
import {resolveFootAnchor} from './trail';
import {routeBearing} from './timeline';
import {roadHeightAt} from './surface';
import {bridgeDeckHeight} from './camera';

type Vec3 = [number, number, number];
/** Deliberately stylized placeholders, never presented as captured identities. */
export function flightParticipants(scene: SceneConfig, state: TimelineState, biometric: BiometricSample, width: number, height: number) {
  const amount = Math.max(0, Math.min(1, (state.camera.zoom - 14.5) / 3));
  // Never fly through a placeholder cyclist or put a synthetic face over the
  // real plate. Keep the proxies in the wide bridge shot, then hand off early.
  const close = Math.max(0, Math.min(1, (state.camera.zoom - 18.3) / 1.4));
  const opacity = amount * amount * (3 - 2 * amount) * (1 - close * close * (3 - 2 * close)) * (1 - state.videoOpacity) * .8;
  if (opacity < 0.002) return [];
  const {anchor, routeHead} = resolveFootAnchor(scene, state, width, height);
  const bearing = routeBearing(scene.route, state.routeProgress);
  const radians = bearing * Math.PI / 180;
  const world = (p: Vec3, origin: LngLatZ): LngLatZ => [
    origin[0] + (p[0] * Math.cos(radians) + p[1] * Math.sin(radians)) / (111320 * Math.cos(origin[1] * Math.PI / 180)),
    origin[1] + (-p[0] * Math.sin(radians) + p[1] * Math.cos(radians)) / 110540,
    origin[2] + p[2]
  ];
  const runnerScene = {...scene, route: [anchor, world([0, 1, 0], anchor)], runner: {...scene.runner,
    groundAltitudeMeters: 0, altitudeOffsetMeters: 0, pointCount: 1100, scale: 1}};
  const points = createProceduralRunnerPoints(runnerScene, {...state, routeProgress: 0, heroOpacity: 1}, biometric)
    .map(point => ({...point, color: (point.position[2] - anchor[2] > 0.95 ? [244, 233, 213, Math.round(255 * opacity)] : [154, 151, 142, Math.round(255 * opacity)]) as [number, number, number, number]}));
  const cyclistOrigin: LngLatZ = [routeHead[0], routeHead[1], roadHeightAt(routeHead, bridgeDeckHeight(state.heroProgress)) ?? anchor[2]];
  const cycle: Vec3[][] = [];
  for (const y of [-0.56, 0.56]) cycle.push(Array.from({length: 33}, (_, i) => [0, y + Math.cos(i / 32 * Math.PI * 2) * 0.34, 0.35 + Math.sin(i / 32 * Math.PI * 2) * 0.34]));
  cycle.push([[0, -.56, .35], [0, -.2, .78], [0, .15, .35], [0, -.56, .35]],
    [[0, -.2, .78], [0, .4, .82], [0, .56, .35], [0, .15, .35], [0, -.2, .78]],
    [[0, .4, .82], [0, .36, 1.05], [0, .56, 1.05]]);
  const gait = state.timeSeconds * Math.PI * 3;
  for (const side of [-1, 1]) {
    const phase = gait + (side === 1 ? Math.PI : 0);
    cycle.push([[side * .12, -.22, 1.04], [side * .13, .05 + .15 * Math.sin(phase), .78], [side * .13, .12 + .15 * Math.sin(phase), .39 + .15 * Math.cos(phase)]]);
    cycle.push([[side * .2, .04, 1.5], [side * .22, .29, 1.18], [side * .22, .5, 1.06]]);
  }
  cycle.push([[0, -.22, 1.04], [0, .04, 1.5], [0, .15, 1.65]]);
  cycle.push(Array.from({length: 25}, (_, i): Vec3 => [Math.cos(i / 24 * Math.PI * 2) * .11, .15, 1.72 + Math.sin(i / 24 * Math.PI * 2) * .12]));
  return [new PointCloudLayer({id: 'flight-charles-stylized-proxy', data: points,
    getPosition: p => p.position, getNormal: p => p.normal, getColor: p => p.color,
    pointSize: 1.2, pickable: false}),
  new PathLayer({id: 'flight-jack-cyclist-proxy', data: cycle.map(path => path.map(p => world(p, cyclistOrigin))),
    getPath: path => path, getColor: [229, 170, 119, Math.round(255 * opacity)],
    getWidth: .035, widthUnits: 'meters', widthMinPixels: 1, widthMaxPixels: 8,
    capRounded: true, jointRounded: true, billboard: false, pickable: false})];
}
