import { describe, expect, it } from "vitest";
import {
  BEATS,
  CLIP_CONTRACT,
  buildHandoffManifest,
  buildTimelineManifest,
  frameState,
  normalizeLongitude,
  playbackFrameForElapsed,
  zoomForLatitude,
} from "../scene/clip-contract";

const FINAL_CAMERA = {
  longitude: CLIP_CONTRACT.finalHandoff.camera.longitude,
  latitude: CLIP_CONTRACT.finalHandoff.camera.latitude,
  zoom: CLIP_CONTRACT.finalHandoff.camera.zoom,
  pitch: CLIP_CONTRACT.finalHandoff.camera.pitch,
  bearing: CLIP_CONTRACT.finalHandoff.camera.bearing,
};

describe("geographic-memory globe clip contract", () => {
  it("locks the 30.9 second, 60 fps encoded clip", () => {
    expect(CLIP_CONTRACT.fps).toBe(60);
    expect(CLIP_CONTRACT.frameCount).toBe(1_854);
    expect(CLIP_CONTRACT.clipEndSeconds - CLIP_CONTRACT.clipStartSeconds).toBe(
      30.9
    );
    expect(CLIP_CONTRACT.width).toBe(1_920);
    expect(CLIP_CONTRACT.height).toBe(1_080);
  });

  it("owns 32 post-handoff WORLD intervals with no required orbit", () => {
    expect(BEATS).toHaveLength(32);
    expect(BEATS[0]).toMatchObject({
      beat: 1,
      intervalStartFrame: 0,
      capturedInThisClip: true,
      inheritedFromClip01: false,
    });
    expect(BEATS.at(-1)).toMatchObject({
      beat: 32,
      markerFrame: CLIP_CONTRACT.transitionFrameCount,
      clippedByEndCut: true,
    });
    expect(CLIP_CONTRACT.visibleBeatCount).toBe(32);
    expect(CLIP_CONTRACT.fullOrbitDegrees).toBe(0);
    for (let index = 1; index < BEATS.length; index += 1) {
      expect(BEATS[index].intervalStartFrame).toBe(
        BEATS[index - 1].markerFrame
      );
      expect(BEATS[index].markerFrame).toBeGreaterThan(
        BEATS[index].intervalStartFrame
      );
    }
  });

  it("begins on the exact Clip 01 hero pose", () => {
    const first = frameState(0);
    expect(first.beatIndex).toBe(1);
    expect(first.beatProgress).toBe(0);
    expect(first.viewState).toEqual({
      longitude: CLIP_CONTRACT.sourceHero.longitude,
      latitude: CLIP_CONTRACT.sourceHero.latitude,
      zoom: CLIP_CONTRACT.sourceHero.zoom,
      pitch: 0,
      bearing: 0,
    });
    expect(zoomForLatitude(CLIP_CONTRACT.sourceHero.latitude)).toBe(
      CLIP_CONTRACT.sourceHero.zoom
    );
  });

  it("runs the 32 provisional cycles at approximately 1.05x", () => {
    expect(CLIP_CONTRACT.cyclePlaybackRate).toBeCloseTo(1.05, 2);
    expect(BEATS[0].globalStartSeconds).toBe(CLIP_CONTRACT.clipStartSeconds);
    expect(BEATS.at(-1)!.globalMarkerSeconds).toBeCloseTo(
      CLIP_CONTRACT.clipStartSeconds +
        CLIP_CONTRACT.transitionFrameCount / CLIP_CONTRACT.fps,
      8
    );
  });

  it("uses a 26-frame final tail and six exact January 2023 hold frames", () => {
    expect(frameState(CLIP_CONTRACT.transitionFrameCount - 1)).toMatchObject({
      beatIndex: 32,
      stableHandoff: false,
      orbitDegrees: 0,
    });
    expect(frameState(CLIP_CONTRACT.handoffFrame).stableHandoff).toBe(true);
    expect(CLIP_CONTRACT.finalTailFrames).toBe(26);
    expect(CLIP_CONTRACT.stableTailFrames).toBe(6);
    for (
      let frame = CLIP_CONTRACT.handoffFrame;
      frame < CLIP_CONTRACT.frameCount;
      frame += 1
    ) {
      expect(frameState(frame)).toMatchObject({
        stableHandoff: true,
        calendarIso: "2023-01-01",
        viewState: FINAL_CAMERA,
      });
    }
  });

  it("exports the geographic-memory timeline and Clip 03 handoff", () => {
    const timeline = buildTimelineManifest();
    const handoff = buildHandoffManifest();
    expect(timeline.sequence).toMatchObject({
      firstDate: "2026-09-06",
      lastDate: "2023-01-01",
      beatCount: 32,
      visibleBeatCount: 32,
      requiredOrbitDegrees: 0,
      stableTailFrames: 6,
    });
    expect(timeline.sequence.selectionAuthority).toContain(
      "geographic-memories-v1"
    );
    expect(handoff).toMatchObject({
      date: "2023-01-01",
      sourceFrameIndex: 1_853,
      handoffFrame: 1_848,
      stableTailFrames: 6,
      location: "Orlando, Florida, United States",
      anchorAuthority: "editorial-city-center",
      scaleAuthority: "match-source-hero-screen-radius",
      camera: FINAL_CAMERA,
    });
  });

  it("rejects invalid frames and normalizes longitudes", () => {
    expect(() => frameState(-1)).toThrow(RangeError);
    expect(() => frameState(1_854)).toThrow(RangeError);
    expect(() => frameState(1.5)).toThrow(TypeError);
    expect(() => frameState(Number.NaN)).toThrow(TypeError);
    expect(normalizeLongitude(368.5417)).toBeCloseTo(8.5417, 8);
  });

  it("never seeks before the requested start frame", () => {
    expect(playbackFrameForElapsed(0, -0.4)).toBe(0);
    expect(playbackFrameForElapsed(20, 1_000)).toBe(80);
    expect(playbackFrameForElapsed(1_800, 2_000)).toBe(1_853);
  });
});
