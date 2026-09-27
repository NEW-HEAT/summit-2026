import { readFileSync } from "node:fs";
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

describe("one-second blank-tile fade-in", () => {
  it("holds contribution progress at zero while blank tiles ease from transparent to visible", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const start = buildVerticalFrameState(0, calendar, layout, VERTICAL_EXPORT_TIMING);
    const middle = buildVerticalFrameState(30, calendar, layout, VERTICAL_EXPORT_TIMING);
    const settled = buildVerticalFrameState(60, calendar, layout, VERTICAL_EXPORT_TIMING);

    expect(VERTICAL_EXPORT_TIMING.introSeconds).toBe(1);
    expect(start.introProgress).toBe(0);
    expect(start.revealHead).toBe(0);
    expect(middle.introProgress).toBeGreaterThan(0);
    expect(middle.introProgress).toBeLessThan(1);
    expect(middle.revealHead).toBe(0);
    expect(settled.introProgress).toBe(1);
  });

  it("applies intro opacity to blank tiles, outlines, and the active outline", () => {
    const scene = readFileSync(new URL("../scene/vertical-scene.ts", import.meta.url), "utf8");

    expect(scene).toContain("const introOpacity = frameState.introProgress;");
    expect(scene).toContain("distanceOpacity * introOpacity");
    expect(scene).toContain("frameState.introProgress * (110 + frameState.activeDayProgress * 110)");
  });
});

function snapshot(): OwnerProjectContributionSnapshot {
  const days: ContributionDay[] = [
    {
      date: "2023-01-01",
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
    },
    {
      date: "2023-01-02",
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
    },
  ];
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
      totalContributions: 2,
      attributedContributions: 2,
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
