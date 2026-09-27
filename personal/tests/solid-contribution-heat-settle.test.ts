import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CommitLocationHeatPoint } from "../scene/location-heat-model";
import {
  buildContributionImpacts,
  contributionImpactFlashStyle,
  contributionSettledHeatRadius,
} from "../scene/globe-impact-model";

describe("solid contribution arrivals that settle into compact heat", () => {
  it("shrinks an opaque organization-colored arrival into a compact persistent radius", () => {
    const [impact] = buildContributionImpacts([contributionPoint()], 1, 32);
    const arrival = contributionImpactFlashStyle({ ...impact, progress: 0 });
    const settled = contributionImpactFlashStyle({ ...impact, progress: 0.44 });

    expect(arrival.radius).toBeLessThan(22);
    expect(settled.radius).toBeLessThan(arrival.radius);
    expect(settled.radius).toBeCloseTo(
      contributionSettledHeatRadius(impact.organizationIndex, impact.intensity),
      0,
    );
  });

  it("renders full-alpha filled flashes and a persistent discrete heat core", () => {
    const source = readFileSync(new URL("../scene/globe-scene.ts", import.meta.url), "utf8");

    expect(source).toContain('id: "contribution-globe-discrete-organization-heat-core"');
    expect(source).toMatch(/contribution-globe-discrete-organization-heat-core[\s\S]*?filled: true,[\s\S]*?stroked: false/);
    expect(source).toMatch(/contribution-globe-discrete-organization-impact-core[\s\S]*?filled: true,[\s\S]*?stroked: false/);
    expect(source).toContain("contributionImpactFlashes");
    expect(source).toContain("workColorMode: \"solid-discrete-organization-heat-contours\"");
    expect(source).not.toContain("contributionImpactFlashStyle(datum).alpha");
  });
});

function contributionPoint(): CommitLocationHeatPoint {
  return {
    id: "point",
    date: "2023-01-01",
    dayOrdinal: 0,
    cellId: "-80:26",
    longitude: -80,
    latitude: 26,
    organizationKey: "visgl",
    organizationColor: [163, 113, 247],
    organizationIndex: 3,
    volume: 32,
  };
}
