import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addDays,
  buildContinuousCalendar,
  formatDate,
  type ContributionDay,
  type OwnerProjectContributionSnapshot,
} from "../scene/calendar-model";
import { buildOrganizationLegendTimeline, getDynamicLegendRows } from "../scene/legend-track";
import {
  VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT,
  VERTICAL_VISGL_HANDOFF_EXPORT_TIMING,
  buildVerticalCalendarLayout,
  buildVerticalFrameState,
} from "../scene/vertical-calendar-model";

describe("vis.gl contributor recap handoff export", () => {
  it("shares the final source frame with the archived community renderer", () => {
    const community = readFileSync(
      new URL("../../community/render-synchronized-alpha-tracks.mjs", import.meta.url), "utf8",
    );
    const constant = (name: string) => Number(community.match(new RegExp(`const ${name} = (\\d+);`))?.[1]);
    expect(constant("FPS")).toBe(60);
    expect(constant("SOURCE_BOUNDARY_FRAME_INDEX")).toBe(VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount - 1);
    expect(community).toContain("outputRgbaSha256.every((hash) => hash === sourceRgbaSha256)");

    expect(VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT).toMatchObject({
      durationSeconds: 62,
      frameCount: 3_720,
      sectionCount: 32,
      sectionSeconds: 1.9375,
      emptyPreRollSeconds: 1,
      traversalSeconds: 60,
      overviewTransitionSeconds: 0.5,
      overviewHoldSeconds: 0.5,
      slotStartTimecode: "00:45.0000",
      slotEndTimecode: "01:47.0000",
      nextClipStartTimecode: "01:47.0000",
      nextClipBoundaryMode: "decoded-pixel-exact-input-frame",
    });
  });

  it("moves through about three empty weeks before the first contribution fills", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const stateAt = (frameIndex: number) => buildVerticalFrameState(
      frameIndex,
      calendar,
      layout,
      VERTICAL_VISGL_HANDOFF_EXPORT_TIMING,
    );
    const start = stateAt(0);
    const middle = stateAt(30);
    const contributionBoundary = stateAt(60);
    const firstFill = stateAt(61);
    const fadeSettled = stateAt(90);

    expect(start.isPreRoll).toBe(true);
    expect(start.currentDayOrdinal / 7).toBeCloseTo(-3.2, 5);
    expect(start.revealHead).toBe(0);
    expect(middle.isPreRoll).toBe(true);
    expect(middle.revealHead).toBe(0);
    expect(middle.cameraY).toBeGreaterThan(start.cameraY);
    expect(contributionBoundary.isPreRoll).toBe(false);
    expect(contributionBoundary.revealHead).toBe(0);
    expect(contributionBoundary.cameraY).toBeGreaterThan(middle.cameraY);
    expect(firstFill.revealHead).toBeGreaterThan(0);
    expect(fadeSettled.introProgress).toBe(1);
    expect(fadeSettled.cameraY).toBeGreaterThan(contributionBoundary.cameraY);
  });

  it("keeps overlays at zero during pre-roll and lands the recap on frame 3660", () => {
    const calendar = buildContinuousCalendar(snapshot());
    const layout = buildVerticalCalendarLayout(calendar);
    const timeline = buildOrganizationLegendTimeline(calendar);
    const stateAt = (frameIndex: number) => buildVerticalFrameState(
      frameIndex,
      calendar,
      layout,
      VERTICAL_VISGL_HANDOFF_EXPORT_TIMING,
    );
    const preRollRows = getDynamicLegendRows(stateAt(30), timeline);

    expect(preRollRows.every((row) => row.entry.count === 0)).toBe(true);
    expect(stateAt(3_659).isOverview).toBe(false);
    expect(stateAt(3_660).isOverview).toBe(true);
    expect(stateAt(3_660).overviewProgress).toBe(0);
    expect(stateAt(3_690).overviewSettled).toBe(true);
    expect(stateAt(3_719).overviewSettled).toBe(true);
  });

  it("routes the export preset and writes the contributor input boundary", () => {
    const scene = readFileSync(new URL("../scene/vertical-scene.ts", import.meta.url), "utf8");
    const renderer = readFileSync(new URL("../render-vertical.mts", import.meta.url), "utf8");

    expect(scene).toContain('timingPreset === "visgl-contributor-handoff"');
    expect(scene).toContain("VERTICAL_VISGL_HANDOFF_EXPORT_TIMING");
    expect(renderer).toContain('timingPreset: "visgl-contributor-handoff"');
    expect(renderer).toContain("buildContributorHandoffFrame(options.output, options.contributorHandoffOutput)");
    expect(renderer).toContain("readCommunityHandoffContract()");
  });
});

function snapshot(): OwnerProjectContributionSnapshot {
  const start = new Date("2023-01-01T00:00:00.000Z");
  const days: ContributionDay[] = Array.from({ length: 1_344 }, (_, index) => ({
    date: formatDate(addDays(start, index)),
    count: 1,
    level: 1,
    attributedCount: 1,
    unattributedCount: 0,
    overflowCount: 0,
    projects: [{
      repository: "visgl/deck.gl",
      visibility: "public",
      count: 1,
      commits: 1,
      pullRequests: 0,
      issues: 0,
      reviews: 0,
    }],
  }));
  return {
    schemaVersion: 2,
    login: "charlieforward9",
    generatedAt: "2026-09-01T00:00:00.000Z",
    source: "github-authenticated-owner-project-events",
    dateRange: { from: days[0].date, to: days.at(-1)!.date },
    timezone: "America/New_York",
    projects: [],
    years: [{
      year: 2023,
      totalContributions: days.length,
      attributedContributions: days.length,
      days,
    }],
    provenance: {
      authenticated: true,
      visibility: "owner-visible-projects",
      approval: "test",
      endpoints: ["test"],
      restrictedContributionsByYear: [],
      note: "test",
    },
  };
}
