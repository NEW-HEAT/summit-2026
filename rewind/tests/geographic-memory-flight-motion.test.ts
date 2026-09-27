import { describe, expect, it } from "vitest";
import { frameState } from "../scene/clip-contract";
import {
  flightScheduleForFrame,
  type GeographicFrameState,
} from "../scene/geographic-memory-model";

function stateAt(beatProgress: number): GeographicFrameState {
  return {
    ...frameState(0),
    beatProgress,
    finalTailProgress: 0,
    inFinalTail: false,
  };
}

describe("cinematic geographic flight motion", () => {
  it("keeps nonzero path motion through the landing boundary", () => {
    const almostLanded = flightScheduleForFrame(stateAt(0.99));
    const landed = flightScheduleForFrame(stateAt(1));
    expect(almostLanded.pathProgress).toBeLessThan(1);
    expect(landed.pathProgress - almostLanded.pathProgress).toBeGreaterThan(0);
    expect(landed.pathProgress - almostLanded.pathProgress).toBeLessThan(0.001);
  });

  it("uses a continuous slow-fast-slow passage instead of an early arrival lock", () => {
    const approach = flightScheduleForFrame(stateAt(0.4));
    expect(approach.pathProgress).toBeGreaterThan(0.25);
    expect(approach.pathProgress).toBeLessThan(0.5);
    expect(approach.incomingOpacity).toBeGreaterThan(0.3);
    const samples = Array.from({ length: 101 }, (_, index) =>
      flightScheduleForFrame(stateAt(index / 100)).pathProgress
    );
    expect(
      samples.slice(1).every((value, index) => value > samples[index])
    ).toBe(true);
    const startStep = samples[1] - samples[0];
    const middleStep = samples[51] - samples[50];
    const endStep = samples[100] - samples[99];
    expect(middleStep).toBeGreaterThan(startStep * 8);
    expect(middleStep).toBeGreaterThan(endStep * 8);
  });

  it("plays destination routes forward on their legitimate range during arrival", () => {
    const travel = flightScheduleForFrame(stateAt(0.25));
    const approach = flightScheduleForFrame(stateAt(0.55));
    const inspection = flightScheduleForFrame(stateAt(0.82));
    const landing = flightScheduleForFrame(stateAt(1));
    expect(travel.incomingPlaybackProgress).toBe(0);
    expect(approach.incomingPlaybackProgress).toBeGreaterThan(0);
    expect(approach.incomingPlaybackProgress).toBeLessThan(1);
    expect(inspection.incomingPlaybackProgress).toBeGreaterThan(
      approach.incomingPlaybackProgress
    );
    expect(inspection.incomingPlaybackProgress).toBeLessThan(1);
    expect(landing.incomingPlaybackProgress).toBe(1);
    expect(landing.incomingOpacity).toBeGreaterThan(approach.incomingOpacity);
  });
});
