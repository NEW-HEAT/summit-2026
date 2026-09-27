import {
  SECTION_COUNT,
  type OrganizationKey,
} from "./calendar-model";
import type {
  CommitLocationHeatPoint,
  ContributionLocationZone,
} from "./location-heat-model";

export const CONTRIBUTION_FOCUS_SECTION_COUNT = SECTION_COUNT;
export const CONTRIBUTION_FOCUS_TRANSITION_FRACTION = 0.12;
export const CONTRIBUTION_FOCUS_LABEL_RADIUS_KM = 180;

export type ContributionFocusBeat = {
  sectionIndex: number;
  startDayOrdinal: number;
  endDayOrdinal: number;
  startDate: string;
  endDate: string;
  longitude: number;
  latitude: number;
  volume: number;
  cellId: string;
  organizationKey: OrganizationKey;
  organizationColor: [number, number, number];
  organizationIndex: number;
  source: "section-dominant-contribution-cell" | "carry-forward";
  locationPrimary: string;
  locationSecondary: string;
  locationEvidence: "nearest-curated-memory-zone" | "unlabeled-contribution-area";
};

export type ContributionFocusFrame = {
  sectionIndex: number;
  sectionProgress: number;
  longitude: number;
  latitude: number;
  pulse: number;
  beat: ContributionFocusBeat;
  previousBeat: ContributionFocusBeat;
};

type AggregateCell = {
  cellId: string;
  longitude: number;
  latitude: number;
  volume: number;
  routeCount: number;
  organizationKey: OrganizationKey;
  organizationColor: [number, number, number];
  organizationIndex: number;
};

type MutableAggregateCell = Omit<AggregateCell,
  "organizationKey" | "organizationColor" | "organizationIndex"> & {
  organizations: Map<OrganizationKey, {
    volume: number;
    color: [number, number, number];
    index: number;
  }>;
};

export function buildContributionFocusBeats(
  points: CommitLocationHeatPoint[],
  zones: ContributionLocationZone[],
  dateRange: { from: string; to: string },
  dayCount: number,
  sectionCount = CONTRIBUTION_FOCUS_SECTION_COUNT,
): ContributionFocusBeat[] {
  if (dayCount <= 0) throw new Error("Contribution focus requires at least one calendar day.");
  if (sectionCount <= 0) throw new Error("Contribution focus requires at least one section.");

  const globalDominant = dominantCell(points) ?? {
    cellId: "fallback",
    longitude: -80,
    latitude: 31,
    volume: 0,
    routeCount: 0,
    organizationKey: "new-heat",
    organizationColor: [248, 81, 73],
    organizationIndex: 0,
  };
  const beats: ContributionFocusBeat[] = [];
  let previous = globalDominant;

  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const startDayOrdinal = Math.floor(sectionIndex * dayCount / sectionCount);
    const endDayOrdinal = sectionIndex === sectionCount - 1
      ? dayCount - 1
      : Math.floor((sectionIndex + 1) * dayCount / sectionCount) - 1;
    const sectionPoints = points.filter((point) =>
      point.dayOrdinal >= startDayOrdinal && point.dayOrdinal <= endDayOrdinal,
    );
    const dominant = dominantCell(sectionPoints);
    const target = dominant ?? previous;
    const location = nearestLocationZone(target, zones);
    const display = location
      ? locationDisplay(location.location)
      : { primary: "WORK FOCUS", secondary: "UNLABELED CONTRIBUTION AREA" };
    beats.push({
      sectionIndex,
      startDayOrdinal,
      endDayOrdinal,
      startDate: dateAtOrdinal(dateRange.from, startDayOrdinal),
      endDate: dateAtOrdinal(dateRange.from, endDayOrdinal),
      longitude: target.longitude,
      latitude: target.latitude,
      volume: dominant?.volume ?? 0,
      cellId: target.cellId,
      organizationKey: target.organizationKey,
      organizationColor: target.organizationColor,
      organizationIndex: target.organizationIndex,
      source: dominant ? "section-dominant-contribution-cell" : "carry-forward",
      locationPrimary: display.primary,
      locationSecondary: display.secondary,
      locationEvidence: location
        ? "nearest-curated-memory-zone"
        : "unlabeled-contribution-area",
    });
    previous = target;
  }
  return beats;
}

export function contributionFocusFrame(
  traversalProgress: number,
  beats: ContributionFocusBeat[],
  transitionFraction = CONTRIBUTION_FOCUS_TRANSITION_FRACTION,
): ContributionFocusFrame {
  if (beats.length === 0) throw new Error("Contribution focus requires beats.");
  const progress = clamp(traversalProgress, 0, 1);
  const sectionPosition = Math.min(beats.length - Number.EPSILON, progress * beats.length);
  const sectionIndex = Math.min(beats.length - 1, Math.floor(sectionPosition));
  const sectionProgress = progress >= 1 ? 1 : sectionPosition - sectionIndex;
  const beat = beats[sectionIndex];
  const previousBeat = beats[Math.max(0, sectionIndex - 1)];
  const movementProgress = clamp(sectionProgress / transitionFraction, 0, 1);
  const movement = easeOutCubic(movementProgress);
  return {
    sectionIndex,
    sectionProgress,
    longitude: normalizeLongitude(
      previousBeat.longitude + shortestLongitudeDelta(previousBeat.longitude, beat.longitude) * movement,
    ),
    latitude: mix(previousBeat.latitude, beat.latitude, movement),
    pulse: 1 - smootherstep(movementProgress),
    beat,
    previousBeat,
  };
}

function dominantCell(points: CommitLocationHeatPoint[]): AggregateCell | null {
  const byCell = new Map<string, MutableAggregateCell>();
  for (const point of points) {
    const current = byCell.get(point.cellId);
    const next = current ?? {
        cellId: point.cellId,
        longitude: point.longitude,
        latitude: point.latitude,
        volume: 0,
        routeCount: 0,
        organizations: new Map(),
      };
    const organization = next.organizations.get(point.organizationKey);
    next.volume += point.volume;
    next.routeCount += point.routeCount;
    next.organizations.set(point.organizationKey, {
      volume: (organization?.volume ?? 0) + point.volume,
      color: point.organizationColor,
      index: point.organizationIndex,
    });
    byCell.set(point.cellId, next);
  }
  const dominant = [...byCell.values()].sort((left, right) =>
    right.volume - left.volume
      || right.routeCount - left.routeCount
      || left.cellId.localeCompare(right.cellId),
  )[0] ?? null;
  if (!dominant) return null;
  const [organizationKey, organization] = [...dominant.organizations.entries()]
    .sort((left, right) => right[1].volume - left[1].volume || left[0].localeCompare(right[0]))[0];
  return {
    cellId: dominant.cellId,
    longitude: dominant.longitude,
    latitude: dominant.latitude,
    volume: dominant.volume,
    routeCount: dominant.routeCount,
    organizationKey,
    organizationColor: organization.color,
    organizationIndex: organization.index,
  };
}

function nearestLocationZone(target: AggregateCell, zones: ContributionLocationZone[]) {
  let nearest: { zone: ContributionLocationZone; distanceKm: number } | null = null;
  for (const zone of zones) {
    const distanceKm = haversineKm(target.longitude, target.latitude, zone.longitude, zone.latitude);
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { zone, distanceKm };
  }
  if (!nearest) return null;
  const permittedDistance = Math.min(
    CONTRIBUTION_FOCUS_LABEL_RADIUS_KM,
    Math.max(40, nearest.zone.collectionRadiusKm * 2),
  );
  return nearest.distanceKm <= permittedDistance ? nearest.zone : null;
}

function locationDisplay(location: ContributionLocationZone["location"]) {
  const primary = location.cityOrRegion.trim();
  const state = location.state?.trim() ?? "";
  const country = location.country.trim();
  const secondary = [
    state && state.toLocaleLowerCase() !== primary.toLocaleLowerCase() ? state : null,
    country && country.toLocaleLowerCase() !== primary.toLocaleLowerCase() ? country : null,
  ].filter((value): value is string => Boolean(value)).join(" · ");
  return { primary, secondary };
}

function shortestLongitudeDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

function normalizeLongitude(value: number) {
  return ((value + 540) % 360) - 180;
}

function dateAtOrdinal(startDate: string, ordinal: number) {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + ordinal);
  return date.toISOString().slice(0, 10);
}

function haversineKm(longitudeA: number, latitudeA: number, longitudeB: number, latitudeB: number) {
  const radians = Math.PI / 180;
  const deltaLatitude = (latitudeB - latitudeA) * radians;
  const deltaLongitude = (longitudeB - longitudeA) * radians;
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA * radians) * Math.cos(latitudeB * radians)
    * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mix(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function smootherstep(value: number) {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * normalized * (normalized * (normalized * 6 - 15) + 10);
}

function easeOutCubic(value: number) {
  const normalized = clamp(value, 0, 1);
  return 1 - (1 - normalized) ** 3;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
