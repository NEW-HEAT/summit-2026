import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  continentLandPolygons,
  type LandTopology,
} from "../scene/continent-land-model";

describe("continent-only globe regression", () => {
  it("decodes the pinned Natural Earth land topology into closed polygons", () => {
    const topology = JSON.parse(
      readFileSync(new URL("./land-110m.topojson", import.meta.url), "utf8")
    ) as LandTopology;
    const polygons = continentLandPolygons(topology);
    const positions = polygons.flatMap((datum) => datum.polygon.flat());

    expect(polygons).toHaveLength(125);
    expect(
      polygons.every((datum) =>
        datum.polygon.every(
          (ring) =>
            ring.length >= 4 &&
            ring[0][0] === ring.at(-1)?.[0] &&
            ring[0][1] === ring.at(-1)?.[1]
        )
      )
    ).toBe(true);
    expect(Math.min(...positions.map((position) => position[0]))).toBe(-180);
    expect(Math.max(...positions.map((position) => position[0]))).toBe(180);
    expect(Math.min(...positions.map((position) => position[1]))).toBeLessThan(
      -85
    );
    expect(
      Math.max(...positions.map((position) => position[1]))
    ).toBeGreaterThan(83);
  });

  it("renders one culled continent PolygonLayer without a raster or ocean surface", () => {
    const scene = readFileSync(
      new URL("../scene/globe-scene.ts", import.meta.url),
      "utf8"
    );

    expect(scene).toContain("new PolygonLayer<ContinentLandPolygon>");
    expect(scene).toContain('id: "contribution-globe-continent-land"');
    expect(scene).toContain('./ne_50m_land.json');
    expect(scene).toContain('landSource: "Natural Earth 1:50m land polygons"');
    expect(scene).toContain('cullMode: "back"');
    expect(scene).toContain("rasterSurfaceLayerCount: 0");
    expect(scene).toContain("oceanUnderlay: false");
    expect(scene).toContain("isPositionOnVisibleHemisphere");
    expect(scene).not.toMatch(/import\s*\{[^}]*BitmapLayer/s);
    expect(scene).not.toContain("new BitmapLayer");
    expect(scene).not.toContain("loadEarthSurfaceTiles");
    expect(scene).not.toContain("createSurfaceUnderlay");
  });
});
