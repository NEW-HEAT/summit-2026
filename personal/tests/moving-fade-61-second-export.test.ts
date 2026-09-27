import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addDays,
  buildContinuousCalendar,
  formatDate,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import {
  OVERVIEW_CELL_GAP,
  OVERVIEW_YEAR_GAP,
  VERTICAL_MOVING_FADE_EXPORT_CONTRACT,
  VERTICAL_MOVING_FADE_EXPORT_TIMING,
  buildVerticalCalendarLayout,
  buildVerticalFrameState,
} from "../scene/vertical-calendar-model";

describe("61-second moving contribution fade", () => {
  it("fades over live traversal instead of holding the calendar still", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const start = buildVerticalFrameState(0, calendar, layout, VERTICAL_MOVING_FADE_EXPORT_TIMING);
    const middle = buildVerticalFrameState(45, calendar, layout, VERTICAL_MOVING_FADE_EXPORT_TIMING);
    const settled = buildVerticalFrameState(90, calendar, layout, VERTICAL_MOVING_FADE_EXPORT_TIMING);

    expect(VERTICAL_MOVING_FADE_EXPORT_TIMING).toMatchObject({
      durationSeconds: 61,
      introSeconds: 1.5,
      introOverlapsTraversal: true,
      traversalSeconds: 60,
      overviewTransitionSeconds: 0.5,
      overviewHoldSeconds: 0.5,
      frameCount: 3_660,
    });
    expect(start.introProgress).toBe(0);
    expect(start.revealHead).toBe(0);
    expect(middle.introProgress).toBeGreaterThan(0);
    expect(middle.introProgress).toBeLessThan(1);
    expect(middle.revealHead).toBeGreaterThan(0);
    expect(middle.cameraY).toBeGreaterThan(start.cameraY);
    expect(settled.introProgress).toBe(1);
    expect(settled.revealHead).toBeGreaterThan(middle.revealHead);
  });

  it("uses the final second for the recap and keeps the master exact", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const stateAt = (frameIndex: number) => buildVerticalFrameState(
      frameIndex,
      calendar,
      layout,
      VERTICAL_MOVING_FADE_EXPORT_TIMING,
    );

    expect(VERTICAL_MOVING_FADE_EXPORT_CONTRACT.durationSeconds).toBe(61);
    expect(VERTICAL_MOVING_FADE_EXPORT_CONTRACT.frameCount).toBe(3_660);
    expect(VERTICAL_MOVING_FADE_EXPORT_CONTRACT.sectionSeconds).toBe(1.875);
    expect(stateAt(3_599).isOverview).toBe(false);
    expect(stateAt(3_600).isOverview).toBe(true);
    expect(stateAt(3_600).overviewProgress).toBe(0);
    expect(stateAt(3_630).overviewSettled).toBe(true);
    expect(stateAt(3_659).overviewSettled).toBe(true);
  });

  it("removes tile borders and opens the recap spacing to match the next composition", () => {
    const scene = readFileSync(new URL("../scene/vertical-scene.ts", import.meta.url), "utf8");

    expect(VERTICAL_MOVING_FADE_EXPORT_CONTRACT.tileBorders).toBe("none");
    expect(OVERVIEW_CELL_GAP).toBe(8);
    expect(OVERVIEW_YEAR_GAP).toBe(52);
    expect(scene).toContain('const showTileBorders = VERTICAL_MOVING_FADE_EXPORT_CONTRACT.tileBorders !== "none";');
    expect(scene).toContain("const borderLayers: Layer[] = showTileBorders ? [");
  });
});

function snapshot(): OwnerProjectContributionSnapshot {
  const start = new Date("2023-01-01T00:00:00.000Z");
  const days: ContributionDay[] = Array.from({ length: 140 }, (_, index) => ({
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
    generatedAt: "2026-09-01T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: days[0].date, to: days.at(-1)!.date },
    timezone: "America/New_York",
    projects: [],
    years: [{
      year: 2023,
      totalContributions: days.length,
      attributedContributions: days.length,
      days,
    }],
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
