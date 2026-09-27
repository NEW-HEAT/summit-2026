import { describe, expect, it } from "vitest";
import {
  ORGANIZATION_GROUPS,
  buildContinuousCalendar,
  buildOrganizationSlices,
  organizationKeyForRepository,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import { buildOrganizationLegendChapters } from "../scene/legend-track";

const day = {
  date: "2026-08-30",
  count: 21,
  level: 4 as const,
  attributedCount: 18,
  unattributedCount: 3,
  overflowCount: 0,
  projects: [
    { repository: "NEW-HEAT/NEWHEAT", visibility: "private" as const, count: 7, commits: 7, pullRequests: 0, issues: 0, reviews: 0 },
    { repository: "Agriculture-Intelligence/agroview-client", visibility: "private" as const, count: 5, commits: 5, pullRequests: 0, issues: 0, reviews: 0 },
    { repository: "VisualPT/visualPT", visibility: "private" as const, count: 3, commits: 3, pullRequests: 0, issues: 0, reviews: 0 },
    { repository: "visgl/deck.gl", visibility: "public" as const, count: 2, commits: 2, pullRequests: 0, issues: 0, reviews: 0 },
    { repository: "someone/else", visibility: "public" as const, count: 1, commits: 1, pullRequests: 0, issues: 0, reviews: 0 },
  ],
};

function makeSnapshot(): OwnerProjectContributionSnapshot {
  return {
    schemaVersion: 2,
    login: "example",
    generatedAt: "2026-08-30T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: day.date, to: day.date },
    timezone: "America/New_York",
    projects: day.projects.map(({ repository, visibility, count }) => ({ repository, visibility, count })),
    years: [{ year: 2026, totalContributions: day.count, attributedContributions: day.attributedCount, days: [day] }],
    provenance: {
      authenticated: true,
      visibility: "owner-visible-projects",
      approval: "test",
      endpoints: ["test"],
      restrictedContributionsByYear: [{ year: 2026, count: 15 }],
      note: "test",
    },
  };
}

describe("organization-level contribution buckets", () => {
  it("maps the four selected owners and sends every other owner to Misc", () => {
    expect(organizationKeyForRepository("NEW-HEAT/NEWHEAT")).toBe("new-heat");
    expect(organizationKeyForRepository("agriculture-intelligence/agroview-client")).toBe("agriculture-intelligence");
    expect(organizationKeyForRepository("VisualPT/visualPT")).toBe("visualpt");
    expect(organizationKeyForRepository("visgl/deck.gl")).toBe("visgl");
    expect(organizationKeyForRepository("charlieforward9/example")).toBe("misc");
  });

  it("folds outside owners and unattributed remainder into one Misc slice", () => {
    expect(buildOrganizationSlices(day).map(({ key, count }) => [key, count])).toEqual([
      ["new-heat", 7],
      ["agriculture-intelligence", 5],
      ["visualpt", 3],
      ["visgl", 2],
      ["misc", 4],
    ]);
  });

  it("keeps all five legend rows stable even when a chapter has zero volume", () => {
    const chapters = buildOrganizationLegendChapters(buildContinuousCalendar(makeSnapshot()));
    expect(chapters[0].entries.map((entry) => entry.label)).toEqual(ORGANIZATION_GROUPS.map((group) => group.label));
    expect(chapters[0].entries.map((entry) => entry.count)).toEqual([7, 5, 3, 2, 4]);
    expect(chapters[0].hiddenProjectCount).toBe(0);
  });
});
