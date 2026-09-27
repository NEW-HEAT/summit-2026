import type {BiometricSample, SceneConfig} from './types';

export const GOOGLE_3D_TILES_ROOT =
  'https://tile.googleapis.com/v1/3dtiles/root.json';

export interface GoogleTilesAccess {
  rootUrl: string;
  apiKey: string;
}

export function validateSceneConfig(input: unknown): SceneConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('scene config must be an object');
  }
  const config = input as SceneConfig;
  if (config.schemaVersion !== 1) throw new Error('scene config schemaVersion must be 1');
  if (config.sourceFps !== 60) throw new Error('closing scene sourceFps must be 60');
  if (config.durationSeconds !== 37) throw new Error('closing scene durationSeconds must be 37');
  if (!config.target || !finite(config.target.longitude) || !finite(config.target.latitude)) {
    throw new Error('target longitude and latitude are required');
  }
  if (Math.abs(config.target.longitude) > 180 || Math.abs(config.target.latitude) > 85) {
    throw new Error('target is outside the supported globe range');
  }
  if (!Array.isArray(config.route) || config.route.length < 2) {
    throw new Error('route must contain at least two [longitude, latitude, altitude] points');
  }
  for (const point of config.route) {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(finite)) {
      throw new Error('route points must be finite [longitude, latitude, altitude] tuples');
    }
  }
  if (config.runner.representation !== 'procedural-point-cloud') {
    throw new Error('closing bridge participants require procedural-point-cloud');
  }
  if (!config.trail || !finite(config.trail.widthMeters) || config.trail.widthMeters <= 0 ||
      !finite(config.trail.trailLengthSeconds) || config.trail.trailLengthSeconds <= 0 ||
      !finite(config.trail.approachLengthSeconds) || config.trail.approachLengthSeconds < config.trail.trailLengthSeconds ||
      !Array.isArray(config.trail.companionOffsetMeters) || config.trail.companionOffsetMeters.length !== 2 ||
      !config.trail.companionOffsetMeters.every(finite)) {
    throw new Error('trail requires a positive close tail, longer approach tail and a finite ground offset');
  }
  if (
    !config.captureReference ||
    config.captureReference.role !== 'source-for-future-3d-reconstruction' ||
    !config.captureReference.mediaPath ||
    !config.captureReference.normalizedRoutePath ||
    !config.captureReference.compositionRoutePath ||
    !Array.isArray(config.captureReference.participants) ||
    config.captureReference.participants.length !== 2 ||
    !finite(config.captureReference.durationSeconds)
  ) {
    throw new Error('captureReference must register the normalized private route and source media');
  }
  for (const [name, dimensions] of [['cameraTrack', 2], ['footAnchorTrack', 3]] as const) {
    const track = config.captureReference[name];
    if (!Array.isArray(track) || track.length < 2 || track[0][0] !== 0 || track.at(-1)![0] !== config.captureReference.calibrationDurationSeconds ||
      !track.every((point, index) => Array.isArray(point) && point.length === dimensions && point.every(finite) &&
        point.slice(1).every(value => value >= 0 && value <= 1) && (index === 0 || point[0] > track[index - 1][0]))) {
      throw new Error(`${name} requires ordered calibration knots spanning the source clip`);
    }
  }
  if (config.captureReference.cameraTrack.some((point, index, track) => index > 0 && point[1] <= track[index - 1][1])) {
    throw new Error('cameraTrack must advance continuously along the bridge');
  }
  const viewTrack = config.captureReference.viewTrack;
  if (!Array.isArray(viewTrack) || viewTrack.length < 2 || viewTrack[0][0] !== 0 || viewTrack.at(-1)![0] !== config.captureReference.calibrationDurationSeconds ||
      !viewTrack.every((point, index) => Array.isArray(point) && point.length === 3 && point.every(finite) &&
        point[1] > 0 && point[1] < 90 && (index === 0 || point[0] > viewTrack[index - 1][0]))) {
    throw new Error('viewTrack requires finite ordered pitch/bearing knots spanning the source clip');
  }
  return config;
}

export function validateBiometrics(input: unknown): BiometricSample[] {
  if (!Array.isArray(input) || input.length < 2) {
    throw new Error('biometrics must contain at least two samples');
  }
  const samples = input as BiometricSample[];
  for (const sample of samples) {
    if (
      !finite(sample.progress) ||
      !finite(sample.heartRateBpm) ||
      !finite(sample.cadenceSpm) ||
      !finite(sample.speedMetersPerSecond) ||
      !finite(sample.powerWatts)
    ) {
      throw new Error('biometric samples must contain finite numeric fields');
    }
  }
  return [...samples].sort((a, b) => a.progress - b.progress);
}

export async function loadSceneConfig(): Promise<SceneConfig> {
  const response = await fetch('/scene.config.json', {cache: 'no-store'});
  if (!response.ok) throw new Error(`scene config failed: ${response.status}`);
  const config = validateSceneConfig(await response.json());
  if (config.captureReference.gaitAnalysisPath) {
    const gait = await fetch(config.captureReference.gaitAnalysisPath, {cache: 'no-store'});
    if (!gait.ok) throw new Error(`gait analysis failed: ${gait.status}`);
    config.captureReference.gait = await gait.json();
  }
  return config;
}

export async function loadBiometrics(url: string): Promise<BiometricSample[]> {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error(`biometrics failed: ${response.status}`);
  return validateBiometrics(await response.json());
}

export function getGoogleTilesAccess(config: SceneConfig): GoogleTilesAccess | null {
  const params = new URLSearchParams(window.location.search);
  if (!config.tiles.enabled || params.get('tiles') === 'off') return null;
  const key = window.__NEWHEAT_GOOGLE_TILES_KEY__?.trim();
  if (!key) return null;
  return {
    rootUrl: config.tiles.rootUrl || GOOGLE_3D_TILES_ROOT,
    apiKey: key
  };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
