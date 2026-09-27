import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ORLANDO_PRESENCE_CONTRACT,
  orlandoPresenceFrame,
  smootherstep,
} from "../orlando-presence/contract";

describe("Orlando presence continuation", () => {
  it("is an exact four-second 60 fps 1080p alpha-track contract", () => {
    expect(ORLANDO_PRESENCE_CONTRACT).toMatchObject({
      fps: 60,
      width: 1920,
      height: 1080,
      frameCount: 240,
      durationSeconds: 4,
      dateLabel: "JAN 01 2023",
      locationLabel: "FLORIDA",
    });
  });

  it("starts at the exact supplied Orlando view state", () => {
    expect(orlandoPresenceFrame(0).viewState).toEqual({
      longitude: -81.379234,
      latitude: 28.538336,
      zoom: 2.861318270370575,
      pitch: 0,
      bearing: 0,
    });
  });

  it("keeps the globe centered while zooming out monotonically", () => {
    const frames = Array.from(
      { length: ORLANDO_PRESENCE_CONTRACT.frameCount },
      (_, index) => orlandoPresenceFrame(index)
    );
    for (const frame of frames) {
      expect(frame.viewState.longitude).toBe(-81.379234);
      expect(frame.viewState.latitude).toBe(28.538336);
      expect(frame.viewState.pitch).toBe(0);
      expect(frame.viewState.bearing).toBe(0);
    }
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index].viewState.zoom).toBeLessThanOrEqual(
        frames[index - 1].viewState.zoom
      );
    }
  });

  it("holds satellite color briefly, then reaches full grayscale smoothly", () => {
    const frames = Array.from(
      { length: ORLANDO_PRESENCE_CONTRACT.frameCount },
      (_, index) => orlandoPresenceFrame(index)
    );
    expect(frames[0].grayscaleProgress).toBe(0);
    expect(frames[frames.length - 1].grayscaleProgress).toBe(1);
    expect(frames[10].grayscaleProgress).toBe(0);
    expect(frames[120].grayscaleProgress).toBeGreaterThan(0.45);
    expect(frames[120].grayscaleProgress).toBeLessThan(0.55);
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index].grayscaleProgress).toBeGreaterThanOrEqual(
        frames[index - 1].grayscaleProgress
      );
    }
  });

  it("uses one tile source and keeps deterministic grayscale as an explicit render style", () => {
    const sceneSource = readFileSync(
      new URL("../orlando-presence/scene.ts", import.meta.url),
      "utf8"
    );
    expect(sceneSource).toContain('renderStyle === "grayscale"');
    expect(sceneSource).toContain(
      "`grayscale(${currentFrame.grayscaleProgress})`"
    );
    expect(sceneSource.match(/new TileLayer<ImageBitmap>/gu)).toHaveLength(1);
  });

  it("targets a globe roughly half the viewport height", () => {
    expect(ORLANDO_PRESENCE_CONTRACT.targetGlobeHeightPx).toBe(540);
    expect(
      ORLANDO_PRESENCE_CONTRACT.targetGlobeHeightPx /
        ORLANDO_PRESENCE_CONTRACT.height
    ).toBe(0.5);
    expect(ORLANDO_PRESENCE_CONTRACT.endPose.zoom).toBeCloseTo(
      1.767724568253466,
      12
    );
  });

  it("uses a zero-velocity smootherstep at both cuts", () => {
    const epsilon = 1e-5;
    expect((smootherstep(epsilon) - smootherstep(0)) / epsilon).toBeLessThan(
      0.001
    );
    expect(
      (smootherstep(1) - smootherstep(1 - epsilon)) / epsilon
    ).toBeLessThan(0.001);
  });

  it("resets tracked location glyphs to left alignment before drawing", () => {
    const sceneSource = readFileSync(
      new URL("../orlando-presence/scene.ts", import.meta.url),
      "utf8"
    );
    const functionStart = sceneSource.indexOf(
      "function drawCenteredTrackedText"
    );
    const functionEnd = sceneSource.indexOf(
      "function trackedTextWidth",
      functionStart
    );
    const trackedTextFunction = sceneSource.slice(functionStart, functionEnd);
    expect(trackedTextFunction).toContain(
      'timestampContext.textAlign = "left"'
    );
    expect(trackedTextFunction).toContain("timestampContext.save()");
    expect(trackedTextFunction).toContain("timestampContext.restore()");
  });
});
