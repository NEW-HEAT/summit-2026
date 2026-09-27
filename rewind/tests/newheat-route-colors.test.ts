import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  NEWHEAT_ACTIVITY_COLORS,
  normalizeNewheatActivityType,
  resolveNewheatRouteColor,
} from "../scene/newheat-route-colors";

describe("NEWHEAT route colors", () => {
  it("stays locked to the canonical activity palette", () => {
    const canonicalSource = readFileSync(
      new URL("./canonical-colors.fixture.txt", import.meta.url),
      "utf8"
    );
    for (const activityType of [
      "Run",
      "Ride",
      "Hike",
      "Drive",
      "Other",
    ] as const) {
      expect(canonicalSource).toContain(
        `${activityType}: "${NEWHEAT_ACTIVITY_COLORS[activityType]}"`
      );
    }
  });

  it("normalizes the activity names present in the local archive", () => {
    expect(normalizeNewheatActivityType("CYCLING")).toBe("Ride");
    expect(normalizeNewheatActivityType("RUNNING")).toBe("Run");
    expect(normalizeNewheatActivityType("OPEN_WATER_SWIMMING")).toBe("Swim");
    expect(normalizeNewheatActivityType("STAND_UP_PADDLEBOARDING_V2")).toBe(
      "StandUpPaddling"
    );
  });

  it("uses the Studio map override for swimming", () => {
    expect(resolveNewheatRouteColor("Swim", 200)).toEqual([47, 155, 255, 200]);
    expect(resolveNewheatRouteColor("Run", 255)).toEqual([255, 69, 0, 255]);
    expect(resolveNewheatRouteColor("Ride", 255)).toEqual([255, 165, 0, 255]);
  });
});
