import { describe, expect, it } from "vitest";
import {
  formatReverseAnalogMemoryDateRange,
  reverseAnalogDateReelFrame,
} from "../scene/geographic-memory-caption";

describe("reverse-time analog timestamp", () => {
  it("reads a visit from its later boundary back to its earlier boundary", () => {
    expect(
      formatReverseAnalogMemoryDateRange({
        targetMs: Date.parse("2026-07-18T00:00:00.000Z"),
        sourceMs: Date.parse("2026-07-21T00:00:00.000Z"),
      })
    ).toBe("JUL 21 2026 → JUL 18 2026");
  });

  it("keeps an explicit reverse range for a one-day memory", () => {
    const day = Date.parse("2024-01-07T00:00:00.000Z");
    expect(
      formatReverseAnalogMemoryDateRange({ targetMs: day, sourceMs: day })
    ).toBe("JAN 07 2024 → JAN 07 2024");
  });

  it("micro-tunes intermediate dates before landing on the exact range", () => {
    const outgoing = {
      targetMs: Date.parse("2026-09-06T00:00:00.000Z"),
      sourceMs: Date.parse("2026-09-06T00:00:00.000Z"),
    };
    const incoming = {
      targetMs: Date.parse("2026-07-18T00:00:00.000Z"),
      sourceMs: Date.parse("2026-07-21T00:00:00.000Z"),
    };
    const middle = reverseAnalogDateReelFrame(outgoing, incoming, 0.5);
    const final = reverseAnalogDateReelFrame(outgoing, incoming, 1);
    expect(middle.outgoing).not.toBe("SEP 06 2026 → SEP 06 2026");
    expect(middle.incoming).not.toBe(final.incoming);
    expect(final.incoming).toBe("JUL 21 2026 → JUL 18 2026");
  });
});
