import { describe, expect, it } from "vitest";
import type { ContributionImpact } from "../scene/globe-impact-model";
import {
  CONTRIBUTION_PIN_ARRIVAL_MAX_RADIUS,
  CONTRIBUTION_PIN_ARRIVAL_FRACTION,
  CONTRIBUTION_PIN_ARRIVAL_HOLD_FRACTION,
  contributionPinArrival,
} from "../scene/globe-pin-arrival-model";

describe("larger incoming contribution circles", () => {
  it("starts at globe size and recedes rapidly without enlarging the landing pin or changing arrival duration", () => {
    const impact: ContributionImpact = {
      id: "test-day", position: [-82, 30], progress: 0, intensity: 1, volume: 50,
      organizationColor: [248, 81, 73], organizationIndex: 0,
    };
    const viewport = { width: 1920, height: 1080 };
    const initial = contributionPinArrival(impact, [960, 540], viewport)!;
    expect(initial.radius).toBe(498);
    expect(CONTRIBUTION_PIN_ARRIVAL_MAX_RADIUS).toBe(498);
    expect(CONTRIBUTION_PIN_ARRIVAL_FRACTION).toBe(0.62);
    const held = contributionPinArrival({
      ...impact,
      progress: CONTRIBUTION_PIN_ARRIVAL_FRACTION * CONTRIBUTION_PIN_ARRIVAL_HOLD_FRACTION,
    }, [960, 540], viewport)!;
    expect(held.radius).toBe(498);
    const halfway = contributionPinArrival({
      ...impact, progress: CONTRIBUTION_PIN_ARRIVAL_FRACTION / 2,
    }, [960, 540], viewport)!;
    expect(halfway.radius).toBeLessThan(40);
    for (const intensity of [0, 0.25, 0.5, 0.75, 1]) {
      expect(contributionPinArrival({ ...impact, intensity }, [960, 540], viewport)?.radius).toBe(498);
    }
    const landing = contributionPinArrival({ ...impact, progress: 0.6199 }, [960, 540], viewport)!;
    expect(landing.radius).toBeCloseTo(8.5, 6);
    expect(landing.position[0]).toBeCloseTo(960, 6);
    expect(landing.position[1]).toBeCloseTo(540, 6);
    expect(initial.color).toEqual([248, 81, 73, 255]);
  });
});
