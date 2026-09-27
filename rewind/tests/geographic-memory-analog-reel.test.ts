import { describe, expect, it } from "vitest";
import {
  analogDateReelFrame,
  analogGlyphProgress,
  formatAnalogMemoryDateRange,
  formatMemoryLocationDisplay,
} from "../scene/geographic-memory-caption";

describe("analog rewind timestamp", () => {
  it("uses a stable mechanical date-board format", () => {
    expect(
      formatAnalogMemoryDateRange({
        targetMs: Date.parse("2026-07-18T00:00:00.000Z"),
        sourceMs: Date.parse("2026-07-21T00:00:00.000Z"),
      })
    ).toBe("JUL 18–21 2026");
    expect(
      formatAnalogMemoryDateRange({
        targetMs: Date.parse("2024-03-29T00:00:00.000Z"),
        sourceMs: Date.parse("2024-04-02T00:00:00.000Z"),
      })
    ).toBe("MAR 29–APR 02 2024");
    expect(
      formatAnalogMemoryDateRange({
        targetMs: Date.parse("2024-12-29T00:00:00.000Z"),
        sourceMs: Date.parse("2025-01-03T00:00:00.000Z"),
      })
    ).toBe("DEC 29 2024–JAN 03 2025");
    expect(
      formatAnalogMemoryDateRange({
        targetMs: Date.parse("2023-01-01T00:00:00.000Z"),
        sourceMs: Date.parse("2023-01-01T00:00:00.000Z"),
      })
    ).toBe("JAN 01 2023");
  });

  it("passes through multiple ordered date ranges during one rewind", () => {
    const outgoing = {
      targetMs: Date.parse("2026-09-06T00:00:00.000Z"),
      sourceMs: Date.parse("2026-09-06T00:00:00.000Z"),
    };
    const incoming = {
      targetMs: Date.parse("2026-07-18T00:00:00.000Z"),
      sourceMs: Date.parse("2026-07-21T00:00:00.000Z"),
    };
    const early = analogDateReelFrame(outgoing, incoming, 0);
    const middle = analogDateReelFrame(outgoing, incoming, 0.5);
    const late = analogDateReelFrame(outgoing, incoming, 1);
    expect(early.outgoing).toBe("SEP 06 2026");
    expect(middle.outgoing).not.toBe(early.outgoing);
    expect(late.incoming).toBe("JUL 18–21 2026");
    expect(late.stepCount).toBeGreaterThanOrEqual(4);
  });

  it("stagger-rolls changed glyphs from left to right", () => {
    expect(analogGlyphProgress(0.4, 0, 12)).toBeGreaterThan(
      analogGlyphProgress(0.4, 11, 12)
    );
    expect(analogGlyphProgress(0, 0, 12)).toBe(0);
    expect(analogGlyphProgress(1, 11, 12)).toBe(1);
  });

  it("deduplicates noisy place and state levels", () => {
    expect(
      formatMemoryLocationDisplay({
        cityOrRegion: "Roma",
        state: "Rome",
        country: "Italy",
        label: "Roma, Rome, Italy",
      })
    ).toEqual({ primary: "Roma", secondary: "Italy" });
    expect(
      formatMemoryLocationDisplay({
        cityOrRegion: "New York",
        state: "New York",
        country: "United States",
        label: "New York, New York, United States",
      })
    ).toEqual({ primary: "New York", secondary: "United States" });
    expect(
      formatMemoryLocationDisplay({
        cityOrRegion: "Los Cabos",
        state: "Baja California Sur",
        country: "Mexico",
        label: "Los Cabos, Baja California Sur, Mexico",
      })
    ).toEqual({
      primary: "Los Cabos",
      secondary: "Baja California Sur · Mexico",
    });
  });

  it("applies the approved editorial city names deterministically", () => {
    const display = (cityOrRegion: string, state: string, country: string) =>
      formatMemoryLocationDisplay({
        cityOrRegion,
        state,
        country,
        label: `${cityOrRegion}, ${state}, ${country}`,
      });
    expect(display("Ponteareas", "Pontevedra", "Spain")).toEqual({
      primary: "Vigo",
      secondary: "Pontevedra · Spain",
    });
    expect(display("Westminster", "Colorado", "United States")).toEqual({
      primary: "Denver",
      secondary: "Colorado · United States",
    });
    expect(display("Gunnison", "Colorado", "United States")).toEqual({
      primary: "Gunnison",
      secondary: "Colorado · United States",
    });
    expect(display("Boynton Beach", "Florida", "United States")).toEqual({
      primary: "Palm Beach",
      secondary: "Florida · United States",
    });
    expect(display("La Honda", "California", "United States")).toEqual({
      primary: "Palo Alto",
      secondary: "California · United States",
    });
  });
});
