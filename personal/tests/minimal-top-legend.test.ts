import { describe, expect, it } from "vitest";
import {
  LEGEND_BOUNDS,
  ORGANIZATION_LEGEND_STYLE,
  legendDoesNotOverlapTimecode,
} from "../scene/legend-track";

describe("minimal top organization legend", () => {
  it("uses a bare full-width inline row outside the date timecode", () => {
    expect(ORGANIZATION_LEGEND_STYLE).toBe("bare-inline");
    expect(LEGEND_BOUNDS.x).toBeLessThanOrEqual(32);
    expect(LEGEND_BOUNDS.width).toBeGreaterThanOrEqual(1_856);
    expect(LEGEND_BOUNDS.height).toBeLessThanOrEqual(40);
    expect(legendDoesNotOverlapTimecode()).toBe(true);
  });
});
