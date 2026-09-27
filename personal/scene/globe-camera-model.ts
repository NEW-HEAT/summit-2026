export type ContributionGlobeCameraInput = {
  elapsedSeconds: number;
  focusLongitude: number;
  focusLatitude: number;
};

export type ContributionGlobeViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: 0;
  pitch: 0;
};

// The full contribution globe preserves Clip 02's fixed-view scale. The camera
// may move between contribution areas, but zoom never changes. The alpha bounds
// use bbox=min_val=128 so faint codec fringe pixels do not inflate the measured
// globe silhouette.
export const REFERENCE_CONTRIBUTION_GLOBE_FINAL_SCALE = Object.freeze({
  sourceZoom: 2.861318270370575,
  zoom: 2.861318270370575,
  opaqueAlphaBoundsAt128: Object.freeze({
    width: 986,
    height: 993,
  }),
  encodedAlphaTolerancePixels: 1,
});

// Exact fixed-view Clip 02 final-frame contract. The contribution clip keeps
// this scale for every frame while longitude and latitude follow the story.
export const CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX = 996;
export const CLIP_02_ORLANDO_HANDOFF_ALPHA_BOUNDS_AT_128 = Object.freeze({
  width: 986,
  height: 993,
});

export const CLIP_02_ORLANDO_HANDOFF_VIEW_STATE = Object.freeze({
  longitude: -81.379234,
  latitude: 28.538336,
  zoom: 2.861318270370575,
  bearing: 0 as const,
  pitch: 0 as const,
});

export function contributionGlobeViewState(
  frame: ContributionGlobeCameraInput,
  handoffSeconds: number,
): ContributionGlobeViewState {
  const handoffProgress = smootherstep(
    handoffSeconds <= 0 ? 1 : frame.elapsedSeconds / handoffSeconds,
  );
  return {
    longitude: normalizeLongitude(
      CLIP_02_ORLANDO_HANDOFF_VIEW_STATE.longitude
        + shortestLongitudeDelta(
          CLIP_02_ORLANDO_HANDOFF_VIEW_STATE.longitude,
          frame.focusLongitude,
        ) * handoffProgress,
    ),
    latitude: mix(
      CLIP_02_ORLANDO_HANDOFF_VIEW_STATE.latitude,
      frame.focusLatitude,
      handoffProgress,
    ),
    zoom: CLIP_02_ORLANDO_HANDOFF_VIEW_STATE.zoom,
    bearing: CLIP_02_ORLANDO_HANDOFF_VIEW_STATE.bearing,
    pitch: CLIP_02_ORLANDO_HANDOFF_VIEW_STATE.pitch,
  };
}

export function globeUnitVector(
  longitude: number,
  latitude: number,
): [number, number, number] {
  const longitudeRadians = longitude * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  const cosLatitude = Math.cos(latitudeRadians);
  return [
    Math.sin(longitudeRadians) * cosLatitude,
    -Math.cos(longitudeRadians) * cosLatitude,
    Math.sin(latitudeRadians),
  ];
}

function smootherstep(progress: number) {
  const value = clamp(progress, 0, 1);
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function shortestLongitudeDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

function normalizeLongitude(longitude: number) {
  return ((longitude + 540) % 360) - 180;
}

function mix(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
