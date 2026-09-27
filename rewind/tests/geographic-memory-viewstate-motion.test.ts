import { describe, expect, it } from "vitest";
import { CLIP_CONTRACT } from "../scene/clip-contract";
import {
  buildGeographicMemorySequence,
  cameraForGeographicFlight,
  focusZoomForMemory,
  geographicFrameState,
} from "../scene/geographic-memory-model";
import type { ArchiveRoute } from "../scene/rewind-model";

const DAY_MS = 86_400_000;

function route(
  cluster: number,
  routeIndex: number,
  longitude: number,
  latitude: number
): ArchiveRoute {
  const startMs =
    Date.parse("2023-01-02T00:00:00.000Z") +
    (cluster * 21 + (routeIndex % 2)) * DAY_MS;
  const offset = routeIndex * 0.012;
  return {
    id: `cluster-${cluster}-route-${routeIndex}`,
    startMs,
    endMs: startMs + 3_600_000,
    activityType: routeIndex % 2 === 0 ? "Run" : "Ride",
    provider: "test",
    timing: "inferred",
    bbox: [
      longitude + offset,
      latitude + offset,
      longitude + offset + 0.04,
      latitude + offset + 0.04,
    ],
    center: [longitude + offset + 0.02, latitude + offset + 0.02],
    pointCount: 3,
    paths: [
      {
        positions: [
          [longitude + offset, latitude + offset],
          [longitude + offset + 0.02, latitude + offset + 0.02],
          [longitude + offset + 0.04, latitude + offset + 0.04],
        ],
      },
    ],
  };
}

function archiveRoutes(): ArchiveRoute[] {
  return Array.from({ length: 48 }, (_, cluster) => {
    const longitude = -168 + (cluster % 12) * 28;
    const latitude = -56 + Math.floor(cluster / 12) * 34;
    return Array.from({ length: 3 }, (_, routeIndex) =>
      route(cluster, routeIndex, longitude, latitude)
    );
  }).flat();
}

describe("geographic continuous view-state motion", () => {
  it("dwells close enough to read each destination without freezing into a bearing-only orbit", () => {
    const sequence = buildGeographicMemorySequence(archiveRoutes());
    const samples = Array.from(
      { length: CLIP_CONTRACT.transitionFrameCount },
      (_, frame) => {
        const state = geographicFrameState(frame, sequence);
        return {
          state,
          camera: cameraForGeographicFlight(state, sequence),
        };
      }
    );

    for (let beatIndex = 1; beatIndex <= sequence.beats.length; beatIndex += 1) {
      const destinationPassage = samples.filter(
        ({ state }) =>
          state.beatIndex === beatIndex &&
          state.beatProgress >= 0.3 &&
          state.beatProgress <= 0.9
      );
      expect(destinationPassage.length).toBeGreaterThan(25);

      const zone = sequence.beats[beatIndex - 1].zone;
      const readableFocusFrames = destinationPassage.filter(({ camera }) =>
        haversineKm(
          [camera.longitude, camera.latitude],
          [zone.longitude, zone.latitude]
        ) <= Math.max(zone.focusRadiusKm, 24) &&
        Math.abs(camera.zoom - focusZoomForMemory(zone)) <= 0.35
      );
      expect(readableFocusFrames.length).toBeGreaterThanOrEqual(20);

      for (let index = 1; index < destinationPassage.length; index += 1) {
        const previous = destinationPassage[index - 1].camera;
        const current = destinationPassage[index].camera;
        const nonBearingMotion = Math.hypot(
          shortestLongitudeDelta(previous.longitude, current.longitude),
          current.latitude - previous.latitude,
          current.zoom - previous.zoom,
          (current.pitch - previous.pitch) / 10
        );
        expect(nonBearingMotion).toBeGreaterThan(1e-8);
      }
    }
  });
});

function haversineKm(left: [number, number], right: [number, number]): number {
  const toRadians = Math.PI / 180;
  const latitudeDelta = (right[1] - left[1]) * toRadians;
  const longitudeDelta = (right[0] - left[0]) * toRadians;
  const leftLatitude = left[1] * toRadians;
  const rightLatitude = right[1] * toRadians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shortestLongitudeDelta(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}
