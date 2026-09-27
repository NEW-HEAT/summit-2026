import { describe, expect, it } from "vitest";
import {
  buildContributionFocusBeats,
  contributionFocusFrame,
} from "../scene/globe-focus-model";
import type {
  CommitLocationHeatPoint,
  ContributionLocationZone,
} from "../scene/location-heat-model";

describe("32 contribution-area focus beats", () => {
  it("selects the highest-volume cell inside each time section and carries only empty sections", () => {
    const beats = buildContributionFocusBeats(points(), zones(), {
      from: "2023-01-01",
      to: "2023-02-01",
    }, 32, 32);

    expect(beats).toHaveLength(32);
    expect(beats[0]).toMatchObject({
      longitude: -80,
      latitude: 26,
      volume: 18,
      organizationKey: "new-heat",
      organizationColor: [248, 81, 73],
      source: "section-dominant-contribution-cell",
      locationPrimary: "Boynton Beach",
      locationSecondary: "Florida · United States",
    });
    expect(beats[1]).toMatchObject({
      longitude: -80,
      latitude: 26,
      volume: 0,
      source: "carry-forward",
    });
    expect(beats[2]).toMatchObject({
      longitude: 2,
      latitude: 41,
      source: "section-dominant-contribution-cell",
      locationPrimary: "Barcelona",
    });
  });

  it("uses one short shortest-path settle per section and then holds", () => {
    const beats = buildContributionFocusBeats(points(), zones(), {
      from: "2023-01-01",
      to: "2023-02-01",
    }, 32, 32);
    const moving = contributionFocusFrame((2 + 0.11) / 32, beats, 0.22);
    const held = contributionFocusFrame((2 + 0.8) / 32, beats, 0.22);

    expect(moving.sectionIndex).toBe(2);
    expect(moving.longitude).toBeGreaterThan(-80);
    expect(moving.longitude).toBeLessThan(2);
    expect(moving.pulse).toBeGreaterThan(0);
    expect(held.longitude).toBe(2);
    expect(held.latitude).toBe(41);
    expect(held.pulse).toBe(0);
  });
});

function points(): CommitLocationHeatPoint[] {
  return [
    point("a", 0, -80, 26, 18),
    point("b", 0, -79, 35, 4),
    point("c", 2, 2, 41, 9),
  ];
}

function point(id: string, dayOrdinal: number, longitude: number, latitude: number, volume: number) {
  return {
    id,
    cellId: `${longitude}:${latitude}`,
    date: `2023-01-${String(dayOrdinal + 1).padStart(2, "0")}`,
    dayOrdinal,
    longitude,
    latitude,
    organizationKey: "new-heat" as const,
    organizationColor: [248, 81, 73] as [number, number, number],
    organizationIndex: 0,
    volume,
    routeCount: 1,
  };
}

function zones(): ContributionLocationZone[] {
  return [
    {
      id: "boynton",
      longitude: -80,
      latitude: 26,
      collectionRadiusKm: 70,
      location: {
        cityOrRegion: "Boynton Beach",
        state: "Florida",
        country: "United States",
      },
    },
    {
      id: "barcelona",
      longitude: 2,
      latitude: 41,
      collectionRadiusKm: 70,
      location: {
        cityOrRegion: "Barcelona",
        state: "Catalonia",
        country: "Spain",
      },
    },
  ];
}
