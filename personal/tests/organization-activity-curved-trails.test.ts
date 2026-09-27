import { describe, expect, it } from "vitest";
import { organizationActivityOpacities } from "../scene/organization-activity-model";
import { contributionLandingCounterFrame, contributionLandingSeconds } from "../scene/contribution-landing-counter";
import { organizationLegendCorner, GEOGRAPHIC_MEMORY_TIMECODE_STYLE } from "../scene/geographic-memory-timecode";
import { contributionPinPathPosition, contributionPinTrail, contributionPinTrailSegments } from "../scene/globe-pin-arrival-model";
import type { OrganizationProgressDay } from "../scene/organization-share-model";
import type { ContributionImpact } from "../scene/globe-impact-model";

const viewport = { width: 1920, height: 1080 };
const target: [number, number] = [960, 540];
const impact: ContributionImpact = {
  id: "day-org", position: [-82, 30], progress: 0.31, intensity: 1, volume: 50,
  organizationColor: [248, 81, 73], organizationIndex: 0,
};
const timeline: OrganizationProgressDay[] = Array.from({ length: 1338 }, (_, dayOrdinal) => ({
  date: new Date(Date.UTC(2023, 0, 1 + dayOrdinal)).toISOString().slice(0, 10), dayOrdinal,
  cumulativeContributions: {
    "new-heat": dayOrdinal < 60 ? 10 : 13,
    "agriculture-intelligence": dayOrdinal < 20 ? 0 : 20,
    visualpt: 0, visgl: 0, misc: 0,
  },
}));
const landing = (day: number) => Math.ceil(contributionLandingSeconds(day, timeline.length) * 60 - 1e-8);

describe("organization inactivity and CapCut clearance", () => {
  it("dims smoothly to 25 percent without reducing the count, then relights on the exact landing frame", () => {
    expect(organizationActivityOpacities(0, timeline)["new-heat"]).toBe(0.25);
    expect(organizationActivityOpacities(landing(0), timeline)["new-heat"]).toBe(1);
    const half = organizationActivityOpacities(landing(15), timeline)["new-heat"];
    expect(half).toBeGreaterThan(0.6);
    expect(half).toBeLessThan(0.65);
    expect(organizationActivityOpacities(landing(31), timeline)["new-heat"]).toBe(0.25);
    expect(contributionLandingCounterFrame(landing(31), timeline).cumulativeContributions["new-heat"]).toBe(10);
    expect(organizationActivityOpacities(landing(60) - 1, timeline)["new-heat"]).toBe(0.25);
    expect(organizationActivityOpacities(landing(60), timeline)["new-heat"]).toBe(1);
    expect(contributionLandingCounterFrame(landing(60), timeline).cumulativeContributions["new-heat"]).toBe(13);
  });
  it("tracks each organization independently and never hides unused organizations", () => {
    const active = organizationActivityOpacities(landing(20), timeline);
    expect(active["agriculture-intelligence"]).toBe(1);
    expect(active["new-heat"]).toBeLessThan(0.5);
    expect(active.visualpt).toBe(0.25);
    expect(active.visgl).toBe(0.25);
    expect(Object.values(organizationActivityOpacities(3719, timeline))).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(Object.values(organizationActivityOpacities(0, []))).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
  it("keeps the requested corner order and at least 240 px below the raised bottom count plus shadow", () => {
    expect(organizationLegendCorner("new-heat")?.corner).toBe("top-left");
    expect(organizationLegendCorner("agriculture-intelligence")?.corner).toBe("bottom-left");
    expect(organizationLegendCorner("visgl")?.corner).toBe("top-right");
    expect(organizationLegendCorner("visualpt")?.corner).toBe("bottom-right");
    for (const key of ["agriculture-intelligence", "visualpt"] as const) {
      expect(organizationLegendCorner(key)!.y + GEOGRAPHIC_MEMORY_TIMECODE_STYLE.organizationCountY + 28)
        .toBeLessThanOrEqual(1080 - 240);
    }
  });
});

describe("curved, tapered contribution wake", () => {
  it("bows away from the straight chord for every corner and still lands exactly", () => {
    for (let org = 0; org < 4; org += 1) {
      const start = contributionPinPathPosition(org, target, viewport, 0);
      const middle = contributionPinPathPosition(org, target, viewport, 0.2);
      const chord = [target[0] - start[0], target[1] - start[1]];
      const offset = [middle[0] - start[0], middle[1] - start[1]];
      const distanceFromStraight = Math.abs(chord[0] * offset[1] - chord[1] * offset[0]) / Math.hypot(...chord);
      expect(distanceFromStraight).toBeGreaterThan(200);
      expect(contributionPinPathPosition(org, target, viewport, 1)).toEqual(target);
    }
  });
  it("tapers the sampled wake toward the tail with no detached or future segments", () => {
    const trail = contributionPinTrail(impact, target, viewport)!;
    const segments = contributionPinTrailSegments(trail);
    expect(segments.length).toBeGreaterThan(10);
    expect(segments[0].width).toBeLessThan(1);
    expect(segments.at(-1)!.width).toBeGreaterThan(7);
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      expect(segment.color).toEqual([248, 81, 73, 235]);
      expect(segment.timestamps[0]).toBeLessThanOrEqual(1);
      if (index > 0) {
        expect(segment.path[0]).toEqual(segments[index - 1].path[1]);
        expect(segment.width).toBeGreaterThanOrEqual(segments[index - 1].width);
      }
    }
    expect(contributionPinTrailSegments(contributionPinTrail({ ...impact, progress: 0 }, target, viewport)!)).toHaveLength(1);
  });
});
