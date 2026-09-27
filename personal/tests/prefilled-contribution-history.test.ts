import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { ContributionDay, OwnerProjectContributionSnapshot } from "../scene/calendar-model";
import { buildCommitLocationHeat } from "../scene/location-heat-model";
import { withPrefilledContributionHistory, prefilledHistoryOpacity } from "../scene/prefilled-contribution-history";
import { contributionLandingCounterFrame, contributionLandingSeconds } from "../scene/contribution-landing-counter";
import { organizationActivityOpacities } from "../scene/organization-activity-model";
import { buildContributionFocusBeats } from "../scene/globe-focus-model";
import { contributionTimecodeFrame } from "../scene/geographic-memory-timecode";

function snapshot(from: string, length: number, activity: Record<number, number>): OwnerProjectContributionSnapshot {
  const days: ContributionDay[] = Array.from({ length }, (_, index) => {
    const count = activity[index] ?? 0;
    return {
      date: new Date(Date.parse(from) + index * 86_400_000).toISOString().slice(0, 10),
      count, level: count > 0 ? 4 : 0,
      projects: count ? [{ repository: "NEW-HEAT/NEWHEAT", visibility: "private", count,
        commits: count, pullRequests: 0, issues: 0, reviews: 0 }] : [],
    };
  });
  return {
    schemaVersion: 2, login: "charlieforward9", generatedAt: "2026-09-03T00:00:00Z",
    source: "github-authenticated-owner-project-events", timezone: "America/New_York",
    dateRange: { from, to: days.at(-1)!.date }, projects: [],
    years: [{ year: Number(from.slice(0, 4)), totalContributions: 0, days }],
    provenance: { authenticated: true, visibility: "owner-visible-projects", approval: "test",
      endpoints: [], restrictedContributionsByYear: [], note: "synthetic regression fixture" },
  };
}
function fixtures() {
  const archive = { ownerFingerprint: "test-owner", routes: [
    { startMs: Date.parse("2022-12-31T18:00:00Z"), center: [-80, 26] as [number, number] },
    { startMs: Date.parse("2023-01-01T18:00:00Z"), center: [-80, 26] as [number, number] },
  ] };
  const history = buildCommitLocationHeat(snapshot("2022-01-01", 365, { 0: 3, 364: 20 }), archive);
  const live = buildCommitLocationHeat(snapshot("2023-01-01", 1338, { 0: 2, 1: 4, 1337: 5 }), archive);
  return { history, live, combined: withPrefilledContributionHistory(live, history) };
}

describe("2022 starting balance without retiming the accepted live movie", () => {
  it("keeps all live dates, ordinals, points and focus beats unchanged", () => {
    const { combined, live } = fixtures();
    expect(combined.dayCount).toBe(1338);
    expect(combined.dateRange).toEqual(live.dateRange);
    expect(combined.organizationProgress.map((day) => [day.date, day.dayOrdinal]))
      .toEqual(live.organizationProgress.map((day) => [day.date, day.dayOrdinal]));
    const livePoints = combined.points.filter((point) => point.dayOrdinal >= 0);
    expect(livePoints).toEqual(live.points);
    expect(buildContributionFocusBeats(livePoints, combined.locationZones, combined.dateRange, combined.dayCount))
      .toEqual(buildContributionFocusBeats(live.points, live.locationZones, live.dateRange, live.dayCount));
    expect(combined.points.filter((point) => point.dayOrdinal < 0).map((point) => point.dayOrdinal)).toEqual([-1]);
  });
  it("prefills frame zero and never replays the historical total as a daily addition", () => {
    const { combined, live } = fixtures();
    expect(contributionLandingCounterFrame(0, combined.organizationProgress).total).toBe(23);
    expect(contributionLandingCounterFrame(0, combined.organizationProgress).additions).toEqual([]);
    const landingFrame = Math.ceil(contributionLandingSeconds(0, combined.dayCount) * 60);
    for (const frame of [landingFrame - 1, landingFrame, landingFrame + 1, 120, 1800, 3700, 3719]) {
      const before = contributionLandingCounterFrame(frame, live.organizationProgress);
      const after = contributionLandingCounterFrame(frame, combined.organizationProgress);
      expect(after.total).toBe(before.total + 23);
      expect(after.additions).toEqual(before.additions);
    }
    expect(combined.metrics.contributionVolume).toBe(34);
    expect(contributionLandingCounterFrame(3719, combined.organizationProgress).total).toBe(34);
  });
  it("retains unknown historical locations as counts only and merges known heat", () => {
    const { combined } = fixtures();
    expect(combined.prefilledHistory).toMatchObject({ contributionVolume: 23, locatedContributionVolume: 20 });
    expect(combined.points.some((point) => point.date === "2022-01-01")).toBe(false);
    expect(combined.organizationShares.reduce((sum, share) => sum + share.contributionPercent, 0)).toBe(100);
    expect(combined.organizationShares.reduce((sum, share) => sum + share.activeDayPercent, 0)).toBe(100);
    expect(combined.metrics.byYear.map((year) => year.year)).toEqual([2022, 2023, 2026]);
  });
  it("uses historical recency without falsely relighting an inactive org on January 1", () => {
    const { combined, live } = fixtures();
    const initial = organizationActivityOpacities(0, combined.organizationProgress)["new-heat"];
    expect(initial).toBeGreaterThan(0.99);
    expect(organizationActivityOpacities(59, combined.organizationProgress)["new-heat"]).toBe(initial);
    const frame = Math.ceil(contributionLandingSeconds(0, live.dayCount) * 60);
    expect(organizationActivityOpacities(frame, combined.organizationProgress)["new-heat"]).toBe(1);
  });
  it("leaves the date reel unchanged while displaying the prefilled opening count", () => {
    const { combined, live } = fixtures();
    const beats = buildContributionFocusBeats(live.points, live.locationZones, live.dateRange, live.dayCount);
    for (const frame of [0, 30, 60, 120, 1800, 3719]) {
      const before = contributionTimecodeFrame(frame, beats, live.organizationProgress);
      const after = contributionTimecodeFrame(frame, beats, combined.organizationProgress);
      expect(after.reel).toEqual(before.reel);
      expect(after.currentDate).toBe(before.currentDate);
    }
    expect(contributionTimecodeFrame(0, beats, combined.organizationProgress).cumulativeContributions["new-heat"]).toBe(23);
  });
  it("fades completed heat in over half a second, before live arrivals, without flattening it in encoding", () => {
    expect(prefilledHistoryOpacity(0)).toBe(0);
    expect(prefilledHistoryOpacity(0.25)).toBe(0.5);
    expect(prefilledHistoryOpacity(0.5)).toBe(1);
    expect(prefilledHistoryOpacity(62)).toBe(1);
    const scene = readFileSync(new URL("../scene/globe-scene.ts", import.meta.url), "utf8");
    expect(scene).toContain("dataset.points.filter((point) => point.dayOrdinal >= 0)");
    expect(scene.match(/opacity: frameState.prefilledHeatOpacity/g)).toHaveLength(3);
    const renderer = readFileSync(new URL("../render-globe.mts", import.meta.url), "utf8");
    expect(renderer).toContain("hasPrefilledHistory ? 1 : Math.round");
  });
  it("rejects overlapping, duplicate, or different-owner prefill", () => {
    const { live, history, combined } = fixtures();
    expect(() => withPrefilledContributionHistory(live, live)).toThrow("overlaps");
    expect(() => withPrefilledContributionHistory(combined, history)).toThrow("already prefilled");
    expect(() => withPrefilledContributionHistory(live, { ...history, ownerFingerprint: "other" })).toThrow("same owner");
  });
});
