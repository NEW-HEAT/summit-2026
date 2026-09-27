import {describe, expect, it} from "vitest";
import {BEATS, CLIP_CONTRACT} from "../scene/clip-contract";
import {
  ALBUM_INDEX_BY_BEAT,
  ALBUM_SOURCES,
  TARGET_LOCATION_OVERRIDES,
  VIDEO_FEED_CONTRACT,
  defaultTrimForBeat,
  feedMotion,
  lockTrimWindow,
  sourceForBeat,
} from "../video-feed/contract";

describe("Around the World video feed", () => {
  it("inherits the exact 30.9 second, 32-beat globe timing", () => {
    expect(VIDEO_FEED_CONTRACT).toMatchObject({
      fps: 60,
      frameCount: 1854,
      beatCount: 32,
      transitionFrameCount: 1828,
      background: "transparent",
      feed: {trimWindowSeconds: 0.9},
    });
    expect(VIDEO_FEED_CONTRACT.durationSeconds).toBe(30.9);
    expect(BEATS).toHaveLength(32);
  });

  it("maps every album item exactly once", () => {
    expect(ALBUM_SOURCES).toHaveLength(32);
    expect(new Set(ALBUM_INDEX_BY_BEAT).size).toBe(32);
    expect([...ALBUM_INDEX_BY_BEAT].sort((a, b) => a - b)).toEqual(
      Array.from({length: 32}, (_, index) => index + 1)
    );
  });

  it("uses the curated reverse segment and the explicit Gainesville final clip", () => {
    expect(sourceForBeat(1).fileName).toBe("source-15.mov");
    expect(sourceForBeat(9).albumIndex).toBe(6);
    expect(sourceForBeat(10).albumIndex).toBe(7);
    expect(sourceForBeat(32).fileName).toBe("source-32.mov");
    for (const source of ALBUM_SOURCES) {
      expect(source).not.toHaveProperty("capturedAt");
      expect(source).not.toHaveProperty("capturedLocation");
    }
    expect(TARGET_LOCATION_OVERRIDES[4].cityOrRegion).toBe("Vigo");
    expect(TARGET_LOCATION_OVERRIDES[9].cityOrRegion).toBe("Gothenburg");
    expect(TARGET_LOCATION_OVERRIDES[14].cityOrRegion).toBe("Denver");
    expect(TARGET_LOCATION_OVERRIDES[15].cityOrRegion).toBe("Palm Beach");
    expect(TARGET_LOCATION_OVERRIDES[23].cityOrRegion).toBe("Palo Alto");
    expect(TARGET_LOCATION_OVERRIDES[24].cityOrRegion).toBe("Dallas Fort Worth");
    expect(TARGET_LOCATION_OVERRIDES[25].cityOrRegion).toBe("Atlanta");
    expect(TARGET_LOCATION_OVERRIDES[27].cityOrRegion).toBe("Madrid");
    expect(TARGET_LOCATION_OVERRIDES[28].cityOrRegion).toBe("Delft");
  });

  it("keeps every default trim inside its source", () => {
    for (let beat = 1; beat <= 32; beat++) {
      const trim = defaultTrimForBeat(beat);
      const source = sourceForBeat(beat);
      expect(trim.trimInSeconds).toBeGreaterThanOrEqual(0);
      expect(trim.trimOutSeconds).toBeGreaterThan(trim.trimInSeconds);
      expect(trim.trimOutSeconds).toBeLessThanOrEqual(source.durationSeconds);
      expect(trim.trimOutSeconds - trim.trimInSeconds).toBeCloseTo(0.9, 6);
    }
  });

  it("locks every edit to one 0.9-second window and clamps the final start", () => {
    const oversized = {
      ...defaultTrimForBeat(32),
      trimInSeconds: 3.8,
      trimOutSeconds: 40,
    };
    const locked = lockTrimWindow(32, oversized);
    expect(locked.trimInSeconds).toBe(3.1);
    expect(locked.trimOutSeconds).toBe(4);
    expect(locked.trimOutSeconds - locked.trimInSeconds).toBeCloseTo(0.9, 6);
  });

  it("scrolls monotonically and lands without a reset", () => {
    const beat = BEATS[12];
    const frames = Array.from(
      {length: beat.markerFrame - beat.intervalStartFrame},
      (_, offset) => beat.intervalStartFrame + offset
    );
    const motion = frames.map((frame) => feedMotion(frame).scrollProgress);
    expect(motion[0]).toBe(0);
    expect(motion.at(-1)).toBe(1);
    for (let index = 1; index < motion.length; index++) {
      expect(motion[index]).toBeGreaterThanOrEqual(motion[index - 1]);
    }
    expect(feedMotion(CLIP_CONTRACT.frameCount - 1)).toMatchObject({
      beatIndex: 31,
      scrollProgress: 1,
    });
  });
});
