import {
  VISIBLE_ORGANIZATION_GROUPS,
  buildVisibleOrganizationSlices,
  visibleContributionCount,
  type OrganizationKey,
  type OwnerProjectContributionSnapshot,
} from "./calendar-model";
import {
  buildOrganizationProgressTimeline,
  buildOrganizationShareSummary,
  type OrganizationProgressDay,
  type OrganizationShareSummary,
} from "./organization-share-model";

export const LOCATION_HEAT_SCHEMA_VERSION = 6;
export const LOCATION_HEAT_QUANTIZATION_DEGREES = 1;
export const LOCATION_HEAT_MATCH_POLICY = "same-local-date-private-route-center" as const;

export type TrainingActivityGroup = "ride" | "run" | "hike" | "swim" | "other";
export type TrainingActivityCounts = Record<TrainingActivityGroup, number>;

export type PrivateLocationRoute = {
  startMs: number;
  center: [number, number];
  activityType?: string;
};

export type PrivateGeographicMemoryLocation = {
  cityOrRegion: string;
  state: string | null;
  country: string;
  label?: string;
};

export type PrivateGeographicMemoryBeat = {
  zone?: {
    longitude: number;
    latitude: number;
    collectionRadiusKm?: number;
    location?: PrivateGeographicMemoryLocation;
  };
};

export type PrivateLocationArchive = {
  status?: string;
  ownerFingerprint?: string;
  routes: PrivateLocationRoute[];
  sequence?: {
    beats?: PrivateGeographicMemoryBeat[];
    alternates?: PrivateGeographicMemoryBeat[];
  };
};

export type ContributionLocationZone = {
  id: string;
  longitude: number;
  latitude: number;
  collectionRadiusKm: number;
  location: PrivateGeographicMemoryLocation;
};

export type CommitLocationHeatPoint = {
  id: string;
  cellId: string;
  date: string;
  dayOrdinal: number;
  longitude: number;
  latitude: number;
  organizationKey: OrganizationKey;
  organizationColor: [number, number, number];
  organizationIndex: number;
  volume: number;
  routeCount: number;
};

export type TrainingLocationHeatPoint = {
  id: string;
  cellId: string;
  date: string;
  dayOrdinal: number;
  longitude: number;
  latitude: number;
  routeCount: number;
  activityCounts: TrainingActivityCounts;
};

export type CommitLocationHeatDataset = {
  schemaVersion: typeof LOCATION_HEAT_SCHEMA_VERSION;
  source: "private-fitness-route-date-cross-reference";
  locationEvidence: typeof LOCATION_HEAT_MATCH_POLICY;
  quantizationDegrees: typeof LOCATION_HEAT_QUANTIZATION_DEGREES;
  timezone: string;
  ownerFingerprint: string | null;
  dateRange: { from: string; to: string };
  dayCount: number;
  points: CommitLocationHeatPoint[];
  trainingPoints: TrainingLocationHeatPoint[];
  locationZones: ContributionLocationZone[];
  organizationShares: OrganizationShareSummary[];
  organizationProgress: OrganizationProgressDay[];
  prefilledHistory?: {
    dateRange: { from: string; to: string };
    fadeSeconds: number;
    contributionVolume: number;
    locatedContributionVolume: number;
  };
  metrics: {
    activeContributionDays: number;
    matchedContributionDays: number;
    unmatchedContributionDays: number;
    exactDayMatchRate: number;
    contributionVolume: number;
    locatedContributionVolume: number;
    routeDayCount: number;
    locationCellCount: number;
    trainingRouteCount: number;
    trainingLocationCellCount: number;
    trainingByActivity: TrainingActivityCounts;
    byYear: Array<{
      year: number;
      activeContributionDays: number;
      matchedContributionDays: number;
      contributionVolume: number;
      locatedContributionVolume: number;
    }>;
  };
};

type RouteCell = {
  cellId: string;
  longitude: number;
  latitude: number;
  routeCount: number;
  activityCounts: TrainingActivityCounts;
};

export function buildCommitLocationHeat(
  snapshot: OwnerProjectContributionSnapshot,
  archive: PrivateLocationArchive,
): CommitLocationHeatDataset {
  const days = snapshot.years
    .flatMap((year) => year.days)
    .sort((left, right) => left.date.localeCompare(right.date));
  if (days.length === 0) throw new Error("Contribution snapshot contains no days.");
  if (!Array.isArray(archive.routes)) throw new Error("Private location archive contains no routes.");

  const routeCellsByDate = new Map<string, Map<string, RouteCell>>();
  const trainingByActivity = emptyTrainingActivityCounts();
  let trainingRouteCount = 0;
  for (const route of archive.routes) {
    if (!validRoute(route)) continue;
    const date = localDate(route.startMs, snapshot.timezone);
    if (date < days[0].date || date > days.at(-1)!.date) continue;
    const longitude = quantizeLongitude(route.center[0]);
    const latitude = quantizeLatitude(route.center[1]);
    const cellId = `${longitude.toFixed(1)}:${latitude.toFixed(1)}`;
    const activity = trainingActivityGroup(route.activityType);
    const cells = routeCellsByDate.get(date) ?? new Map<string, RouteCell>();
    const current = cells.get(cellId);
    cells.set(cellId, current
      ? {
        ...current,
        routeCount: current.routeCount + 1,
        activityCounts: incrementTrainingActivity(current.activityCounts, activity),
      }
      : {
        cellId,
        longitude,
        latitude,
        routeCount: 1,
        activityCounts: incrementTrainingActivity(emptyTrainingActivityCounts(), activity),
      });
    routeCellsByDate.set(date, cells);
    trainingRouteCount += 1;
    trainingByActivity[activity] += 1;
  }

  const dayOrdinalByDate = new Map(days.map((day, dayOrdinal) => [day.date, dayOrdinal]));
  const trainingPoints: TrainingLocationHeatPoint[] = [];
  for (const [date, cells] of routeCellsByDate) {
    const dayOrdinal = dayOrdinalByDate.get(date);
    if (dayOrdinal == null) continue;
    for (const cell of cells.values()) {
      trainingPoints.push({
        id: `${date}:${cell.cellId}:training`,
        cellId: cell.cellId,
        date,
        dayOrdinal,
        longitude: cell.longitude,
        latitude: cell.latitude,
        routeCount: cell.routeCount,
        activityCounts: { ...cell.activityCounts },
      });
    }
  }
  trainingPoints.sort((left, right) => left.dayOrdinal - right.dayOrdinal || left.cellId.localeCompare(right.cellId));

  const points: CommitLocationHeatPoint[] = [];
  const byYear = new Map<number, CommitLocationHeatDataset["metrics"]["byYear"][number]>();
  let activeContributionDays = 0;
  let matchedContributionDays = 0;
  let contributionVolume = 0;
  let locatedContributionVolume = 0;

  for (let dayOrdinal = 0; dayOrdinal < days.length; dayOrdinal += 1) {
    const day = days[dayOrdinal];
    const organizationSlices = buildVisibleOrganizationSlices(day);
    const volume = visibleContributionCount(day);
    if (volume <= 0) continue;
    const year = Number(day.date.slice(0, 4));
    const yearMetrics = byYear.get(year) ?? {
      year,
      activeContributionDays: 0,
      matchedContributionDays: 0,
      contributionVolume: 0,
      locatedContributionVolume: 0,
    };
    activeContributionDays += 1;
    contributionVolume += volume;
    yearMetrics.activeContributionDays += 1;
    yearMetrics.contributionVolume += volume;

    const routeCells = [...(routeCellsByDate.get(day.date)?.values() ?? [])]
      .sort((left, right) => right.routeCount - left.routeCount || left.cellId.localeCompare(right.cellId));
    if (routeCells.length > 0) {
      const routeTotal = routeCells.reduce((sum, cell) => sum + cell.routeCount, 0);
      matchedContributionDays += 1;
      locatedContributionVolume += volume;
      yearMetrics.matchedContributionDays += 1;
      yearMetrics.locatedContributionVolume += volume;
      for (const cell of routeCells) {
        for (const slice of organizationSlices) {
          points.push({
            id: `${day.date}:${cell.cellId}:${slice.key}`,
            cellId: cell.cellId,
            date: day.date,
            dayOrdinal,
            longitude: cell.longitude,
            latitude: cell.latitude,
            organizationKey: slice.key,
            organizationColor: organizationColorForKey(slice.key),
            organizationIndex: visibleOrganizationIndex(slice.key),
            volume: slice.count * cell.routeCount / routeTotal,
            routeCount: cell.routeCount * slice.count / volume,
          });
        }
      }
    }
    byYear.set(year, yearMetrics);
  }

  const locationCellCount = new Set(points.map((point) => point.cellId)).size;
  const locationZones = buildContributionLocationZones(archive);
  return {
    schemaVersion: LOCATION_HEAT_SCHEMA_VERSION,
    source: "private-fitness-route-date-cross-reference",
    locationEvidence: LOCATION_HEAT_MATCH_POLICY,
    quantizationDegrees: LOCATION_HEAT_QUANTIZATION_DEGREES,
    timezone: snapshot.timezone,
    ownerFingerprint: archive.ownerFingerprint ?? null,
    dateRange: { from: days[0].date, to: days.at(-1)!.date },
    dayCount: days.length,
    points,
    trainingPoints,
    locationZones,
    organizationShares: buildOrganizationShareSummary(snapshot),
    organizationProgress: buildOrganizationProgressTimeline(snapshot),
    metrics: {
      activeContributionDays,
      matchedContributionDays,
      unmatchedContributionDays: activeContributionDays - matchedContributionDays,
      exactDayMatchRate: matchedContributionDays / Math.max(activeContributionDays, 1),
      contributionVolume,
      locatedContributionVolume,
      routeDayCount: routeCellsByDate.size,
      locationCellCount,
      trainingRouteCount,
      trainingLocationCellCount: new Set(trainingPoints.map((point) => point.cellId)).size,
      trainingByActivity,
      byYear: [...byYear.values()].sort((left, right) => left.year - right.year),
    },
  };
}

export function organizationColorForKey(key: OrganizationKey): [number, number, number] {
  const color = VISIBLE_ORGANIZATION_GROUPS.find((group) => group.key === key)?.color;
  if (!color) throw new Error(`No visible organization color for ${key}.`);
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function visibleOrganizationIndex(key: OrganizationKey) {
  const index = VISIBLE_ORGANIZATION_GROUPS.findIndex((group) => group.key === key);
  if (index < 0) throw new Error(`No visible organization index for ${key}.`);
  return index;
}

function buildContributionLocationZones(archive: PrivateLocationArchive): ContributionLocationZone[] {
  const zones: ContributionLocationZone[] = [];
  const seen = new Set<string>();
  for (const beat of [
    ...(archive.sequence?.beats ?? []),
    ...(archive.sequence?.alternates ?? []),
  ]) {
    const zone = beat.zone;
    const location = zone?.location;
    if (
      !zone
      || !location
      || !Number.isFinite(zone.longitude)
      || !Number.isFinite(zone.latitude)
      || !location.cityOrRegion?.trim()
      || !location.country?.trim()
    ) continue;
    const key = `${location.cityOrRegion.trim()}|${location.state?.trim() ?? ""}|${location.country.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    zones.push({
      id: `memory-zone-${zones.length + 1}`,
      longitude: quantizeLongitude(zone.longitude),
      latitude: quantizeLatitude(zone.latitude),
      collectionRadiusKm: Math.max(20, Math.min(180, Math.round(zone.collectionRadiusKm ?? 70))),
      location: {
        cityOrRegion: location.cityOrRegion.trim(),
        state: location.state?.trim() || null,
        country: location.country.trim(),
        label: location.label?.trim() || undefined,
      },
    });
  }
  return zones;
}

function emptyTrainingActivityCounts(): TrainingActivityCounts {
  return { ride: 0, run: 0, hike: 0, swim: 0, other: 0 };
}

function incrementTrainingActivity(
  counts: TrainingActivityCounts,
  activity: TrainingActivityGroup,
) {
  return { ...counts, [activity]: counts[activity] + 1 };
}

function trainingActivityGroup(value: string | undefined): TrainingActivityGroup {
  const activity = value?.trim().toLowerCase() ?? "";
  if (activity.includes("ride") || activity.includes("cycling") || activity.includes("bike")) return "ride";
  if (activity.includes("run")) return "run";
  if (activity.includes("hike") || activity.includes("walk") || activity.includes("snow")) return "hike";
  if (
    activity.includes("swim")
    || activity.includes("row")
    || activity.includes("boat")
    || activity.includes("padd")
  ) return "swim";
  return "other";
}

function validRoute(route: PrivateLocationRoute) {
  return Number.isFinite(route?.startMs)
    && Array.isArray(route?.center)
    && route.center.length >= 2
    && Number.isFinite(route.center[0])
    && Number.isFinite(route.center[1])
    && route.center[1] >= -90
    && route.center[1] <= 90;
}

function localDate(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function quantizeLongitude(value: number) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.round(normalized / LOCATION_HEAT_QUANTIZATION_DEGREES)
    * LOCATION_HEAT_QUANTIZATION_DEGREES;
}

function quantizeLatitude(value: number) {
  const clamped = Math.max(-89, Math.min(89, value));
  return Math.round(clamped / LOCATION_HEAT_QUANTIZATION_DEGREES)
    * LOCATION_HEAT_QUANTIZATION_DEGREES;
}
