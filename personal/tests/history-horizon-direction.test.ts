import { OrbitViewport } from "@deck.gl/core";
import { describe, expect, it } from "vitest";
import {
  FPS,
  FRAME_COUNT,
  addDays,
  buildContinuousCalendar,
  formatDate,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import {
  VERTICAL_RENDER_CONTRACT,
  buildVerticalCalendarLayout,
  buildVerticalCellPose,
  buildVerticalFrameState,
  verticalCellDistanceOpacity,
} from "../scene/vertical-calendar-model";

describe("vertical contribution history horizon", () => {
  it("moves completed history upward and smaller as the camera advances", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const earlier = buildVerticalFrameState(30 * FPS, calendar, layout);
    const later = buildVerticalFrameState(31 * FPS, calendar, layout);
    const completedCell = layout.cells[earlier.activeDayOrdinal - 14];
    const earlierPose = buildVerticalCellPose(completedCell, earlier, layout);
    const laterPose = buildVerticalCellPose(completedCell, later, layout);
    const earlierViewport = viewport(earlier);
    const laterViewport = viewport(later);
    const earlierCenter = projectCenter(earlierViewport, earlierPose);
    const laterCenter = projectCenter(laterViewport, laterPose);

    expect(laterCenter[1]).toBeLessThan(earlierCenter[1]);
    expect(projectedWidth(laterViewport, laterPose)).toBeLessThan(projectedWidth(earlierViewport, earlierPose));
    expect(earlier.viewState.rotationX).toBeCloseTo(VERTICAL_RENDER_CONTRACT.crawlTiltDegrees);

    const nearHistory = layout.cells[earlier.activeDayOrdinal - 7];
    const distantHistory = layout.cells[earlier.activeDayOrdinal - 35];
    expect(verticalCellDistanceOpacity(distantHistory, earlier))
      .toBeLessThan(verticalCellDistanceOpacity(nearHistory, earlier));
    expect(verticalCellDistanceOpacity(distantHistory, earlier)).toBeLessThan(0.1);
  });

  it("uses one second to stack the years, then holds the full timeline for one second", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const transitionStartFrame = VERTICAL_RENDER_CONTRACT.traversalSeconds * FPS;
    const fullTimelineStartFrame = (
      VERTICAL_RENDER_CONTRACT.traversalSeconds
      + VERTICAL_RENDER_CONTRACT.overviewTransitionSeconds
    ) * FPS;

    expect(VERTICAL_RENDER_CONTRACT.durationSeconds).toBe(64);
    expect(VERTICAL_RENDER_CONTRACT.traversalSeconds).toBe(62);
    expect(VERTICAL_RENDER_CONTRACT.overviewTransitionSeconds).toBe(1);
    expect(VERTICAL_RENDER_CONTRACT.overviewHoldSeconds).toBe(1);
    expect(buildVerticalFrameState(transitionStartFrame - 1, calendar, layout).isOverview).toBe(false);
    expect(buildVerticalFrameState(transitionStartFrame, calendar, layout).isOverview).toBe(true);
    expect(buildVerticalFrameState(fullTimelineStartFrame, calendar, layout).overviewSettled).toBe(true);
    expect(buildVerticalFrameState(FRAME_COUNT - 1, calendar, layout).overviewSettled).toBe(true);
  });
});

function viewport(state: ReturnType<typeof buildVerticalFrameState>) {
  return new OrbitViewport({
    width: 1920,
    height: 1080,
    orbitAxis: "Z",
    fovy: 48,
    near: 0.1,
    far: 100_000,
    ...state.viewState,
  });
}

function projectCenter(
  viewportState: OrbitViewport,
  pose: ReturnType<typeof buildVerticalCellPose>,
) {
  return viewportState.project([pose.x + pose.size / 2, pose.y + pose.size / 2, pose.z]);
}

function projectedWidth(
  viewportState: OrbitViewport,
  pose: ReturnType<typeof buildVerticalCellPose>,
) {
  const left = viewportState.project([pose.x, pose.y + pose.size / 2, pose.z]);
  const right = viewportState.project([pose.x + pose.size, pose.y + pose.size / 2, pose.z]);
  return Math.abs(right[0] - left[0]);
}

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
