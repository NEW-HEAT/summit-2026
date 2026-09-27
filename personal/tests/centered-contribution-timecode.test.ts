import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GEOGRAPHIC_MEMORY_TIMECODE_STYLE } from "../scene/geographic-memory-timecode";

describe("fitness-consistent contribution timecode centering", () => {
  it("keeps the date at the fitness optical center while organization groups occupy corners", () => {
    expect(GEOGRAPHIC_MEMORY_TIMECODE_STYLE.contentOffsetY).toBe(52);
    const source = readFileSync(new URL("../scene/geographic-memory-timecode.ts", import.meta.url), "utf8");

    expect(source.match(/HEIGHT \/ 2 \+ style\.contentOffsetY/g)).toHaveLength(1);
    expect(source).toContain("context.translate(corner.x, corner.y)");
  });
});
