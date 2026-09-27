export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 60;
export const TRAVERSAL_SECONDS = 62;
export const OVERVIEW_HOLD_SECONDS = 2;
export const DURATION_SECONDS = TRAVERSAL_SECONDS + OVERVIEW_HOLD_SECONDS;
export const FRAME_COUNT = FPS * DURATION_SECONDS;
export const SECTION_COUNT = 32;
export const CELL_SIZE = 104;
export const CELL_GAP = 16;
export const CELL_STEP = CELL_SIZE + CELL_GAP;
export const PAD_WEEKS = 9;
export const EXIT_START_SECONDS = TRAVERSAL_SECONDS;
export const EXIT_STACK_START_SECONDS = TRAVERSAL_SECONDS;
export const OVERVIEW_CELL_SIZE = 23;
export const OVERVIEW_CELL_GAP = 5;
export const OVERVIEW_CELL_STEP = OVERVIEW_CELL_SIZE + OVERVIEW_CELL_GAP;
export const OVERVIEW_YEAR_GAP = 44;
export const COLOR_REVEAL_MODE = "horizontal-clip-only" as const;

export const ORGANIZATION_GROUPS = [
  { key: "new-heat", label: "NEW HEAT", owner: "NEW-HEAT", color: "#f85149" },
  { key: "agriculture-intelligence", label: "Agriculture-Intelligence", owner: "Agriculture-Intelligence", color: "#39d353" },
  { key: "visualpt", label: "VisualPT", owner: "VisualPT", color: "#58a6ff" },
  { key: "visgl", label: "vis.gl", owner: "visgl", color: "#a371f7" },
  { key: "misc", label: "charlieforward9", owner: null, color: "#8b949e" },
] as const;

export const VISIBLE_ORGANIZATION_GROUPS = ORGANIZATION_GROUPS.filter((group) => group.key !== "misc");

export type OrganizationKey = typeof ORGANIZATION_GROUPS[number]["key"];

export const REPOSITORY_ORGANIZATION_OVERRIDES: Readonly<Record<string, OrganizationKey>> = {
  "charlieforward9/athleat": "new-heat",
};

export const OWNER_ORGANIZATION_OVERRIDES: Readonly<Record<string, OrganizationKey>> = {
  "aws-amplify": "agriculture-intelligence",
  "joby-aviation": "visgl",
  mapbox: "visgl",
  robertleeplummerjr: "visgl",
  yuzhva: "visgl",
};

export type ContributionDay = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  attributedCount?: number;
  unattributedCount?: number;
  overflowCount?: number;
  projects?: ProjectContribution[];
};

export type ProjectContribution = {
  repository: string;
  visibility: "public" | "private";
  count: number;
  commits: number;
  pullRequests: number;
  issues: number;
  reviews: number;
};

type SnapshotBase = {
  login: string;
  generatedAt: string;
  dateRange: { from: string; to: string };
  years: Array<{
    year: number;
    totalContributions: number;
    attributedContributions?: number;
    days: ContributionDay[];
  }>;
};

export type PublicContributionSnapshot = SnapshotBase & {
  schemaVersion: 1;
  source: "github-public-profile-html";
  provenance: {
    endpointShape: string;
    authenticated: false;
    visibility: "public-profile";
  };
};

export type OwnerProjectContributionSnapshot = SnapshotBase & {
  schemaVersion: 2;
  source: "github-authenticated-owner-project-events";
  timezone: string;
  projects: Array<{ repository: string; visibility: "public" | "private"; count: number }>;
  provenance: {
    authenticated: true;
    visibility: "owner-visible-projects";
    approval: string;
    endpoints: string[];
    restrictedContributionsByYear: Array<{ year: number; count: number }>;
    note: string;
  };
};

export type ContributionSnapshot = PublicContributionSnapshot | OwnerProjectContributionSnapshot;

export type CalendarCell = ContributionDay & {
  week: number;
  weekday: number;
  isData: boolean;
  dataOrdinal: number;
};

export type ContinuousCalendar = {
  cells: CalendarCell[];
  dataDays: ContributionDay[];
  dataStartWeek: number;
  dataEndWeek: number;
  weekCount: number;
  gridStart: string;
  gridEnd: string;
  volumeCeiling: number;
  projectColors: Record<string, string>;
  projectCount: number;
  organizationColors: Record<OrganizationKey, string>;
  organizationCount: number;
};

export type TrainFrameState = {
  frameIndex: number;
  progress: number;
  currentDayOrdinal: number;
  currentDate: string;
  currentWeek: number;
  calendarTranslationX: number;
  sectionIndex: number;
  sectionProgress: number;
  sectionStartOrdinal: number;
  sectionEndOrdinal: number;
  isOverview: boolean;
};

export type CalendarCellPose = {
  x: number;
  y: number;
  size: number;
};

export type StackedOverviewLayout = {
  byDate: Map<string, CalendarCellPose>;
  years: number[];
  top: number;
  left: number;
  width: number;
  height: number;
};

const DAY_MS = 86_400_000;

export function buildContinuousCalendar(snapshot: ContributionSnapshot): ContinuousCalendar {
  const dataDays = snapshot.years
    .flatMap((year) => year.days)
    .sort((left, right) => left.date.localeCompare(right.date));
  if (dataDays.length === 0) throw new Error("The contribution snapshot contains no days.");
  const uniqueDates = new Set(dataDays.map((day) => day.date));
  if (uniqueDates.size !== dataDays.length) throw new Error("The contribution snapshot contains duplicate dates.");

  const firstDate = parseDate(dataDays[0].date);
  const lastDate = parseDate(dataDays.at(-1)!.date);
  const dataGridStart = addDays(firstDate, -firstDate.getUTCDay());
  const dataGridEnd = addDays(lastDate, 6 - lastDate.getUTCDay());
  const gridStart = addDays(dataGridStart, -PAD_WEEKS * 7);
  const gridEnd = addDays(dataGridEnd, PAD_WEEKS * 7);
  const byDate = new Map(dataDays.map((day, index) => [day.date, { day, index }]));
  const cells: CalendarCell[] = [];

  for (let date = gridStart, position = 0; date <= gridEnd; date = addDays(date, 1), position += 1) {
    const dateString = formatDate(date);
    const match = byDate.get(dateString);
    cells.push({
      date: dateString,
      count: match?.day.count ?? 0,
      level: match?.day.level ?? 0,
      attributedCount: match?.day.attributedCount,
      unattributedCount: match?.day.unattributedCount,
      overflowCount: match?.day.overflowCount,
      projects: match?.day.projects,
      week: Math.floor(position / 7),
      weekday: position % 7,
      isData: Boolean(match),
      dataOrdinal: match?.index ?? -1,
    });
  }

  return {
    cells,
    dataDays,
    dataStartWeek: PAD_WEEKS,
    dataEndWeek: PAD_WEEKS + Math.floor((lastDate.getTime() - dataGridStart.getTime()) / DAY_MS / 7),
    weekCount: cells.length / 7,
    gridStart: formatDate(gridStart),
    gridEnd: formatDate(gridEnd),
    volumeCeiling: percentile(dataDays.map(visibleContributionCount), 0.95),
    projectColors: buildProjectColorMap(dataDays),
    projectCount: new Set(dataDays.flatMap((day) => day.projects?.map((project) => project.repository) ?? [])).size,
    organizationColors: Object.fromEntries(ORGANIZATION_GROUPS.map((group) => [group.key, group.color])) as Record<OrganizationKey, string>,
    organizationCount: VISIBLE_ORGANIZATION_GROUPS.length,
  };
}

export function buildTrainFrameState(frameIndex: number, calendar: ContinuousCalendar): TrainFrameState {
  const safeFrame = clamp(Math.floor(frameIndex), 0, FRAME_COUNT - 1);
  const seconds = safeFrame / FPS;
  const isOverview = seconds >= TRAVERSAL_SECONDS;
  const traversalProgress = clamp(seconds / TRAVERSAL_SECONDS, 0, 1);
  const sectionPosition = Math.min(SECTION_COUNT - Number.EPSILON, traversalProgress * SECTION_COUNT);
  const sectionIndex = isOverview ? SECTION_COUNT - 1 : Math.floor(sectionPosition);
  const sectionProgress = isOverview ? 1 : sectionPosition - sectionIndex;
  const sectionStartOrdinal = Math.floor(sectionIndex * calendar.dataDays.length / SECTION_COUNT);
  const sectionEndOrdinal = sectionIndex === SECTION_COUNT - 1
    ? calendar.dataDays.length - 1
    : Math.floor((sectionIndex + 1) * calendar.dataDays.length / SECTION_COUNT) - 1;
  const currentDayOrdinal = isOverview
    ? calendar.dataDays.length - 1
    : lerp(sectionStartOrdinal, sectionEndOrdinal, sectionProgress);
  const cameraDayOrdinal = (sectionStartOrdinal + sectionEndOrdinal) / 2;
  const currentWeek = calendar.dataStartWeek + currentDayOrdinal / 7;
  const cameraWeek = calendar.dataStartWeek + cameraDayOrdinal / 7;
  return {
    frameIndex: safeFrame,
    progress: safeFrame / (FRAME_COUNT - 1),
    currentDayOrdinal,
    currentDate: calendar.dataDays[Math.round(currentDayOrdinal)].date,
    currentWeek,
    calendarTranslationX: WIDTH / 2 - cameraWeek * CELL_STEP,
    sectionIndex,
    sectionProgress,
    sectionStartOrdinal,
    sectionEndOrdinal,
    isOverview,
  };
}

export function calendarPixelsPerFrame(calendar: ContinuousCalendar) {
  void calendar;
  return 0;
}

export function exitOverviewProgress(frameIndex: number) {
  const seconds = clamp(frameIndex, 0, FRAME_COUNT - 1) / FPS;
  return seconds >= EXIT_START_SECONDS ? 1 : 0;
}

export function exitStackProgress(frameIndex: number) {
  const seconds = clamp(frameIndex, 0, FRAME_COUNT - 1) / FPS;
  return seconds >= EXIT_STACK_START_SECONDS ? 1 : 0;
}

export function buildStackedOverviewLayout(calendar: ContinuousCalendar): StackedOverviewLayout {
  const years = [...new Set(calendar.dataDays.map((day) => Number(day.date.slice(0, 4))))].sort((left, right) => left - right);
  const weekColumns = 53;
  const width = weekColumns * OVERVIEW_CELL_STEP - OVERVIEW_CELL_GAP;
  const yearHeight = 7 * OVERVIEW_CELL_STEP - OVERVIEW_CELL_GAP;
  const height = years.length * yearHeight + Math.max(0, years.length - 1) * OVERVIEW_YEAR_GAP;
  const left = Math.round((WIDTH - width) / 2);
  const top = Math.round((HEIGHT - height) / 2);
  const byDate = new Map<string, CalendarCellPose>();

  for (const day of calendar.dataDays) {
    const date = parseDate(day.date);
    const year = date.getUTCFullYear();
    const yearIndex = years.indexOf(year);
    const januaryFirst = new Date(Date.UTC(year, 0, 1));
    const yearGridStart = addDays(januaryFirst, -januaryFirst.getUTCDay());
    const week = Math.floor((date.getTime() - yearGridStart.getTime()) / DAY_MS / 7);
    byDate.set(day.date, {
      x: left + week * OVERVIEW_CELL_STEP,
      y: top + yearIndex * (yearHeight + OVERVIEW_YEAR_GAP) + date.getUTCDay() * OVERVIEW_CELL_STEP,
      size: OVERVIEW_CELL_SIZE,
    });
  }

  return { byDate, years, top, left, width, height };
}

export function buildExitCellPose(
  cell: CalendarCell,
  state: TrainFrameState,
  calendar: ContinuousCalendar,
  overview: StackedOverviewLayout,
): CalendarCellPose {
  const zoomProgress = exitOverviewProgress(state.frameIndex);
  if (zoomProgress <= 0) {
    return {
      x: state.calendarTranslationX + cell.week * CELL_STEP,
      y: Math.round((HEIGHT - (7 * CELL_STEP - CELL_GAP)) / 2) + cell.weekday * CELL_STEP,
      size: CELL_SIZE,
    };
  }

  const dataWeekSpan = Math.max(1, calendar.dataEndWeek - calendar.dataStartWeek);
  const compactStep = (WIDTH - 180) / dataWeekSpan;
  const compactSize = Math.max(5, compactStep * 0.78);
  const compactFocusWeek = lerp(state.currentWeek, (calendar.dataStartWeek + calendar.dataEndWeek) / 2, zoomProgress);
  const compactX = WIDTH / 2 + (cell.week - compactFocusWeek) * lerp(CELL_STEP, compactStep, zoomProgress);
  const compactY = HEIGHT / 2 + (cell.weekday - 3) * lerp(CELL_STEP, compactStep, zoomProgress);
  const compactPose = {
    x: compactX,
    y: compactY,
    size: lerp(CELL_SIZE, compactSize, zoomProgress),
  };
  const finalPose = overview.byDate.get(cell.date);
  const stackProgress = exitStackProgress(state.frameIndex);
  if (!finalPose || stackProgress <= 0) return compactPose;
  return {
    x: lerp(compactPose.x, finalPose.x, stackProgress),
    y: lerp(compactPose.y, finalPose.y, stackProgress),
    size: lerp(compactPose.size, finalPose.size, stackProgress),
  };
}

export function dayRevealProgress(dayOrdinal: number, currentDayOrdinal: number) {
  return smoothstep(-7, 7, currentDayOrdinal - dayOrdinal);
}

export function dayRevealWidth(dayOrdinal: number, currentDayOrdinal: number) {
  return CELL_SIZE * dayRevealProgress(dayOrdinal, currentDayOrdinal);
}

export function buildDayColorReveal(dayOrdinal: number, currentDayOrdinal: number, cellSize = CELL_SIZE) {
  const progress = dayRevealProgress(dayOrdinal, currentDayOrdinal);
  return {
    progress,
    clipWidth: cellSize * progress,
    colorOpacity: 1 as const,
  };
}

export function calendarCellBaseOpacity(isData: boolean) {
  return isData ? 0.58 : 0.18;
}

export function normalizedDayVolume(count: number, volumeCeiling: number) {
  if (count <= 0 || volumeCeiling <= 0) return 0;
  return clamp(Math.log1p(count) / Math.log1p(volumeCeiling), 0, 1);
}

export function buildProjectSlices(day: ContributionDay) {
  const projects = [...(day.projects ?? [])]
    .filter((project) => project.count > 0)
    .sort((left, right) => right.count - left.count || left.repository.localeCompare(right.repository))
    .map((project) => ({ key: project.repository, count: project.count, visibility: project.visibility }));
  if ((day.unattributedCount ?? 0) > 0) {
    projects.push({ key: "__unattributed__", count: day.unattributedCount!, visibility: "private" });
  }
  if (projects.length === 0 && day.count > 0) {
    projects.push({ key: "__unattributed__", count: day.count, visibility: "private" });
  }
  const total = projects.reduce((sum, project) => sum + project.count, 0);
  return projects.map((project) => ({ ...project, share: total === 0 ? 0 : project.count / total }));
}

export function organizationKeyForRepository(repository: string): OrganizationKey {
  const normalizedRepository = repository.toLocaleLowerCase("en-US");
  const repositoryOverride = REPOSITORY_ORGANIZATION_OVERRIDES[normalizedRepository];
  if (repositoryOverride) return repositoryOverride;
  const owner = normalizedRepository.split("/", 1)[0];
  const ownerOverride = OWNER_ORGANIZATION_OVERRIDES[owner];
  if (ownerOverride) return ownerOverride;
  return ORGANIZATION_GROUPS.find((group) => group.owner?.toLocaleLowerCase("en-US") === owner)?.key ?? "misc";
}

export function buildOrganizationSlices(day: ContributionDay) {
  const totals = new Map<OrganizationKey, number>();
  for (const project of day.projects ?? []) {
    if (project.count <= 0) continue;
    const key = organizationKeyForRepository(project.repository);
    totals.set(key, (totals.get(key) ?? 0) + project.count);
  }
  const remainder = day.unattributedCount ?? 0;
  if (remainder > 0) totals.set("misc", (totals.get("misc") ?? 0) + remainder);
  if (totals.size === 0 && day.count > 0) totals.set("misc", day.count);
  const total = [...totals.values()].reduce((sum, count) => sum + count, 0);
  return ORGANIZATION_GROUPS
    .filter((group) => (totals.get(group.key) ?? 0) > 0)
    .map((group) => ({
      key: group.key,
      label: group.label,
      count: totals.get(group.key)!,
      share: total === 0 ? 0 : totals.get(group.key)! / total,
    }));
}

export function buildVisibleOrganizationSlices(day: ContributionDay) {
  const visible = buildOrganizationSlices(day).filter((slice) => slice.key !== "misc");
  const total = visible.reduce((sum, slice) => sum + slice.count, 0);
  return visible.map((slice) => ({ ...slice, share: total === 0 ? 0 : slice.count / total }));
}

export function visibleContributionCount(day: ContributionDay) {
  return buildVisibleOrganizationSlices(day).reduce((sum, slice) => sum + slice.count, 0);
}

export function buildProjectColorMap(days: ContributionDay[]) {
  const totals = new Map<string, number>();
  for (const day of days) {
    for (const project of day.projects ?? []) {
      totals.set(project.repository, (totals.get(project.repository) ?? 0) + project.count);
    }
  }
  const repositories = [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([repository]) => repository);
  return Object.fromEntries(repositories.map((repository, index) => {
    const hue = (142 + index * 137.508) % 360;
    const lightness = 52 + (index % 3) * 4;
    return [repository, `hsl(${hue.toFixed(1)}, 68%, ${lightness}%)`];
  }));
}

export function formatTimecodeDate(isoDate: string) {
  parseDate(isoDate);
  const [year, month, day] = isoDate.split("-");
  return `${year} · ${month} · ${day}`;
}

export function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || formatDate(date) !== value) throw new Error(`Invalid ISO date: ${value}`);
  return date;
}

export function addDays(date: Date, amount: number) {
  return new Date(date.getTime() + amount * DAY_MS);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function percentile(values: number[], amount: number) {
  const sorted = values.filter((value) => value > 0).sort((left, right) => left - right);
  if (sorted.length === 0) return 1;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))];
}
