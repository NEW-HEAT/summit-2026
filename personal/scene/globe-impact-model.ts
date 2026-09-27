import type {
  CommitLocationHeatPoint,
} from "./location-heat-model";

export const CONTRIBUTION_BANG_DURATION_DAYS = 8;
export const CONTRIBUTION_BANG_WAVE_DELAYS = [0, 0.18, 0.36] as const;
export const CONTRIBUTION_HEAT_CELL_SIZE_DEGREES = 1;
export const CONTRIBUTION_HEAT_BRIGHTNESS_FLOOR = 0.7;
export const CONTRIBUTION_IMPACT_WAVE_MAX_PIXELS = 30;

type LonLat = [number, number];

export type ContributionImpact = {
  id: string;
  position: LonLat;
  progress: number;
  intensity: number;
  volume: number;
  organizationColor: [number, number, number];
  organizationIndex: number;
};

export type ContributionImpactRing = {
  id: string;
  position: LonLat;
  radius: number;
  color: [number, number, number, number];
  lineWidth: number;
};

export function buildContributionImpacts(
  points: CommitLocationHeatPoint[],
  revealHead: number,
  maximumVolume: number,
) {
  const safeMaximum = Math.max(1, maximumVolume);
  return points.flatMap<ContributionImpact>((point) => {
    const ageDays = revealHead - (point.dayOrdinal + 1);
    if (ageDays < 0 || ageDays >= CONTRIBUTION_BANG_DURATION_DAYS) return [];
    return [{
      id: point.id,
      position: [point.longitude, point.latitude],
      progress: clamp(ageDays / CONTRIBUTION_BANG_DURATION_DAYS, 0, 1),
      intensity: 0.35 + 0.65 * Math.log1p(point.volume) / Math.log1p(safeMaximum),
      volume: point.volume,
      organizationColor: point.organizationColor,
      organizationIndex: point.organizationIndex,
    }];
  });
}

export function buildContributionImpactRings(impacts: ContributionImpact[]) {
  return impacts.flatMap<ContributionImpactRing>((impact) =>
    CONTRIBUTION_BANG_WAVE_DELAYS.flatMap((delay, waveIndex) => {
      if (impact.progress < delay) return [];
      const localProgress = clamp((impact.progress - delay) / (1 - delay), 0, 1);
      const easedProgress = 1 - (1 - localProgress) ** 3;
      return [{
        id: `${impact.id}:impact:${waveIndex}`,
        position: impact.position,
        radius: (5.5 + impact.organizationIndex * 0.5 + 18 * easedProgress)
          * (0.86 + 0.14 * impact.intensity),
        color: [
          ...impact.organizationColor,
          Math.round(255 * (1 - localProgress) ** 1.8),
        ],
        lineWidth: 0.2 + 1.8 * (1 - localProgress) * impact.intensity,
      }];
    }),
  );
}

export function contributionImpactFlashStyle(impact: ContributionImpact) {
  const flashProgress = clamp(impact.progress / 0.45, 0, 1);
  const settledRadius = contributionSettledHeatRadius(
    impact.organizationIndex,
    impact.intensity,
  );
  const arrivalRadius = settledRadius + 5 + 3 * impact.intensity;
  const settleProgress = 1 - (1 - flashProgress) ** 3;
  return {
    radius: arrivalRadius + (settledRadius - arrivalRadius) * settleProgress,
    alpha: Math.round(255 * (1 - flashProgress) ** 1.5),
  };
}

export function contributionSettledHeatRadius(organizationIndex: number, intensity: number) {
  return 4 + clamp(organizationIndex, 0, 3) * 2 + clamp(intensity, 0, 1) * 1.5;
}

export function settledContributionRevealHead(revealHead: number, overview: boolean) {
  return overview ? revealHead : Math.max(0, revealHead - CONTRIBUTION_BANG_DURATION_DAYS);
}

export function contributionHeatCellPolygon(
  position: LonLat,
  organizationIndex: number,
): LonLat[] {
  const [west, south, east, north] = geographicHeatCellBounds(position);
  const [longitude, latitude] = position;
  const middleLongitude = longitude;
  const middleLatitude = latitude;
  switch (clamp(Math.floor(organizationIndex), 0, 3)) {
    case 0:
      return [[west, middleLatitude], [middleLongitude, middleLatitude], [middleLongitude, north], [west, north]];
    case 1:
      return [[middleLongitude, middleLatitude], [east, middleLatitude], [east, north], [middleLongitude, north]];
    case 2:
      return [[west, south], [middleLongitude, south], [middleLongitude, middleLatitude], [west, middleLatitude]];
    default:
      return [[middleLongitude, south], [east, south], [east, middleLatitude], [middleLongitude, middleLatitude]];
  }
}

export function geographicHeatCellPolygon(position: LonLat): LonLat[] {
  const [west, south, east, north] = geographicHeatCellBounds(position);
  return [[west, south], [east, south], [east, north], [west, north]];
}

export function contributionSettledHeatColor(
  organizationColor: [number, number, number],
  volume: number,
): [number, number, number, number] {
  const intensity = clamp(Math.log1p(Math.max(0, volume)) / Math.log1p(64), 0, 1);
  const colorStrength = CONTRIBUTION_HEAT_BRIGHTNESS_FLOOR
    + (1 - CONTRIBUTION_HEAT_BRIGHTNESS_FLOOR) * intensity;
  return [
    Math.round(organizationColor[0] * colorStrength),
    Math.round(organizationColor[1] * colorStrength),
    Math.round(organizationColor[2] * colorStrength),
    255,
  ];
}

export function contributionSettledHeatContourColor(
  organizationColor: [number, number, number],
  volume: number,
): [number, number, number, number] {
  const fill = contributionSettledHeatColor(organizationColor, volume);
  return [
    Math.max(24, Math.round(fill[0] * 0.78)),
    Math.max(24, Math.round(fill[1] * 0.78)),
    Math.max(24, Math.round(fill[2] * 0.78)),
    255,
  ];
}

function geographicHeatCellBounds(position: LonLat): [number, number, number, number] {
  const half = CONTRIBUTION_HEAT_CELL_SIZE_DEGREES / 2;
  return [
    Math.max(-179.999, position[0] - half),
    position[1] - half,
    Math.min(179.999, position[0] + half),
    position[1] + half,
  ];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
