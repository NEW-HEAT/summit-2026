import { ORGANIZATION_GROUPS, type OrganizationKey } from "./calendar-model";
import type { CommitLocationHeatDataset } from "./location-heat-model";
import { apportionPercentages } from "./organization-share-model";

export const PREFILLED_HISTORY_FADE_SECONDS = 0.5;

export function prefilledHistoryOpacity(seconds: number) {
  const progress = Math.max(0, Math.min(1, seconds / PREFILLED_HISTORY_FADE_SECONDS));
  return progress * progress * (3 - 2 * progress);
}

/** Add completed history without inserting days or retiming any live event. */
export function withPrefilledContributionHistory(
  live: CommitLocationHeatDataset,
  history: CommitLocationHeatDataset,
): CommitLocationHeatDataset {
  if (live.prefilledHistory) throw new Error("Contribution history is already prefilled.");
  if (history.dateRange.to >= live.dateRange.from) throw new Error("Prefilled history overlaps the live timeline.");
  if (history.timezone !== live.timezone || history.ownerFingerprint !== live.ownerFingerprint) {
    throw new Error("Prefilled history must use the same owner and date timezone.");
  }
  const offset = (Date.parse(history.dateRange.from) - Date.parse(live.dateRange.from)) / 86_400_000;
  const starting = history.organizationProgress.at(-1)!.cumulativeContributions;
  const lastActivity: Partial<Record<OrganizationKey, number>> = {};
  for (let index = 0; index < history.organizationProgress.length; index += 1) {
    const day = history.organizationProgress[index];
    for (const { key } of ORGANIZATION_GROUPS) {
      if (day.cumulativeContributions[key]
        > (history.organizationProgress[index - 1]?.cumulativeContributions[key] ?? 0)) {
        lastActivity[key] = day.dayOrdinal + offset;
      }
    }
  }
  const points = [
    ...history.points.map((point) => ({ ...point, dayOrdinal: point.dayOrdinal + offset })),
    ...live.points,
  ];
  const trainingPoints = [
    ...history.trainingPoints.map((point) => ({ ...point, dayOrdinal: point.dayOrdinal + offset })),
    ...live.trainingPoints,
  ];
  const shares = live.organizationShares.map((share) => {
    const previous = history.organizationShares.find((item) => item.key === share.key);
    return {
      ...share,
      contributionCount: share.contributionCount + (previous?.contributionCount ?? 0),
      activeDayCount: share.activeDayCount + (previous?.activeDayCount ?? 0),
    };
  });
  const total = shares.reduce((sum, item) => sum + item.contributionCount, 0);
  const activeTotal = shares.reduce((sum, item) => sum + item.activeDayCount, 0);
  const contributionPercent = apportionPercentages(shares.map((share) => share.contributionCount));
  const activePercent = apportionPercentages(shares.map((share) => share.activeDayCount));
  const metrics = { ...live.metrics };
  for (const key of ["activeContributionDays", "matchedContributionDays", "unmatchedContributionDays",
    "contributionVolume", "locatedContributionVolume", "routeDayCount", "trainingRouteCount"] as const) {
    metrics[key] += history.metrics[key];
  }
  metrics.exactDayMatchRate = metrics.matchedContributionDays / Math.max(1, metrics.activeContributionDays);
  metrics.locationCellCount = new Set(points.map((point) => point.cellId)).size;
  metrics.trainingLocationCellCount = new Set(trainingPoints.map((point) => point.cellId)).size;
  metrics.byYear = [...history.metrics.byYear, ...live.metrics.byYear];
  metrics.trainingByActivity = { ...live.metrics.trainingByActivity };
  for (const key of ["ride", "run", "hike", "swim", "other"] as const) {
    metrics.trainingByActivity[key] += history.metrics.trainingByActivity[key];
  }
  return {
    ...live,
    // The live range, day count, focus zones, and point identities stay locked.
    points,
    trainingPoints,
    metrics,
    organizationShares: shares.map((share, index) => ({
      ...share,
      contributionShare: share.contributionCount / Math.max(1, total),
      contributionPercent: contributionPercent[index],
      activeDayShare: share.activeDayCount / Math.max(1, activeTotal),
      activeDayPercent: activePercent[index],
    })),
    organizationProgress: live.organizationProgress.map((day, index) => ({
      ...day,
      cumulativeContributions: Object.fromEntries(ORGANIZATION_GROUPS.map(({ key }) => [
        key, day.cumulativeContributions[key] + (starting[key] ?? 0),
      ])) as typeof day.cumulativeContributions,
      ...(index === 0 ? { prefilledContributions: { ...starting }, prefilledLastActivityOrdinals: lastActivity } : {}),
    })),
    prefilledHistory: {
      dateRange: history.dateRange,
      fadeSeconds: PREFILLED_HISTORY_FADE_SECONDS,
      contributionVolume: history.metrics.contributionVolume,
      locatedContributionVolume: history.metrics.locatedContributionVolume,
    },
  };
}
