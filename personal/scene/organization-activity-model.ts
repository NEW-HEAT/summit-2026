import { FPS, VISIBLE_ORGANIZATION_GROUPS, type OrganizationKey } from "./calendar-model";
import { contributionLandingSeconds } from "./contribution-landing-counter";
import type { OrganizationProgressDay } from "./organization-share-model";
import { VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT as TIMING } from "./vertical-calendar-model";

export const ORGANIZATION_ACTIVITY_MIN_OPACITY = 0.25;
export const ORGANIZATION_ACTIVITY_FADE_DAYS = 30;

/** Activity changes on the same encoded frame as the cumulative count. */
export function organizationActivityOpacities(frameIndex: number, days: OrganizationProgressDay[]) {
  const frame = Math.max(0, Math.min(TIMING.frameCount - 1, Math.floor(frameIndex)));
  const latestFrames: Partial<Record<OrganizationKey, number>> = {};
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const landed = Math.ceil(contributionLandingSeconds(day.dayOrdinal, days.length) * FPS - 1e-8);
    if (landed > frame) continue;
    for (const { key } of VISIBLE_ORGANIZATION_GROUPS) {
      if ((day.cumulativeContributions[key] ?? 0)
        > (days[index - 1]?.cumulativeContributions[key]
          ?? days[0]?.prefilledContributions?.[key] ?? 0)) latestFrames[key] = landed;
    }
  }
  return Object.fromEntries(VISIBLE_ORGANIZATION_GROUPS.map(({ key }) => {
    const latest = latestFrames[key];
    const historicalOrdinal = days[0]?.prefilledLastActivityOrdinals?.[key];
    if (latest == null && historicalOrdinal == null) return [key, ORGANIZATION_ACTIVITY_MIN_OPACITY];
    const ageDays = latest == null
      ? Math.max(0, frame / FPS - TIMING.emptyPreRollSeconds)
        / TIMING.traversalSeconds * days.length - historicalOrdinal!
      : (frame - latest) / FPS / TIMING.traversalSeconds * days.length;
    const progress = Math.max(0, Math.min(1, ageDays / ORGANIZATION_ACTIVITY_FADE_DAYS));
    const eased = progress * progress * (3 - 2 * progress);
    return [key, 1 - (1 - ORGANIZATION_ACTIVITY_MIN_OPACITY) * eased];
  })) as Record<OrganizationKey, number>;
}
