import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  ContributionDay,
  OwnerProjectContributionSnapshot,
  OrganizationKey,
} from "../scene/calendar-model";
import {
  buildContributionImpactRings,
  buildContributionImpacts,
} from "../scene/globe-impact-model";
import {
  buildCommitLocationHeat,
  type PrivateLocationArchive,
} from "../scene/location-heat-model";

const EXPECTED_COLORS: Record<Exclude<OrganizationKey, "misc">, [number, number, number]> = {
  "new-heat": [248, 81, 73],
  "agriculture-intelligence": [57, 211, 83],
  visualpt: [88, 166, 255],
  visgl: [163, 113, 247],
};

describe("discrete organization colors on the contribution globe", () => {
  it("splits one located day into exact organization-colored work points", () => {
    const dataset = buildCommitLocationHeat(snapshot(), archive());
    const byOrganization = new Map(dataset.points.map((point) => [point.organizationKey, point]));

    expect([...byOrganization.keys()]).toEqual(Object.keys(EXPECTED_COLORS));
    for (const [key, color] of Object.entries(EXPECTED_COLORS)) {
      expect(byOrganization.get(key as OrganizationKey)?.organizationColor).toEqual(color);
    }
    expect(dataset.points.reduce((sum, point) => sum + point.volume, 0)).toBe(14);
  });

  it("keeps impact RGB equal to the organization palette and disables work blending", () => {
    const points = buildCommitLocationHeat(snapshot(), archive()).points;
    const rings = buildContributionImpactRings(buildContributionImpacts(points, 1, 5));
    const ringColors = new Set(rings.map((ring) => ring.color.slice(0, 3).join(",")));

    expect(ringColors).toEqual(new Set(Object.values(EXPECTED_COLORS).map((color) => color.join(","))));
    const source = readFileSync(new URL("../scene/globe-scene.ts", import.meta.url), "utf8");
    expect(source).toContain("contribution-globe-discrete-organization-volume-rings");
    expect(source).toContain("parameters: { blend: false }");
    expect(source).not.toContain("contribution-globe-heat-glow");
    expect(source).not.toContain("contribution-globe-heat-core");
  });
});

function snapshot(): OwnerProjectContributionSnapshot {
  const day: ContributionDay = {
    date: "2023-01-01",
    count: 14,
    level: 4,
    attributedCount: 14,
    unattributedCount: 0,
    overflowCount: 0,
    projects: [
      project("NEW-HEAT/NEWHEAT", 2),
      project("Agriculture-Intelligence/agroview", 3),
      project("VisualPT/visualPT", 4),
      project("visgl/deck.gl", 5),
    ],
  };
  return {
    schemaVersion: 2,
    login: "charlieforward9",
    generatedAt: "2026-08-31T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: day.date, to: day.date },
    timezone: "America/New_York",
    projects: [],
    years: [{ year: 2023, totalContributions: 14, attributedContributions: 14, days: [day] }],
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

function project(repository: string, count: number) {
  return {
    repository,
    visibility: "private" as const,
    count,
    commits: count,
    pullRequests: 0,
    issues: 0,
    reviews: 0,
  };
}

function archive(): PrivateLocationArchive {
  return {
    status: "ready",
    ownerFingerprint: "test-owner",
    routes: [{
      startMs: Date.parse("2023-01-01T16:00:00.000Z"),
      center: [-80.31, 26.19],
      activityType: "Ride",
    }],
  };
}
