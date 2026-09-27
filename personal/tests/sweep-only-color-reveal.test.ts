import { describe, expect, it } from "vitest";
import {
  CELL_SIZE,
  COLOR_REVEAL_MODE,
  buildDayColorReveal,
  calendarCellBaseOpacity,
} from "../scene/calendar-model";

describe("horizontal sweep-only tile color", () => {
  it("keeps the dark base opacity constant instead of aging the tile", () => {
    expect(calendarCellBaseOpacity(true)).toBe(0.58);
    expect(calendarCellBaseOpacity(false)).toBe(0.18);
    expect(COLOR_REVEAL_MODE).toBe("horizontal-clip-only");
  });

  it("reveals full-opacity color only by widening the horizontal clip", () => {
    expect(buildDayColorReveal(100, 93)).toEqual({ progress: 0, clipWidth: 0, colorOpacity: 1 });
    expect(buildDayColorReveal(100, 100)).toEqual({ progress: 0.5, clipWidth: CELL_SIZE / 2, colorOpacity: 1 });
    expect(buildDayColorReveal(100, 107)).toEqual({ progress: 1, clipWidth: CELL_SIZE, colorOpacity: 1 });
  });
});
