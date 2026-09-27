import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLIP_02_ORLANDO_HANDOFF_ALPHA_BOUNDS_AT_128,
  CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX,
  CLIP_02_ORLANDO_HANDOFF_VIEW_STATE,
  REFERENCE_CONTRIBUTION_GLOBE_FINAL_SCALE,
  contributionGlobeViewState,
} from "../scene/globe-camera-model";
import { CONTRIBUTION_GLOBE_LAYOUT } from "../scene/globe-layout";

describe("Clip 02 to contribution globe handoff regression", () => {
  it("copies the fixed-view Clip 02 scale and never shrinks it during traversal", () => {
    const first = contributionGlobeViewState({
      elapsedSeconds: 0,
      focusLongitude: -82,
      focusLatitude: 30,
    }, 1);
    const settled = contributionGlobeViewState({
      elapsedSeconds: 1,
      focusLongitude: -82,
      focusLatitude: 30,
    }, 1);
    const traversalZooms = [0, 0.5, 1, 31, 61].map((elapsedSeconds) =>
      contributionGlobeViewState({
        elapsedSeconds,
        focusLongitude: -80,
        focusLatitude: 27,
      }, 1).zoom,
    );

    expect(first).toEqual({
      longitude: -81.379234,
      latitude: 28.538336,
      zoom: 2.861318270370575,
      bearing: 0,
      pitch: 0,
    });
    expect(first).toEqual(CLIP_02_ORLANDO_HANDOFF_VIEW_STATE);
    expect(CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX).toBe(996);
    expect(CLIP_02_ORLANDO_HANDOFF_ALPHA_BOUNDS_AT_128).toEqual({
      width: 986,
      height: 993,
    });
    expect(REFERENCE_CONTRIBUTION_GLOBE_FINAL_SCALE).toMatchObject({
      sourceZoom: 2.861318270370575,
      zoom: 2.861318270370575,
      opaqueAlphaBoundsAt128: {
        width: 986,
        height: 993,
      },
      encodedAlphaTolerancePixels: 1,
    });
    expect(settled).toEqual({
      longitude: -82,
      latitude: 30,
      zoom: REFERENCE_CONTRIBUTION_GLOBE_FINAL_SCALE.zoom,
      bearing: 0,
      pitch: 0,
    });
    expect(traversalZooms).toEqual(Array(5).fill(2.861318270370575));
  });

  it("doubles GlobeView mesh density without changing the 1920 by 1080 export", () => {
    expect(CONTRIBUTION_GLOBE_LAYOUT).toMatchObject({
      width: 1920,
      height: 1080,
      meshResolutionDegrees: 0.25,
    });
  });

  it("uses fragment-level hemisphere clipping on every polygon surface", () => {
    const scene = readFileSync(
      new URL("../scene/globe-scene.ts", import.meta.url),
      "utf8",
    );

    expect(scene).toContain("ContributionHorizonClipExtension");
    expect(scene).toContain("clear: true");
    expect(scene).toContain("frameState.elapsedSeconds < VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds");
    expect(scene).toContain("extensions: [HORIZON_CLIP_EXTENSION]");
    expect(scene.match(/extensions: \[HORIZON_CLIP_EXTENSION\]/g)).toHaveLength(4);
  });

  it("normalizes the empty pre-roll to the exact land fill without flattening alpha", () => {
    const renderer = readFileSync(
      new URL("../render-globe.mts", import.meta.url),
      "utf8",
    );

    expect(renderer).toContain("format=gray[prealpha]");
    expect(renderer).toContain("[1:v][prealpha]alphamerge");
    expect(renderer).toContain("CONTINENT_LAND_FILL_COLOR");
    expect(renderer).toContain("handoffColorProbe");
    expect(renderer).toContain("clip02HandoffGlobeScalePass");
    expect(renderer).toContain("CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX");
    expect(renderer).toContain("lockedIntroScalePass");
    expect(renderer).not.toContain("halfHeightGlobePass");
    expect(renderer).toContain("alphaBoundsProbe(output, 128)");
    expect(renderer).toContain("alphaextract,format=gray,bbox");
    expect(renderer).toContain('values.get("--dataset")');
    expect(renderer).toContain("LOCATION_HEAT_SCHEMA_VERSION");
  });

  it("primes frame zero before constructing the transparent globe encoder", () => {
    const scene = readFileSync(
      new URL("../scene/globe-scene.ts", import.meta.url),
      "utf8",
    );
    const renderFunctionIndex = scene.indexOf("async function renderGlobeWebm");
    const primeIndex = scene.indexOf("await setFrame(0);", renderFunctionIndex);
    const sourceIndex = scene.indexOf("const source = new CanvasSource(canvas", renderFunctionIndex);

    expect(primeIndex).toBeGreaterThan(renderFunctionIndex);
    expect(sourceIndex).toBeGreaterThan(primeIndex);
    expect(scene).toContain("if (frameIndex > 0) await setFrame(frameIndex);");
    expect(scene).toContain("const GLOBE_BITRATE = 60_000_000;");
    expect(scene).toContain("const ALPHA_MASK_BITRATE = 30_000_000;");
    expect(scene).toContain('bitrateMode: "constant"');
    expect(scene).toContain('const alphaMaskCanvas = document.createElement("canvas")');
    expect(scene).toContain("const alphaMaskSource = new CanvasSource(alphaMaskCanvas");
    expect(scene).toContain("output.addVideoTrack(alphaMaskSource");
    expect(scene).toContain("requestAnimationFrame");

    const renderer = readFileSync(
      new URL("../render-globe.mts", import.meta.url),
      "utf8",
    );
    expect(renderer).toContain("normalizeGlobeAlphaMov");
    expect(renderer).toContain("[0:v:1]");
    expect(renderer).toContain("dual-video-track-grayscale-mask");
  });
});
