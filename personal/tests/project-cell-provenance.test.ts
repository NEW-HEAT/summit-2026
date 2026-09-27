import { describe, expect, it } from "vitest";
import { buildContinuousCalendar, type OwnerProjectContributionSnapshot } from "../scene/calendar-model";

describe("project contribution cell provenance", () => {
  it("carries the complete daily project payload from the owner snapshot into the screen cell", () => {
    const snapshot: OwnerProjectContributionSnapshot = {
      schemaVersion: 2,
      login: "example",
      generatedAt: "2026-08-30T00:00:00.000Z",
      source: "github-authenticated-owner-project-events",
      dateRange: { from: "2026-08-30", to: "2026-08-30" },
      timezone: "America/New_York",
      projects: [{ repository: "NEW-HEAT/NEWHEAT", visibility: "private", count: 11 }],
      years: [{
        year: 2026,
        totalContributions: 13,
        attributedContributions: 11,
        days: [{
          date: "2026-08-30",
          count: 13,
          level: 4,
          attributedCount: 11,
          unattributedCount: 2,
          overflowCount: 0,
          projects: [{
            repository: "NEW-HEAT/NEWHEAT",
            visibility: "private",
            count: 11,
            commits: 11,
            pullRequests: 0,
            issues: 0,
            reviews: 0,
          }],
        }],
      }],
      provenance: {
        authenticated: true,
        visibility: "owner-visible-projects",
        approval: "test",
        endpoints: ["test"],
        restrictedContributionsByYear: [{ year: 2026, count: 11 }],
        note: "test",
      },
    };

    const cell = buildContinuousCalendar(snapshot).cells.find((candidate) => candidate.date === "2026-08-30");
    expect(cell).toMatchObject({
      attributedCount: 11,
      unattributedCount: 2,
      overflowCount: 0,
      projects: [{ repository: "NEW-HEAT/NEWHEAT", count: 11 }],
    });
  });
});
