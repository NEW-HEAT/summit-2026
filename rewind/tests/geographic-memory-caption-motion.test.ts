import { describe, expect, it } from "vitest";
import {
  memoryLocationTransitionMotion,
  reverseTimeCaptionMotion,
  reverseTimeCaptionTransitionProgress,
} from "../scene/geographic-memory-caption";

describe("reverse-time caption motion", () => {
  it("holds the later and earlier captions at opposite ends of a cycle", () => {
    expect(reverseTimeCaptionTransitionProgress(0.1)).toBe(0);
    expect(reverseTimeCaptionTransitionProgress(0.9)).toBe(1);
    expect(reverseTimeCaptionMotion(0).outgoing).toMatchObject({
      opacity: 1,
      offsetY: -0,
      scale: 1,
    });
    expect(reverseTimeCaptionMotion(1).incoming).toMatchObject({
      opacity: 1,
      offsetY: 0,
      scale: 1,
    });
  });

  it("crossfades at the midpoint while moving both captions backward", () => {
    const motion = reverseTimeCaptionMotion(0.5);
    expect(motion.progress).toBeCloseTo(0.5, 6);
    expect(motion.outgoing.opacity).toBeCloseTo(0.5, 6);
    expect(motion.incoming.opacity).toBeCloseTo(0.5, 6);
    expect(motion.outgoing.offsetY).toBeLessThan(0);
    expect(motion.incoming.offsetY).toBeGreaterThan(0);
    expect(motion.outgoing.offsetY).toBeCloseTo(-motion.incoming.offsetY, 6);
  });

  it("moves monotonically from the later caption to the earlier caption", () => {
    const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map(
      reverseTimeCaptionMotion
    );
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].progress).toBeGreaterThanOrEqual(
        samples[index - 1].progress
      );
      expect(samples[index].incoming.opacity).toBeGreaterThanOrEqual(
        samples[index - 1].incoming.opacity
      );
      expect(samples[index].outgoing.opacity).toBeLessThanOrEqual(
        samples[index - 1].outgoing.opacity
      );
    }
  });

  it("brings the incoming city on early without a blank handoff", () => {
    const early = memoryLocationTransitionMotion(0.2);
    const settled = memoryLocationTransitionMotion(0.34);
    expect(early.incomingOpacity).toBeGreaterThan(0.2);
    expect(early.outgoingOpacity + early.incomingOpacity).toBeGreaterThan(0.7);
    expect(settled.incomingOpacity).toBe(1);
    expect(settled.outgoingOpacity).toBe(0);
  });
});
