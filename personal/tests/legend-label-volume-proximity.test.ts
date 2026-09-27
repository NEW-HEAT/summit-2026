import { describe, expect, it } from "vitest";
import {
  LEGEND_LABEL_COUNT_GAP,
  ORGANIZATION_LEGEND_STYLE,
} from "../scene/legend-track";

describe("legend label and volume proximity", () => {
  it("keeps each cumulative count visually attached to its organization name", () => {
    expect(ORGANIZATION_LEGEND_STYLE).toBe("bare-inline");
    expect(LEGEND_LABEL_COUNT_GAP).toBeGreaterThanOrEqual(8);
    expect(LEGEND_LABEL_COUNT_GAP).toBeLessThanOrEqual(12);
  });
});
