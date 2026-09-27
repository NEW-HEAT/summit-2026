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
  VERTICAL_EXPORT_CONTRACT,
  VERTICAL_EXPORT_TIMING,
  buildVerticalCalendarLayout,
  buildVerticalFrameState,
} from "../scene/vertical-calendar-model";

describe("exact 60-second vertical export", () => {
  it("uses a one-second intro, 58 seconds for 32 sections, then a half-second stack and hold", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const stateAt = (frameIndex: number) => buildVerticalFrameState(
      frameIndex,
      calendar,
      layout,
      VERTICAL_EXPORT_TIMING,
    );

    expect(VERTICAL_EXPORT_CONTRACT.durationSeconds).toBe(60);
    expect(VERTICAL_EXPORT_CONTRACT.frameCount).toBe(3_600);
    expect(VERTICAL_EXPORT_CONTRACT.introSeconds).toBe(1);
    expect(VERTICAL_EXPORT_CONTRACT.traversalSeconds).toBe(58);
    expect(VERTICAL_EXPORT_CONTRACT.sectionCount).toBe(32);
    expect(VERTICAL_EXPORT_CONTRACT.sectionSeconds).toBe(1.8125);
    expect(VERTICAL_EXPORT_CONTRACT.overviewTransitionSeconds).toBe(0.5);
    expect(VERTICAL_EXPORT_CONTRACT.overviewHoldSeconds).toBe(0.5);
    expect(stateAt(59 * FPS - 1).isOverview).toBe(false);
    expect(stateAt(59 * FPS).isOverview).toBe(true);
    expect(stateAt(59.5 * FPS).overviewSettled).toBe(true);
    expect(stateAt(VERTICAL_EXPORT_CONTRACT.frameCount - 1).overviewSettled).toBe(true);
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
