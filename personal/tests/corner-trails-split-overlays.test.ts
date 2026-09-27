import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contributionPinArrival, contributionPinTrail, CONTRIBUTION_PIN_ARRIVAL_FRACTION } from "../scene/globe-pin-arrival-model";
import { contributionLandingCounterFrame, contributionLandingSeconds } from "../scene/contribution-landing-counter";
import { drawContributionOverlay, organizationLegendCorner } from "../scene/geographic-memory-timecode";
import { VISIBLE_ORGANIZATION_GROUPS } from "../scene/calendar-model";
import { organizationColorForKey } from "../scene/location-heat-model";
import { buildContributionFocusBeats } from "../scene/globe-focus-model";
import type { OrganizationProgressDay } from "../scene/organization-share-model";
import type { ContributionImpact } from "../scene/globe-impact-model";

const impact: ContributionImpact = {
  id: "day-org", position: [-82, 30], progress: 0, intensity: 1, volume: 50,
  organizationColor: [248, 81, 73], organizationIndex: 0,
};
const viewport = { width: 1920, height: 1080 };
const target: [number, number] = [960, 540];

function days(): OrganizationProgressDay[] {
  return Array.from({ length: 1338 }, (_, dayOrdinal) => ({
    date: new Date(Date.UTC(2023, 0, 1 + dayOrdinal)).toISOString().slice(0, 10),
    dayOrdinal,
    cumulativeContributions: {
      "new-heat": (dayOrdinal + 1) * 2, "agriculture-intelligence": dayOrdinal + 1,
      visualpt: 0, visgl: 0, misc: 0,
    },
  }));
}

describe("absolute-corner diagonal arrivals and native trips trails", () => {
  it.each([
    ["new-heat", "#f85149", "top-left", [-180, -180]],
    ["agriculture-intelligence", "#39d353", "bottom-left", [-180, 1260]],
    ["visgl", "#a371f7", "top-right", [2100, -180]],
    ["visualpt", "#58a6ff", "bottom-right", [2100, 1260]],
  ] as const)("aligns %s colored circles and trails with its legend corner", (key, color, corner, start) => {
    const organizationIndex = VISIBLE_ORGANIZATION_GROUPS.findIndex((group) => group.key === key);
    expect(VISIBLE_ORGANIZATION_GROUPS[organizationIndex].color).toBe(color);
    const organizationColor = organizationColorForKey(key);
    const current = { ...impact, organizationIndex, organizationColor };
    const arrival = contributionPinArrival(current, target, viewport)!;
    const trail = contributionPinTrail(current, target, viewport)!;
    expect(organizationLegendCorner(key)!.corner).toBe(corner);
    expect(arrival.position).toEqual(start);
    expect(trail.path[0]).toEqual(start);
    expect(arrival.color).toEqual([...organizationColor, 255]);
    expect(trail.color).toEqual([...organizationColor, 235]);
    expect(arrival.radius).toBe(498);
  });
  it("uses the identical path for the trail and the moving circle, with a finite tail after landing", () => {
    const progress = CONTRIBUTION_PIN_ARRIVAL_FRACTION / 2;
    const current = { ...impact, progress };
    const trail = contributionPinTrail(current, target, viewport)!;
    expect(trail.path).toHaveLength(trail.timestamps.length);
    expect(trail.path[24]).toEqual(contributionPinArrival(current, target, viewport)!.position);
    expect(trail.timestamps[24]).toBe(1);
    expect(trail.path.at(-1)).toEqual(target);
    expect(contributionPinTrail({ ...impact, progress: 0.63 }, target, viewport)).not.toBeNull();
    expect(contributionPinTrail({ ...impact, progress: 0.9 }, target, viewport)).toBeNull();
    const scene = readFileSync(new URL("../scene/globe-scene.ts", import.meta.url), "utf8");
    expect(scene).toContain('import { TripsLayer } from "@deck.gl/geo-layers"');
    expect(scene).toContain("new TripsLayer<");
    expect(scene).toContain('cullMode: "none"');
  });
});

describe("landing-synchronized total and daily additions", () => {
  it("adds a day exactly on the first frame its circle lands, never before", () => {
    const timeline = days();
    const landingFrame = Math.ceil(contributionLandingSeconds(0, timeline.length) * 60);
    expect(contributionLandingCounterFrame(landingFrame - 1, timeline).total).toBe(0);
    const landed = contributionLandingCounterFrame(landingFrame, timeline);
    expect(landed.total).toBe(3);
    expect(landed.additions.map((entry) => [entry.key, entry.count, entry.corner])).toEqual([
      ["new-heat", 2, [-1, -1]], ["agriculture-intelligence", 1, [-1, 1]],
    ]);
    expect(landed.additions.every((entry) => entry.progress === 0)).toBe(true);
  });
  it("keeps totals monotonic and lands the final contribution inside the 62-second movie", () => {
    const timeline = days();
    expect(contributionLandingSeconds(1337, timeline.length)).toBeLessThan(62);
    let prior = 0;
    for (let frame = 0; frame < 3720; frame += 31) {
      const counter = contributionLandingCounterFrame(frame, timeline);
      expect(counter.total).toBeGreaterThanOrEqual(prior);
      expect(counter.total).toBeLessThanOrEqual(1338 * 3);
      prior = counter.total;
    }
    const last = contributionLandingCounterFrame(3719, timeline);
    expect(last.total).toBe(4014);
    expect(last.additions).toHaveLength(0);
  });
  it("shows only the total in the total track and no total or org copy in the date track", () => {
    const texts: string[] = [];
    const context = new Proxy({
      fillText: (text: string) => texts.push(text),
      measureText: (text: string) => ({ width: text.length * 25 }),
    }, { get: (object, key) => key in object ? object[key as keyof typeof object] : () => {} }) as unknown as CanvasRenderingContext2D;
    const timeline = days();
    const beats = [{ startDate: "2023-01-01", endDate: "2026-08-30" }] as ReturnType<typeof buildContributionFocusBeats>;
    drawContributionOverlay(context, 0, beats, [], timeline, "total");
    expect(texts).toEqual(["0"]);
    texts.length = 0;
    drawContributionOverlay(context, 0, beats, [], timeline, "date");
    expect(texts.join("").replace(/\s/g, "")).toContain("JAN");
    expect(texts.join("")).not.toContain("HEAT");
    texts.length = 0;
    drawContributionOverlay(context, 0, beats, [], timeline, "organizations");
    expect(texts).toHaveLength(0);
  });
});
