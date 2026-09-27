import { describe, expect, it } from "vitest";
import { reverseAnalogGlyphMotion } from "../scene/geographic-memory-caption";

describe("reverse-time analog glyph direction", () => {
  it("drops the outgoing glyph while the earlier glyph arrives from above", () => {
    expect(reverseAnalogGlyphMotion(0, 84)).toEqual({
      outgoingOffsetY: 0,
      incomingOffsetY: -84,
    });
    expect(reverseAnalogGlyphMotion(0.5, 84)).toEqual({
      outgoingOffsetY: 42,
      incomingOffsetY: -42,
    });
    expect(reverseAnalogGlyphMotion(1, 84)).toEqual({
      outgoingOffsetY: 84,
      incomingOffsetY: 0,
    });
  });

  it("clamps overshoot without reversing the reel", () => {
    expect(reverseAnalogGlyphMotion(-0.25, 84)).toEqual({
      outgoingOffsetY: 0,
      incomingOffsetY: -84,
    });
    expect(reverseAnalogGlyphMotion(1.25, 84)).toEqual({
      outgoingOffsetY: 84,
      incomingOffsetY: 0,
    });
  });
});
