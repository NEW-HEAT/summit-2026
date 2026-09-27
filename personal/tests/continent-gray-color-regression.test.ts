import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTINENT_LAND_FILL_COLOR } from "../scene/continent-land-model";

describe("opaque #9EA2A8 continent fill regression", () => {
  it("keeps the continent PolygonLayer on the requested exact RGBA color", () => {
    const scene = readFileSync(
      new URL("../scene/globe-scene.ts", import.meta.url),
      "utf8",
    );

    expect(CONTINENT_LAND_FILL_COLOR).toEqual([158, 162, 168, 255]);
    expect(scene).toContain("getFillColor: CONTINENT_LAND_FILL_COLOR");
    expect(scene).toContain("continentFillColor: [...CONTINENT_LAND_FILL_COLOR]");
  });
});
