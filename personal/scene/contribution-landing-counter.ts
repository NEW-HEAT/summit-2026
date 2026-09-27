import { FPS, VISIBLE_ORGANIZATION_GROUPS, type OrganizationKey } from "./calendar-model";
import type { OrganizationProgressDay } from "./organization-share-model";
import { VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT as TIMING } from "./vertical-calendar-model";
import { CONTRIBUTION_BANG_DURATION_DAYS } from "./globe-impact-model";
import { CONTRIBUTION_PIN_ARRIVAL_FRACTION, contributionEntryCorner } from "./globe-pin-arrival-model";

export const CONTRIBUTION_ADDITION_SECONDS = 0.24;

export function contributionLandingSeconds(dayOrdinal: number, dayCount: number) {
  return TIMING.emptyPreRollSeconds + TIMING.traversalSeconds
    * (dayOrdinal + 1 + CONTRIBUTION_BANG_DURATION_DAYS * CONTRIBUTION_PIN_ARRIVAL_FRACTION)
    / Math.max(1, dayCount);
}

/** Counts every attributed contribution; a count never implies a known location. */
export function contributionLandingCounterFrame(frameIndex: number, days: OrganizationProgressDay[]) {
  const safeFrame = Math.max(0, Math.min(TIMING.frameCount - 1, Math.floor(frameIndex)));
  const seconds = safeFrame / FPS;
  const starting = days[0]?.prefilledContributions ?? {};
  const cumulative: Partial<Record<OrganizationKey, number>> = { ...starting };
  const additions: Array<{
    id: string; date: string; key: OrganizationKey; count: number; color: string;
    progress: number; corner: readonly [number, number]; landingFrame: number;
  }> = [];
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const landingSeconds = contributionLandingSeconds(day.dayOrdinal, days.length);
    const landingFrame = Math.ceil(landingSeconds * FPS - 1e-8);
    if (safeFrame < landingFrame) continue;
    const ageSeconds = seconds - landingFrame / FPS;
    for (let organizationIndex = 0; organizationIndex < VISIBLE_ORGANIZATION_GROUPS.length; organizationIndex += 1) {
      const group = VISIBLE_ORGANIZATION_GROUPS[organizationIndex];
      const count = (day.cumulativeContributions[group.key] ?? 0)
        - (days[index - 1]?.cumulativeContributions[group.key] ?? starting[group.key] ?? 0);
      if (count <= 0) continue;
      cumulative[group.key] = (cumulative[group.key] ?? 0) + count;
      if (ageSeconds >= CONTRIBUTION_ADDITION_SECONDS) continue;
      additions.push({
        id: `${day.date}:${group.key}`, date: day.date, key: group.key, count, color: group.color,
        progress: Math.max(0, ageSeconds / CONTRIBUTION_ADDITION_SECONDS),
        corner: contributionEntryCorner(organizationIndex), landingFrame,
      });
    }
  }
  return {
    total: Object.values(cumulative).reduce((sum, value) => sum + value, 0),
    cumulativeContributions: cumulative,
    additions,
  };
}
