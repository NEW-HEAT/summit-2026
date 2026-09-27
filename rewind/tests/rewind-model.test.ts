import { describe, expect, it } from "vitest";
import { visibleRoutePath, type ArchiveRoute } from "../scene/rewind-model";

function route(timed: boolean): ArchiveRoute {
  return {
    id: timed ? "timed" : "untimed",
    startMs: 1_000,
    endMs: 2_000,
    activityType: "Run",
    provider: "test",
    timing: timed ? "recorded" : "inferred",
    bbox: [-80, 26, -79.8, 26.2],
    center: [-79.9, 26.1],
    pointCount: 3,
    paths: [
      {
        positions: [
          [-80, 26],
          [-79.9, 26.1],
          [-79.8, 26.2],
        ],
        ...(timed ? { timesMs: [1_000, 1_500, 2_000] } : {}),
      },
    ],
  };
}

describe("route rewind truth modes", () => {
  it("uses recorded point time when it is available", () => {
    expect(visibleRoutePath(route(true), 1_600, "provenance")[0]).toHaveLength(
      2
    );
  });

  it("keeps untimed provenance whole and labels editorial unpaint separately", () => {
    expect(visibleRoutePath(route(false), 1_500, "provenance")[0]).toHaveLength(
      3
    );
    expect(visibleRoutePath(route(false), 1_500, "editorial")[0]).toHaveLength(
      2
    );
    expect(visibleRoutePath(route(false), 999, "provenance")).toEqual([]);
  });
});
