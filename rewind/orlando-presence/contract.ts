export type OrlandoPresencePose = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

export type OrlandoPresenceFrame = {
  frameIndex: number;
  seconds: number;
  progress: number;
  easedProgress: number;
  grayscaleProgress: number;
  continentProgress: number;
  viewState: OrlandoPresencePose;
};

const START_ZOOM = 2.861318270370575;
const START_GLOBE_HEIGHT_PX = 996;
const TARGET_GLOBE_HEIGHT_PX = 540;
// GlobeView's projected diameter is nonlinear at this zoom range. This slope is
// calibrated from encoded alpha bounds at the exact Orlando latitude so the
// final target is a real screen-space measurement, not a Mercator estimate.
const ENCODED_GLOBE_LOG_SCALE_PER_ZOOM = 0.5597857018023702;

export const ORLANDO_PRESENCE_CONTRACT = Object.freeze({
  id: "visgl-talk-2026-clip-02-orlando-presence-zoomout",
  fps: 60,
  width: 1920,
  height: 1080,
  frameCount: 240,
  durationSeconds: 4,
  devicePixelRatio: 1,
  dateIso: "2023-01-01",
  dateLabel: "JAN 01 2023",
  locationLabel: "FLORIDA",
  startGlobeHeightPx: START_GLOBE_HEIGHT_PX,
  targetGlobeHeightPx: TARGET_GLOBE_HEIGHT_PX,
  startPose: Object.freeze({
    longitude: -81.379234,
    latitude: 28.538336,
    zoom: START_ZOOM,
    pitch: 0,
    bearing: 0,
  }),
  endPose: Object.freeze({
    longitude: -81.379234,
    latitude: 28.538336,
    zoom:
      START_ZOOM +
      Math.log(TARGET_GLOBE_HEIGHT_PX / START_GLOBE_HEIGHT_PX) /
        ENCODED_GLOBE_LOG_SCALE_PER_ZOOM,
    pitch: 0,
    bearing: 0,
  }),
  marker: Object.freeze({
    longitude: -81.379234,
    latitude: 28.538336,
    coreRadiusPx: 5.5,
    haloRadiusPx: 18,
  }),
  imagery: Object.freeze({
    provider: "Esri World Imagery",
    tileUrl: "/world-imagery/{z}/{y}/{x}.jpg",
    tileSize: 256,
    minZoom: 0,
    maxZoom: 15,
    zoomOffset: 1,
    maxCacheSize: 256,
    maxRequests: 8,
    refinementStrategy: "no-overlap" as const,
    startDesaturate: 0,
    endDesaturate: 1,
    grayscaleTransitionStartProgress: 0.08,
    grayscaleTransitionEndProgress: 0.92,
  }),
  continentGeometry: Object.freeze({
    source: "Natural Earth 1:50m land polygons",
    transitionStartProgress: 0.08,
    transitionEndProgress: 0.92,
    fillColor: Object.freeze([158, 162, 168, 255] as const),
    cullMode: "back" as const,
    oceanOpacity: 0,
    backgroundOpacity: 0,
  }),
});

export function smootherstep(progress: number): number {
  const value = clamp(progress, 0, 1);
  return value * value * value * (value * (value * 6 - 15) + 10);
}

export function orlandoPresenceFrame(frameIndex: number): OrlandoPresenceFrame {
  assertFrameIndex(frameIndex);
  const progress =
    frameIndex / Math.max(ORLANDO_PRESENCE_CONTRACT.frameCount - 1, 1);
  const easedProgress = smootherstep(progress);
  const grayscaleProgress = smootherstep(
    (progress -
      ORLANDO_PRESENCE_CONTRACT.imagery.grayscaleTransitionStartProgress) /
      (ORLANDO_PRESENCE_CONTRACT.imagery.grayscaleTransitionEndProgress -
        ORLANDO_PRESENCE_CONTRACT.imagery.grayscaleTransitionStartProgress)
  );
  const continentProgress = smootherstep(
    (progress -
      ORLANDO_PRESENCE_CONTRACT.continentGeometry.transitionStartProgress) /
      (ORLANDO_PRESENCE_CONTRACT.continentGeometry.transitionEndProgress -
        ORLANDO_PRESENCE_CONTRACT.continentGeometry.transitionStartProgress)
  );
  return {
    frameIndex,
    seconds: frameIndex / ORLANDO_PRESENCE_CONTRACT.fps,
    progress,
    easedProgress,
    grayscaleProgress,
    continentProgress,
    viewState: {
      longitude: ORLANDO_PRESENCE_CONTRACT.startPose.longitude,
      latitude: ORLANDO_PRESENCE_CONTRACT.startPose.latitude,
      zoom: mix(
        ORLANDO_PRESENCE_CONTRACT.startPose.zoom,
        ORLANDO_PRESENCE_CONTRACT.endPose.zoom,
        easedProgress
      ),
      pitch: ORLANDO_PRESENCE_CONTRACT.startPose.pitch,
      bearing: ORLANDO_PRESENCE_CONTRACT.startPose.bearing,
    },
  };
}

function assertFrameIndex(frameIndex: number): void {
  if (
    !Number.isInteger(frameIndex) ||
    frameIndex < 0 ||
    frameIndex >= ORLANDO_PRESENCE_CONTRACT.frameCount
  ) {
    throw new RangeError(
      `Frame index must be an integer from 0 to ${ORLANDO_PRESENCE_CONTRACT.frameCount - 1}.`
    );
  }
}

function mix(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
