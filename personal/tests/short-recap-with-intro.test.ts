import { describe, expect, it } from "vitest";
import {
  buildContinuousCalendar,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import {
  VERTICAL_EXPORT_TIMING,
  buildVerticalCalendarLayout,
  buildVerticalFrameState,
} from "../scene/vertical-calendar-model";

describe("one-second four-year recap after a one-second intro", () => {
  it("keeps the master at 60 seconds while halving the recap", () => {
    expect(VERTICAL_EXPORT_TIMING).toMatchObject({
      durationSeconds: 60,
      introSeconds: 1,
      traversalSeconds: 58,
      overviewTransitionSeconds: 0.5,
      overviewHoldSeconds: 0.5,
      frameCount: 3_600,
    });
    expect(
      VERTICAL_EXPORT_TIMING.introSeconds
      + VERTICAL_EXPORT_TIMING.traversalSeconds
      + VERTICAL_EXPORT_TIMING.overviewTransitionSeconds
      + VERTICAL_EXPORT_TIMING.overviewHoldSeconds,
    ).toBe(60);
  });

  it("starts the recap at 59 seconds and settles the four-year stack by 59.5 seconds", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const before = buildVerticalFrameState(3_539, calendar, layout, VERTICAL_EXPORT_TIMING);
    const transition = buildVerticalFrameState(3_540, calendar, layout, VERTICAL_EXPORT_TIMING);
    const settled = buildVerticalFrameState(3_570, calendar, layout, VERTICAL_EXPORT_TIMING);
    const final = buildVerticalFrameState(3_599, calendar, layout, VERTICAL_EXPORT_TIMING);

    expect(before.isOverview).toBe(false);
    expect(transition.isOverview).toBe(true);
    expect(transition.overviewProgress).toBe(0);
    expect(settled.overviewSettled).toBe(true);
    expect(final.overviewSettled).toBe(true);
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
    generatedAt: "2026-09-01T00:00:00.000Z",
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
