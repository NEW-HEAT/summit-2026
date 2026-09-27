import {
  CLIP_CONTRACT,
  normalizeLongitude,
  type CameraPose,
  type FrameState,
} from "./clip-contract";
import type { ArchiveRoute, LonLat } from "./rewind-model";
import type { GeographicMemoryLocation } from "./geographic-memory-caption";

export type GeographicMemoryZone = {
  longitude: number;
  latitude: number;
  collectionRadiusKm: number;
  radiusKm: number;
  focusRadiusKm: number;
  bearing: number;
  location: GeographicMemoryLocation | null;
  routeCount: number;
  totalRouteCount: number;
  activeDays: number;
  coverage: number;
  zoom: number;
  routeIds: string[];
  allRouteIds: string[];
};

export type GeographicMemoryBeat = {
  beat: number;
  clusterId: string;
  selectionRank: number;
  representativeDate: string;
  representativeMs: number;
  sourceMs: number;
  targetMs: number;
  sourceDate: string;
  targetDate: string;
  dayCount: number;
  nearestSelectedKm: number;
  broadRegionId: string;
  zone: GeographicMemoryZone;
};

export type GeographicMemoryAlternate = Omit<GeographicMemoryBeat, "beat">;

export type GeographicMemorySequence = {
  kind: "geographic-memories-v1";
  selectorVersion: 1;
  startDate: "2023-01-01";
  endDate: "2026-09-06";
  boundaries: string[];
  beats: GeographicMemoryBeat[];
  alternates: GeographicMemoryAlternate[];
};

export type GeographicMemorySelectionOverride = {
  replace: { cityOrRegion: string; state: string | null };
  promote: { cityOrRegion: string; state: string | null };
};

export type FitnessArchiveBundle = {
  status: "ready";
  schemaVersion: 2;
  generatedAt: string;
  ownerFingerprint: string;
  range: { start: string; endExclusive: string };
  routeCount: number;
  timedRouteCount: number;
  inferredRouteCount: number;
  objectCount: number;
  routes: ArchiveRoute[];
  sequence: GeographicMemorySequence;
};

export type GeographicFrameState = FrameState & {
  finalTailProgress: number;
  inFinalTail: boolean;
};

export type FlightSchedule = {
  progress: number;
  phaseProgress: number;
  phase: "departure" | "travel" | "approach" | "landing" | "tail";
  pathProgress: number;
  outgoingOpacity: number;
  incomingOpacity: number;
  outgoingRewindProgress: number;
  incomingPlaybackProgress: number;
  diveWeight: number;
};

export type GeographicCamera = CameraPose & {
  unwrappedLongitude: number;
  diveWeight: number;
  rewindProgress: number;
};

type Candidate = {
  clusterId: string;
  representativeDate: string;
  representativeMs: number;
  visitStartMs: number;
  visitEndMs: number;
  center: LonLat;
  focusCenter: LonLat;
  collectionRadiusKm: number;
  radiusKm: number;
  focusRadiusKm: number;
  focusBearing: number;
  activeDays: number;
  allRouteIds: string[];
  emphasizedRouteIds: string[];
  broadRegionId: string;
  legibility: number;
  richness: number;
};

type RankedCandidate = Candidate & {
  selectionRank: number;
  nearestSelectedKm: number;
};

const DAY_MS = 86_400_000;
const START_MS = Date.parse("2023-01-01T00:00:00.000Z");
const END_MS = Date.parse("2026-09-06T00:00:00.000Z");
const VISIT_GAP_MS = 21 * DAY_MS;
const MIN_SELECTED_CENTER_KM = 120;
const MAX_PER_BROAD_REGION = 4;
const REQUIRED_SELECTIONS = 32;
const REQUIRED_ALTERNATES = 16;
const MAX_EMPHASIZED_ROUTES = 48;
const MIN_ROUTE_FILL_ZOOM_BONUS = 0.48;
const MAX_ROUTE_FILL_ZOOM_BONUS = 0.72;
const MAX_FOCUS_ZOOM = 13.65;
const FLIGHT_FRAME_COUNT = CLIP_CONTRACT.transitionFrameCount;
const HANDOFF_FRAME = CLIP_CONTRACT.handoffFrame;
const MINIMUM_PASSAGE_VELOCITY = 0.06;
const PASSAGE_START_OFFSET = 0.22;
const PASSAGE_BOUNDARY_VELOCITY = 0.85;
const FOCUS_PASSAGE_VELOCITY = 0.002;
const FOCUS_PHASE_HALF_SPAN = 0.0008;
const FOCUS_CENTER_PROGRESS = 0.6;
const MINIMUM_FOCUS_DURATION = 0.42;
const MAXIMUM_FOCUS_DURATION = 0.66;
const AVERAGE_BEAT_FRAME_COUNT = FLIGHT_FRAME_COUNT / REQUIRED_SELECTIONS;
const FINAL_TAIL_TRAVEL_FRAME_COUNT = Math.max(
  HANDOFF_FRAME - FLIGHT_FRAME_COUNT,
  1
);
const FINAL_TAIL_PASSAGE_VELOCITY =
  continuousPassageDerivative(PASSAGE_START_OFFSET) * PASSAGE_BOUNDARY_VELOCITY;
const FINAL_TAIL_START_VELOCITY =
  (FINAL_TAIL_PASSAGE_VELOCITY * FINAL_TAIL_TRAVEL_FRAME_COUNT) /
  ((1 - PASSAGE_START_OFFSET) * AVERAGE_BEAT_FRAME_COUNT);

export function buildGeographicMemorySequence(
  routes: readonly ArchiveRoute[]
): GeographicMemorySequence {
  const eligibleRoutes = routes.filter(
    (route) =>
      route.startMs >= START_MS &&
      route.startMs < END_MS &&
      route.paths.some((path) => path.positions.length >= 2)
  );
  const candidates = buildCandidates(eligibleRoutes);
  const placeCells: Candidate[] = [];
  for (const candidate of candidates.sort(compareCandidatePriority)) {
    if (
      placeCells.some(
        (accepted) => !geographicallyDistinct(candidate, accepted)
      )
    ) {
      continue;
    }
    placeCells.push(candidate);
  }

  const ranked = rankGeographicCells(
    placeCells,
    REQUIRED_SELECTIONS + REQUIRED_ALTERNATES
  );
  if (ranked.length < REQUIRED_SELECTIONS + REQUIRED_ALTERNATES) {
    throw new Error(
      `Geographic selector produced ${ranked.length} valid cells; 48 are required.`
    );
  }

  const selected = ranked.slice(0, REQUIRED_SELECTIONS);
  const ordered = [...selected].sort(
    (a, b) =>
      b.representativeMs - a.representativeMs ||
      a.clusterId.localeCompare(b.clusterId)
  );
  const dates = ordered.map((candidate) => candidate.representativeDate);
  if (new Set(dates).size !== REQUIRED_SELECTIONS) {
    throw new Error("Selected geographic memories must have unique dates.");
  }

  return {
    kind: "geographic-memories-v1",
    selectorVersion: 1,
    startDate: "2023-01-01",
    endDate: "2026-09-06",
    boundaries: dates,
    beats: ordered.map((candidate, index) => toBeat(candidate, index + 1)),
    alternates: ranked
      .slice(REQUIRED_SELECTIONS)
      .map((candidate) => toAlternate(candidate)),
  };
}

export function geographicFrameState(
  frameIndex: number,
  sequence: GeographicMemorySequence
): GeographicFrameState {
  assertFrameIndex(frameIndex);
  const inFinalTail = frameIndex >= FLIGHT_FRAME_COUNT;
  const stableHandoff = frameIndex >= HANDOFF_FRAME;
  let beatIndex = REQUIRED_SELECTIONS;
  let beatProgress = 1;
  if (!inFinalTail) {
    beatIndex = Math.min(
      REQUIRED_SELECTIONS,
      Math.floor((frameIndex * REQUIRED_SELECTIONS) / FLIGHT_FRAME_COUNT) + 1
    );
    const intervalStart = Math.round(
      ((beatIndex - 1) * FLIGHT_FRAME_COUNT) / REQUIRED_SELECTIONS
    );
    const intervalEnd = Math.round(
      (beatIndex * FLIGHT_FRAME_COUNT) / REQUIRED_SELECTIONS
    );
    beatProgress = clamp(
      (frameIndex - intervalStart) / Math.max(intervalEnd - intervalStart, 1),
      0,
      1
    );
  }
  const finalTailProgress = inFinalTail
    ? endpointEase(
        clamp(
          (frameIndex - FLIGHT_FRAME_COUNT) /
            Math.max(HANDOFF_FRAME - FLIGHT_FRAME_COUNT, 1),
          0,
          1
        ),
        FINAL_TAIL_START_VELOCITY,
        0
      )
    : 0;
  const beat = sequence.beats[beatIndex - 1];
  const calendarMs = stableHandoff ? START_MS : beat.representativeMs;
  const clipSeconds = frameIndex / CLIP_CONTRACT.fps;
  const camera = stableHandoff
    ? CLIP_CONTRACT.finalHandoff.camera
    : CLIP_CONTRACT.sourceHero;
  return {
    frameIndex,
    clipSeconds,
    globalSeconds: CLIP_CONTRACT.clipStartSeconds + clipSeconds,
    beatIndex,
    beatProgress,
    orbitProgress: 0,
    orbitDegrees: 0,
    calendarIso: isoDate(calendarMs),
    calendarMs,
    finalBeatClipped: true,
    stableHandoff,
    unwrappedLongitude: camera.longitude,
    viewState: camera,
    finalTailProgress,
    inFinalTail,
  };
}

export function flightScheduleForFrame(
  state: GeographicFrameState
): FlightSchedule {
  if (state.inFinalTail) {
    return {
      progress: state.finalTailProgress,
      phaseProgress: state.finalTailProgress,
      phase: "tail",
      pathProgress:
        PASSAGE_START_OFFSET +
        state.finalTailProgress * (1 - PASSAGE_START_OFFSET),
      outgoingOpacity: 1 - state.finalTailProgress,
      incomingOpacity: 0,
      outgoingRewindProgress: state.finalTailProgress,
      incomingPlaybackProgress: 1,
      diveWeight: 1 - state.finalTailProgress,
    };
  }
  const progress = clamp(state.beatProgress, 0, 1);
  const departureEnd = 0.12;
  const travelEnd = 0.34;
  const approachEnd = 0.5;
  const pathProgress = continuousPassageProgress(progress);
  const incomingPlaybackProgress = smootherstep(
    clamp((progress - 0.32) / 0.62, 0, 1)
  );
  if (progress < departureEnd) {
    const local = smootherstep(progress / departureEnd);
    return {
      progress,
      phaseProgress: local,
      phase: "departure",
      pathProgress,
      outgoingOpacity: mix(1, 0.18, local),
      incomingOpacity: mix(0, 0.06, local),
      outgoingRewindProgress: smootherstep(clamp(progress / 0.11, 0, 1)),
      incomingPlaybackProgress,
      diveWeight: mix(1, 0.08, local),
    };
  }
  if (progress < travelEnd) {
    const local = smootherstep(
      (progress - departureEnd) / (travelEnd - departureEnd)
    );
    return {
      progress,
      phaseProgress: local,
      phase: "travel",
      pathProgress,
      outgoingOpacity: mix(0.18, 0.03, local),
      incomingOpacity: mix(0.06, 0.22, local),
      outgoingRewindProgress: 1,
      incomingPlaybackProgress,
      diveWeight: mix(0.08, 0.42, local),
    };
  }
  if (progress < approachEnd) {
    const local = smootherstep(
      (progress - travelEnd) / (approachEnd - travelEnd)
    );
    return {
      progress,
      phaseProgress: local,
      phase: "approach",
      pathProgress,
      outgoingOpacity: mix(0.03, 0, local),
      incomingOpacity: mix(0.22, 0.82, local),
      outgoingRewindProgress: 1,
      incomingPlaybackProgress,
      diveWeight: mix(0.42, 0.9, local),
    };
  }
  const local = smootherstep((progress - approachEnd) / (1 - approachEnd));
  return {
    progress,
    phaseProgress: local,
    phase: "landing",
    pathProgress,
    outgoingOpacity: 0,
    incomingOpacity: mix(0.82, 1, local),
    outgoingRewindProgress: 1,
    incomingPlaybackProgress,
    diveWeight: mix(0.9, 1, local),
  };
}

export function cameraForGeographicFlight(
  state: GeographicFrameState,
  sequence: GeographicMemorySequence
): GeographicCamera {
  if (state.stableHandoff) {
    return {
      ...CLIP_CONTRACT.finalHandoff.camera,
      unwrappedLongitude: CLIP_CONTRACT.finalHandoff.camera.longitude,
      diveWeight: 0,
      rewindProgress: 1,
    };
  }
  const schedule = flightScheduleForFrame(state);
  const passage = cameraPassageForState(state, sequence);
  const camera = cinematicCameraForSegment(
    sequence,
    passage.segmentIndex,
    passage.pathProgress
  );
  return {
    ...camera,
    diveWeight: schedule.diveWeight,
    rewindProgress: state.inFinalTail
      ? state.finalTailProgress
      : schedule.outgoingRewindProgress,
  };
}

function cameraPassageForState(
  state: GeographicFrameState,
  sequence: GeographicMemorySequence
): { segmentIndex: number; pathProgress: number } {
  if (state.inFinalTail) {
    return {
      segmentIndex: sequence.beats.length,
      pathProgress:
        PASSAGE_START_OFFSET +
        state.finalTailProgress * (1 - PASSAGE_START_OFFSET),
    };
  }
  const beat = sequence.beats[state.beatIndex - 1];
  const phase =
    state.beatIndex -
    1 +
    focusPassagePhase(state.beatProgress, beat.zone, state.beatIndex === 1);
  const segmentIndex = Math.min(sequence.beats.length, Math.floor(phase));
  return {
    segmentIndex,
    pathProgress: continuousPassageProgress(phase - segmentIndex),
  };
}

export function focusDwellWindowForMemory(zone: GeographicMemoryZone): {
  start: number;
  end: number;
  duration: number;
  importance: number;
} {
  const emphasizedRouteWeight = normalize(Math.log2(zone.routeCount + 1), [
    Math.log2(4),
    Math.log2(MAX_EMPHASIZED_ROUTES + 1),
  ]);
  const activeDayWeight = normalize(Math.log2(zone.activeDays + 1), [
    Math.log2(3),
    Math.log2(15),
  ]);
  const archiveWeight = normalize(Math.log2(zone.totalRouteCount + 1), [
    Math.log2(4),
    Math.log2(150),
  ]);
  const importance = clamp(
    emphasizedRouteWeight * 0.45 + activeDayWeight * 0.35 + archiveWeight * 0.2,
    0,
    1
  );
  const duration = mix(
    MINIMUM_FOCUS_DURATION,
    MAXIMUM_FOCUS_DURATION,
    smootherstep(importance)
  );
  return {
    start: FOCUS_CENTER_PROGRESS - duration / 2,
    end: FOCUS_CENTER_PROGRESS + duration / 2,
    duration,
    importance,
  };
}

function focusPassagePhase(
  progress: number,
  zone: GeographicMemoryZone,
  firstBeat: boolean
): number {
  const value = clamp(progress, 0, 1);
  const focus = focusDwellWindowForMemory(zone);
  const passageStart = firstBeat ? 0 : PASSAGE_START_OFFSET;
  const focusPhaseStart = 1 - FOCUS_PHASE_HALF_SPAN;
  const focusPhaseEnd = 1 + FOCUS_PHASE_HALF_SPAN;
  if (value <= focus.start) {
    return quinticRange(
      value,
      0,
      focus.start,
      passageStart,
      focusPhaseStart,
      firstBeat ? 0 : PASSAGE_BOUNDARY_VELOCITY,
      FOCUS_PASSAGE_VELOCITY
    );
  }
  if (value <= focus.end) {
    return quinticRange(
      value,
      focus.start,
      focus.end,
      focusPhaseStart,
      focusPhaseEnd,
      FOCUS_PASSAGE_VELOCITY,
      FOCUS_PASSAGE_VELOCITY
    );
  }
  return quinticRange(
    value,
    focus.end,
    1,
    focusPhaseEnd,
    1 + PASSAGE_START_OFFSET,
    FOCUS_PASSAGE_VELOCITY,
    PASSAGE_BOUNDARY_VELOCITY
  );
}

function quinticRange(
  value: number,
  inputStart: number,
  inputEnd: number,
  outputStart: number,
  outputEnd: number,
  startVelocity: number,
  endVelocity: number
): number {
  const inputSpan = inputEnd - inputStart;
  const outputSpan = outputEnd - outputStart;
  if (inputSpan <= 0 || outputSpan <= 0) return outputEnd;
  const local = clamp((value - inputStart) / inputSpan, 0, 1);
  return mix(
    outputStart,
    outputEnd,
    quinticEndpointEase(
      local,
      (startVelocity * inputSpan) / outputSpan,
      (endVelocity * inputSpan) / outputSpan
    )
  );
}

function cinematicCameraForSegment(
  sequence: GeographicMemorySequence,
  segmentIndex: number,
  pathProgress: number
): Omit<GeographicCamera, "diveWeight" | "rewindProgress"> {
  const origin = cameraWaypoint(sequence, segmentIndex);
  const target = cameraWaypoint(sequence, segmentIndex + 1);
  const point = sphericalCatmullRom(
    cameraWaypoint(sequence, segmentIndex - 1),
    origin,
    target,
    cameraWaypoint(sequence, segmentIndex + 2),
    pathProgress
  );
  const zoom = cinematicCameraAxis(
    sequence,
    segmentIndex,
    pathProgress,
    "zoom"
  );
  const pitch = cinematicCameraAxis(
    sequence,
    segmentIndex,
    pathProgress,
    "pitch"
  );
  const bearing = cinematicCameraAxis(
    sequence,
    segmentIndex,
    pathProgress,
    "bearing"
  );
  return {
    longitude: point[0],
    latitude: point[1],
    zoom: clamp(zoom, CLIP_CONTRACT.sourceHero.zoom, MAX_FOCUS_ZOOM),
    pitch: clamp(pitch, 0, 58),
    bearing: clamp(bearing, -68, 68),
    unwrappedLongitude: unwrapLongitude(point[0], origin[0]),
  };
}

type CinematicCameraAxis = "zoom" | "pitch" | "bearing";

function cinematicCameraAxis(
  sequence: GeographicMemorySequence,
  segmentIndex: number,
  progress: number,
  axis: CinematicCameraAxis
): number {
  const firstKey = segmentIndex * 2 + (progress < 0.5 ? 0 : 1);
  const local = progress < 0.5 ? progress * 2 : (progress - 0.5) * 2;
  return catmullRomScalar(
    cinematicCameraKey(sequence, firstKey - 1, axis),
    cinematicCameraKey(sequence, firstKey, axis),
    cinematicCameraKey(sequence, firstKey + 1, axis),
    cinematicCameraKey(sequence, firstKey + 2, axis),
    local,
    0.42
  );
}

function cinematicCameraKey(
  sequence: GeographicMemorySequence,
  requestedKey: number,
  axis: CinematicCameraAxis
): number {
  const maximumKey = (sequence.beats.length + 1) * 2;
  const key = clamp(requestedKey, 0, maximumKey);
  if (key % 2 === 0) {
    const waypointIndex = key / 2;
    if (waypointIndex === 0) {
      return CLIP_CONTRACT.sourceHero[axis];
    }
    if (waypointIndex > sequence.beats.length) {
      return CLIP_CONTRACT.finalHandoff.camera[axis];
    }
    const zone = sequence.beats[waypointIndex - 1].zone;
    if (axis === "zoom") return focusZoomForMemory(zone);
    if (axis === "pitch") return landingPitchForMemory(zone);
    return landingBearingForBeat(sequence, waypointIndex - 1);
  }
  const segmentIndex = Math.floor(key / 2);
  const origin = cameraWaypoint(sequence, segmentIndex);
  const target = cameraWaypoint(sequence, segmentIndex + 1);
  const distanceKm = haversineKm(origin, target);
  if (axis === "zoom") {
    return flightApexZoom(
      distanceKm,
      cinematicCameraKey(sequence, key - 1, "zoom"),
      cinematicCameraKey(sequence, key + 1, "zoom")
    );
  }
  if (axis === "pitch") return travelPitchForDistance(distanceKm);
  return clamp(
    flightHeading(
      origin,
      target,
      0.5,
      cameraSegmentSeed(sequence, segmentIndex)
    ),
    -60,
    60
  );
}

function cameraWaypoint(
  sequence: GeographicMemorySequence,
  waypointIndex: number
): LonLat {
  if (waypointIndex <= 0) {
    return [
      CLIP_CONTRACT.sourceHero.longitude,
      CLIP_CONTRACT.sourceHero.latitude,
    ];
  }
  if (waypointIndex > sequence.beats.length) {
    return [
      CLIP_CONTRACT.finalHandoff.camera.longitude,
      CLIP_CONTRACT.finalHandoff.camera.latitude,
    ];
  }
  const zone = sequence.beats[waypointIndex - 1].zone;
  return [zone.longitude, zone.latitude];
}

function cameraSegmentSeed(
  sequence: GeographicMemorySequence,
  segmentIndex: number
): string {
  return sequence.beats[segmentIndex]?.clusterId ?? "orlando-handoff";
}

export function focusZoomForMemory(zone: GeographicMemoryZone): number {
  const density = clamp(
    (zone.routeCount - 4) / (MAX_EMPHASIZED_ROUTES - 4),
    0,
    1
  );
  const routeFillZoomBonus = mix(
    MAX_ROUTE_FILL_ZOOM_BONUS,
    MIN_ROUTE_FILL_ZOOM_BONUS,
    smootherstep(density)
  );
  return clamp(
    zone.zoom + routeFillZoomBonus,
    CLIP_CONTRACT.sourceHero.zoom + 1.2,
    MAX_FOCUS_ZOOM
  );
}

export function applyGeographicMemorySelectionOverride(
  sequence: GeographicMemorySequence,
  override: GeographicMemorySelectionOverride
): GeographicMemorySequence {
  const replacedIndex = sequence.beats.findIndex((beat) =>
    memoryLocationMatches(beat.zone.location, override.replace)
  );
  const promotedIndex = sequence.alternates.findIndex((alternate) =>
    memoryLocationMatches(alternate.zone.location, override.promote)
  );
  if (replacedIndex < 0 || promotedIndex < 0) return sequence;

  const replaced = sequence.beats[replacedIndex];
  const promoted = sequence.alternates[promotedIndex];
  const beats = sequence.beats
    .map((beat, index) =>
      index === replacedIndex ? { ...promoted, beat: beat.beat } : beat
    )
    .sort((a, b) => b.representativeMs - a.representativeMs)
    .map((beat, index) => ({ ...beat, beat: index + 1 }));
  const replacedAlternate: GeographicMemoryAlternate = { ...replaced };
  Reflect.deleteProperty(replacedAlternate, "beat");
  const alternates = sequence.alternates.map((alternate, index) =>
    index === promotedIndex ? replacedAlternate : alternate
  );
  return { ...sequence, beats, alternates };
}

export function landingPitchForMemory(zone: GeographicMemoryZone): number {
  return clamp(
    58 - Math.log2(Math.max(zone.focusRadiusKm, 2) / 2) * 1.1,
    52,
    58
  );
}

export function rewindCutoffMs(
  beat: GeographicMemoryBeat,
  progress: number
): number {
  return Math.round(mix(beat.sourceMs, beat.targetMs, smootherstep(progress)));
}

function buildCandidates(routes: readonly ArchiveRoute[]): Candidate[] {
  const deduplicated = new Map<string, Candidate>();
  for (const seed of routes) {
    const distances = routes
      .map((route) => haversineKm(seed.center, route.center))
      .sort((a, b) => a - b);
    const eighthNearestKm = distances[Math.min(8, distances.length - 1)] ?? 20;
    const collectionRadiusKm = clamp(eighthNearestKm * 1.5, 20, 70);
    const nearby = routes
      .filter(
        (route) =>
          haversineKm(seed.center, route.center) <= collectionRadiusKm + 1e-6
      )
      .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
    const visits: ArchiveRoute[][] = [];
    for (const route of nearby) {
      const visit = visits.at(-1);
      if (!visit || route.startMs - visit.at(-1)!.startMs > VISIT_GAP_MS) {
        visits.push([route]);
      } else {
        visit.push(route);
      }
    }
    for (const visit of visits) {
      const activeDays = new Set(visit.map((route) => utcDay(route.startMs)));
      if (activeDays.size < 2 && visit.length < 3) continue;
      const routeIds = visit.map((route) => route.id).sort();
      const fingerprint = routeIds.join(":");
      if (deduplicated.has(fingerprint)) continue;
      const activeDayValues = [...activeDays].sort((a, b) => a - b);
      const representativeDay =
        activeDayValues[Math.floor(activeDayValues.length / 2)];
      const representativeMs = representativeDay * DAY_MS;
      const center = footprintCenter(visit);
      const radiusKm = Math.max(
        2,
        ...visit.map((route) => routeFootprintKm(route, center))
      );
      const emphasizedRoutes = [...visit]
        .sort(
          (a, b) =>
            Math.abs(a.startMs - representativeMs) -
              Math.abs(b.startMs - representativeMs) || a.id.localeCompare(b.id)
        )
        .slice(0, MAX_EMPHASIZED_ROUTES);
      const emphasizedRouteIds = emphasizedRoutes.map((route) => route.id);
      const focusCenter = footprintCenter(emphasizedRoutes);
      const focusRadiusKm = Math.max(
        2,
        ...emphasizedRoutes.map((route) => routeFootprintKm(route, focusCenter))
      );
      const focusBearing = routeAxisBearing(emphasizedRoutes, focusCenter);
      deduplicated.set(fingerprint, {
        clusterId: stableHash(fingerprint),
        representativeDate: isoDate(representativeMs),
        representativeMs,
        visitStartMs: Math.min(...visit.map((route) => route.startMs)),
        visitEndMs: Math.max(...visit.map((route) => route.endMs)),
        center,
        focusCenter,
        collectionRadiusKm,
        radiusKm,
        focusRadiusKm,
        focusBearing,
        activeDays: activeDays.size,
        allRouteIds: routeIds,
        emphasizedRouteIds,
        broadRegionId: broadRegionId(center),
        legibility: 1 / Math.log2(radiusKm + 2),
        richness: Math.log2(activeDays.size * 2 + visit.length + 1),
      });
    }
  }
  return [...deduplicated.values()];
}

function rankGeographicCells(
  candidates: readonly Candidate[],
  count: number
): RankedCandidate[] {
  const remaining = [...candidates];
  const selected: RankedCandidate[] = [];
  const selectedDates = new Set<string>();
  const regionCounts = new Map<string, number>();
  while (selected.length < count) {
    const valid = remaining.filter(
      (candidate) =>
        !selectedDates.has(candidate.representativeDate) &&
        (regionCounts.get(candidate.broadRegionId) ?? 0) < MAX_PER_BROAD_REGION
    );
    if (valid.length === 0) break;
    let distanceMaximum = Infinity;
    const withDistance = valid.map((candidate) => {
      const nearestSelectedKm =
        selected.length === 0
          ? 20_015
          : Math.min(
              ...selected.map((accepted) =>
                haversineKm(candidate.center, accepted.center)
              )
            );
      return { candidate, nearestSelectedKm };
    });
    if (selected.length > 0) {
      distanceMaximum = Math.max(
        ...withDistance.map((entry) => entry.nearestSelectedKm)
      );
    }
    const geographicBand = withDistance.filter(
      (entry) =>
        selected.length === 0 ||
        entry.nearestSelectedKm >= distanceMaximum * 0.95
    );
    const yearCounts = new Map<number, number>();
    for (const accepted of selected) {
      const year = new Date(accepted.representativeMs).getUTCFullYear();
      yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
    }
    const legibilityRange = range(
      geographicBand.map((entry) => entry.candidate.legibility)
    );
    const richnessRange = range(
      geographicBand.map((entry) => entry.candidate.richness)
    );
    geographicBand.sort((a, b) => {
      const scoreA = secondaryScore(
        a.candidate,
        yearCounts,
        legibilityRange,
        richnessRange
      );
      const scoreB = secondaryScore(
        b.candidate,
        yearCounts,
        legibilityRange,
        richnessRange
      );
      return (
        scoreB - scoreA ||
        b.candidate.representativeMs - a.candidate.representativeMs ||
        a.candidate.clusterId.localeCompare(b.candidate.clusterId)
      );
    });
    const chosen = geographicBand[0];
    const ranked: RankedCandidate = {
      ...chosen.candidate,
      selectionRank: selected.length + 1,
      nearestSelectedKm: chosen.nearestSelectedKm,
    };
    selected.push(ranked);
    selectedDates.add(ranked.representativeDate);
    regionCounts.set(
      ranked.broadRegionId,
      (regionCounts.get(ranked.broadRegionId) ?? 0) + 1
    );
    remaining.splice(remaining.indexOf(chosen.candidate), 1);
  }
  return selected;
}

function secondaryScore(
  candidate: Candidate,
  yearCounts: ReadonlyMap<number, number>,
  legibilityRange: [number, number],
  richnessRange: [number, number]
): number {
  const year = new Date(candidate.representativeMs).getUTCFullYear();
  const temporalCoverage = 1 / (1 + (yearCounts.get(year) ?? 0));
  return (
    normalize(candidate.legibility, legibilityRange) * 0.5 +
    normalize(candidate.richness, richnessRange) * 0.35 +
    temporalCoverage * 0.15
  );
}

function toBeat(
  candidate: RankedCandidate,
  beat: number
): GeographicMemoryBeat {
  return {
    beat,
    ...toAlternate(candidate),
  };
}

function toAlternate(candidate: RankedCandidate): GeographicMemoryAlternate {
  return {
    clusterId: candidate.clusterId,
    selectionRank: candidate.selectionRank,
    representativeDate: candidate.representativeDate,
    representativeMs: candidate.representativeMs,
    sourceMs: candidate.visitEndMs,
    targetMs: candidate.visitStartMs,
    sourceDate: isoDate(candidate.visitEndMs),
    targetDate: isoDate(candidate.visitStartMs),
    dayCount: Math.max(
      1,
      Math.ceil((candidate.visitEndMs - candidate.visitStartMs) / DAY_MS)
    ),
    nearestSelectedKm: candidate.nearestSelectedKm,
    broadRegionId: candidate.broadRegionId,
    zone: {
      longitude: candidate.focusCenter[0],
      latitude: candidate.focusCenter[1],
      collectionRadiusKm: candidate.collectionRadiusKm,
      radiusKm: candidate.radiusKm,
      focusRadiusKm: candidate.focusRadiusKm,
      bearing: candidate.focusBearing,
      location: null,
      routeCount: candidate.emphasizedRouteIds.length,
      totalRouteCount: candidate.allRouteIds.length,
      activeDays: candidate.activeDays,
      coverage:
        candidate.emphasizedRouteIds.length / candidate.allRouteIds.length,
      zoom: zoomForRadius(candidate.focusRadiusKm, candidate.focusCenter[1]),
      routeIds: candidate.emphasizedRouteIds,
      allRouteIds: candidate.allRouteIds,
    },
  };
}

function geographicallyDistinct(a: Candidate, b: Candidate): boolean {
  const centerDistance = haversineKm(a.center, b.center);
  return (
    centerDistance >= MIN_SELECTED_CENTER_KM &&
    centerDistance >= 0.65 * (a.radiusKm + b.radiusKm)
  );
}

function compareCandidatePriority(a: Candidate, b: Candidate): number {
  return (
    b.activeDays - a.activeDays ||
    b.allRouteIds.length - a.allRouteIds.length ||
    b.representativeMs - a.representativeMs ||
    a.clusterId.localeCompare(b.clusterId)
  );
}

function footprintCenter(routes: readonly ArchiveRoute[]): LonLat {
  const reference = circularLongitudeMean(routes.map((route) => route.center));
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const route of routes) {
    west = Math.min(west, unwrapLongitude(route.bbox[0], reference));
    east = Math.max(east, unwrapLongitude(route.bbox[2], reference));
    south = Math.min(south, route.bbox[1]);
    north = Math.max(north, route.bbox[3]);
  }
  return [normalizeLongitude((west + east) / 2), (south + north) / 2];
}

function routeFootprintKm(route: ArchiveRoute, center: LonLat): number {
  return Math.max(
    haversineKm(center, [route.bbox[0], route.bbox[1]]),
    haversineKm(center, [route.bbox[0], route.bbox[3]]),
    haversineKm(center, [route.bbox[2], route.bbox[1]]),
    haversineKm(center, [route.bbox[2], route.bbox[3]])
  );
}

function zoomForRadius(radiusKm: number, latitude: number): number {
  const latitudeScale = Math.max(
    0.25,
    Math.cos((Math.abs(latitude) * Math.PI) / 180)
  );
  const targetDiameterPixels = CLIP_CONTRACT.height * 0.82;
  return clamp(
    Math.log2(
      (40_075 * latitudeScale * targetDiameterPixels) /
        (512 * Math.max(radiusKm * 2, 8))
    ),
    CLIP_CONTRACT.sourceHero.zoom + 0.9,
    13.07
  );
}

function flightApexZoom(
  distanceKm: number,
  fromZoom: number,
  toZoom: number
): number {
  const closeZoom = Math.min(fromZoom, toZoom);
  if (distanceKm < 150)
    return Math.max(CLIP_CONTRACT.sourceHero.zoom + 2.1, closeZoom - 0.65);
  if (distanceKm < 1_200)
    return Math.max(CLIP_CONTRACT.sourceHero.zoom + 1.25, closeZoom - 1.8);
  if (distanceKm < 4_000) return CLIP_CONTRACT.sourceHero.zoom + 0.62;
  return CLIP_CONTRACT.sourceHero.zoom + 0.12;
}

function sphericalCatmullRom(
  previous: LonLat,
  origin: LonLat,
  target: LonLat,
  next: LonLat,
  amount: number
): LonLat {
  if (amount <= 0) return [...origin];
  if (amount >= 1) return [...target];
  const a = lonLatToVector(previous);
  const b = lonLatToVector(origin);
  const c = lonLatToVector(target);
  const d = lonLatToVector(next);
  const vector: [number, number, number] = [
    catmullRomScalar(a[0], b[0], c[0], d[0], amount, 0.48),
    catmullRomScalar(a[1], b[1], c[1], d[1], amount, 0.48),
    catmullRomScalar(a[2], b[2], c[2], d[2], amount, 0.48),
  ];
  const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
  if (magnitude < 1e-8) {
    return sphericalInterpolate(origin, target, amount, "catmull-fallback");
  }
  return vectorToLonLat([
    vector[0] / magnitude,
    vector[1] / magnitude,
    vector[2] / magnitude,
  ]);
}

function catmullRomScalar(
  previous: number,
  origin: number,
  target: number,
  next: number,
  amount: number,
  tension: number
): number {
  const t = clamp(amount, 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  const tangentScale = (1 - tension) / 2;
  const originTangent = (target - previous) * tangentScale;
  const targetTangent = (next - origin) * tangentScale;
  return (
    (2 * t3 - 3 * t2 + 1) * origin +
    (t3 - 2 * t2 + t) * originTangent +
    (-2 * t3 + 3 * t2) * target +
    (t3 - t2) * targetTangent
  );
}

function sphericalInterpolate(
  from: LonLat,
  to: LonLat,
  amount: number,
  seed: string
): LonLat {
  if (amount <= 0) return [...from];
  if (amount >= 1) return [...to];
  const a = lonLatToVector(from);
  const b = lonLatToVector(to);
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  if (dot < -0.995) {
    const north = Number.parseInt(seed.slice(-1), 16) % 2 === 0;
    const midpoint: LonLat = [
      normalizeLongitude((from[0] + to[0]) / 2 + 90),
      north ? 62 : -62,
    ];
    return amount < 0.5
      ? sphericalInterpolate(from, midpoint, amount * 2, `${seed}a`)
      : sphericalInterpolate(midpoint, to, (amount - 0.5) * 2, `${seed}b`);
  }
  if (dot > 0.9995) {
    return [
      normalizeLongitude(
        from[0] + shortestLongitudeDelta(from[0], to[0]) * amount
      ),
      mix(from[1], to[1], amount),
    ];
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const fromWeight = Math.sin((1 - amount) * theta) / sinTheta;
  const toWeight = Math.sin(amount * theta) / sinTheta;
  return vectorToLonLat([
    a[0] * fromWeight + b[0] * toWeight,
    a[1] * fromWeight + b[1] * toWeight,
    a[2] * fromWeight + b[2] * toWeight,
  ]);
}

function lonLatToVector(point: LonLat): [number, number, number] {
  const longitude = (point[0] * Math.PI) / 180;
  const latitude = (point[1] * Math.PI) / 180;
  const cosLatitude = Math.cos(latitude);
  return [
    cosLatitude * Math.cos(longitude),
    cosLatitude * Math.sin(longitude),
    Math.sin(latitude),
  ];
}

function vectorToLonLat(vector: [number, number, number]): LonLat {
  return [
    normalizeLongitude((Math.atan2(vector[1], vector[0]) * 180) / Math.PI),
    (Math.atan2(vector[2], Math.hypot(vector[0], vector[1])) * 180) / Math.PI,
  ];
}

function landingBearingForBeat(
  sequence: GeographicMemorySequence,
  beatIndex: number
): number {
  const beat = sequence.beats[beatIndex];
  return clamp(beat.zone.bearing, -44, 44);
}

function travelPitchForDistance(distanceKm: number): number {
  if (distanceKm >= 4_000) return 2;
  if (distanceKm >= 1_200) return 4;
  if (distanceKm >= 300) return 6;
  return 8;
}

function flightHeading(
  from: LonLat,
  to: LonLat,
  amount: number,
  seed: string
): number {
  const delta = 0.008;
  const start = sphericalInterpolate(
    from,
    to,
    clamp(amount - delta, 0, 1),
    seed
  );
  const end = sphericalInterpolate(from, to, clamp(amount + delta, 0, 1), seed);
  return initialBearing(start, end);
}

function initialBearing(from: LonLat, to: LonLat): number {
  const radians = Math.PI / 180;
  const fromLat = from[1] * radians;
  const toLat = to[1] * radians;
  const deltaLongitude = shortestLongitudeDelta(from[0], to[0]) * radians;
  const y = Math.sin(deltaLongitude) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLongitude);
  return normalizeBearing((Math.atan2(y, x) * 180) / Math.PI);
}

function routeAxisBearing(
  routes: readonly ArchiveRoute[],
  center: LonLat
): number {
  const samples: LonLat[] = [];
  for (const route of routes) {
    for (const path of route.paths) {
      const stride = Math.max(1, Math.ceil(path.positions.length / 16));
      for (let index = 0; index < path.positions.length; index += stride) {
        samples.push(path.positions[index]);
      }
      const final = path.positions.at(-1);
      if (final) samples.push(final);
    }
  }
  if (samples.length < 2) return 0;
  const longitudeScale = Math.max(0.2, Math.cos((center[1] * Math.PI) / 180));
  const points = samples.map(
    (point) =>
      [
        shortestLongitudeDelta(center[0], point[0]) * longitudeScale,
        point[1] - center[1],
      ] as const
  );
  const meanX =
    points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const meanY =
    points.reduce((sum, point) => sum + point[1], 0) / points.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const x = point[0] - meanX;
    const y = point[1] - meanY;
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  const spread = xx + yy;
  const anisotropy = spread > 0 ? Math.hypot(xx - yy, 2 * xy) / spread : 0;
  if (anisotropy < 0.08) return 0;
  const angleFromEast = 0.5 * Math.atan2(2 * xy, xx - yy);
  return normalizeAxisBearing(90 - (angleFromEast * 180) / Math.PI);
}

function normalizeAxisBearing(value: number): number {
  const normalized = normalizeBearing(value);
  return normalized >= 90
    ? normalized - 180
    : normalized < -90
      ? normalized + 180
      : normalized;
}

function normalizeBearing(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function memoryLocationMatches(
  location: GeographicMemoryLocation | null,
  expected: { cityOrRegion: string; state: string | null }
): boolean {
  return (
    location?.cityOrRegion === expected.cityOrRegion &&
    location.state === expected.state
  );
}

function broadRegionId(center: LonLat): string {
  const longitudeCell = Math.floor((normalizeLongitude(center[0]) + 180) / 12);
  const latitudeCell = Math.floor((clamp(center[1], -89.999, 89.999) + 90) / 8);
  return `v1-${longitudeCell}-${latitudeCell}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `gm-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function circularLongitudeMean(points: readonly LonLat[]): number {
  let x = 0;
  let y = 0;
  for (const point of points) {
    const radians = (point[0] * Math.PI) / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
  }
  return normalizeLongitude((Math.atan2(y, x) * 180) / Math.PI);
}

function haversineKm(a: LonLat, b: LonLat): number {
  const toRadians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRadians;
  const dLon = shortestLongitudeDelta(a[0], b[0]) * toRadians;
  const latA = a[1] * toRadians;
  const latB = b[1] * toRadians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function shortestLongitudeDelta(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

function unwrapLongitude(longitude: number, reference: number): number {
  return reference + shortestLongitudeDelta(reference, longitude);
}

function utcDay(value: number): number {
  return Math.floor(value / DAY_MS);
}

function range(values: readonly number[]): [number, number] {
  return [Math.min(...values), Math.max(...values)];
}

function normalize(
  value: number,
  [minimum, maximum]: [number, number]
): number {
  return maximum === minimum ? 1 : (value - minimum) / (maximum - minimum);
}

function isoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function smootherstep(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function continuousPassageProgress(amount: number): number {
  const value = clamp(amount, 0, 1);
  return mix(smootherstep(value), value, MINIMUM_PASSAGE_VELOCITY);
}

function continuousPassageDerivative(amount: number): number {
  const value = clamp(amount, 0, 1);
  return (
    MINIMUM_PASSAGE_VELOCITY +
    (1 - MINIMUM_PASSAGE_VELOCITY) * 30 * value ** 2 * (1 - value) ** 2
  );
}

function quinticEndpointEase(
  amount: number,
  startVelocity: number,
  endVelocity: number
): number {
  const value = clamp(amount, 0, 1);
  const value2 = value * value;
  const value3 = value2 * value;
  const value4 = value3 * value;
  const value5 = value4 * value;
  const endPositionBasis = 10 * value3 - 15 * value4 + 6 * value5;
  const startVelocityBasis = value - 6 * value3 + 8 * value4 - 3 * value5;
  const endVelocityBasis = -4 * value3 + 7 * value4 - 3 * value5;
  return (
    endPositionBasis +
    startVelocity * startVelocityBasis +
    endVelocity * endVelocityBasis
  );
}

function endpointEase(
  amount: number,
  startVelocity: number,
  endVelocity: number
): number {
  const value = clamp(amount, 0, 1);
  const value2 = value * value;
  const value3 = value2 * value;
  return (
    (2 * value3 - 3 * value2 + 1) * 0 +
    (value3 - 2 * value2 + value) * startVelocity +
    (-2 * value3 + 3 * value2) * 1 +
    (value3 - value2) * endVelocity
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function assertFrameIndex(frameIndex: number): void {
  if (!Number.isFinite(frameIndex) || !Number.isInteger(frameIndex)) {
    throw new TypeError("Frame index must be a finite integer.");
  }
  if (frameIndex < 0 || frameIndex >= CLIP_CONTRACT.frameCount) {
    throw new RangeError(
      `Frame index must be from 0 to ${CLIP_CONTRACT.frameCount - 1}.`
    );
  }
}
