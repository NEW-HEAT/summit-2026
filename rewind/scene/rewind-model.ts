export type LonLat = [number, number];

export type ArchiveRoutePath = {
  positions: LonLat[];
  timesMs?: number[];
};

export type ArchiveRoute = {
  provenance?: "reconstructed";
  id: string;
  startMs: number;
  endMs: number;
  activityType: string;
  provider: string;
  timing: "recorded" | "inferred";
  bbox: [number, number, number, number];
  center: LonLat;
  pointCount: number;
  paths: ArchiveRoutePath[];
};

export function visibleRoutePath(
  route: ArchiveRoute,
  calendarMs: number,
  untimedMode: "provenance" | "editorial"
): LonLat[][] {
  if (calendarMs < route.startMs) return [];
  if (calendarMs >= route.endMs) {
    return route.paths.map((path) => path.positions);
  }
  return route.paths
    .map((path) => {
      if (
        path.timesMs?.length === path.positions.length &&
        path.timesMs.length > 1
      ) {
        const visibleCount = upperBound(path.timesMs, calendarMs);
        return path.positions.slice(0, Math.max(visibleCount, 1));
      }
      if (untimedMode === "provenance") return path.positions;
      const duration = Math.max(route.endMs - route.startMs, 1);
      const fraction = clamp((calendarMs - route.startMs) / duration, 0, 1);
      const visibleCount = Math.max(
        1,
        Math.ceil(path.positions.length * fraction)
      );
      return path.positions.slice(0, visibleCount);
    })
    .filter((path) => path.length >= 2);
}

function upperBound(values: readonly number[], needle: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= needle) low = middle + 1;
    else high = middle;
  }
  return low;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
