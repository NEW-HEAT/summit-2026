import { describe, expect, it } from "vitest";
import {
  FRAME_COUNT,
  buildContinuousCalendar,
  buildTrainFrameState,
  calendarPixelsPerFrame,
  type ContributionSnapshot,
} from "../scene/calendar-model";

function makeSnapshot(): ContributionSnapshot {
  const days = [];
  for (
    let date = new Date("2023-01-01T00:00:00.000Z"), index = 0;
    date <= new Date("2026-08-29T00:00:00.000Z");
    date = new Date(date.getTime() + 86_400_000), index += 1
  ) {
    days.push({
      date: date.toISOString().slice(0, 10),
      count: index % 8,
      level: Math.min(4, index % 5) as 0 | 1 | 2 | 3 | 4,
    });
  }
  return {
    schemaVersion: 1,
    login: "example",
    generatedAt: "2026-08-30T00:00:00.000Z",
    source: "github-public-profile-html",
    dateRange: { from: "2023-01-01", to: "2026-08-29" },
    years: [2023, 2024, 2025, 2026].map((year) => ({
      year,
      totalContributions: 0,
      days: days.filter((day) => day.date.startsWith(`${year}-`)),
    })),
    provenance: { endpointShape: "public", authenticated: false, visibility: "public-profile" },
  };
}

describe("slower train motion", () => {
  it("uses a constant screen velocity below eighteen pixels per frame", () => {
    const calendar = buildContinuousCalendar(makeSnapshot());
    const expected = calendarPixelsPerFrame(calendar);
    const earlyDelta = buildTrainFrameState(0, calendar).calendarTranslationX - buildTrainFrameState(1, calendar).calendarTranslationX;
    const middle = Math.floor(FRAME_COUNT / 2);
    const middleDelta = buildTrainFrameState(middle, calendar).calendarTranslationX - buildTrainFrameState(middle + 1, calendar).calendarTranslationX;
    expect(expected).toBeLessThan(18);
    expect(earlyDelta).toBeCloseTo(expected, 8);
    expect(middleDelta).toBeCloseTo(expected, 8);
  });
});
