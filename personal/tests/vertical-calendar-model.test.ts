import { describe, expect, it } from "vitest";
import {
  FPS,
  FRAME_COUNT,
  TRAVERSAL_SECONDS,
  addDays,
  buildContinuousCalendar,
  formatDate,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import {
  OVERVIEW_TRANSITION_SECONDS,
  VERTICAL_RENDER_CONTRACT,
  buildVerticalCalendarLayout,
  buildVerticalCellPose,
  buildVerticalFrameState,
  monthBoundaryCameraJumps,
  verticalDayRevealProgress,
} from "../scene/vertical-calendar-model";

function snapshot(dayCount = 500): OwnerProjectContributionSnapshot {
  const start = new Date("2023-01-01T00:00:00.000Z");
  const repositories = [
    "NEW-HEAT/NEWHEAT",
    "Agriculture-Intelligence/agroview-client",
    "VisualPT/visualPT",
    "visgl/deck.gl",
  ];
  const days: ContributionDay[] = Array.from({ length: dayCount }, (_, index) => {
    const count = (index % 9) + 1;
    return {
      date: formatDate(addDays(start, index)),
      count,
      level: 4,
      attributedCount: count,
      unattributedCount: 0,
      overflowCount: 0,
      projects: [{
        repository: repositories[index % repositories.length],
        visibility: "private",
        count,
        commits: count,
        pullRequests: 0,
        issues: 0,
        reviews: 0,
      }],
    };
  });
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
        totalContributions: yearDays.reduce((sum, day) => sum + day.count, 0),
        attributedContributions: yearDays.reduce((sum, day) => sum + (day.attributedCount ?? 0), 0),
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

describe("vertical deck.gl contribution calendar", () => {
  it("stacks familiar seven-column month grids into one static vertical world", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);

    expect(layout.cells).toHaveLength(calendar.dataDays.length);
    expect(layout.monthKeys[0]).toBe("2023-01");
    expect(layout.monthBoundaries.length).toBeGreaterThan(12);
    expect(new Set(layout.cells.map((cell) => cell.weekday))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    expect(layout.monthBoundaries.every((boundary, index) => index === 0 || boundary.y > layout.monthBoundaries[index - 1].y)).toBe(true);
  });

  it("allows only one contribution day to be partially filled at any traversal frame", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    for (let frameIndex = 1; frameIndex < TRAVERSAL_SECONDS * FPS - 1; frameIndex += 37) {
      const state = buildVerticalFrameState(frameIndex, calendar, layout);
      const partial = layout.cells.filter((cell) => {
        const progress = verticalDayRevealProgress(cell.dataOrdinal, state);
        return progress > 0 && progress < 1;
      });
      expect(partial.length).toBeLessThanOrEqual(1);
      expect(state.partialRevealCount).toBe(partial.length);
    }
  });

  it("moves forward monotonically and smooths every month boundary", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const traversalFrames = TRAVERSAL_SECONDS * FPS;
    let previous = buildVerticalFrameState(0, calendar, layout);
    let largestStep = 0;
    for (let frameIndex = 1; frameIndex < traversalFrames; frameIndex += 1) {
      const state = buildVerticalFrameState(frameIndex, calendar, layout);
      expect(state.cameraY).toBeGreaterThanOrEqual(previous.cameraY - 1e-8);
      largestStep = Math.max(largestStep, state.cameraY - previous.cameraY);
      previous = state;
    }
    expect(largestStep).toBeLessThan(55);
    expect(monthBoundaryCameraJumps(calendar, layout).every((boundary) => boundary.delta < 4)).toBe(true);
  });

  it("uses the exact 64-second contract and settles a full-history overview", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const lastTraversal = buildVerticalFrameState(TRAVERSAL_SECONDS * FPS - 1, calendar, layout);
    const overviewStart = buildVerticalFrameState(TRAVERSAL_SECONDS * FPS, calendar, layout);
    const finalState = buildVerticalFrameState(FRAME_COUNT - 1, calendar, layout);

    expect(VERTICAL_RENDER_CONTRACT.frameCount).toBe(3_840);
    expect(VERTICAL_RENDER_CONTRACT.durationSeconds).toBe(64);
    expect(lastTraversal.isOverview).toBe(false);
    expect(overviewStart.isOverview).toBe(true);
    expect(finalState.overviewSettled).toBe(true);
    expect(finalState.elapsedSeconds - TRAVERSAL_SECONDS).toBeGreaterThan(OVERVIEW_TRANSITION_SECONDS);
    expect(finalState.currentDate).toBe(calendar.dataDays.at(-1)!.date);
  });

  it("moves every day into the complete year-stacked overview", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const finalState = buildVerticalFrameState(FRAME_COUNT - 1, calendar, layout);
    const finalPoses = layout.cells.map((cell) => buildVerticalCellPose(cell, finalState, layout));

    expect(finalPoses).toHaveLength(calendar.dataDays.length);
    expect(finalPoses.every((pose) => pose.size > 0 && Number.isFinite(pose.x) && Number.isFinite(pose.y))).toBe(true);
    expect(Math.max(...finalPoses.map((pose) => pose.x + pose.size)) - Math.min(...finalPoses.map((pose) => pose.x)))
      .toBeLessThanOrEqual(layout.overviewWidth + 1);
  });
});
