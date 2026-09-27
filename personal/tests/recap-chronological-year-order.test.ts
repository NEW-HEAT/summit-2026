import { describe, expect, it } from "vitest";
import {
  buildContinuousCalendar,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import { buildVerticalCalendarLayout } from "../scene/vertical-calendar-model";

describe("chronological final recap", () => {
  it("places 2023 at the top and 2026 at the bottom of the rendered stack", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const averageY = (year: number) => {
      const poses = calendar.dataDays
        .filter((day) => day.date.startsWith(`${year}-`))
        .map((day) => layout.overviewByDate.get(day.date)!)
        .filter(Boolean);
      return poses.reduce((sum, pose) => sum + pose.y, 0) / poses.length;
    };

    // The final OrbitView projects larger Cartesian Y values higher on screen.
    expect(averageY(2023)).toBeGreaterThan(averageY(2024));
    expect(averageY(2024)).toBeGreaterThan(averageY(2025));
    expect(averageY(2025)).toBeGreaterThan(averageY(2026));
  });
});

function snapshot(): OwnerProjectContributionSnapshot {
  const days = [2023, 2024, 2025, 2026].map((year): ContributionDay => ({
    date: `${year}-01-01`,
    count: 1,
    level: 1,
    attributedCount: 1,
    unattributedCount: 0,
    overflowCount: 0,
    projects: [{
      repository: "visgl/deck.gl",
      visibility: "public",
      count: 1,
      commits: 1,
      pullRequests: 0,
      issues: 0,
      reviews: 0,
    }],
  }));
  return {
    schemaVersion: 2,
    login: "charlieforward9",
    generatedAt: "2026-08-31T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: days[0].date, to: days.at(-1)!.date },
    timezone: "America/New_York",
    projects: [],
    years: days.map((day) => ({
      year: Number(day.date.slice(0, 4)),
      totalContributions: day.count,
      attributedContributions: day.attributedCount!,
      days: [day],
    })),
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
