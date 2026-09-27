import { describe, expect, it } from "vitest";
import {
  FRAME_COUNT,
  buildContinuousCalendar,
  buildTrainFrameState,
  type ContributionSnapshot,
} from "../scene/calendar-model";
import {
  buildLegendChapters,
  getLegendFrameState,
  legendDoesNotOverlapTimecode,
} from "../scene/legend-track";

function makeSnapshot(): ContributionSnapshot {
  const days = Array.from({ length: 181 }, (_, index) => {
    const date = new Date(Date.UTC(2023, 0, index + 1)).toISOString().slice(0, 10);
    const projects = Array.from({ length: 9 }, (__, projectIndex) => ({
      repository: `owner/project-${projectIndex + 1}`,
      visibility: "private" as const,
      count: projectIndex + 1,
    }));
    return {
      date,
      count: 48,
      level: 4 as const,
      projects,
      attributedCount: 45,
      unattributedCount: 3,
      overflowCount: 0,
    };
  });
  return {
    schemaVersion: 2,
    login: "example",
    generatedAt: "2026-08-30T00:00:00.000Z",
    source: "github-graphql-owner-projects",
    dateRange: { from: days[0].date, to: days.at(-1)!.date },
    years: [{ year: 2023, totalContributions: 181 * 48, days }],
    provenance: { endpointShape: "graphql", authenticated: true, visibility: "owner-visible-projects" },
  };
}

describe("project legend overlay", () => {
  it("stays outside the centered timecode exclusion zone", () => {
    expect(legendDoesNotOverlapTimecode()).toBe(true);
  });

  it("builds stable 90-day chapters with seven rows maximum", () => {
    const chapters = buildLegendChapters(buildContinuousCalendar(makeSnapshot()));
    expect(chapters).toHaveLength(3);
    expect(chapters[0].startDate).toBe("2023-01-01");
    expect(chapters[0].endDate).toBe("2023-03-31");
    expect(chapters[0].entries).toHaveLength(7);
    expect(chapters[0].entries.at(-1)?.label).toBe("Unattributed");
    expect(chapters[0].hiddenProjectCount).toBe(3);
  });

  it("crossfades only at chapter boundaries", () => {
    const calendar = buildContinuousCalendar(makeSnapshot());
    const chapters = buildLegendChapters(calendar);
    const state = buildTrainFrameState(Math.floor(0.55 * (FRAME_COUNT - 1)), calendar);
    const legendState = getLegendFrameState(state, chapters);
    expect(legendState.chapterIndex).toBeGreaterThan(0);
    expect(legendState.transition).toBeGreaterThanOrEqual(0);
    expect(legendState.transition).toBeLessThanOrEqual(1);
  });
});
