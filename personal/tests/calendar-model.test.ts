import { describe, expect, it } from "vitest";
import {
  CELL_SIZE,
  CELL_STEP,
  FRAME_COUNT,
  HEIGHT,
  PAD_WEEKS,
  buildContinuousCalendar,
  buildTrainFrameState,
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
    provenance: {
      endpointShape: "public",
      authenticated: false,
      visibility: "public-profile",
    },
  };
}

describe("continuous contribution train model", () => {
  it("builds one uninterrupted week strip with context on both ends", () => {
    const calendar = buildContinuousCalendar(makeSnapshot());
    expect(calendar.dataStartWeek).toBe(PAD_WEEKS);
    expect(calendar.gridStart).toBe("2022-10-30");
    expect(calendar.gridEnd).toBe("2026-10-31");
    expect(calendar.cells).toHaveLength(calendar.weekCount * 7);
  });

  it("moves the calendar backwards while dates move forward", () => {
    const calendar = buildContinuousCalendar(makeSnapshot());
    const start = buildTrainFrameState(0, calendar);
    const middle = buildTrainFrameState(Math.floor(FRAME_COUNT / 2), calendar);
    const end = buildTrainFrameState(FRAME_COUNT - 1, calendar);
    expect([start.currentDate, middle.currentDate, end.currentDate]).toEqual([
      "2023-01-01",
      "2024-11-20",
      "2026-08-29",
    ]);
    expect(start.calendarTranslationX).toBeGreaterThan(middle.calendarTranslationX);
    expect(middle.calendarTranslationX).toBeGreaterThan(end.calendarTranslationX);
  });

  it("fills more than three quarters of the frame height", () => {
    const gridHeight = 7 * CELL_STEP - (CELL_STEP - CELL_SIZE);
    expect(gridHeight / HEIGHT).toBeGreaterThan(0.75);
  });
});
