import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTRIBUTION_HEAT_BRIGHTNESS_FLOOR,
  CONTRIBUTION_IMPACT_WAVE_MAX_PIXELS,
  buildContributionImpactRings,
  contributionSettledHeatColor,
  type ContributionImpact,
} from "../scene/globe-impact-model";

describe("bright globe heat with compact pings", () => {
  it("keeps even low-volume organization heat bright and fully opaque", () => {
    const organizationColor: [number, number, number] = [248, 81, 73];
    const low = contributionSettledHeatColor(organizationColor, 1);
    const high = contributionSettledHeatColor(organizationColor, 64);

    expect(CONTRIBUTION_HEAT_BRIGHTNESS_FLOOR).toBeGreaterThanOrEqual(0.7);
    expect(low[0]).toBeGreaterThanOrEqual(
      Math.round(organizationColor[0] * CONTRIBUTION_HEAT_BRIGHTNESS_FLOOR),
    );
    expect(low[3]).toBe(255);
    expect(high[3]).toBe(255);
    expect(high[0]).toBeGreaterThan(low[0]);
  });

  it("caps contribution shockwaves well below the previous 72-pixel spread", () => {
    const impact: ContributionImpact = {
      id: "impact",
      position: [-80, 26],
      progress: 1,
      intensity: 1,
      volume: 64,
      organizationColor: [248, 81, 73],
      organizationIndex: 3,
    };
    const rings = buildContributionImpactRings([impact]);

    expect(CONTRIBUTION_IMPACT_WAVE_MAX_PIXELS).toBe(30);
    expect(Math.max(...rings.map((ring) => ring.radius)))
      .toBeLessThanOrEqual(CONTRIBUTION_IMPACT_WAVE_MAX_PIXELS);
  });

  it("keeps focus and training pings compact while preserving the solid bang core", () => {
    const source = readFileSync(new URL("../scene/globe-scene.ts", import.meta.url), "utf8");

    expect(source).toContain("radiusMaxPixels: CONTRIBUTION_IMPACT_WAVE_MAX_PIXELS");
    expect(source).toContain("radiusMaxPixels: 32");
    expect(source).toContain("radiusMaxPixels: 7");
    expect(source).toContain("radiusMaxPixels: 22");
    expect(source).not.toContain("radiusMaxPixels: 72");
  });

  it("locks the raised training and work brightness into export diagnostics", () => {
    const source = readFileSync(new URL("../scene/globe-scene.ts", import.meta.url), "utf8");

    expect(source).toContain("const strength = 0.46 + 0.46 * trainingIntensity");
    expect(source).toContain("settledWorkBrightnessFloor: CONTRIBUTION_HEAT_BRIGHTNESS_FLOOR");
    expect(source).toContain("settledTrainingBrightnessFloor: 0.46");
  });
});
