import {
  ORGANIZATION_GROUPS,
  VISIBLE_ORGANIZATION_GROUPS,
  buildVisibleOrganizationSlices,
  type OrganizationKey,
  type OwnerProjectContributionSnapshot,
} from "./calendar-model";

export type OrganizationShareSummary = {
  key: OrganizationKey;
  label: string;
  color: string;
  activeDayCount: number;
  activeDayShare: number;
  activeDayPercent: number;
  contributionCount: number;
  contributionShare: number;
  contributionPercent: number;
};

export type OrganizationProgressDay = {
  date: string;
  dayOrdinal: number;
  cumulativeContributions: Record<OrganizationKey, number>;
  /** First live day only: completed history, never a new arrival or +X event. */
  prefilledContributions?: Partial<Record<OrganizationKey, number>>;
  prefilledLastActivityOrdinals?: Partial<Record<OrganizationKey, number>>;
};

export function buildOrganizationShareSummary(
  snapshot: OwnerProjectContributionSnapshot,
): OrganizationShareSummary[] {
  const activeDays = new Map<OrganizationKey, number>(
    VISIBLE_ORGANIZATION_GROUPS.map((group) => [group.key, 0]),
  );
  const contributions = new Map<OrganizationKey, number>(
    VISIBLE_ORGANIZATION_GROUPS.map((group) => [group.key, 0]),
  );

  for (const day of snapshot.years.flatMap((year) => year.days)) {
    for (const slice of buildVisibleOrganizationSlices(day)) {
      if (slice.count <= 0) continue;
      activeDays.set(slice.key, (activeDays.get(slice.key) ?? 0) + 1);
      contributions.set(slice.key, (contributions.get(slice.key) ?? 0) + slice.count);
    }
  }

  const activeDayTotal = sum(activeDays.values());
  const contributionTotal = sum(contributions.values());
  const activeDayPercents = apportionPercentages(
    VISIBLE_ORGANIZATION_GROUPS.map((group) => activeDays.get(group.key) ?? 0),
  );
  const contributionPercents = apportionPercentages(
    VISIBLE_ORGANIZATION_GROUPS.map((group) => contributions.get(group.key) ?? 0),
  );

  return VISIBLE_ORGANIZATION_GROUPS.map((group, index) => {
    const activeDayCount = activeDays.get(group.key) ?? 0;
    const contributionCount = contributions.get(group.key) ?? 0;
    return {
      key: group.key,
      label: group.label,
      color: group.color,
      activeDayCount,
      activeDayShare: activeDayCount / Math.max(1, activeDayTotal),
      activeDayPercent: activeDayPercents[index],
      contributionCount,
      contributionShare: contributionCount / Math.max(1, contributionTotal),
      contributionPercent: contributionPercents[index],
    };
  });
}

export function buildOrganizationProgressTimeline(
  snapshot: OwnerProjectContributionSnapshot,
): OrganizationProgressDay[] {
  const cumulative = Object.fromEntries(
    ORGANIZATION_GROUPS.map((group) => [group.key, 0]),
  ) as Record<OrganizationKey, number>;
  const days = snapshot.years
    .flatMap((year) => year.days)
    .sort((left, right) => left.date.localeCompare(right.date));

  return days.map((day, dayOrdinal) => {
    for (const slice of buildVisibleOrganizationSlices(day)) {
      cumulative[slice.key] += slice.count;
    }
    return {
      date: day.date,
      dayOrdinal,
      cumulativeContributions: { ...cumulative },
    };
  });
}

export function apportionPercentages(values: number[]) {
  const total = values.reduce((result, value) => result + value, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => value * 100 / total);
  const result = exact.map(Math.floor);
  let remaining = 100 - result.reduce((sumValue, value) => sumValue + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) result[order[index].index] += 1;
  return result;
}

function sum(values: Iterable<number>) {
  let result = 0;
  for (const value of values) result += value;
  return result;
}
