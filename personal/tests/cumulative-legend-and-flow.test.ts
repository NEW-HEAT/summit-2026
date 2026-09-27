import { describe, expect, it } from "vitest";
import {
  CELL_SIZE,
  DURATION_SECONDS,
  FPS,
  FRAME_COUNT,
  ORGANIZATION_GROUPS,
  OVERVIEW_HOLD_SECONDS,
  TRAVERSAL_SECONDS,
  buildContinuousCalendar,
  dayRevealWidth,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import { buildOrganizationLegendTimeline } from "../scene/legend-track";

function makeSnapshot(): OwnerProjectContributionSnapshot {
  const days = [
    {
      date: "2026-08-29",
      count: 4,
      level: 2 as const,
      attributedCount: 3,
      unattributedCount: 1,
      overflowCount: 0,
      projects: [{ repository: "NEW-HEAT/NEWHEAT", visibility: "private" as const, count: 3, commits: 3, pullRequests: 0, issues: 0, reviews: 0 }],
    },
    {
      date: "2026-08-30",
      count: 7,
      level: 3 as const,
      attributedCount: 7,
      unattributedCount: 0,
      overflowCount: 0,
      projects: [
        { repository: "Agriculture-Intelligence/agroview-client", visibility: "private" as const, count: 5, commits: 5, pullRequests: 0, issues: 0, reviews: 0 },
        { repository: "VisualPT/visualPT", visibility: "private" as const, count: 2, commits: 2, pullRequests: 0, issues: 0, reviews: 0 },
      ],
    },
  ];
  return {
    schemaVersion: 2,
    login: "example",
    generatedAt: "2026-08-30T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: days[0].date, to: days[1].date },
    timezone: "America/New_York",
    projects: [],
    years: [{ year: 2026, totalContributions: 11, attributedContributions: 10, days }],
    provenance: { authenticated: true, visibility: "owner-visible-projects", approval: "test", endpoints: ["test"], restrictedContributionsByYear: [], note: "test" },
  };
}

describe("cumulative legend and left-to-right journey", () => {
  it("uses 62 seconds of traversal plus a two-second synchronized overview hold", () => {
    expect(TRAVERSAL_SECONDS).toBe(62);
    expect(OVERVIEW_HOLD_SECONDS).toBe(2);
    expect(DURATION_SECONDS).toBe(64);
    expect(FRAME_COUNT).toBe(FPS * 64);
  });

  it("uses the requested stable organization palette", () => {
    expect(Object.fromEntries(ORGANIZATION_GROUPS.map((group) => [group.key, group.color]))).toEqual({
      "new-heat": "#f85149",
      "agriculture-intelligence": "#39d353",
      visualpt: "#58a6ff",
      visgl: "#a371f7",
      misc: "#8b949e",
    });
  });

  it("reveals a date from zero width through half width to full width", () => {
    expect(dayRevealWidth(100, 93)).toBe(0);
    expect(dayRevealWidth(100, 100)).toBe(CELL_SIZE / 2);
    expect(dayRevealWidth(100, 107)).toBe(CELL_SIZE);
  });

  it("keeps every organization total monotonically nondecreasing", () => {
    const timeline = buildOrganizationLegendTimeline(buildContinuousCalendar(makeSnapshot()));
    expect(timeline.entriesByDay[0].map((entry) => entry.count)).toEqual([3, 0, 0, 0, 1]);
    expect(timeline.entriesByDay[1].map((entry) => entry.count)).toEqual([3, 5, 2, 0, 1]);
    for (let dayIndex = 1; dayIndex < timeline.entriesByDay.length; dayIndex += 1) {
      for (let groupIndex = 0; groupIndex < ORGANIZATION_GROUPS.length; groupIndex += 1) {
        expect(timeline.entriesByDay[dayIndex][groupIndex].count).toBeGreaterThanOrEqual(timeline.entriesByDay[dayIndex - 1][groupIndex].count);
      }
    }
  });
});
