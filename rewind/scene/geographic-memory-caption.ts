export type GeographicMemoryLocation = {
  cityOrRegion: string;
  state: string | null;
  country: string;
  label: string;
};

export type GeographicMemoryDateRange = {
  targetMs: number;
  sourceMs: number;
};

export type ReverseTimeCaptionLayerMotion = {
  opacity: number;
  offsetY: number;
  scale: number;
  blurPx: number;
};

export type ReverseTimeCaptionMotion = {
  progress: number;
  outgoing: ReverseTimeCaptionLayerMotion;
  incoming: ReverseTimeCaptionLayerMotion;
};

export type AnalogDateReelFrame = {
  outgoing: string;
  incoming: string;
  progress: number;
  stepIndex: number;
  stepCount: number;
};

export type ReverseAnalogGlyphMotion = {
  outgoingOffsetY: number;
  incomingOffsetY: number;
};

export type GeographicMemoryLocationDisplay = {
  primary: string;
  secondary: string;
};

export type MemoryLocationTransitionMotion = {
  outgoingOpacity: number;
  outgoingOffsetY: number;
  incomingOpacity: number;
  incomingOffsetY: number;
};

const CAPTION_TRANSITION_START = 0.12;
const CAPTION_TRANSITION_END = 0.88;
const CAPTION_TRAVEL_PX = 112;
const LOCATION_OUT_START = 0.04;
const LOCATION_OUT_END = 0.16;
const LOCATION_IN_START = 0.14;
const LOCATION_IN_END = 0.22;
const LOCATION_TRANSITION_TRAVEL_PX = 24;
const DAY_MS = 86_400_000;

export function formatMemoryDateRange(
  range: GeographicMemoryDateRange
): string {
  const start = new Date(Math.min(range.targetMs, range.sourceMs));
  const end = new Date(Math.max(range.targetMs, range.sourceMs));
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const startMonth = monthName(start);
  const endMonth = monthName(end);
  const startDay = twoDigitDay(start);
  const endDay = twoDigitDay(end);

  if (
    startYear === endYear &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate()
  ) {
    return `${startMonth} ${startDay} ${startYear}`;
  }
  if (startYear === endYear && start.getUTCMonth() === end.getUTCMonth()) {
    return `${startMonth} ${startDay}–${endDay} ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth} ${startDay}–${endMonth} ${endDay} ${startYear}`;
  }
  return `${startMonth} ${startDay} ${startYear}–${endMonth} ${endDay} ${endYear}`;
}

export function formatMemorySingleDate(value: number): string {
  const date = new Date(value);
  return `${monthName(date)} ${twoDigitDay(date)} ${date.getUTCFullYear()}`;
}

export function formatAnalogMemoryDateRange(
  range: GeographicMemoryDateRange
): string {
  return formatMemoryDateRange(range);
}

export function formatReverseAnalogMemoryDateRange(
  range: GeographicMemoryDateRange
): string {
  const earlier = new Date(Math.min(range.targetMs, range.sourceMs));
  const later = new Date(Math.max(range.targetMs, range.sourceMs));
  const earlierLabel = `${monthName(earlier)} ${twoDigitDay(earlier)} ${earlier.getUTCFullYear()}`;
  const laterLabel = `${monthName(later)} ${twoDigitDay(later)} ${later.getUTCFullYear()}`;
  return `${laterLabel} → ${earlierLabel}`;
}

export function analogDateReelFrame(
  outgoingRange: GeographicMemoryDateRange,
  incomingRange: GeographicMemoryDateRange,
  cycleProgress: number
): AnalogDateReelFrame {
  return buildAnalogDateReelFrame(
    outgoingRange,
    incomingRange,
    cycleProgress,
    formatAnalogMemoryDateRange
  );
}

export function reverseAnalogDateReelFrame(
  outgoingRange: GeographicMemoryDateRange,
  incomingRange: GeographicMemoryDateRange,
  cycleProgress: number
): AnalogDateReelFrame {
  return buildAnalogDateReelFrame(
    outgoingRange,
    incomingRange,
    cycleProgress,
    formatReverseAnalogMemoryDateRange
  );
}

function buildAnalogDateReelFrame(
  outgoingRange: GeographicMemoryDateRange,
  incomingRange: GeographicMemoryDateRange,
  cycleProgress: number,
  formatter: (range: GeographicMemoryDateRange) => string
): AnalogDateReelFrame {
  const outgoing = orderedRange(outgoingRange);
  const incoming = orderedRange(incomingRange);
  const distanceDays =
    Math.max(
      Math.abs(incoming.startMs - outgoing.startMs),
      Math.abs(incoming.endMs - outgoing.endMs)
    ) / DAY_MS;
  const stepCount = Math.round(clamp(distanceDays / 32, 4, 9));
  const transition = reverseTimeCaptionTransitionProgress(cycleProgress);
  const scaled = transition * stepCount;
  const stepIndex = Math.min(Math.floor(scaled), stepCount - 1);
  const progress = smootherstep(clamp(scaled - stepIndex, 0, 1));
  const outgoingStep = stepIndex / stepCount;
  const incomingStep = (stepIndex + 1) / stepCount;
  return {
    outgoing: formatter({
      targetMs: mixUtcDay(outgoing.startMs, incoming.startMs, outgoingStep),
      sourceMs: mixUtcDay(outgoing.endMs, incoming.endMs, outgoingStep),
    }),
    incoming: formatter({
      targetMs: mixUtcDay(outgoing.startMs, incoming.startMs, incomingStep),
      sourceMs: mixUtcDay(outgoing.endMs, incoming.endMs, incomingStep),
    }),
    progress,
    stepIndex,
    stepCount,
  };
}

export function analogGlyphProgress(
  reelProgress: number,
  glyphIndex: number,
  glyphCount: number
): number {
  const staggerSpan = 0.18;
  const order = glyphCount <= 1 ? 0 : glyphIndex / (glyphCount - 1);
  return smootherstep(
    clamp((reelProgress - order * staggerSpan) / (1 - staggerSpan), 0, 1)
  );
}

export function reverseAnalogGlyphMotion(
  progress: number,
  travelPx: number
): ReverseAnalogGlyphMotion {
  const normalizedProgress = clamp(progress, 0, 1);
  return {
    outgoingOffsetY: travelPx * normalizedProgress,
    incomingOffsetY:
      normalizedProgress === 1 ? 0 : -travelPx * (1 - normalizedProgress),
  };
}

export function formatMemoryLocationDisplay(
  location: GeographicMemoryLocation
): GeographicMemoryLocationDisplay {
  const sourcePrimary = location.cityOrRegion.trim();
  const editorial = editorialLocationDisplay(sourcePrimary);
  const primary = editorial?.primary ?? sourcePrimary;
  const state = editorial?.state ?? location.state?.trim() ?? "";
  const country = editorial?.country ?? location.country.trim();
  const secondary = [
    state && !samePlaceLevel(primary, state) ? state : null,
    country && !samePlaceLevel(primary, country) ? country : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  return { primary, secondary };
}

export function memoryLocationTransitionMotion(
  cycleProgress: number
): MemoryLocationTransitionMotion {
  const outgoingProgress = smootherstep(
    clamp(
      (cycleProgress - LOCATION_OUT_START) /
        (LOCATION_OUT_END - LOCATION_OUT_START),
      0,
      1
    )
  );
  const incomingProgress = smootherstep(
    clamp(
      (cycleProgress - LOCATION_IN_START) /
        (LOCATION_IN_END - LOCATION_IN_START),
      0,
      1
    )
  );
  return {
    outgoingOpacity: 1 - outgoingProgress,
    outgoingOffsetY: -LOCATION_TRANSITION_TRAVEL_PX * outgoingProgress,
    incomingOpacity: incomingProgress,
    incomingOffsetY: LOCATION_TRANSITION_TRAVEL_PX * (1 - incomingProgress),
  };
}

export function reverseTimeCaptionTransitionProgress(
  cycleProgress: number
): number {
  const normalized = clamp(
    (cycleProgress - CAPTION_TRANSITION_START) /
      (CAPTION_TRANSITION_END - CAPTION_TRANSITION_START),
    0,
    1
  );
  return smootherstep(normalized);
}

export function reverseTimeCaptionMotion(
  cycleProgress: number
): ReverseTimeCaptionMotion {
  const progress = reverseTimeCaptionTransitionProgress(cycleProgress);
  return {
    progress,
    outgoing: {
      opacity: 1 - progress,
      offsetY: -CAPTION_TRAVEL_PX * progress,
      scale: 1 - 0.03 * progress,
      blurPx: 1.4 * progress,
    },
    incoming: {
      opacity: progress,
      offsetY: CAPTION_TRAVEL_PX * (1 - progress),
      scale: 0.97 + 0.03 * progress,
      blurPx: 1.4 * (1 - progress),
    },
  };
}

export function parseMapboxMemoryLocation(
  response: unknown
): GeographicMemoryLocation | null {
  if (!response || typeof response !== "object") return null;
  const features = Reflect.get(response, "features");
  if (!Array.isArray(features)) return null;

  const country = contextName(features, "country");
  const state = contextName(features, "region");
  const city =
    contextName(features, "place") ??
    contextName(features, "locality") ??
    contextName(features, "district");
  const cityOrRegion = city ?? state ?? country;
  if (!country || !cityOrRegion) return null;
  const parts = city
    ? [city, state, country].filter((value): value is string => Boolean(value))
    : [cityOrRegion, country];
  return {
    cityOrRegion,
    state: city ? state : null,
    country,
    label: parts.join(", "),
  };
}

function contextName(
  features: readonly unknown[],
  type: "country" | "district" | "locality" | "place" | "region"
): string | null {
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const properties = Reflect.get(feature, "properties");
    if (!properties || typeof properties !== "object") continue;
    const context = Reflect.get(properties, "context");
    if (!context || typeof context !== "object") continue;
    const entry = Reflect.get(context, type);
    if (!entry || typeof entry !== "object") continue;
    const value =
      Reflect.get(entry, "name_preferred") ?? Reflect.get(entry, "name");
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const properties = Reflect.get(feature, "properties");
    if (!properties || typeof properties !== "object") continue;
    if (Reflect.get(properties, "feature_type") !== type) continue;
    const value =
      Reflect.get(properties, "name_preferred") ??
      Reflect.get(properties, "name");
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function monthName(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase();
}

function twoDigitDay(date: Date): string {
  return String(date.getUTCDate()).padStart(2, "0");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function orderedRange(range: GeographicMemoryDateRange): {
  startMs: number;
  endMs: number;
} {
  return {
    startMs: Math.min(range.targetMs, range.sourceMs),
    endMs: Math.max(range.targetMs, range.sourceMs),
  };
}

function mixUtcDay(startMs: number, endMs: number, amount: number): number {
  return Math.round((startMs + (endMs - startMs) * amount) / DAY_MS) * DAY_MS;
}

function samePlaceLevel(left: string, right: string): boolean {
  const a = normalizePlaceLevel(left);
  const b = normalizePlaceLevel(right);
  if (a === b) return true;
  return Math.max(a.length, b.length) <= 5 && editDistance(a, b) <= 1;
}

function normalizePlaceLevel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function editorialLocationDisplay(
  sourcePrimary: string
): { primary: string; state?: string; country?: string } | null {
  switch (normalizePlaceLevel(sourcePrimary)) {
    case "ponteareas":
      return { primary: "Vigo", state: "Pontevedra", country: "Spain" };
    case "westminster":
      return {
        primary: "Denver",
        state: "Colorado",
        country: "United States",
      };
    case "boyntonbeach":
      return {
        primary: "Palm Beach",
        state: "Florida",
        country: "United States",
      };
    case "lahonda":
      return {
        primary: "Palo Alto",
        state: "California",
        country: "United States",
      };
    case "angered":
      return { primary: "Gothenburg" };
    case "irving":
      return { primary: "Dallas Fort Worth" };
    case "smyrna":
      return { primary: "Atlanta" };
    case "illescas":
      return { primary: "Madrid", state: "", country: "Spain" };
    case "roelofarendsveen":
    case "roelofarnesdsveen":
      return { primary: "Delft" };
    default:
      return null;
  }
}

function editDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}
