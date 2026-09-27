import { describe, expect, it } from "vitest";
import {
  advanceTileStabilitySample,
  exportDownloadTimeoutMs,
  proResEncoderForPlatform,
  TILE_LOAD_TIMEOUT_MS,
  TILE_SETTLED_REDRAW_COUNT,
  TILE_STABILITY_SAMPLE_COUNT,
  TIMESTAMP_PRORES_PROFILE,
} from "../scene/render-policy";

describe("fitness rewind render policy", () => {
  it("requires a full readiness window instead of one loaded task yield", () => {
    const ready = {
      isLoaded: true,
      viewportTileCount: 18,
    };
    let stableSamples = advanceTileStabilitySample(0, ready);
    expect(stableSamples).toBe(1);
    expect(stableSamples).toBeLessThan(TILE_STABILITY_SAMPLE_COUNT);
    stableSamples = advanceTileStabilitySample(stableSamples, ready);
    expect(stableSamples).toBe(2);
    expect(stableSamples).toBeLessThan(TILE_STABILITY_SAMPLE_COUNT);
    stableSamples = advanceTileStabilitySample(stableSamples, ready);
    expect(stableSamples).toBe(TILE_STABILITY_SAMPLE_COUNT);
    expect(
      advanceTileStabilitySample(stableSamples, {
        isLoaded: false,
        viewportTileCount: 18,
      })
    ).toBe(0);
    expect(TILE_LOAD_TIMEOUT_MS).toBe(300_000);
    expect(TILE_SETTLED_REDRAW_COUNT).toBeGreaterThanOrEqual(2);
  });

  it("scales the browser download deadline for tile-settled frame capture", () => {
    expect(exportDownloadTimeoutMs(1)).toBe(607_200);
    expect(exportDownloadTimeoutMs(1_854)).toBe(13_948_800);
    expect(exportDownloadTimeoutMs(1_854)).toBeGreaterThan(13_000_000);
    expect(() => exportDownloadTimeoutMs(0)).toThrow(RangeError);
  });

  it("uses Apple hardware ProRes while keeping a portable fallback", () => {
    expect(proResEncoderForPlatform("darwin")).toEqual({
      codec: "prores_videotoolbox",
      extraArgs: ["-prio_speed", "1"],
    });
    expect(proResEncoderForPlatform("linux")).toEqual({
      codec: "prores_ks",
      extraArgs: [],
    });
  });

  it("locks the timestamp companion to a true alpha-bearing ProRes profile", () => {
    expect(TIMESTAMP_PRORES_PROFILE).toEqual({
      codec: "prores_aw",
      pixelFormat: "yuva444p10le",
      vendor: "apl0",
      codecTag: "ap4h",
    });
  });
});
