import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTRIBUTION_FOCUS_TRANSITION_FRACTION,
  contributionFocusFrame,
  type ContributionFocusBeat,
} from "../scene/globe-focus-model";

describe("quick active-location globe snap regression", () => {
  it("covers most of a location jump in the first half of a short settle", () => {
    const beats = [beat(0, -80, 26), beat(1, 2, 41)];
    const halfway = contributionFocusFrame((1 + 0.06) / beats.length, beats);
    const arrived = contributionFocusFrame((1 + 0.12) / beats.length, beats);
    const travelled = (halfway.longitude - beats[0].longitude)
      / (beats[1].longitude - beats[0].longitude);

    expect(CONTRIBUTION_FOCUS_TRANSITION_FRACTION).toBe(0.12);
    expect(travelled).toBeGreaterThan(0.85);
    expect(arrived.longitude).toBe(beats[1].longitude);
    expect(arrived.latitude).toBe(beats[1].latitude);
    expect(arrived.pulse).toBe(0);
  });

  it("publishes the quick ease-out motion contract in globe diagnostics", () => {
    const source = readFileSync(new URL("../scene/globe-scene.ts", import.meta.url), "utf8");

    expect(source).toContain('focusMotionMode: "quick-ease-out-section-snap"');
    expect(source).toContain("focusTransitionFraction: CONTRIBUTION_GLOBE_LAYOUT.focusTransitionFraction");
  });
});

function beat(sectionIndex: number, longitude: number, latitude: number): ContributionFocusBeat {
  return {
    sectionIndex,
    startDayOrdinal: sectionIndex,
    endDayOrdinal: sectionIndex,
    startDate: "2023-01-01",
    endDate: "2023-01-02",
    longitude,
    latitude,
    volume: 1,
    cellId: `${longitude}:${latitude}`,
    organizationKey: "new-heat",
    organizationColor: [248, 81, 73],
    organizationIndex: 0,
    source: "section-dominant-contribution-cell",
    locationPrimary: "Focus",
    locationSecondary: "Area",
    locationEvidence: "nearest-curated-memory-zone",
  };
}
