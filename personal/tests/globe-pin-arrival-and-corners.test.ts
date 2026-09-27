import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONTRIBUTION_PIN_ARRIVAL_FRACTION,
  contributionPinArrival,
  contributionPinLandingImpact,
} from "../scene/globe-pin-arrival-model";
import { organizationLegendCorner } from "../scene/geographic-memory-timecode";
import { CONTRIBUTION_BANG_DURATION_DAYS, settledContributionRevealHead, type ContributionImpact } from "../scene/globe-impact-model";

const impact: ContributionImpact = {
  id: "day-org", position: [-82, 30], progress: 0, intensity: 1, volume: 50,
  organizationColor: [248, 81, 73], organizationIndex: 0,
};
const viewport = { width: 1920, height: 1080 };

describe("corner-to-map contribution arrivals", () => {
  it("begins at globe size beyond the absolute corner and contracts directly to the projected destination", () => {
    for (const target of [[960, 540], [470, 520], [1460, 500], [960, 45], [920, 1010]] as [number, number][]) {
      const start = contributionPinArrival(impact, target, viewport)!;
      const [x, y] = start.position;
      expect(start.radius * 2).toBe(996);
      expect([x, y]).toEqual([-180, -180]);
      expect(x + start.radius).toBeGreaterThan(0);
      expect(y + start.radius).toBeGreaterThan(0);
      let previousDistance = Infinity;
      let previousRadius = Infinity;
      for (const progress of [0, 0.1, 0.2, 0.4, 0.61]) {
        const pin = contributionPinArrival({ ...impact, progress }, target, viewport)!;
        const distance = Math.hypot(pin.position[0] - target[0], pin.position[1] - target[1]);
        expect(distance).toBeLessThanOrEqual(previousDistance);
        expect(pin.radius).toBeLessThanOrEqual(previousRadius);
        expect(pin.color).toEqual([248, 81, 73, 255]);
        previousDistance = distance;
        previousRadius = pin.radius;
      }
      expect(previousDistance).toBeLessThan(0.02);
    }
  });

  it("lands before triggering the existing bang and preserves the heatmap settling clock", () => {
    expect(contributionPinLandingImpact({ ...impact, progress: 0.3 })).toBeNull();
    expect(contributionPinArrival({ ...impact, progress: CONTRIBUTION_PIN_ARRIVAL_FRACTION }, [960, 540], viewport)).toBeNull();
    expect(contributionPinLandingImpact({ ...impact, progress: CONTRIBUTION_PIN_ARRIVAL_FRACTION })?.progress).toBe(0);
    expect(contributionPinLandingImpact({ ...impact, progress: 1 })?.progress).toBe(1);
    expect(CONTRIBUTION_BANG_DURATION_DAYS).toBe(8);
    expect(settledContributionRevealHead(100, false)).toBe(92);
  });
});

describe("organization corner legend", () => {
  it("preserves the legend RGB and alpha through its opening second", () => {
    const renderer = readFileSync(new URL("../render-globe.mts", import.meta.url), "utf8");
    const timecodeNormalizer = renderer.split("async function normalizeAlphaMov")[1]
      .split("async function normalizeGlobeAlphaMov")[0];
    expect(timecodeNormalizer).toContain("format=yuva444p10le");
    expect(timecodeNormalizer).not.toContain("alphamerge");
    expect(timecodeNormalizer).not.toContain("color=c=");
  });
  it("pins identity to the requested corner independent of ranking or data order", () => {
    expect(organizationLegendCorner("new-heat")).toEqual({ corner: "top-left", x: 306, y: 96 });
    expect(organizationLegendCorner("agriculture-intelligence")).toEqual({ corner: "bottom-left", x: 306, y: 760 });
    expect(organizationLegendCorner("visgl")).toEqual({ corner: "top-right", x: 1614, y: 96 });
    expect(organizationLegendCorner("visualpt")).toEqual({ corner: "bottom-right", x: 1614, y: 760 });
    expect(organizationLegendCorner("misc")).toBeNull();
  });
});
