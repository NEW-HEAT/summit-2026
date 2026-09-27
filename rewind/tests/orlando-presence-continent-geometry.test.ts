import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ORLANDO_PRESENCE_CONTRACT,
  orlandoPresenceFrame,
} from "../orlando-presence/contract";

describe("Orlando satellite-to-continent geometry continuation", () => {
  it("crossfades monotonically from satellite imagery to continent geometry", () => {
    const frames = Array.from(
      { length: ORLANDO_PRESENCE_CONTRACT.frameCount },
      (_, index) => orlandoPresenceFrame(index)
    );
    expect(frames[0].continentProgress).toBe(0);
    expect(frames[frames.length - 1].continentProgress).toBe(1);
    expect(frames[10].continentProgress).toBe(0);
    expect(frames[120].continentProgress).toBeGreaterThan(0.45);
    expect(frames[120].continentProgress).toBeLessThan(0.55);
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index].continentProgress).toBeGreaterThanOrEqual(
        frames[index - 1].continentProgress
      );
    }
  });

  it("uses local Natural Earth PolygonLayer land with clipped back faces and no ocean geometry", () => {
    const sceneSource = readFileSync(
      new URL("../orlando-presence/scene.ts", import.meta.url),
      "utf8"
    );
    const rendererSource = readFileSync(
      new URL("../orlando-presence/render.mts", import.meta.url),
      "utf8"
    );
    expect(sceneSource).toContain("../scene/ne_50m_land.json");
    expect(sceneSource).toContain("new PolygonLayer<ContinentPolygon>");
    expect(sceneSource).toContain("class HorizonClipExtension");
    expect(sceneSource).toContain("orlandoHorizonVisibility < 0.002");
    expect(sceneSource).toContain("discard;");
    expect(sceneSource).toContain('cullMode: "back"');
    expect(sceneSource).toContain("depthWriteEnabled: true");
    expect(sceneSource).toContain(
      'const continentOpacity = renderStyle === "continents" ? 1 : 0;'
    );
    expect(sceneSource).toContain("1 - currentFrame.continentProgress");
    expect(sceneSource).toContain("const markerOpacity = satelliteOpacity;");
    expect(sceneSource).toContain("forceContinentGeometry");
    expect(rendererSource).toContain("--continent-composite-only");
    expect(rendererSource).toContain("[continents][satellite]overlay=0:0");
    expect(rendererSource).not.toContain("[satellite][continents]overlay=0:0");
    expect(rendererSource).not.toContain(
      "fade=t=in:st=${transitionStartSeconds}"
    );
    expect(ORLANDO_PRESENCE_CONTRACT.continentGeometry).toMatchObject({
      oceanOpacity: 0,
      backgroundOpacity: 0,
      cullMode: "back",
    });
  });
});
