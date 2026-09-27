export type CameraPose = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

export type SourceFingerprint = {
  worktree: string;
  head: string;
  dirty: boolean;
  sourcePath: string;
  sourceSha256: string;
};

export type BeatContract = {
  beat: number;
  lyric: "WORLD";
  intervalStartFrame: number;
  markerFrame: number;
  globalStartSeconds: number;
  globalMarkerSeconds: number;
  capturedInThisClip: true;
  inheritedFromClip01: false;
  clippedByEndCut: boolean;
  timingAuthority: "provisional-uniform-1.05x";
};

export type FrameState = {
  frameIndex: number;
  clipSeconds: number;
  globalSeconds: number;
  beatIndex: number;
  beatProgress: number;
  orbitProgress: number;
  orbitDegrees: number;
  calendarIso: string;
  calendarMs: number;
  finalBeatClipped: boolean;
  stableHandoff: boolean;
  unwrappedLongitude: number;
  viewState: CameraPose;
};

const TRANSITION_FRAME_COUNT = 1_828;
const FINAL_TAIL_FRAMES = 26;
const STABLE_TAIL_FRAMES = 6;
const HANDOFF_FRAME = 1_848;

export const CLIP_CONTRACT = Object.freeze({
  id: "visgl-talk-2026-clip-02-fitness-globe-geographic-memories",
  label: "Fitness Globe Geographic Memories",
  fps: 60,
  width: 1920,
  height: 1080,
  devicePixelRatio: 1,
  frameCount: 1_854,
  transitionFrameCount: TRANSITION_FRAME_COUNT,
  finalTailFrames: FINAL_TAIL_FRAMES,
  clipStartSeconds: 14.1,
  clipEndSeconds: 45,
  beatCount: 32,
  cyclePlaybackRate: 32 / (TRANSITION_FRAME_COUNT / 60),
  firstDate: "2026-09-06",
  lastDate: "2023-01-01",
  inheritedBeatCount: 0,
  visibleBeatCount: 32,
  stableTailFrames: STABLE_TAIL_FRAMES,
  handoffFrame: HANDOFF_FRAME,
  fullOrbitDegrees: 0,
  finalOrbitDegrees: 0,
  sourceHero: Object.freeze({
    longitude: 8.5417,
    latitude: 47.3769,
    zoom: 2.4858036230728944,
    pitch: 0,
    bearing: 0,
    projectionRadius: 256,
    screenRadius: 0.65,
    canvasViewportRatio: 0.96,
    canvasCssSize: 1036.8,
    canvasClientSize: 1037,
  }),
  finalHandoff: Object.freeze({
    date: "2023-01-01",
    location: "Orlando, Florida, United States",
    anchorAuthority: "editorial-city-center" as const,
    scaleAuthority: "match-source-hero-screen-radius" as const,
    camera: Object.freeze({
      longitude: -81.379234,
      latitude: 28.538336,
      zoom: 2.861318270370575,
      pitch: 0,
      bearing: 0,
    }),
  }),
  imagery: Object.freeze({
    provider: "Esri World Imagery",
    tileUrl: "/world-imagery/{z}/{y}/{x}.jpg",
    tileSize: 256,
    minZoom: 0,
    maxZoom: 15,
    zoomOffset: 1,
    maxCacheSize: 256,
    maxRequests: 4,
    refinementStrategy: "no-overlap",
    prefetchZooms: [2, 3, 4] as const,
    prefetchBatchSize: 4,
    historicalImageryClaim: false,
  }),
  lighting: Object.freeze({
    effects: [] as const,
    polygonMaterial: false,
    clearColor: [0, 0, 0, 1] as const,
  }),
});

export const BEATS: readonly BeatContract[] = Object.freeze(
  Array.from({ length: CLIP_CONTRACT.beatCount }, (_, index) => {
    const intervalStartFrame = Math.round(
      (index * TRANSITION_FRAME_COUNT) / CLIP_CONTRACT.beatCount
    );
    const markerFrame = Math.round(
      ((index + 1) * TRANSITION_FRAME_COUNT) / CLIP_CONTRACT.beatCount
    );
    return Object.freeze({
      beat: index + 1,
      lyric: "WORLD" as const,
      intervalStartFrame,
      markerFrame,
      globalStartSeconds:
        CLIP_CONTRACT.clipStartSeconds + intervalStartFrame / CLIP_CONTRACT.fps,
      globalMarkerSeconds:
        CLIP_CONTRACT.clipStartSeconds + markerFrame / CLIP_CONTRACT.fps,
      capturedInThisClip: true as const,
      inheritedFromClip01: false as const,
      clippedByEndCut: index === CLIP_CONTRACT.beatCount - 1,
      timingAuthority: "provisional-uniform-1.05x" as const,
    });
  })
);

export function frameState(frameIndex: number): FrameState {
  assertFrameIndex(frameIndex);
  const clipSeconds = frameIndex / CLIP_CONTRACT.fps;
  const inFinalTail = frameIndex >= TRANSITION_FRAME_COUNT;
  const stableHandoff = frameIndex >= HANDOFF_FRAME;
  let beatIndex: number = CLIP_CONTRACT.beatCount;
  let beatProgress = 1;
  if (!inFinalTail) {
    beatIndex = Math.min(
      CLIP_CONTRACT.beatCount,
      Math.floor(
        (frameIndex * CLIP_CONTRACT.beatCount) / TRANSITION_FRAME_COUNT
      ) + 1
    );
    const beat = BEATS[beatIndex - 1];
    beatProgress = clamp(
      (frameIndex - beat.intervalStartFrame) /
        Math.max(beat.markerFrame - beat.intervalStartFrame, 1),
      0,
      1
    );
  }
  const sequenceProgress = inFinalTail
    ? 1
    : clamp((beatIndex - 1 + beatProgress) / CLIP_CONTRACT.beatCount, 0, 1);
  const firstMs = Date.parse(`${CLIP_CONTRACT.firstDate}T00:00:00.000Z`);
  const lastMs = Date.parse(`${CLIP_CONTRACT.lastDate}T00:00:00.000Z`);
  const calendarMs = stableHandoff
    ? lastMs
    : Math.round(firstMs + (lastMs - firstMs) * sequenceProgress);
  const camera = stableHandoff
    ? CLIP_CONTRACT.finalHandoff.camera
    : CLIP_CONTRACT.sourceHero;
  return {
    frameIndex,
    clipSeconds,
    globalSeconds: CLIP_CONTRACT.clipStartSeconds + clipSeconds,
    beatIndex,
    beatProgress,
    orbitProgress: 0,
    orbitDegrees: 0,
    calendarIso: new Date(calendarMs).toISOString().slice(0, 10),
    calendarMs,
    finalBeatClipped: inFinalTail,
    stableHandoff,
    unwrappedLongitude: camera.longitude,
    viewState: {
      longitude: camera.longitude,
      latitude: camera.latitude,
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
    },
  };
}

export function playbackFrameForElapsed(
  startFrame: number,
  elapsedMilliseconds: number
): number {
  assertFrameIndex(startFrame);
  const elapsedFrames = Math.max(
    0,
    Math.floor((elapsedMilliseconds * CLIP_CONTRACT.fps) / 1000)
  );
  return Math.min(CLIP_CONTRACT.frameCount - 1, startFrame + elapsedFrames);
}

export function buildTimelineManifest(source?: SourceFingerprint) {
  return {
    id: CLIP_CONTRACT.id,
    label: CLIP_CONTRACT.label,
    provider: CLIP_CONTRACT.imagery.provider,
    renderer:
      "deck.gl GlobeView + TileLayer + BitmapLayer + GPU-timed TripsLayer fitness archive",
    labelsRequested: false,
    providerAttributionPlacement: "end-of-talk credit panel",
    historicalImageryClaim: false,
    historicalImageryNote:
      "The dates describe private activity memories. Esri World Imagery is not presented as a historical imagery archive.",
    clip: {
      globalStartSeconds: CLIP_CONTRACT.clipStartSeconds,
      globalEndSeconds: CLIP_CONTRACT.clipEndSeconds,
      durationSeconds:
        CLIP_CONTRACT.clipEndSeconds - CLIP_CONTRACT.clipStartSeconds,
      fps: CLIP_CONTRACT.fps,
      frameCount: CLIP_CONTRACT.frameCount,
      width: CLIP_CONTRACT.width,
      height: CLIP_CONTRACT.height,
      devicePixelRatio: CLIP_CONTRACT.devicePixelRatio,
    },
    sequence: {
      firstDate: CLIP_CONTRACT.firstDate,
      lastDate: CLIP_CONTRACT.lastDate,
      beatCount: CLIP_CONTRACT.beatCount,
      visibleBeatCount: CLIP_CONTRACT.visibleBeatCount,
      cyclePlaybackRate: CLIP_CONTRACT.cyclePlaybackRate,
      timingAuthority:
        "Provisional uniform 1.05x marker clock; authoritative soundtrack markers remain required before final sync approval.",
      selectionAuthority:
        "Ignored local geographic-memories-v1 archive manifest: 32 selected memories plus 16 ranked alternates.",
      requiredOrbitDegrees: 0,
      transitionFrameCount: CLIP_CONTRACT.transitionFrameCount,
      finalTailFrames: CLIP_CONTRACT.finalTailFrames,
      stableTailFrames: CLIP_CONTRACT.stableTailFrames,
      handoffFrame: CLIP_CONTRACT.handoffFrame,
      fitnessArchiveRange: {
        start: "2022-01-01",
        endExclusive: "2028-01-01",
      },
      fitnessSequenceRange: {
        start: CLIP_CONTRACT.lastDate,
        end: CLIP_CONTRACT.firstDate,
      },
    },
    sourceHero: CLIP_CONTRACT.sourceHero,
    finalHandoff: CLIP_CONTRACT.finalHandoff,
    sceneCanvas: {
      mode: "full-viewport",
      width: CLIP_CONTRACT.width,
      height: CLIP_CONTRACT.height,
      devicePixelRatio: CLIP_CONTRACT.devicePixelRatio,
    },
    imagery: CLIP_CONTRACT.imagery,
    lighting: CLIP_CONTRACT.lighting,
    source: source ?? null,
    beats: BEATS,
  };
}

export function buildHandoffManifest(source?: SourceFingerprint) {
  const finalFrame = frameState(CLIP_CONTRACT.frameCount - 1);
  return {
    id: "visgl-talk-2026-clip-02-fitness-to-clip-03-handoff",
    sourceClip: CLIP_CONTRACT.id,
    targetClip: "visgl-talk-2026-clip-03",
    globalCutSeconds: CLIP_CONTRACT.clipEndSeconds,
    sourceFrameIndex: finalFrame.frameIndex,
    handoffFrame: CLIP_CONTRACT.handoffFrame,
    date: CLIP_CONTRACT.finalHandoff.date,
    location: CLIP_CONTRACT.finalHandoff.location,
    anchorAuthority: CLIP_CONTRACT.finalHandoff.anchorAuthority,
    scaleAuthority: CLIP_CONTRACT.finalHandoff.scaleAuthority,
    camera: finalFrame.viewState,
    unwrappedLongitude: finalFrame.unwrappedLongitude,
    viewport: {
      width: CLIP_CONTRACT.width,
      height: CLIP_CONTRACT.height,
      devicePixelRatio: CLIP_CONTRACT.devicePixelRatio,
      canvasMode: "full-viewport",
      canvasCssWidth: CLIP_CONTRACT.width,
      canvasCssHeight: CLIP_CONTRACT.height,
      canvasClientWidth: CLIP_CONTRACT.width,
      canvasClientHeight: CLIP_CONTRACT.height,
      sourceHeroCanvasClientSize: CLIP_CONTRACT.sourceHero.canvasClientSize,
    },
    globe: {
      projectionRadius: CLIP_CONTRACT.sourceHero.projectionRadius,
      screenRadius: CLIP_CONTRACT.sourceHero.screenRadius,
    },
    imagery: CLIP_CONTRACT.imagery,
    lighting: CLIP_CONTRACT.lighting,
    stableTailFrames: CLIP_CONTRACT.stableTailFrames,
    source: source ?? null,
  };
}

export function zoomForLatitude(latitude: number): number {
  const clampedLatitude = clamp(latitude, -85.051129, 85.051129);
  const latitudeScale = Math.PI * Math.cos((clampedLatitude * Math.PI) / 180);
  const targetScale =
    (CLIP_CONTRACT.sourceHero.screenRadius *
      CLIP_CONTRACT.sourceHero.canvasClientSize) /
    CLIP_CONTRACT.sourceHero.projectionRadius;
  return Math.log2(targetScale) + Math.log2(latitudeScale);
}

export function normalizeLongitude(value: number): number {
  const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
  if (Object.is(normalized, -0)) return 0;
  return Number(normalized.toFixed(10));
}

function assertFrameIndex(frameIndex: number): void {
  if (!Number.isFinite(frameIndex) || !Number.isInteger(frameIndex)) {
    throw new TypeError("Frame index must be a finite integer.");
  }
  if (frameIndex < 0 || frameIndex >= CLIP_CONTRACT.frameCount) {
    throw new RangeError(
      `Frame index must be from 0 to ${CLIP_CONTRACT.frameCount - 1}.`
    );
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
