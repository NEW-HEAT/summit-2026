import { describe, expect, it } from "vitest";
import { CLIP_CONTRACT } from "../scene/clip-contract";
import {
  applyGeographicMemorySelectionOverride,
  buildGeographicMemorySequence,
  cameraForGeographicFlight,
  flightScheduleForFrame,
  focusDwellWindowForMemory,
  focusZoomForMemory,
  geographicFrameState,
  landingPitchForMemory,
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

describe("geographic memory selector", () => {
  it("selects 32 distinct chronological memories plus 16 alternates", () => {
    const sequence = buildGeographicMemorySequence(archiveRoutes());
    expect(sequence.kind).toBe("geographic-memories-v1");
    expect(sequence.beats).toHaveLength(32);
    expect(sequence.alternates).toHaveLength(16);
    expect(
      new Set(sequence.beats.map((beat) => beat.representativeDate))
    ).toHaveLength(32);
    for (let index = 1; index < sequence.beats.length; index += 1) {
      expect(sequence.beats[index - 1].representativeMs).toBeGreaterThan(
        sequence.beats[index].representativeMs
      );
    }
    expect(sequence.beats.every((beat) => beat.zone.routeCount <= 48)).toBe(
      true
    );
    expect(
      sequence.beats.every(
        (beat) =>
          beat.zone.focusRadiusKm > 0 &&
          beat.zone.focusRadiusKm <= beat.zone.radiusKm + 1e-6
      )
    ).toBe(true);
    expect(
      Math.max(...sequence.beats.map((beat) => focusZoomForMemory(beat.zone)))
    ).toBeGreaterThan(11);
    expect(
      sequence.beats.every(
        (beat) =>
          Number.isFinite(beat.zone.bearing) && beat.zone.location === null
      )
    ).toBe(true);
  });

  it("preserves the close route-fit zoom instead of flattening it to z9.6", () => {
    const sequence = buildGeographicMemorySequence(archiveRoutes());
    const closeZone = sequence.beats.reduce(
      (closest, beat) =>
        beat.zone.focusRadiusKm < closest.focusRadiusKm ? beat.zone : closest,
      sequence.beats[0].zone
    );
    expect(focusZoomForMemory(closeZone)).toBeGreaterThan(11);
    expect(focusZoomForMemory(closeZone)).toBeLessThanOrEqual(13.65);
    expect(focusZoomForMemory(closeZone)).toBeGreaterThanOrEqual(
      Math.min(closeZone.zoom + 0.45, 13.65)
    );
  });

  it("uses more of the viewport for sparse memories while protecting dense extents", () => {
    const sequence = buildGeographicMemorySequence(archiveRoutes());
    const zone = sequence.beats[0].zone;
    const sparse = focusZoomForMemory({ ...zone, routeCount: 4 });
    const dense = focusZoomForMemory({ ...zone, routeCount: 48 });
    expect(sparse).toBeGreaterThan(dense);
    expect(sparse - dense).toBeGreaterThan(0.2);
  });

  it("promotes an approved real memory without changing the 32-beat contract", () => {
    const sequence = buildGeographicMemorySequence(archiveRoutes());
    const selected = sequence.beats[0];
    const alternate = sequence.alternates[0];
    selected.zone.location = {
      cityOrRegion: "Gunnison",
      state: "Colorado",
      country: "United States",
      label: "Gunnison, Colorado, United States",
    };
    alternate.zone.location = {
      cityOrRegion: "Westminster",
      state: "Colorado",
      country: "United States",
      label: "Westminster, Colorado, United States",
    };
    const updated = applyGeographicMemorySelectionOverride(sequence, {
      replace: { cityOrRegion: "Gunnison", state: "Colorado" },
      promote: { cityOrRegion: "Westminster", state: "Colorado" },
    });
    expect(updated.beats).toHaveLength(32);
    expect(updated.alternates).toHaveLength(16);
    expect(
      updated.beats.some(
        (beat) => beat.zone.location?.cityOrRegion === "Westminster"
      )
    ).toBe(true);
    expect(
      updated.alternates.some(
        (memory) => memory.zone.location?.cityOrRegion === "Gunnison"
      )
    ).toBe(true);
    expect(updated.beats.map((beat) => beat.beat)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1)
    );
  });

  it("spends materially longer on the densest activity memories", () => {
    const sequence = buildGeographicMemorySequence(archiveRoutes());
    const baseZone = sequence.beats[0].zone;
    const sparse = focusDwellWindowForMemory({
      ...baseZone,
      routeCount: 3,
      totalRouteCount: 3,
      activeDays: 2,
    });
    const dense = focusDwellWindowForMemory({
      ...baseZone,
      routeCount: 48,
      totalRouteCount: 149,
      activeDays: 96,
    });
    expect(sparse.duration).toBeGreaterThanOrEqual(0.42);
    expect(dense.duration).toBeGreaterThanOrEqual(0.65);
    expect(dense.duration - sparse.duration).toBeGreaterThan(0.2);
  });

  it("starts on the hero, flies through continuous landings, and ends at January 2023", () => {
    const sequence = buildGeographicMemorySequence(archiveRoutes());
    const firstState = geographicFrameState(0, sequence);
    const firstCamera = cameraForGeographicFlight(firstState, sequence);
    expect(firstState.beatIndex).toBe(1);
    expect(firstState.beatProgress).toBe(0);
    expect(firstCamera).toMatchObject({
      longitude: CLIP_CONTRACT.sourceHero.longitude,
      latitude: CLIP_CONTRACT.sourceHero.latitude,
      zoom: CLIP_CONTRACT.sourceHero.zoom,
      pitch: 0,
      bearing: 0,
    });

    const markerOne = Math.round(CLIP_CONTRACT.transitionFrameCount / 32);
    const beforeMarker = cameraForGeographicFlight(
      geographicFrameState(markerOne - 1, sequence),
      sequence
    );
    const afterMarker = cameraForGeographicFlight(
      geographicFrameState(markerOne, sequence),
      sequence
    );
    const afterMarkerPlusOne = cameraForGeographicFlight(
      geographicFrameState(markerOne + 1, sequence),
      sequence
    );
    const crossingMotion = cameraDelta(beforeMarker, afterMarker);
    const continuingMotion = cameraDelta(afterMarker, afterMarkerPlusOne);
    expect(crossingMotion).toBeGreaterThan(1e-5);
    expect(continuingMotion).toBeGreaterThan(1e-5);
    expect(
      Math.abs(crossingMotion - continuingMotion) /
        Math.max(crossingMotion, continuingMotion)
    ).toBeLessThan(0.35);

    const finalState = geographicFrameState(
      CLIP_CONTRACT.frameCount - 1,
      sequence
    );
    const finalCamera = cameraForGeographicFlight(finalState, sequence);
    expect(finalState.stableHandoff).toBe(true);
    expect(finalState.calendarIso).toBe("2023-01-01");
    expect(finalCamera).toMatchObject({
      longitude: CLIP_CONTRACT.finalHandoff.camera.longitude,
      latitude: CLIP_CONTRACT.finalHandoff.camera.latitude,
      zoom: CLIP_CONTRACT.finalHandoff.camera.zoom,
      pitch: 0,
      bearing: 0,
    });
  });

  it("uses a flat departure and a sustained route-oriented pitched inspection", () => {
    const sequence = buildGeographicMemorySequence(archiveRoutes());
    const firstIntervalFrames = Math.round(
      CLIP_CONTRACT.transitionFrameCount / 32
    );
    const travelCamera = cameraForGeographicFlight(
      geographicFrameState(Math.round(firstIntervalFrames * 0.19), sequence),
      sequence
    );
    const inspectionCamera = cameraForGeographicFlight(
      geographicFrameState(Math.round(firstIntervalFrames * 0.64), sequence),
      sequence
    );
    const focusCamera = cameraForGeographicFlight(
      geographicFrameState(Math.round(firstIntervalFrames * 0.62), sequence),
      sequence
    );
    expect(travelCamera.pitch).toBeLessThanOrEqual(8);
    expect(inspectionCamera.pitch).toBeGreaterThanOrEqual(48);
    expect(
      Math.abs(
        focusCamera.pitch - landingPitchForMemory(sequence.beats[0].zone)
      )
    ).toBeLessThan(0.25);
    expect(Math.abs(sequence.beats[0].zone.bearing)).toBeGreaterThan(20);
    expect(Math.abs(sequence.beats[0].zone.bearing)).toBeLessThan(70);
    const cameras = Array.from(
      { length: CLIP_CONTRACT.frameCount },
      (_, frame) =>
        cameraForGeographicFlight(
          geographicFrameState(frame, sequence),
          sequence
        )
    );
    expect(
      Math.max(...cameras.map((camera) => Math.abs(camera.bearing)))
    ).toBeLessThanOrEqual(68);
    expect(
      Math.max(...cameras.map((camera) => camera.pitch))
    ).toBeLessThanOrEqual(58);
  });

  it("uses continuous route-opacity endpoints without a required orbit", () => {
    const sequence = buildGeographicMemorySequence(archiveRoutes());
    const departure = flightScheduleForFrame(
      geographicFrameState(10, sequence)
    );
    expect(departure.outgoingOpacity).toBeGreaterThanOrEqual(0);
    expect(departure.incomingOpacity).toBeGreaterThanOrEqual(0);
    expect(
      Array.from({ length: 120 }, (_, frame) =>
        geographicFrameState(frame, sequence)
      ).every((state) => state.orbitDegrees === 0)
    ).toBe(true);
  });
});

function cameraDelta(
  left: ReturnType<typeof cameraForGeographicFlight>,
  right: ReturnType<typeof cameraForGeographicFlight>
): number {
  return Math.hypot(
    right.longitude - left.longitude,
    right.latitude - left.latitude,
    right.zoom - left.zoom,
    (right.pitch - left.pitch) / 10,
    (right.bearing - left.bearing) / 10
  );
}
