export type LngLatZ = [longitude: number, latitude: number, altitudeMeters: number];

export type RunnerRepresentation = 'procedural-point-cloud';

export interface LocationConfig {
  id: string;
  label: string;
  longitude: number;
  latitude: number;
  altitudeMeters: number;
  sourceUrl?: string;
}

export interface RunnerConfig {
  representation: RunnerRepresentation;
  groundAltitudeMeters: number;
  altitudeOffsetMeters: number;
  headingOffsetDegrees: number;
  scale: number;
  pointCount: number;
  pointSizePixels: number;
  progressiveResolveSeconds: number;
}

export interface TileConfig {
  enabled: boolean;
  rootUrl: string;
  maximumScreenSpaceError: number;
  maximumMemoryUsage: number;
}

export interface TrailConfig {
  companionOffsetMeters: [east: number, north: number];
  widthPixels: number;
  widthMeters: number;
  trailLengthSeconds: number;
  approachLengthSeconds: number;
  color: [number, number, number];
}

export interface CaptureReferenceConfig {
  id: string;
  mediaPath: string;
  normalizedRoutePath: string;
  compositionRoutePath: string;
  durationSeconds: number;
  cameraTrack: Array<[videoSeconds: number, routeProgress: number]>;
  calibrationDurationSeconds: number;
  deckProfileTimeOffsetSeconds: number;
  viewTrack: Array<[videoSeconds: number, pitch: number, bearing: number]>;
  footAnchorTrack: Array<[videoSeconds: number, x: number, y: number]>;
  gaitAnalysisPath?: string;
  gait?: import('./gait').GaitAnalysis;
  role: 'source-for-future-3d-reconstruction';
  participants: Array<{
    label: string;
    activity: 'ride' | 'run';
  }>;
}

export interface SceneConfig {
  schemaVersion: number;
  id: string;
  sourceFps: number;
  durationSeconds: number;
  target: LocationConfig;
  route: LngLatZ[];
  tiles: TileConfig;
  runner: RunnerConfig;
  trail: TrailConfig;
  captureReference: CaptureReferenceConfig;
  biometricsUrl: string;
}

export interface BiometricSample {
  progress: number;
  heartRateBpm: number;
  cadenceSpm: number;
  speedMetersPerSecond: number;
  powerWatts: number;
}

export interface CameraState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export type ClosingPhase =
  | 'black-in'
  | 'fly-in'
  | 'video-focus'
  | 'fly-out'
  | 'black-out';

export interface TimelineState {
  frame: number;
  timeSeconds: number;
  progress: number;
  phase: ClosingPhase;
  camera: CameraState;
  projectionBlend: number;
  projectionVeilOpacity: number;
  sceneOpacity: number;
  viewportScale: number;
  mapDimOpacity: number;
  skyOpacity: number;
  heroOpacity: number;
  heroProgress: number;
  routeProgress: number;
  heroResolve: number;
  trailOpacity: number;
  trailTimeSeconds: number;
  trailLengthSeconds: number;
  videoOpacity: number;
  videoScale: number;
  videoProgress: number;
  videoTimeSeconds: number;
  compositionRouteProgress: number;
}

export interface RunnerPoint {
  position: LngLatZ;
  normal: [number, number, number];
  color: [number, number, number, number];
  revealOrder: number;
}
