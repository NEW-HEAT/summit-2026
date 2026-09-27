import {biometricHeat} from './biometrics';
import {routeBearing, routePosition} from './timeline';
import type {
  BiometricSample,
  LngLatZ,
  RunnerConfig,
  RunnerPoint,
  SceneConfig,
  TimelineState
} from './types';

type Vec3 = [number, number, number];
type Segment = {a: Vec3; b: Vec3; radius: number; colorBand: number};

export function createProceduralRunnerPoints(
  scene: SceneConfig,
  state: TimelineState,
  biometric: BiometricSample
): RunnerPoint[] {
  const config = scene.runner;
  const runnerPosition = routePosition(scene.route, state.routeProgress);
  const bearing = routeBearing(scene.route, state.routeProgress) + config.headingOffsetDegrees;
  const gait =
    state.timeSeconds * (biometric.cadenceSpm / 60) * Math.PI * 2;
  const segments = createSkeleton(gait, config.scale);
  const heat = biometricHeat(biometric);
  const count = Math.max(64, Math.round(config.pointCount));
  const points: RunnerPoint[] = [];

  for (let index = 0; index < count; index += 1) {
    const part = segments[Math.floor(hash(index, 11) * segments.length) % segments.length];
    const along = hash(index, 23);
    const angle = hash(index, 37) * Math.PI * 2;
    const radius = Math.sqrt(hash(index, 53)) * part.radius;
    const center = mixVec(part.a, part.b, along);
    const local: Vec3 = [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius * 0.68,
      center[2] + (hash(index, 71) - 0.5) * part.radius * 0.55
    ];
    const position = localToLngLat(
      local,
      runnerPosition,
      bearing,
      config
    );
    const glow = Math.max(0, Math.min(1, heat * 0.75 + part.colorBand * 0.25));
    points.push({
      position,
      normal: [0, 0, 1],
      color: heatColor(glow, state.heroOpacity),
      revealOrder: hash(index, 101)
    });
  }
  return points;
}

function createSkeleton(gait: number, scale: number): Segment[] {
  const stride = Math.sin(gait);
  const counter = Math.sin(gait + Math.PI);
  const liftLeft = Math.max(0, Math.sin(gait + Math.PI / 2));
  const liftRight = Math.max(0, Math.sin(gait + (Math.PI * 3) / 2));
  const hipLeft: Vec3 = [-0.13 * scale, 0, 0.98 * scale];
  const hipRight: Vec3 = [0.13 * scale, 0, 0.98 * scale];
  const shoulderLeft: Vec3 = [-0.27 * scale, 0.02 * scale, 1.5 * scale];
  const shoulderRight: Vec3 = [0.27 * scale, 0.02 * scale, 1.5 * scale];
  const kneeLeft: Vec3 = [-0.12 * scale, 0.28 * stride * scale, (0.56 + 0.18 * liftLeft) * scale];
  const kneeRight: Vec3 = [0.12 * scale, 0.28 * counter * scale, (0.56 + 0.18 * liftRight) * scale];
  const footLeft: Vec3 = [-0.11 * scale, (0.52 * stride + 0.14) * scale, (0.06 + 0.22 * liftLeft) * scale];
  const footRight: Vec3 = [0.11 * scale, (0.52 * counter + 0.14) * scale, (0.06 + 0.22 * liftRight) * scale];
  const elbowLeft: Vec3 = [-0.36 * scale, -0.24 * stride * scale, 1.18 * scale];
  const elbowRight: Vec3 = [0.36 * scale, -0.24 * counter * scale, 1.18 * scale];
  const handLeft: Vec3 = [-0.28 * scale, -0.48 * stride * scale, 0.98 * scale];
  const handRight: Vec3 = [0.28 * scale, -0.48 * counter * scale, 0.98 * scale];
  return [
    {a: [-0.17 * scale, 0, 0.96 * scale], b: [-0.21 * scale, 0.02 * scale, 1.5 * scale], radius: 0.16 * scale, colorBand: 0.85},
    {a: [0.17 * scale, 0, 0.96 * scale], b: [0.21 * scale, 0.02 * scale, 1.5 * scale], radius: 0.16 * scale, colorBand: 0.82},
    {a: [0, 0, 1.47 * scale], b: [0, 0, 1.72 * scale], radius: 0.08 * scale, colorBand: 0.92},
    {a: [0, 0, 1.72 * scale], b: [0, -0.01 * scale, 1.84 * scale], radius: 0.13 * scale, colorBand: 1},
    {a: hipLeft, b: kneeLeft, radius: 0.09 * scale, colorBand: 0.62},
    {a: kneeLeft, b: footLeft, radius: 0.075 * scale, colorBand: 0.48},
    {a: hipRight, b: kneeRight, radius: 0.09 * scale, colorBand: 0.64},
    {a: kneeRight, b: footRight, radius: 0.075 * scale, colorBand: 0.5},
    {a: shoulderLeft, b: elbowLeft, radius: 0.07 * scale, colorBand: 0.72},
    {a: elbowLeft, b: handLeft, radius: 0.06 * scale, colorBand: 0.56},
    {a: shoulderRight, b: elbowRight, radius: 0.07 * scale, colorBand: 0.74},
    {a: elbowRight, b: handRight, radius: 0.06 * scale, colorBand: 0.58}
  ];
}

function localToLngLat(
  local: Vec3,
  anchor: LngLatZ,
  bearingDegrees: number,
  config: RunnerConfig
): LngLatZ {
  const radians = (bearingDegrees * Math.PI) / 180;
  const east = local[1] * Math.sin(radians) + local[0] * Math.cos(radians);
  const north = local[1] * Math.cos(radians) - local[0] * Math.sin(radians);
  const longitude = anchor[0] + east / (111_320 * Math.cos((anchor[1] * Math.PI) / 180));
  const latitude = anchor[1] + north / 110_540;
  return [
    longitude,
    latitude,
    anchor[2] + config.groundAltitudeMeters + config.altitudeOffsetMeters + local[2]
  ];
}

function heatColor(heat: number, opacity: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, heat));
  return [
    255,
    Math.round(46 + 190 * Math.pow(t, 1.7)),
    Math.round(18 + 185 * Math.pow(t, 3)),
    Math.round(255 * opacity)
  ];
}

function mixVec(a: Vec3, b: Vec3, amount: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount
  ];
}

function hash(index: number, seed: number): number {
  const x = Math.sin(index * 12.9898 + seed * 78.233) * 43_758.5453;
  return x - Math.floor(x);
}
