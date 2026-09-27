import { OrbitViewport } from "@deck.gl/core";
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
  buildVerticalCalendarLayout,
  buildVerticalCellPose,
  buildVerticalFrameState,
} from "../scene/vertical-calendar-model";

describe("aggressive Star Wars crawl tilt", () => {
  it("compresses distant history and expands the incoming lower foreground", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const state = buildVerticalFrameState(31 * FPS, calendar, layout);
    const viewport = new OrbitViewport({
      width: 1920,
      height: 1080,
      orbitAxis: "Z",
      fovy: 48,
      near: 0.1,
      far: 100_000,
      ...state.viewState,
    });
    const distant = projectedHeight(viewport, buildVerticalCellPose(
      layout.cells[state.activeDayOrdinal - 28], state, layout,
    ));
    const active = projectedHeight(viewport, buildVerticalCellPose(
      layout.cells[state.activeDayOrdinal], state, layout,
    ));
    const incoming = projectedHeight(viewport, buildVerticalCellPose(
      layout.cells[state.activeDayOrdinal + 7], state, layout,
    ));

    expect(state.viewState.rotationX).toBeLessThanOrEqual(22);
    expect(distant).toBeLessThan(active * 0.5);
    expect(incoming).toBeGreaterThan(active * 1.4);
  });
});

function projectedHeight(
  viewport: OrbitViewport,
  pose: ReturnType<typeof buildVerticalCellPose>,
) {
  const top = viewport.project([pose.x + pose.size / 2, pose.y, pose.z]);
  const bottom = viewport.project([pose.x + pose.size / 2, pose.y + pose.size, pose.z]);
  return Math.abs(bottom[1] - top[1]);
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
