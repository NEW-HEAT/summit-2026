export type RouteRgba = [number, number, number, number];

// Keep this palette in lockstep with src/constants.ts ACTIVITY_COLORS and
// src/studio/studioMapColors.ts. The scene is intentionally standalone, so it
// carries the render-safe subset instead of importing the app's environmentful
// constants module into the browser capture runtime.
export const NEWHEAT_ACTIVITY_COLORS = Object.freeze({
  AlpineSki: "#8a2be2",
  BackcountrySki: "#4b0082",
  Boat: "#7dd3fc",
  Bus: "#00a6fb",
  Canoeing: "#8b4513",
  Crossfit: "#808080",
  Drive: "#7c5cff",
  EBikeRide: "#ffdf00",
  Elliptical: "#c0c0c0",
  Flight: "#00ff7f",
  Golf: "#228b22",
  Handcycle: "#4682b4",
  Hike: "#228b22",
  Hiking: "#228b22",
  IceSkate: "#add8e6",
  InlineSkate: "#87cefa",
  Kayaking: "#00bfff",
  Kitesurf: "#1e90ff",
  NordicSki: "#8a2be2",
  Ride: "#ffa500",
  Cycling: "#ffa500",
  Biking: "#ffa500",
  RockClimbing: "#8b4513",
  RollerSki: "#9370db",
  Rowing: "#4682b4",
  Run: "#ff4500",
  Running: "#ff4500",
  Sail: "#00bfff",
  Skateboard: "#a0522d",
  Snowboard: "#6495ed",
  Snowshoe: "#483d8b",
  Soccer: "#228b22",
  StairStepper: "#c0c0c0",
  StandUpPaddling: "#00ced1",
  Surfing: "#00ffff",
  Swim: "#40e0d0",
  Swimming: "#40e0d0",
  Train: "#d946ef",
  Velomobile: "#ff8c00",
  VirtualRide: "#90ee90",
  VirtualRun: "#fa8072",
  Walk: "#4CAF50",
  WeightTraining: "#8b0000",
  Wheelchair: "#696969",
  Windsurf: "#1e90ff",
  Workout: "#4b0082",
  Yoga: "#da70d6",
  Other: "#FF6B35",
});

type NewheatActivityType = keyof typeof NEWHEAT_ACTIVITY_COLORS;

const STUDIO_MAP_OVERRIDES: Partial<Record<NewheatActivityType, string>> = {
  Swim: "#2f9bff",
  Swimming: "#2f9bff",
};

export function resolveNewheatRouteColor(
  rawActivityType: string,
  alpha = 255
): RouteRgba {
  const activityType = normalizeNewheatActivityType(rawActivityType);
  return hexToRgba(
    STUDIO_MAP_OVERRIDES[activityType] ??
      NEWHEAT_ACTIVITY_COLORS[activityType] ??
      NEWHEAT_ACTIVITY_COLORS.Other,
    alpha
  );
}

export function normalizeNewheatActivityType(
  rawActivityType: string
): NewheatActivityType {
  const normalized = rawActivityType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");

  if (
    !normalized ||
    /^(activity|generic|unknown|multi_sport)$/.test(normalized)
  )
    return "Other";
  if (/^transition_?\d*(?:_v\d+)?$/.test(normalized)) return "Other";
  if (/stand_?up_?paddle|paddleboard|^sup$/.test(normalized))
    return "StandUpPaddling";
  if (/open_?water_?swim|swim|pool|freestyle|backstroke/.test(normalized))
    return "Swim";
  if (/run|jog|sprint|marathon|treadmill|trail_run/.test(normalized))
    return "Run";
  if (/e_?bike|ebike|electric_?bike|pedal_?assist/.test(normalized))
    return "EBikeRide";
  if (/bike|biking|cycl|ride|mtb|gravel|velomobile/.test(normalized))
    return "Ride";
  if (/hike|hiking|trek|backpack|mountaineer/.test(normalized)) return "Hike";
  if (/walk|stroll|ramble/.test(normalized)) return "Walk";
  if (/snowboard/.test(normalized)) return "Snowboard";
  if (/backcountry_?ski|touring_?ski/.test(normalized)) return "BackcountrySki";
  if (/nordic|cross_?country|xc_?ski/.test(normalized)) return "NordicSki";
  if (/ski/.test(normalized)) return "AlpineSki";
  if (/row|rowing|crew|sculling/.test(normalized)) return "Rowing";
  if (/kayak|canoe|paddle/.test(normalized)) return "Kayaking";
  if (/sail/.test(normalized)) return "Sail";
  if (/boat|ferry/.test(normalized)) return "Boat";
  if (/train|rail|subway|metro/.test(normalized)) return "Train";
  if (/bus|coach|shuttle/.test(normalized)) return "Bus";
  if (/drive|car_?trip|road_?trip/.test(normalized)) return "Drive";
  if (/surf/.test(normalized)) return "Surfing";
  if (/soccer|football/.test(normalized)) return "Soccer";

  const direct = Object.keys(NEWHEAT_ACTIVITY_COLORS).find(
    (key) => key.toLowerCase() === normalized.replaceAll("_", "")
  );
  return (direct as NewheatActivityType | undefined) ?? "Other";
}

function hexToRgba(hex: string, alpha: number): RouteRgba {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    clampByte(alpha),
  ];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
