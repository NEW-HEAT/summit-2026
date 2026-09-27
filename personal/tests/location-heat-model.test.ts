import { describe, expect, it } from "vitest";
import type {
  ContributionDay,
  OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import {
  LOCATION_HEAT_MATCH_POLICY,
  LOCATION_HEAT_QUANTIZATION_DEGREES,
  buildCommitLocationHeat,
  type PrivateLocationArchive,
} from "../scene/location-heat-model";

describe("private contribution location heat", () => {
  it("maps only exact local-date route evidence and preserves attributed volume", () => {
    const dataset = buildCommitLocationHeat(snapshot(), archive());

    expect(dataset.locationEvidence).toBe(LOCATION_HEAT_MATCH_POLICY);
    expect(dataset.quantizationDegrees).toBe(LOCATION_HEAT_QUANTIZATION_DEGREES);
    expect(dataset.metrics).toMatchObject({
      activeContributionDays: 3,
      matchedContributionDays: 2,
      unmatchedContributionDays: 1,
      contributionVolume: 21,
      locatedContributionVolume: 15,
    });
    expect(dataset.metrics.exactDayMatchRate).toBeCloseTo(2 / 3);
    expect(dataset.points.reduce((sum, point) => sum + point.volume, 0)).toBeCloseTo(15);
    expect(dataset.points.map((point) => point.date)).not.toContain("2023-01-03");
  });

  it("quantizes private route centers into broad one-degree heat cells", () => {
    const dataset = buildCommitLocationHeat(snapshot(), archive());
    const first = dataset.points.find((point) => point.date === "2023-01-01")!;

    expect(first.longitude).toBe(-80);
    expect(first.latitude).toBe(26);
    expect(first.cellId).toBe("-80.0:26.0");
  });
});

function snapshot(): OwnerProjectContributionSnapshot {
  const days: ContributionDay[] = [
    day("2023-01-01", 10),
    day("2023-01-02", 5),
    day("2023-01-03", 6),
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
    level: 4,
    attributedCount: count,
    unattributedCount: 0,
    overflowCount: 0,
    projects: [{
      repository: "NEW-HEAT/NEWHEAT",
      visibility: "private",
      count,
      commits: count,
      pullRequests: 0,
      issues: 0,
      reviews: 0,
    }],
  };
}

function archive(): PrivateLocationArchive {
  return {
    status: "ready",
    ownerFingerprint: "test-owner",
    routes: [
      // 02:00 UTC is still the prior local calendar date in New York.
      { startMs: Date.parse("2023-01-02T02:00:00.000Z"), center: [-80.32, 26.18] },
      { startMs: Date.parse("2023-01-02T18:00:00.000Z"), center: [-79.48, 25.62] },
      // This route is one day too late for the final contribution day and must not backfill it.
      { startMs: Date.parse("2023-01-04T18:00:00.000Z"), center: [-81.1, 27.1] },
    ],
  };
}
