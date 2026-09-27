import { describe, expect, it } from "vitest";
import {
  EXIT_STACK_START_SECONDS,
  EXIT_START_SECONDS,
  FPS,
  FRAME_COUNT,
  HEIGHT,
  OVERVIEW_CELL_SIZE,
  WIDTH,
  addDays,
  buildContinuousCalendar,
  buildExitCellPose,
  buildStackedOverviewLayout,
  buildTrainFrameState,
  exitOverviewProgress,
  exitStackProgress,
  formatDate,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import {
  HEAT_WINDOW_DAYS,
  buildOrganizationLegendTimeline,
  getDynamicLegendRows,
  rankLegendEntries,
} from "../scene/legend-track";
import { buildMiscBreakdown } from "../scene/misc-breakdown";

function projectDay(date: string, repository: string, count: number): ContributionDay {
  return {
    date,
    count,
    level: count > 0 ? 4 : 0,
    attributedCount: count,
    unattributedCount: 0,
    overflowCount: 0,
    projects: count > 0 ? [{ repository, visibility: "private", count, commits: count, pullRequests: 0, issues: 0, reviews: 0 }] : [],
  };
}

function snapshot(days: ContributionDay[]): OwnerProjectContributionSnapshot {
  const byYear = new Map<number, ContributionDay[]>();
  for (const day of days) {
    const year = Number(day.date.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), day]);
  }
  return {
    schemaVersion: 2,
    login: "example",
    generatedAt: "2026-08-30T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: days[0].date, to: days.at(-1)!.date },
    timezone: "America/New_York",
    projects: [],
    years: [...byYear.entries()].map(([year, yearDays]) => ({
      year,
      totalContributions: yearDays.reduce((sum, day) => sum + day.count, 0),
      attributedContributions: yearDays.reduce((sum, day) => sum + (day.attributedCount ?? 0), 0),
      days: yearDays,
    })),
    provenance: { authenticated: true, visibility: "owner-visible-projects", approval: "test", endpoints: ["test"], restrictedContributionsByYear: [], note: "test" },
  };
}

describe("dynamic heat legend and full-history exit", () => {
  it("promotes recent heat while cumulative totals remain monotonic", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const days = Array.from({ length: 120 }, (_, index) => index < 30
      ? projectDay(formatDate(addDays(start, index)), "NEW-HEAT/NEWHEAT", 20)
      : projectDay(formatDate(addDays(start, index)), "Agriculture-Intelligence/agroview-client", 3));
    const calendar = buildContinuousCalendar(snapshot(days));
    const timeline = buildOrganizationLegendTimeline(calendar);
    const finalEntries = timeline.entriesByDay.at(-1)!;
    const finalRanking = rankLegendEntries(finalEntries);

    expect(HEAT_WINDOW_DAYS).toBe(90);
    expect(finalEntries.find((entry) => entry.key === "new-heat")?.count).toBe(600);
    expect(finalEntries.find((entry) => entry.key === "agriculture-intelligence")?.count).toBe(270);
    expect(finalRanking[0].key).toBe("agriculture-intelligence");
    expect(finalRanking.find((entry) => entry.key === "new-heat")?.heat).toBe(0);
    const rows = getDynamicLegendRows(buildTrainFrameState(FRAME_COUNT - 1, calendar), timeline);
    expect(rows.find((row) => row.entry.key === "agriculture-intelligence")!.rankPosition)
      .toBeLessThan(rows.find((row) => row.entry.key === "new-heat")!.rankPosition);
    for (let dayIndex = 1; dayIndex < timeline.entriesByDay.length; dayIndex += 1) {
      for (let groupIndex = 0; groupIndex < timeline.entriesByDay[dayIndex].length; groupIndex += 1) {
        expect(timeline.entriesByDay[dayIndex][groupIndex].count)
          .toBeGreaterThanOrEqual(timeline.entriesByDay[dayIndex - 1][groupIndex].count);
      }
    }
  });

  it("zooms out after 54 seconds and lands every year inside the stacked frame", () => {
    const days = [
      projectDay("2023-01-01", "NEW-HEAT/NEWHEAT", 2),
      projectDay("2024-06-15", "Agriculture-Intelligence/agroview-client", 3),
      projectDay("2025-09-20", "VisualPT/visualPT", 4),
      projectDay("2026-08-30", "visgl/deck.gl", 5),
    ];
    const calendar = buildContinuousCalendar(snapshot(days));
    const overview = buildStackedOverviewLayout(calendar);
    const finalState = buildTrainFrameState(FRAME_COUNT - 1, calendar);

    expect(exitOverviewProgress(EXIT_START_SECONDS * FPS - 1)).toBe(0);
    expect(exitStackProgress(Math.floor(EXIT_STACK_START_SECONDS * FPS) - 1)).toBe(0);
    expect(exitOverviewProgress(FRAME_COUNT - 1)).toBe(1);
    expect(exitStackProgress(FRAME_COUNT - 1)).toBe(1);
    expect(overview.years).toEqual([2023, 2024, 2025, 2026]);
    expect(overview.byDate.size).toBe(days.length);
    for (const cell of calendar.cells.filter((candidate) => candidate.isData)) {
      const pose = buildExitCellPose(cell, finalState, calendar, overview);
      expect(pose.size).toBe(OVERVIEW_CELL_SIZE);
      expect(pose.x).toBeGreaterThanOrEqual(0);
      expect(pose.y).toBeGreaterThanOrEqual(0);
      expect(pose.x + pose.size).toBeLessThanOrEqual(WIDTH);
      expect(pose.y + pose.size).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it("separates the unattributed remainder from true other-owner activity", () => {
    const day = projectDay("2026-08-30", "charlieforward9/ATHLEAT", 7);
    day.count = 12;
    day.unattributedCount = 5;
    const breakdown = buildMiscBreakdown(snapshot([day]));
    expect(breakdown).toMatchObject({
      officialUnattributedCount: 5,
      otherOwnerAttributedCount: 7,
      displayedMiscCount: 12,
    });
    expect(breakdown.owners[0]).toEqual({ owner: "charlieforward9", count: 7, repositoryCount: 1 });
  });
});
