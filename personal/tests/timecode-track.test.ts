import { describe, expect, it } from "vitest";
import { formatTimecodeDate } from "../scene/calendar-model";

describe("separate timecode track", () => {
  it("formats the exact synchronized date without adding project claims", () => {
    expect(formatTimecodeDate("2023-01-01")).toBe("2023 · 01 · 01");
    expect(formatTimecodeDate("2026-08-29")).toBe("2026 · 08 · 29");
  });
});
