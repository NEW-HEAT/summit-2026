import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTRIBUTION_BANG_DURATION_DAYS,
  contributionHeatCellPolygon,
  contributionSettledHeatColor,
  geographicHeatCellPolygon,
  settledContributionRevealHead,
} from "../scene/globe-impact-model";
import { VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT } from "../scene/vertical-calendar-model";

describe("globe impact to geographic heat regression", () => {
  it("holds new contributions out of settled heat until the bang completes", () => {
    expect(settledContributionRevealHead(6, false)).toBe(0);
    expect(settledContributionRevealHead(20, false)).toBe(
      20 - CONTRIBUTION_BANG_DURATION_DAYS,
    );
    expect(settledContributionRevealHead(20, true)).toBe(20);
  });

  it("uses opaque cumulative heat cells with non-overlapping organization quadrants", () => {
    const fullCell = geographicHeatCellPolygon([-80, 26]);
    const quadrants = [0, 1, 2, 3].map((index) =>
      contributionHeatCellPolygon([-80, 26], index),
    );
    const low = contributionSettledHeatColor([248, 81, 73], 1);
    const high = contributionSettledHeatColor([248, 81, 73], 64);

    expect(fullCell).toEqual([
      [-80.5, 25.5],
      [-79.5, 25.5],
      [-79.5, 26.5],
      [-80.5, 26.5],
    ]);
    expect(new Set(quadrants.flat().map((position) => position.join(",")).values()).size)
      .toBeGreaterThan(4);
    expect(low[3]).toBe(255);
    expect(high[3]).toBe(255);
    expect(high[0]).toBeGreaterThan(low[0]);
  });

  it("keeps scatterplots transient and settles both work and training into PolygonLayer heat", () => {
    const source = readFileSync(new URL("../scene/globe-scene.ts", import.meta.url), "utf8");

    expect(source).toContain("new PolygonLayer<WorkHeatTile>");
    expect(source).toContain("new PolygonLayer<TrainingHeatTile>");
    expect(source).not.toContain("new ScatterplotLayer<WorkHeatTile>");
    expect(source).not.toContain("new ScatterplotLayer<TrainingHeatTile>");
    expect(source).toContain('persistentWorkScatterplots: false');
    expect(source).toContain('persistentTrainingScatterplots: false');
    // Final-day arrivals are allowed to finish in the ending hold, then expire
    // through buildContributionImpacts' existing eight-day lifetime.
    expect(source).toContain("/ VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.traversalSeconds * dataset.dayCount");
    expect(source).toContain("frameState.elapsedSeconds < VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds");
  });

  it("locks the regenerated globe to the current 62-second handoff", () => {
    expect(VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount).toBe(3_720);
    expect(VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.durationSeconds).toBe(62);
    expect(VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds).toBe(1);
  });
});
