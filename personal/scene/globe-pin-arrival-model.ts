import type { ContributionImpact } from "./globe-impact-model";
import { CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX } from "./globe-camera-model";

export const CONTRIBUTION_PIN_ARRIVAL_FRACTION = 0.62;
export const CONTRIBUTION_PIN_ARRIVAL_MAX_RADIUS = CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX / 2;
export const CONTRIBUTION_PIN_ARRIVAL_HOLD_FRACTION = 0.12;
export const CONTRIBUTION_PIN_RECESSION_EXPONENT = 5;
export const CONTRIBUTION_PIN_TRAIL_LENGTH = 0.34;

export function contributionEntryCorner(organizationIndex: number) {
  // VISIBLE_ORGANIZATION_GROUPS order: NEW HEAT, AGINTEL, VISUALPT, VIS.GL.
  // Match the organization legend, including the separate landing +X positions.
  return ([[-1, -1], [-1, 1], [1, 1], [1, -1]] as const)[
    Math.max(0, Math.min(3, organizationIndex))
  ];
}

export function contributionPinPathPosition(
  organizationIndex: number,
  target: [number, number],
  viewport: { width: number; height: number },
  progress: number,
): [number, number] {
  const [dx, dy] = contributionEntryCorner(organizationIndex);
  const start: [number, number] = [
    dx < 0 ? -180 : viewport.width + 180,
    dy < 0 ? -180 : viewport.height + 180,
  ];
  const eased = 1 - (1 - Math.max(0, Math.min(1, progress))) ** 3;
  const chord = [target[0] - start[0], target[1] - start[1]];
  // Bank in from the side of the frame, then curve into the geographic pin.
  // Mirrored control points keep all four approaches coherent without loops.
  const bow = [-chord[1] * dx * dy, chord[0] * dx * dy];
  const first = start.map((value, axis) => value + chord[axis] * 0.26 + bow[axis] * 0.30);
  const second = target.map((value, axis) => value - chord[axis] * 0.18 + bow[axis] * 0.14);
  const remaining = 1 - eased;
  return [
    remaining ** 3 * start[0] + 3 * remaining ** 2 * eased * first[0]
      + 3 * remaining * eased ** 2 * second[0] + eased ** 3 * target[0],
    remaining ** 3 * start[1] + 3 * remaining ** 2 * eased * first[1]
      + 3 * remaining * eased ** 2 * second[1] + eased ** 3 * target[1],
  ];
}

export function contributionPinTrail(
  impact: ContributionImpact,
  target: [number, number],
  viewport: { width: number; height: number },
) {
  const progress = impact.progress / CONTRIBUTION_PIN_ARRIVAL_FRACTION;
  if (progress >= 1 + CONTRIBUTION_PIN_TRAIL_LENGTH) return null;
  const samples = Array.from({ length: 49 }, (_, index) => index / 48);
  return {
    id: impact.id,
    path: samples.map((sample) => contributionPinPathPosition(
      impact.organizationIndex, target, viewport, sample,
    )),
    // Small relative times keep TripsLayer's float32 timestamps precise.
    timestamps: samples.map((sample) => 1 + sample - progress),
    color: [...impact.organizationColor, 235] as [number, number, number, number],
  };
}

/** Native TripsLayer segments taper from a narrow wake to a bright moving head. */
export function contributionPinTrailSegments(trail: NonNullable<ReturnType<typeof contributionPinTrail>>) {
  return trail.path.slice(1).flatMap((end, index) => {
    const beginTime = trail.timestamps[index];
    const endTime = trail.timestamps[index + 1];
    if (beginTime > 1 || endTime < 1 - CONTRIBUTION_PIN_TRAIL_LENGTH) return [];
    const headness = Math.max(0, Math.min(1,
      1 - (1 - Math.min(1, (beginTime + endTime) / 2)) / CONTRIBUTION_PIN_TRAIL_LENGTH,
    ));
    return [{
      id: `${trail.id}:${index}`,
      path: [trail.path[index], end],
      timestamps: [beginTime, endTime],
      color: trail.color,
      width: 0.6 + 7.4 * headness ** 1.5,
    }];
  });
}

/** A screen-space approach keeps the camera and geographic destination fixed. */
export function contributionPinArrival(
  impact: ContributionImpact,
  target: [number, number],
  viewport: { width: number; height: number },
) {
  if (impact.progress >= CONTRIBUTION_PIN_ARRIVAL_FRACTION) return null;
  const progress = Math.max(0, impact.progress / CONTRIBUTION_PIN_ARRIVAL_FRACTION);
  const radiusStart = CONTRIBUTION_PIN_ARRIVAL_MAX_RADIUS;
  const radiusEnd = 6 + 2.5 * impact.intensity;
  const recessionProgress = Math.max(
    0,
    (progress - CONTRIBUTION_PIN_ARRIVAL_HOLD_FRACTION)
      / (1 - CONTRIBUTION_PIN_ARRIVAL_HOLD_FRACTION),
  );
  return {
    id: impact.id,
    position: contributionPinPathPosition(impact.organizationIndex, target, viewport, progress),
    target,
    radius: radiusEnd + (radiusStart - radiusEnd)
      * (1 - recessionProgress) ** CONTRIBUTION_PIN_RECESSION_EXPONENT,
    color: [...impact.organizationColor, 255] as [number, number, number, number],
  };
}

export function contributionPinLandingImpact(impact: ContributionImpact) {
  if (impact.progress < CONTRIBUTION_PIN_ARRIVAL_FRACTION) return null;
  return {
    ...impact,
    progress: (impact.progress - CONTRIBUTION_PIN_ARRIVAL_FRACTION)
      / (1 - CONTRIBUTION_PIN_ARRIVAL_FRACTION),
  };
}
