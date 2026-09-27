import { describe, expect, it } from "vitest";
import {
  addDays,
  buildContinuousCalendar,
  formatDate,
  parseDate,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import {
  VERTICAL_CELL_STEP,
  VERTICAL_RENDER_CONTRACT,
  buildVerticalCalendarLayout,
} from "../scene/vertical-calendar-model";

describe("continuous vertical contribution calendar", () => {
  it("uses one uninterrupted seven-column week ribbon across month boundaries", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const firstWeekday = parseDate(calendar.dataDays[0].date).getUTCDay();

    layout.cells.forEach((cell, dayOrdinal) => {
      const continuousSlot = firstWeekday + dayOrdinal;
      expect(cell.y).toBe(Math.floor(continuousSlot / 7) * VERTICAL_CELL_STEP);
    });

    for (const boundary of layout.monthBoundaries.slice(1)) {
      const firstDay = layout.cells[boundary.firstDayOrdinal];
      const previousDay = layout.cells[boundary.firstDayOrdinal - 1];
      expect(firstDay.y - previousDay.y).toBeGreaterThanOrEqual(0);
      expect(firstDay.y - previousDay.y).toBeLessThanOrEqual(VERTICAL_CELL_STEP);
      expect(boundary.y).toBe(firstDay.y);
    }

    expect(VERTICAL_RENDER_CONTRACT.calendarStructure).toBe("continuous-seven-column-week-ribbon");
    expect(VERTICAL_RENDER_CONTRACT.monthDividers).toBe("none");
  });
});

function snapshot(): OwnerProjectContributionSnapshot {
  const start = new Date("2023-01-01T00:00:00.000Z");
  const days: ContributionDay[] = Array.from({ length: 500 }, (_, index) => ({
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
