import { describe, expect, it } from "vitest";
import {
  buildContinuousCalendar,
  buildProjectSlices,
  dayRevealProgress,
  normalizedDayVolume,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";

const projectDay = {
  date: "2026-08-30",
  count: 12,
  level: 4 as const,
  attributedCount: 10,
  unattributedCount: 2,
  overflowCount: 0,
  projects: [
    { repository: "NEW-HEAT/NEWHEAT", visibility: "private" as const, count: 7, commits: 7, pullRequests: 0, issues: 0, reviews: 0 },
    { repository: "visgl/deck.gl", visibility: "public" as const, count: 3, commits: 2, pullRequests: 1, issues: 0, reviews: 0 },
  ],
};

function makeSnapshot(): OwnerProjectContributionSnapshot {
  return {
    schemaVersion: 2,
    login: "example",
    generatedAt: "2026-08-30T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: "2026-08-30", to: "2026-08-30" },
    timezone: "America/New_York",
    projects: [
      { repository: "NEW-HEAT/NEWHEAT", visibility: "private", count: 7 },
      { repository: "visgl/deck.gl", visibility: "public", count: 3 },
    ],
    years: [{ year: 2026, totalContributions: 12, attributedContributions: 10, days: [projectDay] }],
    provenance: {
      authenticated: true,
      visibility: "owner-visible-projects",
      approval: "test",
      endpoints: ["test"],
      restrictedContributionsByYear: [{ year: 2026, count: 7 }],
      note: "test",
    },
  };
}

describe("per-project daily volume", () => {
  it("preserves every named project and the unreconciled remainder as proportional slices", () => {
    const slices = buildProjectSlices(projectDay);
    expect(slices.map((slice) => [slice.key, slice.count])).toEqual([
      ["NEW-HEAT/NEWHEAT", 7],
      ["visgl/deck.gl", 3],
      ["__unattributed__", 2],
    ]);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 10);
  });

  it("fills each day progressively as it crosses the playhead", () => {
    expect(dayRevealProgress(100, 93)).toBe(0);
    expect(dayRevealProgress(100, 100)).toBeCloseTo(0.5, 10);
    expect(dayRevealProgress(100, 107)).toBe(1);
  });

  it("uses logarithmic intensity so large days remain visually distinct without flattening small days", () => {
    expect(normalizedDayVolume(0, 64)).toBe(0);
    expect(normalizedDayVolume(8, 64)).toBeGreaterThan(0.5);
    expect(normalizedDayVolume(64, 64)).toBe(1);
    expect(normalizedDayVolume(640, 64)).toBe(1);
  });

  it("assigns recurring project identities distinct colors across the calendar", () => {
    const calendar = buildContinuousCalendar(makeSnapshot());
    expect(calendar.projectCount).toBe(2);
    expect(calendar.projectColors["NEW-HEAT/NEWHEAT"]).not.toBe(calendar.projectColors["visgl/deck.gl"]);
    expect(calendar.volumeCeiling).toBe(10);
  });
});
