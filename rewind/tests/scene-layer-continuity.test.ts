import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("fitness rewind imagery continuity", () => {
  it("keeps one TileLayer identity while zoom changes within a projection", () => {
    const source = readFileSync(new URL("../scene/scene.ts", import.meta.url), "utf8");
    expect(source).toContain(
      "id: `fitness-rewind-world-imagery-${projectionBucket}`"
    );
    expect(source).not.toContain("-${projectionBucket}-z${zoomBucket}");
  });

  it("keeps the native tile pyramid visible instead of stretching cluster bitmaps", () => {
    const source = readFileSync(new URL("../scene/scene.ts", import.meta.url), "utf8");
    expect(source).not.toContain("closeImageryBlend");
    expect(source).not.toContain("createMemoryImageryLayers");
    expect(source).not.toContain("memoryImagerySpec");
    expect(source).toContain('cullMode: "back"');
    expect(source).toContain('depthCompare: "always"');
    expect(source).toContain("depthWriteEnabled: false");
    expect(source).toContain("tileY === 0 ? 90 : north");
    expect(source).toContain("tileY === tileCount - 1 ? -90 : south");
  });

  it("contains no pixelated surface or export-image fallback", () => {
    const scene = readFileSync(new URL("../scene/scene.ts", import.meta.url), "utf8");
    const contract = readFileSync(
      new URL("../scene/clip-contract.ts", import.meta.url),
      "utf8"
    );
    const renderer = readFileSync(
      new URL("../render.mts", import.meta.url),
      "utf8"
    );
    expect(scene).not.toContain("createSurfaceLayer");
    expect(scene).not.toContain("loadEarthSurfaceColors");
    expect(scene).not.toContain("fitness-rewind-surface-underlay");
    expect(contract).not.toContain("fallbackImageUrl");
    expect(contract).not.toContain("MapServer/export");
    expect(contract).toContain('tileUrl: "/world-imagery/{z}/{y}/{x}.jpg"');
    expect(scene).toContain("getTileData: loadWorldImageryTile");
    expect(scene).toContain("World Imagery tile failed after retries.");
    expect(renderer).toContain("WORLD_IMAGERY_CACHE");
    expect(renderer).toContain("loadCachedWorldImageryTile");
  });

  it("waits for one coherent imagery level instead of mixing parent and child tiles", () => {
    const contract = readFileSync(
      new URL("../scene/clip-contract.ts", import.meta.url),
      "utf8"
    );
    expect(contract).toContain('refinementStrategy: "no-overlap"');
    expect(contract).not.toContain('refinementStrategy: "best-available"');
  });
});
