import { describe, expect, it } from "vitest";
import {
  FPS,
  addDays,
  buildContinuousCalendar,
  formatDate,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import {
  VERTICAL_HISTORY_VISIBILITY_MODE,
  buildVerticalCalendarLayout,
  buildVerticalFrameState,
  verticalCellDistanceOpacity,
} from "../scene/vertical-calendar-model";

describe("projection-only contribution history visibility", () => {
  it("keeps old completed days at full opacity while perspective compresses them", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const state = buildVerticalFrameState(31 * FPS, calendar, layout);
    const historyOffsets = [7, 35, 140];

    expect(VERTICAL_HISTORY_VISIBILITY_MODE).toBe("perspective-distance-only");
    for (const offset of historyOffsets) {
      const cell = layout.cells[state.activeDayOrdinal - offset];
      expect(verticalCellDistanceOpacity(
        cell,
        state,
        VERTICAL_HISTORY_VISIBILITY_MODE,
      )).toBe(1);
    }
  });
});

function snapshot(): OwnerProjectContributionSnapshot {
  const start = new Date("2023-01-01T00:00:00.000Z");
  const days: ContributionDay[] = Array.from({ length: 1_340 }, (_, index) => ({
    date: formatDate(addDays(start, index)),
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
    years: [...new Set(days.map((day) => Number(day.date.slice(0, 4))))].map((year) => {
      const yearDays = days.filter((day) => day.date.startsWith(String(year)));
      return {
        year,
        totalContributions: yearDays.length,
        attributedContributions: yearDays.length,
        days: yearDays,
      };
    }),
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
