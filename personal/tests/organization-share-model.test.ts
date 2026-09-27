import { describe, expect, it } from "vitest";
import type {
  ContributionDay,
  OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import {
  buildOrganizationProgressTimeline,
  buildOrganizationShareSummary,
} from "../scene/organization-share-model";

describe("organization time and contribution shares", () => {
  it("uses active organization-days as the time proxy and apportions both percentages to 100", () => {
    const shares = buildOrganizationShareSummary(snapshot());
    const byKey = new Map(shares.map((share) => [share.key, share]));

    expect(shares.map((share) => share.key)).toEqual([
      "new-heat",
      "agriculture-intelligence",
      "visualpt",
      "visgl",
    ]);
    expect(byKey.get("new-heat")).toMatchObject({ activeDayCount: 2, contributionCount: 40 });
    expect(byKey.get("visgl")).toMatchObject({ activeDayCount: 1, contributionCount: 10 });
    expect(shares.reduce((sum, share) => sum + share.activeDayPercent, 0)).toBe(100);
    expect(shares.reduce((sum, share) => sum + share.contributionPercent, 0)).toBe(100);
  });

  it("builds a monotonic daily cumulative contribution timeline", () => {
    const progress = buildOrganizationProgressTimeline(snapshot());

    expect(progress).toHaveLength(2);
    expect(progress[0].cumulativeContributions).toMatchObject({
      "new-heat": 30,
      visgl: 10,
    });
    expect(progress[1].cumulativeContributions).toMatchObject({
      "new-heat": 40,
      visgl: 10,
    });
  });
});

function snapshot(): OwnerProjectContributionSnapshot {
  const days = [
    day("2023-01-01", [
      { repository: "NEW-HEAT/NEWHEAT", count: 30 },
      { repository: "visgl/deck.gl", count: 10 },
    ]),
    day("2023-01-02", [{ repository: "NEW-HEAT/NEWHEAT", count: 10 }]),
  ];
  return {
    schemaVersion: 2,
    login: "charlieforward9",
    generatedAt: "2026-08-31T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: days[0].date, to: days.at(-1)!.date },
    timezone: "America/New_York",
    projects: [],
    years: [{ year: 2023, totalContributions: 50, attributedContributions: 50, days }],
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

function day(
  date: string,
  projects: Array<{ repository: string; count: number }>,
): ContributionDay {
  const count = projects.reduce((sum, project) => sum + project.count, 0);
  return {
    date,
    count,
    level: 4,
    attributedCount: count,
    unattributedCount: 0,
    overflowCount: 0,
    projects: projects.map((project) => ({
      ...project,
      visibility: "private",
      commits: project.count,
      pullRequests: 0,
      issues: 0,
      reviews: 0,
    })),
  };
}
