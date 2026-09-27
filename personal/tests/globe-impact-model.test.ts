import { describe, expect, it } from "vitest";
import type {
  CommitLocationHeatPoint,
} from "../scene/location-heat-model";
import {
  buildContributionImpactRings,
  buildContributionImpacts,
  contributionImpactFlashStyle,
} from "../scene/globe-impact-model";

describe("contribution arrival impacts", () => {
  it("starts on the exact reveal boundary and expires after the impact window", () => {
    const point = contributionPoint({ dayOrdinal: 9, volume: 12 });

    expect(buildContributionImpacts([point], 9.99, 12)).toEqual([]);
    expect(buildContributionImpacts([point], 10, 12)).toMatchObject([{ progress: 0 }]);
    expect(buildContributionImpacts([point], 14, 12)).toMatchObject([{ progress: 0.5 }]);
    expect(buildContributionImpacts([point], 18, 12)).toEqual([]);
  });

  it("makes higher-volume contribution days hit harder", () => {
    const impacts = buildContributionImpacts([
      contributionPoint({ id: "low", volume: 1 }),
      contributionPoint({ id: "high", volume: 32 }),
    ], 1, 32);

    expect(impacts[1].intensity).toBeGreaterThan(impacts[0].intensity);
    expect(contributionImpactFlashStyle(impacts[1]).radius)
      .toBeGreaterThan(contributionImpactFlashStyle(impacts[0]).radius);
  });

  it("emits staggered expanding shockwaves with a short central flash", () => {
    const [impact] = buildContributionImpacts([contributionPoint({ volume: 32 })], 5.8, 32);
    const rings = buildContributionImpactRings([impact]);

    expect(rings).toHaveLength(3);
    expect(rings[0].radius).toBeGreaterThan(rings[1].radius);
    expect(rings[1].radius).toBeGreaterThan(rings[2].radius);
    expect(rings[0].color[3]).toBeLessThan(rings[2].color[3]);
    expect(rings.every((ring) => ring.color.slice(0, 3).join(",") === "248,81,73")).toBe(true);
    expect(contributionImpactFlashStyle({ ...impact, progress: 0 }).alpha).toBe(255);
    expect(contributionImpactFlashStyle({ ...impact, progress: 0.5 }).alpha).toBe(0);
  });
});

function contributionPoint(overrides: Partial<CommitLocationHeatPoint> = {}): CommitLocationHeatPoint {
  return {
    id: "point",
    date: "2023-01-01",
    dayOrdinal: 0,
    cellId: "-80:26",
    longitude: -80,
    latitude: 26,
    organizationKey: "new-heat",
    organizationColor: [248, 81, 73],
    organizationIndex: 0,
    volume: 8,
    ...overrides,
  };
}
