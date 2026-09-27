import {
  DURATION_SECONDS,
  FPS,
  FRAME_COUNT,
  HEIGHT,
  SECTION_COUNT,
  TRAVERSAL_SECONDS,
  WIDTH,
  addDays,
  formatDate,
  parseDate,
  type CalendarCell,
  type ContinuousCalendar,
  type TrainFrameState,
} from "./calendar-model";

export const VERTICAL_CELL_SIZE = 126;
export const VERTICAL_CELL_GAP = 22;
export const VERTICAL_CELL_STEP = VERTICAL_CELL_SIZE + VERTICAL_CELL_GAP;
export const VERTICAL_CAMERA_SMOOTH_DAYS = 6;
export const OVERVIEW_TRANSITION_SECONDS = 1;
export const FULL_TIMELINE_HOLD_SECONDS = DURATION_SECONDS - TRAVERSAL_SECONDS - OVERVIEW_TRANSITION_SECONDS;
export const VERTICAL_EXPORT_TIMING = {
  durationSeconds: 60,
  introSeconds: 1,
  traversalSeconds: 58,
  overviewTransitionSeconds: 0.5,
  overviewHoldSeconds: 0.5,
  frameCount: FPS * 60,
} as const;
export const VERTICAL_MOVING_FADE_EXPORT_TIMING = {
  durationSeconds: 61,
  introSeconds: 1.5,
  introOverlapsTraversal: true,
  traversalSeconds: 60,
  overviewTransitionSeconds: 0.5,
  overviewHoldSeconds: 0.5,
  frameCount: FPS * 61,
} as const;
export const VERTICAL_VISGL_HANDOFF_EXPORT_TIMING = {
  durationSeconds: 62,
  introSeconds: 1.5,
  introOverlapsCalendarMotion: true,
  emptyPreRollSeconds: 1,
  traversalSeconds: 60,
  overviewTransitionSeconds: 0.5,
  overviewHoldSeconds: 0.5,
  sectionTimelineSeconds: 62,
  frameCount: FPS * 62,
} as const;
export const VERTICAL_HISTORY_FADE_START_ROWS = 1.5;
export const VERTICAL_HISTORY_FADE_END_ROWS = 4.5;
export const VERTICAL_HISTORY_VISIBILITY_MODE = "perspective-distance-only";
export const OVERVIEW_CELL_SIZE = 22;
export const OVERVIEW_CELL_GAP = 8;
export const OVERVIEW_CELL_STEP = OVERVIEW_CELL_SIZE + OVERVIEW_CELL_GAP;
export const OVERVIEW_YEAR_GAP = 52;

export type VerticalCell = CalendarCell & {
  monthKey: string;
  monthIndex: number;
  monthRow: number;
  x: number;
  y: number;
  size: number;
};

export type MonthBoundary = {
  monthKey: string;
  monthIndex: number;
  firstDayOrdinal: number;
  y: number;
};

export type VerticalCellPose = {
  x: number;
  y: number;
  z: number;
  size: number;
};

export type VerticalCalendarLayout = {
  cells: VerticalCell[];
  byDate: Map<string, VerticalCell>;
  monthBoundaries: MonthBoundary[];
  monthKeys: string[];
  cameraTrackY: number[];
  top: number;
  bottom: number;
  overviewByDate: Map<string, VerticalCellPose>;
  overviewCenter: [number, number, number];
  overviewWidth: number;
  overviewHeight: number;
};

export type VerticalViewState = {
  target: [number, number, number];
  zoom: number;
  rotationOrbit: number;
  rotationX: number;
};

export type VerticalFrameState = TrainFrameState & {
  elapsedSeconds: number;
  introProgress: number;
  isPreRoll: boolean;
  preRollProgress: number;
  revealHead: number;
  activeDayOrdinal: number;
  activeDayProgress: number;
  partialRevealCount: 0 | 1;
  cameraY: number;
  cameraDayOrdinal: number;
  cameraDeltaY: number;
  monthIndex: number;
  monthKey: string;
  overviewProgress: number;
  overviewSettled: boolean;
  viewState: VerticalViewState;
};

export function buildVerticalCalendarLayout(calendar: ContinuousCalendar): VerticalCalendarLayout {
  const monthKeys = [...new Set(calendar.dataDays.map((day) => day.date.slice(0, 7)))];
  const monthIndexByKey = new Map(monthKeys.map((monthKey, monthIndex) => [monthKey, monthIndex]));
  const sourceByDate = new Map(calendar.cells.map((cell) => [cell.date, cell]));
  const firstWeekday = parseDate(calendar.dataDays[0].date).getUTCDay();
  const cells = calendar.dataDays.map((day, dayOrdinal): VerticalCell => {
    const source = sourceByDate.get(day.date);
    if (!source) throw new Error(`Calendar cell missing for ${day.date}.`);
    const monthKey = day.date.slice(0, 7);
    const continuousSlot = firstWeekday + dayOrdinal;
    const weekRow = Math.floor(continuousSlot / 7);
    const weekday = continuousSlot % 7;
    return {
      ...source,
      monthKey,
      monthIndex: monthIndexByKey.get(monthKey) ?? 0,
      monthRow: weekRow,
      x: (weekday - 3) * VERTICAL_CELL_STEP - VERTICAL_CELL_SIZE / 2,
      y: weekRow * VERTICAL_CELL_STEP,
      size: VERTICAL_CELL_SIZE,
    };
  });
  const monthBoundaries = monthKeys.map((monthKey, monthIndex): MonthBoundary => {
    const firstDayOrdinal = calendar.dataDays.findIndex((day) => day.date.startsWith(`${monthKey}-`));
    return {
      monthKey,
      monthIndex,
      firstDayOrdinal,
      y: cells[firstDayOrdinal].y,
    };
  });

  if (cells.length !== calendar.dataDays.length) {
    throw new Error(`Vertical layout lost days (${cells.length}/${calendar.dataDays.length}).`);
  }
  const byDate = new Map(cells.map((cell) => [cell.date, cell]));
  const cameraTrackY = buildSmoothedCameraTrack(cells.map((cell) => cell.y + cell.size / 2));
  const overview = buildOverviewLayout(calendar);
  return {
    cells,
    byDate,
    monthBoundaries,
    monthKeys,
    cameraTrackY,
    top: cells[0]?.y ?? 0,
    bottom: cells.at(-1)!.y + VERTICAL_CELL_SIZE,
    overviewByDate: overview.byDate,
    overviewCenter: overview.center,
    overviewWidth: overview.width,
    overviewHeight: overview.height,
  };
}

export function buildVerticalFrameState(
  frameIndex: number,
  calendar: ContinuousCalendar,
  layout = buildVerticalCalendarLayout(calendar),
  timing: {
    durationSeconds: number;
    introSeconds?: number;
    introOverlapsTraversal?: boolean;
    emptyPreRollSeconds?: number;
    traversalSeconds: number;
    overviewTransitionSeconds: number;
    sectionTimelineSeconds?: number;
    frameCount: number;
  } = {
    durationSeconds: DURATION_SECONDS,
    traversalSeconds: TRAVERSAL_SECONDS,
    overviewTransitionSeconds: OVERVIEW_TRANSITION_SECONDS,
    frameCount: FRAME_COUNT,
  },
): VerticalFrameState {
  const safeFrame = clamp(Math.floor(frameIndex), 0, timing.frameCount - 1);
  const elapsedSeconds = safeFrame / FPS;
  const introSeconds = timing.introSeconds ?? 0;
  const introFrameCount = introSeconds * FPS;
  const introProgress = introSeconds <= 0
    ? 1
    : smootherstep(clamp(elapsedSeconds / introSeconds, 0, 1));
  const introOverlapsTraversal = timing.introOverlapsTraversal ?? false;
  const emptyPreRollSeconds = timing.emptyPreRollSeconds ?? 0;
  const emptyPreRollFrameCount = emptyPreRollSeconds * FPS;
  const traversalStartFrame = emptyPreRollSeconds > 0
    ? emptyPreRollFrameCount
    : introOverlapsTraversal
      ? 0
      : introFrameCount;
  const preRollProgress = emptyPreRollSeconds <= 0
    ? 1
    : clamp(elapsedSeconds / emptyPreRollSeconds, 0, 1);
  const isPreRoll = emptyPreRollSeconds > 0 && elapsedSeconds < emptyPreRollSeconds;
  const overviewStartSeconds = timing.traversalSeconds + (emptyPreRollSeconds > 0
    ? emptyPreRollSeconds
    : introOverlapsTraversal
      ? 0
      : introSeconds);
  const isOverview = elapsedSeconds >= overviewStartSeconds;
  const traversalFrameCount = timing.traversalSeconds * FPS;
  const traversalProgress = isOverview
    ? 1
    : clamp((safeFrame - traversalStartFrame) / Math.max(1, traversalFrameCount - 1), 0, 1);
  const revealHead = traversalProgress * calendar.dataDays.length;
  const activeDayOrdinal = Math.min(
    calendar.dataDays.length - 1,
    Math.floor(Math.min(revealHead, calendar.dataDays.length - Number.EPSILON)),
  );
  const activeDayProgress = isOverview ? 1 : revealHead - Math.floor(revealHead);
  const partialRevealCount = isOverview || activeDayProgress === 0 ? 0 : 1;
  const preRollDays = emptyPreRollSeconds > 0
    ? (calendar.dataDays.length / timing.traversalSeconds) * emptyPreRollSeconds
    : 0;
  const cameraDayOrdinal = isPreRoll
    ? -preRollDays * (1 - preRollProgress)
    : Math.min(calendar.dataDays.length - 1, revealHead);
  const currentDayOrdinal = cameraDayOrdinal;
  const currentDate = isPreRoll
    ? formatDate(addDays(parseDate(calendar.dataDays[0].date), Math.floor(cameraDayOrdinal)))
    : calendar.dataDays[activeDayOrdinal].date;
  const activeCell = layout.cells[activeDayOrdinal];
  const cameraY = interpolateTrackWithLead(layout.cameraTrackY, cameraDayOrdinal);
  const previousCameraY = interpolateTrackWithLead(layout.cameraTrackY, cameraDayOrdinal - 1 / 60);
  const sectionProgressSource = timing.sectionTimelineSeconds
    ? clamp(elapsedSeconds / timing.sectionTimelineSeconds, 0, 1)
    : traversalProgress;
  const sectionPosition = Math.min(SECTION_COUNT - Number.EPSILON, sectionProgressSource * SECTION_COUNT);
  const sectionIndex = Math.floor(sectionPosition);
  const sectionStartOrdinal = Math.floor(sectionIndex * calendar.dataDays.length / SECTION_COUNT);
  const sectionEndOrdinal = sectionIndex === SECTION_COUNT - 1
    ? calendar.dataDays.length - 1
    : Math.floor((sectionIndex + 1) * calendar.dataDays.length / SECTION_COUNT) - 1;
  const overviewProgress = isOverview
    ? smootherstep(clamp((elapsedSeconds - overviewStartSeconds) / timing.overviewTransitionSeconds, 0, 1))
    : 0;
  const crawlTarget: [number, number, number] = [0, -cameraY + 220, 0];
  const target = interpolateVector(crawlTarget, layout.overviewCenter, overviewProgress);

  return {
    frameIndex: safeFrame,
    elapsedSeconds,
    introProgress,
    isPreRoll,
    preRollProgress,
    progress: safeFrame / (timing.frameCount - 1),
    currentDayOrdinal,
    currentDate,
    currentWeek: calendar.dataStartWeek + currentDayOrdinal / 7,
    calendarTranslationX: 0,
    sectionIndex,
    sectionProgress: sectionPosition - sectionIndex,
    sectionStartOrdinal,
    sectionEndOrdinal,
    isOverview,
    revealHead,
    activeDayOrdinal,
    activeDayProgress,
    partialRevealCount,
    cameraY,
    cameraDayOrdinal,
    cameraDeltaY: cameraY - previousCameraY,
    monthIndex: isPreRoll ? -1 : activeCell.monthIndex,
    monthKey: isPreRoll ? currentDate.slice(0, 7) : activeCell.monthKey,
    overviewProgress,
    overviewSettled: overviewProgress >= 1,
    viewState: {
      target,
      zoom: lerp(0.33, -0.08, overviewProgress),
      rotationOrbit: 0,
      rotationX: lerp(20, 90, overviewProgress),
    },
  };
}

export function verticalDayRevealProgress(dayOrdinal: number, state: VerticalFrameState) {
  if (state.isOverview) return 1;
  return clamp(state.revealHead - dayOrdinal, 0, 1);
}

export function buildVerticalCellPose(
  cell: VerticalCell,
  state: VerticalFrameState,
  layout: VerticalCalendarLayout,
): VerticalCellPose {
  const overview = layout.overviewByDate.get(cell.date);
  const crawl: VerticalCellPose = {
    x: cell.x,
    y: -cell.y - cell.size,
    z: 0,
    size: cell.size,
  };
  if (!overview || state.overviewProgress <= 0) return crawl;
  return {
    x: lerp(crawl.x, overview.x, state.overviewProgress),
    y: lerp(crawl.y, overview.y, state.overviewProgress),
    z: 0,
    size: lerp(crawl.size, overview.size, state.overviewProgress),
  };
}

export function verticalCellDistanceOpacity(
  cell: VerticalCell,
  state: VerticalFrameState,
  mode: "legacy-horizon-taper" | typeof VERTICAL_HISTORY_VISIBILITY_MODE = "legacy-horizon-taper",
) {
  if (mode === VERTICAL_HISTORY_VISIBILITY_MODE) return 1;
  const historyRows = (
    state.cameraY - (cell.y + cell.size / 2)
  ) / VERTICAL_CELL_STEP;
  const fadeProgress = smootherstep(clamp(
    (historyRows - VERTICAL_HISTORY_FADE_START_ROWS)
      / (VERTICAL_HISTORY_FADE_END_ROWS - VERTICAL_HISTORY_FADE_START_ROWS),
    0,
    1,
  ));
  const crawlOpacity = 1 - fadeProgress;
  return lerp(crawlOpacity, 1, state.overviewProgress);
}

export function monthBoundaryCameraJumps(calendar: ContinuousCalendar, layout: VerticalCalendarLayout) {
  return layout.monthBoundaries.slice(1).map((boundary) => {
    const before = Math.max(0, boundary.firstDayOrdinal - 0.01);
    const after = Math.min(calendar.dataDays.length - 1, boundary.firstDayOrdinal + 0.01);
    return {
      monthKey: boundary.monthKey,
      delta: interpolateTrack(layout.cameraTrackY, after) - interpolateTrack(layout.cameraTrackY, before),
    };
  });
}

function buildSmoothedCameraTrack(raw: number[]) {
  return raw.map((_, index) => {
    let weightedTotal = 0;
    let totalWeight = 0;
    for (let offset = -VERTICAL_CAMERA_SMOOTH_DAYS; offset <= VERTICAL_CAMERA_SMOOTH_DAYS; offset += 1) {
      const sourceIndex = clamp(index + offset, 0, raw.length - 1);
      const normalized = Math.abs(offset) / (VERTICAL_CAMERA_SMOOTH_DAYS + 1);
      const weight = Math.pow(1 - normalized, 2);
      weightedTotal += raw[sourceIndex] * weight;
      totalWeight += weight;
    }
    return weightedTotal / totalWeight;
  });
}

function buildOverviewLayout(calendar: ContinuousCalendar) {
  const years = [...new Set(calendar.dataDays.map((day) => Number(day.date.slice(0, 4))))];
  const width = 53 * OVERVIEW_CELL_STEP - OVERVIEW_CELL_GAP;
  const yearHeight = 7 * OVERVIEW_CELL_STEP - OVERVIEW_CELL_GAP;
  const height = years.length * yearHeight + Math.max(0, years.length - 1) * OVERVIEW_YEAR_GAP;
  const left = -width / 2;
  const top = -height / 2;
  const byDate = new Map<string, VerticalCellPose>();

  for (const day of calendar.dataDays) {
    const date = parseDate(day.date);
    const year = date.getUTCFullYear();
    // deck.gl's final top-down OrbitView projects larger Cartesian Y values
    // toward the top of the screen. Reverse the source-year index so the
    // recap reads chronologically from 2023 at the top to 2026 at the bottom.
    const yearIndex = years.length - 1 - years.indexOf(year);
    const januaryFirst = new Date(Date.UTC(year, 0, 1));
    const yearGridStart = new Date(januaryFirst.getTime() - januaryFirst.getUTCDay() * 86_400_000);
    const week = Math.floor((date.getTime() - yearGridStart.getTime()) / 86_400_000 / 7);
    byDate.set(day.date, {
      x: left + week * OVERVIEW_CELL_STEP,
      y: top + yearIndex * (yearHeight + OVERVIEW_YEAR_GAP) + date.getUTCDay() * OVERVIEW_CELL_STEP,
      z: 0,
      size: OVERVIEW_CELL_SIZE,
    });
  }

  return {
    byDate,
    center: [0, 0, 0] as [number, number, number],
    width,
    height,
  };
}

function interpolateTrack(values: number[], ordinal: number) {
  const lower = clamp(Math.floor(ordinal), 0, values.length - 1);
  const upper = Math.min(values.length - 1, lower + 1);
  const progress = smootherstep(ordinal - Math.floor(ordinal));
  return lerp(values[lower], values[upper], progress);
}

function interpolateTrackWithLead(values: number[], ordinal: number) {
  if (ordinal >= 0) return interpolateTrack(values, ordinal);
  const comparisonIndex = Math.min(7, values.length - 1);
  const pixelsPerDay = comparisonIndex > 0
    ? (values[comparisonIndex] - values[0]) / comparisonIndex
    : VERTICAL_CELL_STEP / 7;
  return values[0] + ordinal * pixelsPerDay;
}

function interpolateVector(
  start: [number, number, number],
  end: [number, number, number],
  progress: number,
): [number, number, number] {
  return [
    lerp(start[0], end[0], progress),
    lerp(start[1], end[1], progress),
    lerp(start[2], end[2], progress),
  ];
}

function smootherstep(value: number) {
  const amount = clamp(value, 0, 1);
  return amount * amount * amount * (amount * (amount * 6 - 15) + 10);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

export const VERTICAL_RENDER_CONTRACT = {
  width: WIDTH,
  height: HEIGHT,
  fps: FPS,
  durationSeconds: DURATION_SECONDS,
  traversalSeconds: TRAVERSAL_SECONDS,
  overviewTransitionSeconds: OVERVIEW_TRANSITION_SECONDS,
  overviewHoldSeconds: FULL_TIMELINE_HOLD_SECONDS,
  frameCount: FRAME_COUNT,
  projection: "deck.gl OrbitView perspective",
  chronology: "one active day at a time",
  calendarStructure: "continuous-seven-column-week-ribbon",
  monthDividers: "none",
  cameraMotion: "monotonic smoothed continuous-week track",
  crawlTiltDegrees: 20,
  screenDirection: "new dates enter from bottom; completed history recedes toward top",
  historyVisibility: "full crawl opacity with perspective-distance compression",
} as const;

export const VERTICAL_EXPORT_CONTRACT = {
  ...VERTICAL_RENDER_CONTRACT,
  durationSeconds: VERTICAL_EXPORT_TIMING.durationSeconds,
  introSeconds: VERTICAL_EXPORT_TIMING.introSeconds,
  traversalSeconds: VERTICAL_EXPORT_TIMING.traversalSeconds,
  overviewTransitionSeconds: VERTICAL_EXPORT_TIMING.overviewTransitionSeconds,
  overviewHoldSeconds: VERTICAL_EXPORT_TIMING.overviewHoldSeconds,
  frameCount: VERTICAL_EXPORT_TIMING.frameCount,
  sectionCount: SECTION_COUNT,
  sectionSeconds: VERTICAL_EXPORT_TIMING.traversalSeconds / SECTION_COUNT,
} as const;

export const VERTICAL_MOVING_FADE_EXPORT_CONTRACT = {
  ...VERTICAL_RENDER_CONTRACT,
  durationSeconds: VERTICAL_MOVING_FADE_EXPORT_TIMING.durationSeconds,
  introSeconds: VERTICAL_MOVING_FADE_EXPORT_TIMING.introSeconds,
  introOverlapsTraversal: VERTICAL_MOVING_FADE_EXPORT_TIMING.introOverlapsTraversal,
  traversalSeconds: VERTICAL_MOVING_FADE_EXPORT_TIMING.traversalSeconds,
  overviewTransitionSeconds: VERTICAL_MOVING_FADE_EXPORT_TIMING.overviewTransitionSeconds,
  overviewHoldSeconds: VERTICAL_MOVING_FADE_EXPORT_TIMING.overviewHoldSeconds,
  frameCount: VERTICAL_MOVING_FADE_EXPORT_TIMING.frameCount,
  sectionCount: SECTION_COUNT,
  sectionSeconds: VERTICAL_MOVING_FADE_EXPORT_TIMING.traversalSeconds / SECTION_COUNT,
  tileBorders: "none",
  fadeCurve: "smootherstep",
} as const;

export const VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT = {
  ...VERTICAL_RENDER_CONTRACT,
  durationSeconds: VERTICAL_VISGL_HANDOFF_EXPORT_TIMING.durationSeconds,
  introSeconds: VERTICAL_VISGL_HANDOFF_EXPORT_TIMING.introSeconds,
  introOverlapsCalendarMotion: VERTICAL_VISGL_HANDOFF_EXPORT_TIMING.introOverlapsCalendarMotion,
  emptyPreRollSeconds: VERTICAL_VISGL_HANDOFF_EXPORT_TIMING.emptyPreRollSeconds,
  traversalSeconds: VERTICAL_VISGL_HANDOFF_EXPORT_TIMING.traversalSeconds,
  overviewTransitionSeconds: VERTICAL_VISGL_HANDOFF_EXPORT_TIMING.overviewTransitionSeconds,
  overviewHoldSeconds: VERTICAL_VISGL_HANDOFF_EXPORT_TIMING.overviewHoldSeconds,
  frameCount: VERTICAL_VISGL_HANDOFF_EXPORT_TIMING.frameCount,
  sectionCount: SECTION_COUNT,
  sectionSeconds: VERTICAL_VISGL_HANDOFF_EXPORT_TIMING.sectionTimelineSeconds / SECTION_COUNT,
  contributionTraversalSectionSeconds: VERTICAL_VISGL_HANDOFF_EXPORT_TIMING.traversalSeconds / SECTION_COUNT,
  tileBorders: "none",
  fadeCurve: "smootherstep",
  slotStartTimecode: "00:45.0000",
  slotEndTimecode: "01:47.0000",
  nextClip: "04-contributor-constellation",
  nextClipStartTimecode: "01:47.0000",
  nextClipBoundaryMode: "decoded-pixel-exact-input-frame",
} as const;
