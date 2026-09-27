import { describe, expect, it } from "vitest";
import {
  DURATION_SECONDS,
  FPS,
  FRAME_COUNT,
  OVERVIEW_HOLD_SECONDS,
  SECTION_COUNT,
  TRAVERSAL_SECONDS,
  VISIBLE_ORGANIZATION_GROUPS,
  addDays,
  buildContinuousCalendar,
  buildTrainFrameState,
  buildVisibleOrganizationSlices,
  exitOverviewProgress,
  formatDate,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import {
  buildOrganizationLegendTimeline,
  getDynamicLegendRows,
} from "../scene/legend-track";

function projectDay(date: string, repository: string, count: number): ContributionDay {
  return {
    date,
    count,
    level: count > 0 ? 4 : 0,
    attributedCount: count,
    unattributedCount: 0,
    overflowCount: 0,
    projects: count > 0 ? [{
      repository,
      visibility: "private",
      count,
      commits: count,
      pullRequests: 0,
      issues: 0,
      reviews: 0,
    }] : [],
  };
}

function snapshot(days: ContributionDay[]): OwnerProjectContributionSnapshot {
  return {
    schemaVersion: 2,
    login: "charlieforward9",
    generatedAt: "2026-08-31T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: days[0].date, to: days.at(-1)!.date },
    timezone: "America/New_York",
    projects: [],
    years: [{
      year: 2026,
      totalContributions: days.reduce((sum, day) => sum + day.count, 0),
      attributedContributions: days.reduce((sum, day) => sum + (day.attributedCount ?? 0), 0),
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

function makeCalendar(dayCount = 320) {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const repositories = [
    "NEW-HEAT/NEWHEAT",
    "Agriculture-Intelligence/agroview-client",
    "VisualPT/visualPT",
    "visgl/deck.gl",
  ];
  return buildContinuousCalendar(snapshot(Array.from({ length: dayCount }, (_, index) =>
    projectDay(formatDate(addDays(start, index)), repositories[index % repositories.length], (index % 7) + 1))));
}

describe("beat-synchronous contribution retry", () => {
  it("holds one camera pose during each of 32 fill sections and jumps at the boundary", () => {
    const calendar = makeCalendar();
    const firstSectionFrame = 10;
    const laterFrameInSection = 80;
    const beforeBoundary = Math.floor((TRAVERSAL_SECONDS / SECTION_COUNT) * FPS) - 1;
    const afterBoundary = beforeBoundary + 2;
    const start = buildTrainFrameState(firstSectionFrame, calendar);
    const later = buildTrainFrameState(laterFrameInSection, calendar);
    const before = buildTrainFrameState(beforeBoundary, calendar);
    const after = buildTrainFrameState(afterBoundary, calendar);

    expect(SECTION_COUNT).toBe(32);
    expect(start.sectionIndex).toBe(0);
    expect(later.sectionIndex).toBe(0);
    expect(later.calendarTranslationX).toBe(start.calendarTranslationX);
    expect(later.currentDayOrdinal).toBeGreaterThan(start.currentDayOrdinal);
    expect(before.sectionIndex).toBe(0);
    expect(after.sectionIndex).toBe(1);
    expect(after.calendarTranslationX).not.toBe(before.calendarTranslationX);
  });

  it("uses 62 seconds for traversal and holds the complete overview for the final two seconds", () => {
    const calendar = makeCalendar();
    const lastTraversalFrame = TRAVERSAL_SECONDS * FPS - 1;
    const overviewStartFrame = TRAVERSAL_SECONDS * FPS;

    expect(TRAVERSAL_SECONDS).toBe(62);
    expect(OVERVIEW_HOLD_SECONDS).toBe(2);
    expect(DURATION_SECONDS).toBe(64);
    expect(FRAME_COUNT).toBe(3_840);
    expect(exitOverviewProgress(lastTraversalFrame)).toBe(0);
    expect(exitOverviewProgress(overviewStartFrame)).toBe(1);
    expect(buildTrainFrameState(FRAME_COUNT - 1, calendar).isOverview).toBe(true);
  });

  it("keeps legend labels full-contrast and on non-overlapping integer rows for a whole section", () => {
    const calendar = makeCalendar();
    const timeline = buildOrganizationLegendTimeline(calendar);
    const early = getDynamicLegendRows(buildTrainFrameState(10, calendar), timeline);
    const late = getDynamicLegendRows(buildTrainFrameState(80, calendar), timeline);

    expect(early).toHaveLength(4);
    expect(early.map((row) => row.opacity)).toEqual([1, 1, 1, 1]);
    expect(early.map((row) => row.rankPosition).sort((left, right) => left - right)).toEqual([0, 1, 2, 3]);
    expect(late.map((row) => [row.entry.key, row.rankPosition]))
      .toEqual(early.map((row) => [row.entry.key, row.rankPosition]));
  });

  it("removes unresolved and unclassified activity from the visible four-lane render", () => {
    expect(VISIBLE_ORGANIZATION_GROUPS.map((group) => group.label)).toEqual([
      "NEW HEAT",
      "Agriculture-Intelligence",
      "VisualPT",
      "vis.gl",
    ]);
    const slices = buildVisibleOrganizationSlices({
      date: "2026-08-30",
      count: 25,
      level: 4,
      attributedCount: 20,
      unattributedCount: 5,
      projects: [
        { repository: "NEW-HEAT/NEWHEAT", visibility: "private", count: 7, commits: 7, pullRequests: 0, issues: 0, reviews: 0 },
        { repository: "charlieforward9/quickies", visibility: "public", count: 6, commits: 6, pullRequests: 0, issues: 0, reviews: 0 },
        { repository: "openjs-foundation/nodejs.org", visibility: "public", count: 7, commits: 7, pullRequests: 0, issues: 0, reviews: 0 },
      ],
    });
    expect(slices.map(({ key, count }) => [key, count])).toEqual([["new-heat", 7]]);
  });
});
