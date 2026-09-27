import {
  BufferTarget,
  CanvasSource,
  Output,
  WebMOutputFormat,
} from "mediabunny";
import {
  DURATION_SECONDS,
  FPS,
  FRAME_COUNT,
  HEIGHT,
  ORGANIZATION_GROUPS,
  VISIBLE_ORGANIZATION_GROUPS,
  WIDTH,
  buildOrganizationSlices,
  buildTrainFrameState,
  type ContinuousCalendar,
  type TrainFrameState,
} from "./calendar-model";
import { TIMECODE_EXCLUSION_BOUNDS } from "./timecode-track";

const LEGEND_BITRATE = 10_000_000;
const CHAPTER_DAYS = 90;
const MAX_NAMED_ROWS = 7;
const TRANSITION_DAYS = 10;
const UNATTRIBUTED_KEY = "__unattributed__";
const UNATTRIBUTED_COLOR = "#8b949e";
export const HEAT_WINDOW_DAYS = 90;
const RANK_EASING = 0.16;

export const LEGEND_BOUNDS = {
  x: 32,
  y: 28,
  width: 1856,
  height: 40,
} as const;
export const ORGANIZATION_LEGEND_STYLE = "bare-inline" as const;
export const LEGEND_LABEL_COUNT_GAP = 10;

const LEGACY_LEGEND_BOUNDS = {
  x: 1420,
  y: 56,
  width: 452,
  height: 282,
} as const;

export type LegendEntry = {
  key: string;
  label: string;
  count: number;
  color: string;
  visibility: "public" | "private" | "unattributed";
  heat?: number;
  rankPosition?: number;
};

export type DynamicLegendRow = {
  entry: LegendEntry;
  rankPosition: number;
  opacity: number;
  prominence: number;
};

export type LegendChapter = {
  index: number;
  startDate: string;
  endDate: string;
  entries: LegendEntry[];
  hiddenProjectCount: number;
  totalCount: number;
};

export type OrganizationLegendTimeline = {
  startDate: string;
  endDate: string;
  entriesByDay: LegendEntry[][];
};

export function buildLegendChapters(calendar: ContinuousCalendar): LegendChapter[] {
  const chapterCount = Math.ceil(calendar.dataDays.length / CHAPTER_DAYS);
  return Array.from({ length: chapterCount }, (_, index) => {
    const days = calendar.dataDays.slice(index * CHAPTER_DAYS, (index + 1) * CHAPTER_DAYS);
    const totals = new Map<string, { count: number; visibility: "public" | "private" }>();
    let unattributedCount = 0;
    for (const day of days) {
      unattributedCount += day.unattributedCount ?? 0;
      for (const project of day.projects ?? []) {
        const current = totals.get(project.repository) ?? { count: 0, visibility: project.visibility };
        current.count += project.count;
        totals.set(project.repository, current);
      }
    }
    const ranked = [...totals.entries()]
      .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]));
    const namedLimit = unattributedCount > 0 ? MAX_NAMED_ROWS - 1 : MAX_NAMED_ROWS;
    const entries: LegendEntry[] = ranked.slice(0, namedLimit).map(([repository, contribution]) => ({
      key: repository,
      label: formatRepositoryLabel(repository),
      count: contribution.count,
      color: calendar.projectColors[repository],
      visibility: contribution.visibility,
    }));
    if (unattributedCount > 0) {
      entries.push({
        key: UNATTRIBUTED_KEY,
        label: "Unattributed",
        count: unattributedCount,
        color: UNATTRIBUTED_COLOR,
        visibility: "unattributed",
      });
    }
    return {
      index,
      startDate: days[0].date,
      endDate: days.at(-1)!.date,
      entries,
      hiddenProjectCount: Math.max(0, ranked.length - namedLimit),
      totalCount: ranked.reduce((sum, [, contribution]) => sum + contribution.count, unattributedCount),
    };
  });
}

export function buildOrganizationLegendChapters(calendar: ContinuousCalendar): LegendChapter[] {
  const chapterCount = Math.ceil(calendar.dataDays.length / CHAPTER_DAYS);
  return Array.from({ length: chapterCount }, (_, index) => {
    const days = calendar.dataDays.slice(index * CHAPTER_DAYS, (index + 1) * CHAPTER_DAYS);
    const totals = new Map<string, number>(ORGANIZATION_GROUPS.map((group) => [group.key, 0]));
    for (const day of days) {
      for (const slice of buildOrganizationSlices(day)) {
        totals.set(slice.key, (totals.get(slice.key) ?? 0) + slice.count);
      }
    }
    const entries: LegendEntry[] = ORGANIZATION_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      count: totals.get(group.key) ?? 0,
      color: group.color,
      visibility: group.key === "misc" ? "unattributed" : "private",
    }));
    return {
      index,
      startDate: days[0].date,
      endDate: days.at(-1)!.date,
      entries,
      hiddenProjectCount: 0,
      totalCount: entries.reduce((sum, entry) => sum + entry.count, 0),
    };
  });
}

export function buildOrganizationLegendTimeline(calendar: ContinuousCalendar): OrganizationLegendTimeline {
  const totals = new Map<string, number>(ORGANIZATION_GROUPS.map((group) => [group.key, 0]));
  const heatTotals = new Map<string, number>(ORGANIZATION_GROUPS.map((group) => [group.key, 0]));
  const rankPositions = new Map<string, number>(ORGANIZATION_GROUPS.map((group, index) => [group.key, index]));
  const dailySlices: Map<string, number>[] = [];
  const entriesByDay = calendar.dataDays.map((day, dayIndex) => {
    const dayTotals = new Map<string, number>(ORGANIZATION_GROUPS.map((group) => [group.key, 0]));
    for (const slice of buildOrganizationSlices(day)) {
      totals.set(slice.key, (totals.get(slice.key) ?? 0) + slice.count);
      heatTotals.set(slice.key, (heatTotals.get(slice.key) ?? 0) + slice.count);
      dayTotals.set(slice.key, (dayTotals.get(slice.key) ?? 0) + slice.count);
    }
    dailySlices.push(dayTotals);
    const expired = dailySlices[dayIndex - HEAT_WINDOW_DAYS];
    if (expired) {
      for (const group of ORGANIZATION_GROUPS) {
        heatTotals.set(group.key, Math.max(0, (heatTotals.get(group.key) ?? 0) - (expired.get(group.key) ?? 0)));
      }
    }
    const entries = ORGANIZATION_GROUPS.map((group): LegendEntry => ({
      key: group.key,
      label: group.label,
      count: totals.get(group.key) ?? 0,
      color: group.color,
      visibility: group.key === "misc" ? "unattributed" : "private",
      heat: heatTotals.get(group.key) ?? 0,
    }));
    const targetRanks = new Map(rankLegendEntries(entries).map((entry, index) => [entry.key, index]));
    for (const entry of entries) {
      const previous = rankPositions.get(entry.key) ?? targetRanks.get(entry.key) ?? 0;
      const target = targetRanks.get(entry.key) ?? previous;
      const next = dayIndex === 0 ? target : previous + (target - previous) * RANK_EASING;
      rankPositions.set(entry.key, next);
      entry.rankPosition = next;
    }
    return entries;
  });
  return {
    startDate: calendar.dataDays[0].date,
    endDate: calendar.dataDays.at(-1)!.date,
    entriesByDay,
  };
}

export function rankLegendEntries(entries: LegendEntry[]) {
  const stableOrder = new Map<string, number>(ORGANIZATION_GROUPS.map((group, index) => [group.key, index]));
  return [...entries].sort((left, right) => (right.heat ?? 0) - (left.heat ?? 0)
    || right.count - left.count
    || (stableOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER) - (stableOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER));
}

export function getDynamicLegendRows(
  state: TrainFrameState,
  timeline: OrganizationLegendTimeline,
): DynamicLegendRow[] {
  if (state.currentDayOrdinal < 0) {
    return VISIBLE_ORGANIZATION_GROUPS.map((group, rankPosition): DynamicLegendRow => ({
      entry: {
        key: group.key,
        label: group.label,
        count: 0,
        color: group.color,
        visibility: "private",
        heat: 0,
      },
      rankPosition,
      opacity: 1,
      prominence: rankPosition === 0 ? 1 : 0,
    }));
  }
  const currentIndex = Math.max(0, Math.min(timeline.entriesByDay.length - 1, Math.floor(state.currentDayOrdinal)));
  const rankingIndex = Math.max(0, Math.min(timeline.entriesByDay.length - 1, state.sectionEndOrdinal));
  const current = new Map(timeline.entriesByDay[currentIndex].map((entry) => [entry.key, entry]));
  const ranking = rankLegendEntries(timeline.entriesByDay[rankingIndex]
    .filter((entry) => VISIBLE_ORGANIZATION_GROUPS.some((group) => group.key === entry.key)));
  const rankByKey = new Map(ranking.map((entry, index) => [entry.key, index]));
  return VISIBLE_ORGANIZATION_GROUPS.map((group): DynamicLegendRow => {
    const entry = current.get(group.key)!;
    const rankPosition = rankByKey.get(group.key) ?? 0;
    return {
      entry,
      rankPosition,
      opacity: 1,
      prominence: rankPosition === 0 ? 1 : 0,
    };
  });
}

export function getLegendFrameState(
  state: TrainFrameState,
  chapters: LegendChapter[],
) {
  const chapterIndex = Math.min(chapters.length - 1, Math.floor(state.currentDayOrdinal / CHAPTER_DAYS));
  const chapterDay = state.currentDayOrdinal - chapterIndex * CHAPTER_DAYS;
  const transition = chapterIndex === 0 ? 1 : smoothstep(0, TRANSITION_DAYS, chapterDay);
  return {
    chapterIndex,
    current: chapters[chapterIndex],
    previous: chapterIndex > 0 ? chapters[chapterIndex - 1] : null,
    transition,
  };
}

export function drawLegend(
  context: CanvasRenderingContext2D,
  state: TrainFrameState,
  chapters: LegendChapter[],
) {
  const legendState = getLegendFrameState(state, chapters);
  if (legendState.previous && legendState.transition < 1) {
    drawLegendPanel(context, legendState.previous, 1 - legendState.transition, -8 * legendState.transition);
    drawLegendPanel(context, legendState.current, legendState.transition, 8 * (1 - legendState.transition));
    return;
  }
  drawLegendPanel(context, legendState.current, 1, 0);
}

export function drawOrganizationLegend(
  context: CanvasRenderingContext2D,
  state: TrainFrameState,
  timeline: OrganizationLegendTimeline,
) {
  drawDynamicOrganizationLegendPanel(context, getDynamicLegendRows(state, timeline));
}

export async function encodeLegendTrack(
  calendar: ContinuousCalendar,
  buildFrameState: (frameIndex: number, calendar: ContinuousCalendar) => TrainFrameState = buildTrainFrameState,
  timing: { frameCount: number; durationSeconds: number } = {
    frameCount: FRAME_COUNT,
    durationSeconds: DURATION_SECONDS,
  },
) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D alpha is required for the legend track.");
  const timeline = buildOrganizationLegendTimeline(calendar);

  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const source = new CanvasSource(canvas, {
    codec: "vp9",
    bitrate: LEGEND_BITRATE,
    alpha: "keep",
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: timing.frameCount + 2 });
  await output.start();

  let firstState = buildFrameState(0, calendar);
  let lastState = firstState;
  for (let frameIndex = 0; frameIndex < timing.frameCount; frameIndex += 1) {
    const state = buildFrameState(frameIndex, calendar);
    if (frameIndex === 0) firstState = state;
    lastState = state;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    drawOrganizationLegend(context, state, timeline);
    await source.add(frameIndex / FPS, 1 / FPS, {
      keyFrame: frameIndex === 0 || frameIndex % (FPS * 2) === 0,
    });
    if (frameIndex % 240 === 0 || frameIndex === timing.frameCount - 1) {
      console.log(`CONTRIBUTION_LEGEND_RENDER_PROGRESS ${frameIndex + 1}/${timing.frameCount}`);
    }
  }

  await source.close();
  await output.finalize();
  if (!target.buffer) throw new Error("The encoded legend WebM buffer is empty.");
  const filename = "personal-github-contribution-project-legend.webm";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([target.buffer], { type: "video/webm" }));
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  return {
    frameCount: timing.frameCount,
    frameRate: FPS,
    durationSeconds: timing.durationSeconds,
    filename,
    counterMode: "cumulative-to-date",
    dayCount: timeline.entriesByDay.length,
    firstState,
    lastState,
  };
}

export function legendDoesNotOverlapTimecode() {
  return !rectanglesOverlap(LEGEND_BOUNDS, TIMECODE_EXCLUSION_BOUNDS);
}

function drawLegendPanel(
  context: CanvasRenderingContext2D,
  chapter: LegendChapter,
  opacity: number,
  offsetY: number,
) {
  const { x, y, width, height } = LEGACY_LEGEND_BOUNDS;
  context.save();
  context.globalAlpha = opacity;
  context.translate(0, offsetY);

  context.fillStyle = "rgba(8,12,18,0.78)";
  context.strokeStyle = "rgba(255,255,255,0.18)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(x, y, width, height, 24);
  context.fill();
  context.stroke();

  context.textBaseline = "middle";
  context.fillStyle = "rgba(255,255,255,0.94)";
  context.font = '700 24px "Helvetica Neue", Helvetica, Arial, sans-serif';
  context.fillText("ORGANIZATIONS", x + 28, y + 34);
  context.textAlign = "right";
  context.fillStyle = "rgba(255,255,255,0.56)";
  context.font = '600 17px "Helvetica Neue", Helvetica, Arial, sans-serif';
  context.fillText("TO DATE", x + width - 28, y + 34);
  context.textAlign = "left";

  context.fillStyle = "rgba(255,255,255,0.12)";
  context.fillRect(x + 28, y + 60, width - 56, 1);

  const rowStartY = y + 89;
  const rowHeight = 43;
  for (let index = 0; index < chapter.entries.length; index += 1) {
    const entry = chapter.entries[index];
    const centerY = rowStartY + index * rowHeight;
    context.fillStyle = entry.color;
    context.beginPath();
    context.roundRect(x + 28, centerY - 10, 20, 20, 5);
    context.fill();
    context.strokeStyle = "rgba(255,255,255,0.28)";
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = "rgba(255,255,255,0.92)";
    context.font = '600 22px "Helvetica Neue", Helvetica, Arial, sans-serif';
    context.fillText(entry.label, x + 64, centerY);
    context.textAlign = "right";
    context.fillStyle = "rgba(255,255,255,0.62)";
    context.font = '600 19px "Helvetica Neue", Helvetica, Arial, sans-serif';
    context.fillText(formatCount(entry.count), x + width - 28, centerY);
    context.textAlign = "left";
  }

  if (chapter.hiddenProjectCount > 0) {
    context.fillStyle = "rgba(255,255,255,0.48)";
    context.font = '500 17px "Helvetica Neue", Helvetica, Arial, sans-serif';
    context.fillText(`+ ${chapter.hiddenProjectCount} more projects`, x + 28, y + height - 24);
  }
  context.restore();
}

function drawDynamicOrganizationLegendPanel(
  context: CanvasRenderingContext2D,
  rows: DynamicLegendRow[],
) {
  const { x, y, width, height } = LEGEND_BOUNDS;
  const rankedRows = [...rows].sort((left, right) => left.rankPosition - right.rankPosition);
  const columnWidth = width / rankedRows.length;
  context.save();
  context.textBaseline = "middle";
  const centerY = y + height / 2;
  context.shadowColor = "rgba(0,0,0,0.92)";
  context.shadowBlur = 8;
  for (let index = 0; index < rankedRows.length; index += 1) {
    const row = rankedRows[index];
    const columnX = x + index * columnWidth;
    const swatchSize = 12;
    context.fillStyle = row.entry.color;
    context.beginPath();
    context.roundRect(columnX, centerY - swatchSize / 2, swatchSize, swatchSize, 3);
    context.fill();

    context.fillStyle = "rgba(255,255,255,0.88)";
    context.font = '500 16px "Helvetica Neue", Helvetica, Arial, sans-serif';
    const labelX = columnX + 24;
    context.fillText(row.entry.label, labelX, centerY);
    const labelWidth = context.measureText(row.entry.label).width;
    context.fillStyle = "rgba(255,255,255,0.62)";
    context.font = '600 15px "Helvetica Neue", Helvetica, Arial, sans-serif';
    context.fillText(
      formatCount(row.entry.count),
      Math.min(labelX + labelWidth + LEGEND_LABEL_COUNT_GAP, columnX + columnWidth - 48),
      centerY,
    );
  }
  context.restore();
}

function formatRepositoryLabel(repository: string) {
  const name = repository.split("/").at(-1) ?? repository;
  if (name.length <= 25) return name;
  return `${name.slice(0, 23)}…`;
}

function formatCount(value: number) {
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}
