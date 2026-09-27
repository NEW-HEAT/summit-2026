import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("monochrome contribution basemap", () => {
  it("uses the dark gray cartographic canvas and leaves saturated color to the data layers", () => {
    const sceneSource = readFileSync(new URL("../scene/globe-scene.ts", import.meta.url), "utf8");

    expect(sceneSource).toContain("Canvas/World_Dark_Gray_Base/MapServer/export");
    expect(sceneSource).toContain("desaturate: 1");
    expect(sceneSource).toContain("Esri World Dark Gray Canvas atlas");
    expect(sceneSource).not.toContain("World_Imagery/MapServer/export");
  });
});
