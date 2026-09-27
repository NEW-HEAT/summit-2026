import { describe, expect, it } from "vitest";
import { LEGEND_BOUNDS, legendDoesNotOverlapTimecode } from "../scene/legend-track";

describe("full-width top organization legend", () => {
  it("uses the top horizon band without entering the centered timecode zone", () => {
    expect(LEGEND_BOUNDS.x).toBeLessThanOrEqual(40);
    expect(LEGEND_BOUNDS.y).toBeLessThanOrEqual(40);
    expect(LEGEND_BOUNDS.width).toBeGreaterThanOrEqual(1_840);
    expect(LEGEND_BOUNDS.height).toBeLessThanOrEqual(120);
    expect(legendDoesNotOverlapTimecode()).toBe(true);
  });
});
