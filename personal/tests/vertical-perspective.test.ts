import { OrbitViewport } from "@deck.gl/core";
import { describe, expect, it } from "vitest";
import {
  TRAVERSAL_SECONDS,
  FPS,
  addDays,
  buildContinuousCalendar,
  formatDate,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import { buildVerticalCalendarLayout, buildVerticalFrameState } from "../scene/vertical-calendar-model";

describe("vertical contribution crawl perspective", () => {
  it("places the completed calendar in the large lower foreground and future dates toward the top horizon", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const state = buildVerticalFrameState(Math.floor(TRAVERSAL_SECONDS * FPS * 0.5), calendar, layout);
    const viewport = new OrbitViewport({
      width: 1920,
      height: 1080,
      orbitAxis: "Z",
      fovy: 48,
      near: 0.1,
      far: 100_000,
      ...state.viewState,
    });
    const targetY = state.viewState.target[1];
    const completedY = targetY - 300;
    const futureY = targetY + 300;
    const completedCenter = viewport.project([0, completedY, 0]);
    const futureCenter = viewport.project([0, futureY, 0]);
    const completedWidth = projectedWidth(viewport, completedY);
    const futureWidth = projectedWidth(viewport, futureY);

    expect(completedCenter[1]).toBeGreaterThan(futureCenter[1]);
    expect(completedWidth).toBeGreaterThan(futureWidth);
  });
});

function projectedWidth(viewport: OrbitViewport, y: number) {
  const left = viewport.project([-63, y, 0]);
  const right = viewport.project([63, y, 0]);
  return Math.abs(right[0] - left[0]);
}

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
