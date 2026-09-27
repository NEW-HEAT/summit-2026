import {
  BufferTarget,
  CanvasSource,
  Output,
  WebMOutputFormat,
} from "mediabunny";
import {
  FPS,
  HEIGHT,
  WIDTH,
  type OrganizationKey,
} from "./calendar-model";
import type { ContributionFocusBeat } from "./globe-focus-model";
import type {
  OrganizationProgressDay,
  OrganizationShareSummary,
} from "./organization-share-model";
import { VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT } from "./vertical-calendar-model";
import { contributionLandingCounterFrame } from "./contribution-landing-counter";
import {
  organizationActivityOpacities,
  ORGANIZATION_ACTIVITY_MIN_OPACITY,
  ORGANIZATION_ACTIVITY_FADE_DAYS,
} from "./organization-activity-model";

export type ContributionOverlayKind = "combined" | "date" | "organizations" | "total";

const TIMECODE_BITRATE = 8_000_000;
export const RANGE_HOLD_FRACTION = 0.08;
export const RANGE_TO_CURRENT_DATE_END_FRACTION = 0.34;
export const OPENING_DATE_RANGE_LABEL = "JAN 01 2022–2023";

export const GEOGRAPHIC_MEMORY_TIMECODE_STYLE = {
  contentOffsetY: 52,
  dateCellWidth: 39,
  dateCellHeight: 84,
  dateCenterY: -112,
  dateFont: '600 60px "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
  organizationColumnWidth: 420,
  organizationRuleWidth: 148,
  organizationRuleY: -42,
  organizationLabelY: -10,
  organizationCountY: 52,
  organizationLabelFont: '700 28px "Helvetica Neue", Helvetica, Arial, sans-serif',
  organizationCountFont: '750 56px "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
} as const;

export type ContributionTimecodeFrame = {
  sectionIndex: number;
  sectionProgress: number;
  outgoingBeat: ContributionFocusBeat;
  incomingBeat: ContributionFocusBeat;
  reel: {
    outgoing: string;
    incoming: string;
    progress: number;
  };
  currentDate: string;
  nextDate: string;
  dateTransitionMode: "section-range-to-live-date" | "opening-range-to-live-calendar";
  cumulativeContributions: Partial<Record<OrganizationKey, number>>;
};

export async function encodeContributionGeographicMemoryTimecode(
  beats: ContributionFocusBeat[],
  organizationShares: OrganizationShareSummary[],
  organizationProgress: OrganizationProgressDay[],
  { frameCount = VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount, kind = "combined" }:
    { frameCount?: number; kind?: ContributionOverlayKind } = {},
) {
  const safeFrameCount = clamp(
    Math.floor(frameCount),
    1,
    VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount,
  );
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D alpha is required for the geographic-memory timecode.");

  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const source = new CanvasSource(canvas, {
    codec: "vp9",
    bitrate: TIMECODE_BITRATE,
    alpha: "keep",
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: safeFrameCount + 2 });
  await output.start();
  for (let frameIndex = 0; frameIndex < safeFrameCount; frameIndex += 1) {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    drawContributionOverlay(context, frameIndex, beats, organizationShares, organizationProgress, kind);
    await source.add(frameIndex / FPS, 1 / FPS, {
      keyFrame: frameIndex === 0 || frameIndex % (FPS * 2) === 0,
    });
    if (frameIndex % 240 === 0 || frameIndex === safeFrameCount - 1) {
      console.log(`CONTRIBUTION_GEOGRAPHIC_TIMECODE_RENDER_PROGRESS ${frameIndex + 1}/${safeFrameCount}`);
    }
  }
  await source.close();
  await output.finalize();
  if (!target.buffer) throw new Error("The geographic-memory timecode WebM buffer is empty.");
  const filename = `personal-github-contribution-${kind}.webm`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([target.buffer], { type: "video/webm" }));
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  return {
    frameCount: safeFrameCount,
    frameRate: FPS,
    durationSeconds: safeFrameCount / FPS,
    filename,
    dateMode: "opening-range-to-live-calendar" as const,
    openingRangeLabel: OPENING_DATE_RANGE_LABEL,
    calendarAlignment: "shared-day-count" as const,
    legendLayout: "one-organization-per-corner" as const,
    kind,
    initialTotal: contributionLandingCounterFrame(0, organizationProgress).total,
    finalTotal: contributionLandingCounterFrame(safeFrameCount - 1, organizationProgress).total,
    counterClock: "exact-circle-landing-frame" as const,
    organizationActivity: kind === "organizations" ? {
      minimumOpacity: ORGANIZATION_ACTIVITY_MIN_OPACITY,
      fadeCalendarDays: ORGANIZATION_ACTIVITY_FADE_DAYS,
      bottomAnchorY: organizationLegendCorner("visualpt")!.y,
      corners: ["new-heat", "visgl", "agriculture-intelligence", "visualpt"],
    } : null,
  };
}

export function drawContributionOverlay(
  context: CanvasRenderingContext2D,
  frameIndex: number,
  beats: ContributionFocusBeat[],
  shares: OrganizationShareSummary[],
  days: OrganizationProgressDay[],
  kind: ContributionOverlayKind = "combined",
) {
  const frame = contributionTimecodeFrame(frameIndex, beats, days);
  if (kind === "combined") {
    drawContributionGeographicMemoryTimecode(context, frame, shares);
  } else if (kind === "date") {
    context.save();
    // Same reel style, separate lower-center lane so it never covers the total.
    context.translate(0, HEIGHT - 100 - (HEIGHT / 2
      + GEOGRAPHIC_MEMORY_TIMECODE_STYLE.contentOffsetY
      + GEOGRAPHIC_MEMORY_TIMECODE_STYLE.dateCenterY));
    drawAnalogDateReel(context, frame.reel);
    context.restore();
  } else {
    const counter = contributionLandingCounterFrame(frameIndex, days);
    if (kind === "organizations") {
      drawOrganizationCumulativeLegend(context, {
        ...frame, cumulativeContributions: counter.cumulativeContributions,
      }, shares, organizationActivityOpacities(frameIndex, days));
    } else {
      drawContributionTotal(context, counter);
    }
  }
}

function drawContributionTotal(
  context: CanvasRenderingContext2D,
  counter: ReturnType<typeof contributionLandingCounterFrame>,
) {
  context.save();
  applyCaptionShadow(context);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = '750 96px "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
  context.fillStyle = "#ffffff";
  context.fillText(formatCount(counter.total), WIDTH / 2, HEIGHT / 2);
  for (const addition of counter.additions) {
    const [dx, dy] = addition.corner;
    const progress = addition.progress;
    context.globalAlpha = Math.min(1, (1 - progress) / 0.3);
    context.fillStyle = addition.color;
    context.font = '700 34px "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
    const label = `+${formatCount(addition.count)}`;
    const x = WIDTH / 2 + dx * (330 - 90 * progress);
    const y = HEIGHT / 2 + dy * (300 - 240 * progress);
    // Keep red-on-red arrivals (and blue-on-gray land) readable without
    // changing the organization's fill color or adding a label panel.
    context.strokeStyle = "rgba(0, 0, 0, 0.94)";
    context.lineWidth = 4;
    context.lineJoin = "round";
    context.strokeText(label, x, y);
    context.fillText(label, x, y);
  }
  context.restore();
}

export function contributionTimecodeFrame(
  frameIndex: number,
  beats: ContributionFocusBeat[],
  organizationProgress: OrganizationProgressDay[] = [],
): ContributionTimecodeFrame {
  if (beats.length === 0) throw new Error("Geographic-memory timecode requires focus beats.");
  const safeFrame = clamp(
    Math.floor(frameIndex),
    0,
    VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount - 1,
  );
  const elapsedSeconds = safeFrame / FPS;
  const hasCompleteLiveDateTimeline = organizationProgress.length >= beats.length;
  const hasFullPersonalContributionTimeline = isFullPersonalContributionTimeline(
    organizationProgress,
  );
  const traversalStartSeconds = hasCompleteLiveDateTimeline
    ? VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds
    : 0;
  const traversalSeconds = hasCompleteLiveDateTimeline
    ? VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.traversalSeconds
    : 58;
  const traversalProgress = clamp(
    (elapsedSeconds - traversalStartSeconds) / traversalSeconds,
    0,
    1,
  );
  const sectionPosition = Math.min(beats.length - Number.EPSILON, traversalProgress * beats.length);
  const sectionIndex = Math.min(beats.length - 1, Math.floor(sectionPosition));
  const sectionProgress = traversalProgress >= 1 ? 1 : sectionPosition - sectionIndex;
  const incomingBeat = beats[sectionIndex];
  const outgoingBeat = beats[Math.max(0, sectionIndex - 1)];
  const lastDayIndex = Math.max(organizationProgress.length - 1, 0);
  const currentDayPosition = Math.min(
    traversalProgress * organizationProgress.length,
    lastDayIndex,
  );
  const currentDayIndex = Math.min(
    Math.max(organizationProgress.length - 1, 0),
    Math.floor(currentDayPosition),
  );
  const nextDayIndex = Math.min(
    Math.max(organizationProgress.length - 1, 0),
    currentDayIndex + 1,
  );
  const currentDate = organizationProgress[currentDayIndex]?.date ?? incomingBeat.startDate;
  const nextDate = organizationProgress[nextDayIndex]?.date ?? currentDate;
  const currentDayProgress = currentDayPosition - currentDayIndex;
  const revealedDayCount = traversalProgress >= 1
    ? organizationProgress.length
    : Math.floor(traversalProgress * organizationProgress.length);
  const cumulativeContributions = revealedDayCount > 0
    ? organizationProgress[revealedDayCount - 1].cumulativeContributions
    : organizationProgress[0]?.prefilledContributions ?? {};
  const dateTransitionMode = hasFullPersonalContributionTimeline
    ? "opening-range-to-live-calendar"
    : "section-range-to-live-date";
  const reel = hasFullPersonalContributionTimeline
    ? openingRangeToLiveCalendarReel(
      currentDate,
      clamp(elapsedSeconds / traversalStartSeconds, 0, 1),
    )
    : rangeToCurrentDateReel(
      incomingBeat,
      currentDate,
      nextDate,
      currentDayProgress,
      sectionProgress,
    );
  return {
    sectionIndex,
    sectionProgress,
    outgoingBeat,
    incomingBeat,
    reel,
    currentDate,
    nextDate,
    dateTransitionMode,
    cumulativeContributions,
  };
}

export function openingRangeToLiveCalendarReel(
  currentDate: string,
  preRollProgress: number,
) {
  const liveDate = formatDateRange(dateMs(currentDate), dateMs(currentDate));
  const openingProgress = smootherstep(clamp(preRollProgress, 0, 1));
  if (openingProgress < 1) {
    return {
      outgoing: OPENING_DATE_RANGE_LABEL,
      incoming: liveDate,
      progress: openingProgress,
    };
  }
  return {
    outgoing: liveDate,
    incoming: liveDate,
    progress: 0,
  };
}

export function drawContributionGeographicMemoryTimecode(
  context: CanvasRenderingContext2D,
  frame: ContributionTimecodeFrame,
  organizationShares: OrganizationShareSummary[],
) {
  drawAnalogDateReel(context, frame.reel);
  drawOrganizationCumulativeLegend(context, frame, organizationShares);
}

export function rangeToCurrentDateReel(
  beat: ContributionFocusBeat,
  currentDate: string,
  nextDate: string,
  currentDayProgress: number,
  sectionProgress: number,
  openingRangeLabel?: string,
) {
  const range = openingRangeLabel
    ?? formatDateRange(dateMs(beat.startDate), dateMs(beat.endDate));
  const liveDate = formatDateRange(dateMs(currentDate), dateMs(currentDate));
  const followingDate = formatDateRange(dateMs(nextDate), dateMs(nextDate));
  const rangeToDateProgress = smootherstep(clamp(
    (sectionProgress - RANGE_HOLD_FRACTION)
      / (RANGE_TO_CURRENT_DATE_END_FRACTION - RANGE_HOLD_FRACTION),
    0,
    1,
  ));
  if (rangeToDateProgress < 1) {
    return {
      outgoing: range,
      incoming: liveDate,
      progress: rangeToDateProgress,
    };
  }
  return {
    outgoing: liveDate,
    incoming: followingDate,
    progress: smootherstep(clamp(currentDayProgress, 0, 1)),
  };
}

function isFullPersonalContributionTimeline(
  organizationProgress: OrganizationProgressDay[],
) {
  const firstDate = organizationProgress.at(0)?.date;
  const lastDate = organizationProgress.at(-1)?.date;
  return organizationProgress.length >= 365
    && firstDate?.startsWith("2023-") === true
    && lastDate != null
    && lastDate >= "2026-01-01";
}

function drawAnalogDateReel(
  context: CanvasRenderingContext2D,
  reel: ContributionTimecodeFrame["reel"],
) {
  const glyphs = alignedReelGlyphs(reel.outgoing, reel.incoming);
  const style = GEOGRAPHIC_MEMORY_TIMECODE_STYLE;
  const { dateCellWidth, dateCellHeight, dateCenterY, dateFont } = style;
  const boardWidth = glyphs.outgoing.length * dateCellWidth;
  const boardLeft = -boardWidth / 2;
  context.save();
  context.translate(WIDTH / 2, HEIGHT / 2 + style.contentOffsetY);
  context.fillStyle = "#ffffff";
  context.font = dateFont;
  context.textAlign = "center";
  context.textBaseline = "middle";
  applyCaptionShadow(context);
  for (let index = 0; index < glyphs.outgoing.length; index += 1) {
    const outgoing = glyphs.outgoing[index];
    const incoming = glyphs.incoming[index];
    const x = boardLeft + (index + 0.5) * dateCellWidth;
    if (outgoing === incoming) {
      context.globalAlpha = 0.98;
      context.fillText(outgoing, x, dateCenterY);
      continue;
    }
    const progress = analogGlyphProgress(reel.progress, index, glyphs.outgoing.length);
    const motion = forwardAnalogGlyphMotion(progress, dateCellHeight);
    context.save();
    context.beginPath();
    context.rect(
      boardLeft + index * dateCellWidth,
      dateCenterY - dateCellHeight / 2,
      dateCellWidth,
      dateCellHeight,
    );
    context.clip();
    context.globalAlpha = 0.98;
    context.fillText(outgoing, x, dateCenterY + motion.outgoingOffsetY);
    context.fillText(incoming, x, dateCenterY + motion.incomingOffsetY);
    context.restore();
  }
  context.restore();
}

function drawOrganizationCumulativeLegend(
  context: CanvasRenderingContext2D,
  frame: ContributionTimecodeFrame,
  shares: OrganizationShareSummary[],
  opacities: Partial<Record<OrganizationKey, number>> = {},
) {
  const style = GEOGRAPHIC_MEMORY_TIMECODE_STYLE;
  context.save();
  applyCaptionShadow(context);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  for (const share of shares) {
    const corner = organizationLegendCorner(share.key);
    if (!corner) continue;
    context.save();
    context.translate(corner.x, corner.y);
    const opacity = opacities[share.key] ?? 1;
    context.globalAlpha = opacity;
    context.fillStyle = share.color;
    context.fillRect(
      -style.organizationRuleWidth / 2,
      style.organizationRuleY,
      style.organizationRuleWidth,
      6,
    );
    context.globalAlpha = opacity;
    context.fillStyle = "#ffffff";
    context.font = style.organizationLabelFont;
    drawCenteredFittedTrackedText(
      context,
      organizationLegendDisplayLabel(share.key, share.label),
      style.organizationLabelY,
      1.2,
      style.organizationColumnWidth - 28,
    );
    context.globalAlpha = opacity;
    context.font = style.organizationCountFont;
    drawCenteredFittedTrackedText(
      context,
      formatCount(frame.cumulativeContributions[share.key] ?? 0),
      style.organizationCountY,
      0.2,
      style.organizationColumnWidth - 22,
    );
    context.restore();
  }
  context.restore();
}

export function organizationLegendCorner(key: OrganizationKey) {
  const left = 96 + GEOGRAPHIC_MEMORY_TIMECODE_STYLE.organizationColumnWidth / 2;
  const right = WIDTH - left;
  const top = 96;
  // Reserve the bottom 240 px, including shadow clearance, for CapCut's full timecode.
  const bottom = HEIGHT - 320;
  switch (key) {
    case "new-heat": return { corner: "top-left", x: left, y: top };
    case "agriculture-intelligence": return { corner: "bottom-left", x: left, y: bottom };
    case "visgl": return { corner: "top-right", x: right, y: top };
    case "visualpt": return { corner: "bottom-right", x: right, y: bottom };
    default: return null;
  }
}

export function organizationLegendDisplayLabel(key: OrganizationKey, fallback: string) {
  return key === "agriculture-intelligence" ? "AGINTEL" : fallback.toUpperCase();
}

function formatCount(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function alignedReelGlyphs(outgoing: string, incoming: string) {
  const length = Math.max(outgoing.length, incoming.length);
  const centerPad = (value: string) => {
    const missing = length - value.length;
    const left = Math.floor(missing / 2);
    return `${" ".repeat(left)}${value}${" ".repeat(missing - left)}`;
  };
  return { outgoing: centerPad(outgoing), incoming: centerPad(incoming) };
}

function analogGlyphProgress(reelProgress: number, glyphIndex: number, glyphCount: number) {
  const staggerSpan = 0.18;
  const order = glyphCount <= 1 ? 0 : glyphIndex / (glyphCount - 1);
  return smootherstep(clamp((reelProgress - order * staggerSpan) / (1 - staggerSpan), 0, 1));
}

export function forwardAnalogGlyphMotion(progress: number, travelPx: number) {
  const normalized = clamp(progress, 0, 1);
  return {
    outgoingOffsetY: -travelPx * normalized,
    incomingOffsetY: normalized === 1 ? 0 : travelPx * (1 - normalized),
  };
}

function formatDateRange(startMs: number, endMs: number) {
  const start = new Date(Math.min(startMs, endMs));
  const end = new Date(Math.max(startMs, endMs));
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const startMonth = monthName(start);
  const endMonth = monthName(end);
  const startDay = twoDigitDay(start);
  const endDay = twoDigitDay(end);
  if (
    startYear === endYear
    && start.getUTCMonth() === end.getUTCMonth()
    && start.getUTCDate() === end.getUTCDate()
  ) return `${startMonth} ${startDay} ${startYear}`;
  if (startYear === endYear && start.getUTCMonth() === end.getUTCMonth()) {
    return `${startMonth} ${startDay}–${endDay} ${startYear}`;
  }
  if (startYear === endYear) return `${startMonth} ${startDay}–${endMonth} ${endDay} ${startYear}`;
  return `${startMonth} ${startDay} ${startYear}–${endMonth} ${endDay} ${endYear}`;
}

function monthName(date: Date) {
  return date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
}

function twoDigitDay(date: Date) {
  return String(date.getUTCDate()).padStart(2, "0");
}

function dateMs(value: string) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function applyCaptionShadow(context: CanvasRenderingContext2D) {
  context.shadowColor = "rgba(0, 0, 0, 0.82)";
  context.shadowBlur = 16;
  context.shadowOffsetY = 2;
}

function drawCenteredFittedTrackedText(
  context: CanvasRenderingContext2D,
  value: string,
  y: number,
  tracking: number,
  maximumWidth: number,
) {
  const width = trackedTextWidth(context, value, tracking);
  if (width <= maximumWidth) {
    drawCenteredTrackedText(context, value, y, tracking);
    return;
  }
  context.save();
  context.scale(maximumWidth / width, 1);
  drawCenteredTrackedText(context, value, y, tracking);
  context.restore();
}

function drawCenteredTrackedText(
  context: CanvasRenderingContext2D,
  value: string,
  y: number,
  tracking: number,
) {
  let cursor = -trackedTextWidth(context, value, tracking) / 2;
  for (const character of value) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + tracking;
  }
}

function trackedTextWidth(context: CanvasRenderingContext2D, value: string, tracking: number) {
  let width = 0;
  for (const character of value) width += context.measureText(character).width;
  return width + Math.max(value.length - 1, 0) * tracking;
}

function smootherstep(value: number) {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * normalized * (normalized * (normalized * 6 - 15) + 10);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
