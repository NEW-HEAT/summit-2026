import {BEATS, CLIP_CONTRACT} from "../scene/clip-contract";

export type SourceVideoSpec = {
  albumIndex: number;
  fileName: string;
  durationSeconds: number;
};

export type FeedTrim = {
  trimInSeconds: number;
  trimOutSeconds: number;
  cropXPercent: number;
  cropYPercent: number;
  scale: number;
  approved: boolean;
};

export type FeedBeat = {
  beat: number;
  intervalStartFrame: number;
  markerFrame: number;
  globalStartSeconds: number;
  targetDateStart: string;
  targetDateEnd: string;
  targetPlace: string;
  targetRegion: string;
  targetCountry: string;
  source: SourceVideoSpec;
  sourceReady: boolean;
  mediaUrl: string | null;
  trim: FeedTrim;
  mappingNote: string;
};

export type FeedManifest = {
  contract: typeof VIDEO_FEED_CONTRACT;
  beats: FeedBeat[];
  media: {
    readyCount: number;
    expectedCount: number;
    status: "ready" | "missing";
    cachePath: string;
    watchedPath: string;
    photosExportError: string | null;
  };
};

export const FEED_TRIM_WINDOW_SECONDS = 0.9;

export const VIDEO_FEED_CONTRACT = Object.freeze({
  id: "visgl-talk-2026-clip-02-around-the-world-video-feed",
  width: CLIP_CONTRACT.width,
  height: CLIP_CONTRACT.height,
  fps: CLIP_CONTRACT.fps,
  frameCount: CLIP_CONTRACT.frameCount,
  durationSeconds: CLIP_CONTRACT.frameCount / CLIP_CONTRACT.fps,
  beatCount: CLIP_CONTRACT.beatCount,
  transitionFrameCount: CLIP_CONTRACT.transitionFrameCount,
  background: "transparent",
  feed: Object.freeze({
    left: 112,
    top: 102,
    width: 486,
    height: 864,
    cornerRadius: 34,
    gap: 56,
    transitionStart: 0.025,
    transitionEnd: 0.34,
    trimWindowSeconds: FEED_TRIM_WINDOW_SECONDS,
  }),
  output: Object.freeze({
    container: "Apple ProRes 4444 MOV",
    codec: "prores_ks profile 4",
    pixelFormat: "yuva444p10le",
    alpha: true,
    audio: false,
  }),
});

/**
 * The album is not in timeline order. The newest fifteen items are displayed in
 * mostly reverse timeline order; Gothenburg and Bergen are also reversed by
 * their geotags. The remaining seventeen already follow the rewind timeline.
 */
export const ALBUM_INDEX_BY_BEAT = Object.freeze([
  15, 14, 13, 12, 11, 10, 9, 8, 6, 7, 5, 4, 3, 2, 1, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
]);

/** Editorial place names already approved for the companion location track. */
export const TARGET_LOCATION_OVERRIDES: Readonly<
  Record<number, {cityOrRegion: string; state: string; country: string}>
> = Object.freeze({
  4: {cityOrRegion: "Vigo", state: "Galicia", country: "Spain"},
  9: {
    cityOrRegion: "Gothenburg",
    state: "V\u00e4stra G\u00f6taland",
    country: "Sweden",
  },
  14: {cityOrRegion: "Denver", state: "Colorado", country: "United States"},
  15: {cityOrRegion: "Palm Beach", state: "Florida", country: "United States"},
  23: {cityOrRegion: "Palo Alto", state: "California", country: "United States"},
  24: {cityOrRegion: "Dallas Fort Worth", state: "Texas", country: "United States"},
  25: {cityOrRegion: "Atlanta", state: "Georgia", country: "United States"},
  27: {cityOrRegion: "Madrid", state: "Community of Madrid", country: "Spain"},
  28: {cityOrRegion: "Delft", state: "South Holland", country: "Netherlands"},
  32: {cityOrRegion: "Gainesville", state: "Florida", country: "United States"},
});

export const ALBUM_SOURCES: readonly SourceVideoSpec[] = Object.freeze([
  {albumIndex: 1, fileName: "source-01.mov", durationSeconds: 14},
  {albumIndex: 2, fileName: "source-02.mov", durationSeconds: 32},
  {albumIndex: 3, fileName: "source-03.mov", durationSeconds: 10},
  {albumIndex: 4, fileName: "source-04.mov", durationSeconds: 10},
  {albumIndex: 5, fileName: "source-05.mov", durationSeconds: 39},
  {albumIndex: 6, fileName: "source-06.mov", durationSeconds: 48},
  {albumIndex: 7, fileName: "source-07.mov", durationSeconds: 17},
  {albumIndex: 8, fileName: "source-08.mov", durationSeconds: 30},
  {albumIndex: 9, fileName: "source-09.mov", durationSeconds: 27},
  {albumIndex: 10, fileName: "source-10.mov", durationSeconds: 70},
  {albumIndex: 11, fileName: "source-11.mov", durationSeconds: 11},
  {albumIndex: 12, fileName: "source-12.mov", durationSeconds: 12},
  {albumIndex: 13, fileName: "source-13.mov", durationSeconds: 64},
  {albumIndex: 14, fileName: "source-14.mov", durationSeconds: 13},
  {albumIndex: 15, fileName: "source-15.mov", durationSeconds: 20},
  {albumIndex: 16, fileName: "source-16.mov", durationSeconds: 20},
  {albumIndex: 17, fileName: "source-17.mov", durationSeconds: 15},
  {albumIndex: 18, fileName: "source-18.mov", durationSeconds: 8},
  {albumIndex: 19, fileName: "source-19.mov", durationSeconds: 41},
  {albumIndex: 20, fileName: "source-20.mov", durationSeconds: 14},
  {albumIndex: 21, fileName: "source-21.mov", durationSeconds: 33},
  {albumIndex: 22, fileName: "source-22.mov", durationSeconds: 84},
  {albumIndex: 23, fileName: "source-23.mov", durationSeconds: 32},
  {albumIndex: 24, fileName: "source-24.mov", durationSeconds: 16},
  {albumIndex: 25, fileName: "source-25.mov", durationSeconds: 18},
  {albumIndex: 26, fileName: "source-26.mov", durationSeconds: 7},
  {albumIndex: 27, fileName: "source-27.mov", durationSeconds: 5},
  {albumIndex: 28, fileName: "source-28.mov", durationSeconds: 18},
  {albumIndex: 29, fileName: "source-29.mov", durationSeconds: 14},
  {albumIndex: 30, fileName: "source-30.mov", durationSeconds: 5},
  {albumIndex: 31, fileName: "source-31.mov", durationSeconds: 15},
  {albumIndex: 32, fileName: "source-32.mov", durationSeconds: 4},
]);

export function sourceForBeat(beat: number): SourceVideoSpec {
  const albumIndex = ALBUM_INDEX_BY_BEAT[beat - 1];
  const source = ALBUM_SOURCES[albumIndex - 1];
  if (!source || source.albumIndex !== albumIndex) {
    throw new Error(`Missing album source for beat ${beat}.`);
  }
  return source;
}

export function defaultTrimForBeat(beat: number): FeedTrim {
  const source = sourceForBeat(beat);
  const trimInSeconds = Math.max(
    0,
    (source.durationSeconds - FEED_TRIM_WINDOW_SECONDS) / 2
  );
  return {
    trimInSeconds: roundMillis(trimInSeconds),
    trimOutSeconds: roundMillis(trimInSeconds + FEED_TRIM_WINDOW_SECONDS),
    cropXPercent: 50,
    cropYPercent: 50,
    scale: 1,
    approved: false,
  };
}

/**
 * Keep the user's chosen start moment while making the editorial window fixed.
 * trimOutSeconds is derived state and never acts as a second user-controlled edge.
 */
export function lockTrimWindow(beat: number, trim: FeedTrim): FeedTrim {
  const source = sourceForBeat(beat);
  const maximumStart = Math.max(0, source.durationSeconds - FEED_TRIM_WINDOW_SECONDS);
  const requestedStart = Number.isFinite(trim.trimInSeconds)
    ? trim.trimInSeconds
    : defaultTrimForBeat(beat).trimInSeconds;
  const trimInSeconds = roundMillis(clamp(requestedStart, 0, maximumStart));
  return {
    ...trim,
    trimInSeconds,
    trimOutSeconds: roundMillis(trimInSeconds + FEED_TRIM_WINDOW_SECONDS),
  };
}

export function feedMotion(frameIndex: number): {
  beatIndex: number;
  beatProgress: number;
  scrollProgress: number;
} {
  const clampedFrame = Math.max(
    0,
    Math.min(VIDEO_FEED_CONTRACT.frameCount - 1, Math.round(frameIndex))
  );
  if (clampedFrame >= VIDEO_FEED_CONTRACT.transitionFrameCount) {
    return {beatIndex: 31, beatProgress: 1, scrollProgress: 1};
  }
  const beatIndex = Math.min(
    31,
    Math.floor(
      (clampedFrame * VIDEO_FEED_CONTRACT.beatCount) /
        VIDEO_FEED_CONTRACT.transitionFrameCount
    )
  );
  const timing = BEATS[beatIndex];
  const beatProgress = clamp(
    (clampedFrame - timing.intervalStartFrame) /
      Math.max(1, timing.markerFrame - timing.intervalStartFrame),
    0,
    1
  );
  if (beatIndex === 0) {
    return {beatIndex, beatProgress, scrollProgress: 1};
  }
  const t = clamp(
    (beatProgress - VIDEO_FEED_CONTRACT.feed.transitionStart) /
      (VIDEO_FEED_CONTRACT.feed.transitionEnd -
        VIDEO_FEED_CONTRACT.feed.transitionStart),
    0,
    1
  );
  return {beatIndex, beatProgress, scrollProgress: smootherstep(t)};
}

function roundMillis(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}
