import { describe, expect, it } from "vitest";
import {
  formatMemoryLocationDisplay,
  memoryLocationTransitionMotion,
} from "../scene/geographic-memory-caption";

describe("geographic memory location polish", () => {
  const display = (cityOrRegion: string, state: string, country: string) =>
    formatMemoryLocationDisplay({
      cityOrRegion,
      state,
      country,
      label: `${cityOrRegion}, ${state}, ${country}`,
    });

  it("uses the approved metro-area display names", () => {
    expect(display("Angered", "Västra Götaland", "Sweden")).toEqual({
      primary: "Gothenburg",
      secondary: "Västra Götaland · Sweden",
    });
    expect(display("Irving", "Texas", "United States")).toEqual({
      primary: "Dallas Fort Worth",
      secondary: "Texas · United States",
    });
    expect(display("Smyrna", "Georgia", "United States")).toEqual({
      primary: "Atlanta",
      secondary: "Georgia · United States",
    });
    expect(display("Illescas", "Castilla-La Mancha", "Spain")).toEqual({
      primary: "Madrid",
      secondary: "Spain",
    });
    expect(display("Roelofarendsveen", "South Holland", "Netherlands")).toEqual(
      {
        primary: "Delft",
        secondary: "South Holland · Netherlands",
      }
    );
  });

  it("clears the outgoing card before settling the incoming card", () => {
    const start = memoryLocationTransitionMotion(0);
    const middle = memoryLocationTransitionMotion(0.15);
    const end = memoryLocationTransitionMotion(0.34);

    expect(start).toMatchObject({
      outgoingOpacity: 1,
      outgoingOffsetY: -0,
      incomingOpacity: 0,
      incomingOffsetY: 24,
    });
    expect(middle.outgoingOpacity + middle.incomingOpacity).toBeLessThan(0.1);
    expect(middle.outgoingOffsetY).toBeLessThan(-20);
    expect(middle.incomingOffsetY).toBeGreaterThan(20);
    expect(end).toMatchObject({
      outgoingOpacity: 0,
      outgoingOffsetY: -24,
      incomingOpacity: 1,
      incomingOffsetY: 0,
    });
  });
});
