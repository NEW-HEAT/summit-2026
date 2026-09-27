import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  ContributionDay,
  OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import { CONTRIBUTION_GLOBE_LAYOUT } from "../scene/globe-layout";
import {
  LOCATION_HEAT_SCHEMA_VERSION,
  buildCommitLocationHeat,
  type PrivateLocationArchive,
} from "../scene/location-heat-model";

describe("high-fidelity work and training globe", () => {
  it("uses a textured atlas and 32 stable contribution-focus sections without a spin contract", () => {
    expect(CONTRIBUTION_GLOBE_LAYOUT.meshResolutionDegrees).toBeLessThanOrEqual(0.5);
    expect(CONTRIBUTION_GLOBE_LAYOUT.earthAtlasColumns * CONTRIBUTION_GLOBE_LAYOUT.earthAtlasRows).toBe(32);
    expect(CONTRIBUTION_GLOBE_LAYOUT.focusSectionCount).toBe(32);
    expect(CONTRIBUTION_GLOBE_LAYOUT.focusTransitionFraction).toBeLessThan(0.25);
    expect(CONTRIBUTION_GLOBE_LAYOUT).not.toHaveProperty("spinDegrees");
  });

  it("keeps every training route in range while locating work on exact matching days only", () => {
    const dataset = buildCommitLocationHeat(snapshot(), archive());

    expect(dataset.schemaVersion).toBe(LOCATION_HEAT_SCHEMA_VERSION);
    expect(dataset.metrics).toMatchObject({
      activeContributionDays: 2,
      matchedContributionDays: 2,
      trainingRouteCount: 4,
      trainingLocationCellCount: 3,
      trainingByActivity: { ride: 2, run: 1, hike: 0, swim: 1, other: 0 },
    });
    expect(dataset.trainingPoints.map((point) => point.date)).toContain("2023-01-02");
    expect(dataset.points.map((point) => point.date)).not.toContain("2023-01-02");
    expect(dataset.trainingPoints.reduce((sum, point) => sum + point.routeCount, 0)).toBe(4);
    expect(dataset.trainingPoints.every((point) => Number.isInteger(point.longitude))).toBe(true);
    expect(dataset.trainingPoints.every((point) => Number.isInteger(point.latitude))).toBe(true);
    expect(dataset.trainingPoints.every((point) => !("paths" in point))).toBe(true);
  });

  it("does not render ArcLayer while GlobeView clipping remains deferred", () => {
    const sceneSource = readFileSync(new URL("../scene/globe-scene.ts", import.meta.url), "utf8");

    expect(sceneSource).not.toContain("ArcLayer");
    expect(sceneSource).not.toContain("greatCircle");
    expect(sceneSource).not.toContain("buildLocationArcs");
  });
});

function snapshot(): OwnerProjectContributionSnapshot {
  const days = [
    day("2023-01-01", 8),
    day("2023-01-02", 0),
    day("2023-01-03", 13),
  ];
  return {
    schemaVersion: 2,
    login: "charlieforward9",
    generatedAt: "2026-08-31T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: days[0].date, to: days.at(-1)!.date },
    timezone: "America/New_York",
    projects: [{ repository: "NEW-HEAT/NEWHEAT", visibility: "private", count: 21 }],
    years: [{
      year: 2023,
      totalContributions: 21,
      attributedContributions: 21,
      days,
    }],
    provenance: {
      authenticated: true,
      visibility: "owner-visible-projects",
      approval: "test",
      endpoints: ["test"],
      restrictedContributionsByYear: [],
      note: "test",
    },
  };
}

function day(date: string, count: number): ContributionDay {
  return {
    date,
    count,
    level: count > 0 ? 4 : 0,
    attributedCount: count,
    unattributedCount: 0,
    overflowCount: 0,
    projects: count > 0 ? [{
      repository: "NEW-HEAT/NEWHEAT",
      visibility: "private",
      count,
      commits: count,
      pullRequests: 0,
      issues: 0,
      reviews: 0,
    }] : [],
  };
}

function archive(): PrivateLocationArchive {
  return {
    status: "ready",
    ownerFingerprint: "test-owner",
    routes: [
      { startMs: Date.parse("2023-01-01T16:00:00.000Z"), center: [-80.31, 26.19], activityType: "Ride" },
      { startMs: Date.parse("2023-01-01T20:00:00.000Z"), center: [-80.29, 26.21], activityType: "CYCLING" },
      { startMs: Date.parse("2023-01-02T16:00:00.000Z"), center: [8.52, 47.38], activityType: "Run" },
      { startMs: Date.parse("2023-01-03T16:00:00.000Z"), center: [151.21, -33.87], activityType: "OPEN_WATER_SWIMMING" },
    ],
  };
}
