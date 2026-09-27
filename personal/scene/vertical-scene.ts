import {
  COORDINATE_SYSTEM,
  Deck,
  OrbitView,
  type Layer,
} from "@deck.gl/core";
import { PathLayer, SolidPolygonLayer } from "@deck.gl/layers";
import {
  BufferTarget,
  CanvasSource,
  Output,
  WebMOutputFormat,
  canEncodeVideo,
} from "mediabunny";
import {
  FPS,
  HEIGHT,
  WIDTH,
  buildContinuousCalendar,
  buildVisibleOrganizationSlices,
  normalizedDayVolume,
  visibleContributionCount,
  type ContributionSnapshot,
  type ContinuousCalendar,
} from "./calendar-model";
import {
  HEAT_WINDOW_DAYS,
  ORGANIZATION_LEGEND_STYLE,
  buildOrganizationLegendTimeline,
  drawOrganizationLegend,
  encodeLegendTrack,
  legendDoesNotOverlapTimecode,
} from "./legend-track";
import { drawTimecode, encodeTimecodeTrack } from "./timecode-track";
import {
  VERTICAL_HISTORY_VISIBILITY_MODE,
  VERTICAL_MOVING_FADE_EXPORT_CONTRACT,
  VERTICAL_MOVING_FADE_EXPORT_TIMING,
  VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT,
  VERTICAL_VISGL_HANDOFF_EXPORT_TIMING,
  buildVerticalCalendarLayout,
  buildVerticalCellPose,
  buildVerticalFrameState,
  verticalCellDistanceOpacity,
  verticalDayRevealProgress,
  type VerticalCalendarLayout,
  type VerticalFrameState,
} from "./vertical-calendar-model";

const VIDEO_BITRATE = 18_000_000;
const EMPTY = [22, 27, 34, 230] as const;
const EMPTY_OUTLINE = [48, 54, 61, 125] as const;
type Position = [number, number, number];
type Color = [number, number, number, number];
type PolygonDatum = { id: string; polygon: Position[]; color: Color };
type PathDatum = { id: string; path: Position[]; color: Color; width: number };

type Diagnostics = {
  webgl: boolean;
  renderer?: string;
  vendor?: string;
  version?: string;
  deckView: "OrbitView";
  deckLayerTypes: string[];
  monthCount: number;
  dayCount: number;
  organizationCount: number;
  partialRevealMaximum: 1;
  cameraTimeDirection: "forward";
  calendarScreenDirection: "completed-history-toward-top-horizon";
  dayFillDirection: "left-to-right";
  calendarContinuityMode: "continuous-week-ribbon";
  monthDividerMode: "none";
  colorRevealMode: "horizontal-clip-only";
  historyVisibilityMode: "perspective-distance-only";
  transparentBackground: true;
  contract: typeof VERTICAL_MOVING_FADE_EXPORT_CONTRACT | typeof VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT;
};

declare global {
  interface Window {
    __CONTRIBUTION_VERTICAL_CALENDAR__: {
      ready: Promise<void>;
      setFrame(frameIndex: number): Promise<VerticalFrameState>;
      setTimecodePreview(frameIndex: number): Promise<VerticalFrameState>;
      setLegendPreview(frameIndex: number): Promise<VerticalFrameState>;
      setOverlayCompositePreview(frameIndex: number): Promise<VerticalFrameState>;
      getState(): VerticalFrameState;
      getDiagnostics(): Diagnostics;
      getLegendDiagnostics(): {
        counterMode: "cumulative-to-date";
        rankingMode: "section-locked-rolling-heat";
        heatWindowDays: number;
        dayCount: number;
        doesNotOverlapTimecode: boolean;
        style: typeof ORGANIZATION_LEGEND_STYLE;
      };
      renderWebm(options?: { frameCount?: number }): Promise<{ frameCount: number; frameRate: number; durationSeconds: number; filename: string }>;
      renderTimecodeWebm(): ReturnType<typeof encodeTimecodeTrack>;
      renderLegendWebm(): ReturnType<typeof encodeLegendTrack>;
    };
  }
}

const canvasElement = document.querySelector<HTMLCanvasElement>("#deck-canvas");
const overlayCanvasElement = document.querySelector<HTMLCanvasElement>("#overlay-canvas");
if (!canvasElement || !overlayCanvasElement) throw new Error("Vertical contribution render canvases are missing.");
const canvas: HTMLCanvasElement = canvasElement;
const overlayCanvas: HTMLCanvasElement = overlayCanvasElement;
canvas.width = WIDTH;
canvas.height = HEIGHT;
overlayCanvas.width = WIDTH;
overlayCanvas.height = HEIGHT;
const overlayContextCandidate = overlayCanvas.getContext("2d", { alpha: true });
if (!overlayContextCandidate) throw new Error("Overlay Canvas2D is unavailable.");
const overlayContext: CanvasRenderingContext2D = overlayContextCandidate;

const searchParams = new URLSearchParams(window.location.search);
const sourceUrl = searchParams.get("source");
if (!sourceUrl) throw new Error("An owner-visible contribution snapshot URL is required.");
const timingPreset = searchParams.get("timingPreset");
const usesVisglContributorHandoff = timingPreset === "visgl-contributor-handoff";
const renderTiming = usesVisglContributorHandoff
  ? VERTICAL_VISGL_HANDOFF_EXPORT_TIMING
  : VERTICAL_MOVING_FADE_EXPORT_TIMING;
const renderContract = usesVisglContributorHandoff
  ? VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT
  : VERTICAL_MOVING_FADE_EXPORT_CONTRACT;
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Contribution snapshot failed to load (${response.status}).`);
const snapshot = (await response.json()) as ContributionSnapshot;
const calendar = buildContinuousCalendar(snapshot);
const layout = buildVerticalCalendarLayout(calendar);
const legendTimeline = buildOrganizationLegendTimeline(calendar);
const view = new OrbitView({
  id: "vertical-contribution-crawl",
  controller: false,
  orbitAxis: "Z",
  fovy: 48,
  near: 0.1,
  far: 100_000,
  orthographic: false,
});

let state = buildVerticalFrameState(0, calendar, layout, renderTiming);
let frameResolver: (() => void) | null = null;
let deckReadyResolve: () => void;
const ready = new Promise<void>((resolve) => {
  deckReadyResolve = resolve;
});

const deck = new Deck({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  views: view,
  viewState: state.viewState,
  layers: buildLayers(state, calendar, layout),
  controller: false,
  useDevicePixels: 1,
  parameters: {
    clearColor: [0, 0, 0, 0],
    depthTest: true,
    blend: true,
  } as never,
  deviceProps: {
    powerPreference: "high-performance",
    webgl: {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    },
  },
  onLoad: () => deckReadyResolve(),
  onAfterRender: () => {
    frameResolver?.();
    frameResolver = null;
  },
});

async function setFrame(frameIndex: number): Promise<VerticalFrameState> {
  await ready;
  state = buildVerticalFrameState(frameIndex, calendar, layout, renderTiming);
  clearOverlay();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      frameResolver = null;
      reject(new Error(`Timed out rendering vertical contribution frame ${frameIndex}.`));
    }, 15_000);
    frameResolver = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    deck.setProps({
      viewState: state.viewState,
      layers: buildLayers(state, calendar, layout),
    });
    deck.redraw(`vertical-contribution-frame-${frameIndex}`);
  });
  return state;
}

async function setTimecodePreview(frameIndex: number) {
  const next = await setFrame(frameIndex);
  drawTimecode(overlayContext, next);
  return next;
}

async function setLegendPreview(frameIndex: number) {
  const next = await setFrame(frameIndex);
  drawOrganizationLegend(overlayContext, next, legendTimeline);
  return next;
}

async function setOverlayCompositePreview(frameIndex: number) {
  const next = await setFrame(frameIndex);
  drawOrganizationLegend(overlayContext, next, legendTimeline);
  drawTimecode(overlayContext, next);
  return next;
}

function clearOverlay() {
  overlayContext.clearRect(0, 0, WIDTH, HEIGHT);
}

function buildLayers(
  frameState: VerticalFrameState,
  sourceCalendar: ContinuousCalendar,
  sourceLayout: VerticalCalendarLayout,
): Layer[] {
  const basePolygons: PolygonDatum[] = [];
  const fillPolygons: PolygonDatum[] = [];
  const outlinePaths: PathDatum[] = [];
  const throughputPaths: PathDatum[] = [];
  const introOpacity = frameState.introProgress;
  const showTileBorders = VERTICAL_MOVING_FADE_EXPORT_CONTRACT.tileBorders !== "none";

  for (const cell of sourceLayout.cells) {
    const pose = buildVerticalCellPose(cell, frameState, sourceLayout);
    const distanceOpacity = verticalCellDistanceOpacity(
      cell,
      frameState,
      VERTICAL_HISTORY_VISIBILITY_MODE,
    );
    if (distanceOpacity <= 0.005) continue;
    basePolygons.push({
      id: `base-${cell.date}`,
      polygon: rectangle(pose.x, pose.y, pose.size, 0),
      color: scaleAlpha(EMPTY, distanceOpacity * introOpacity),
    });
    if (showTileBorders) {
      outlinePaths.push({
        id: `outline-${cell.date}`,
        path: rectanglePath(pose.x, pose.y, pose.size, 0.4),
        color: scaleAlpha(EMPTY_OUTLINE, distanceOpacity * introOpacity),
        width: pose.size >= 40 ? 0.85 : 0.45,
      });
    }

    const revealProgress = verticalDayRevealProgress(cell.dataOrdinal, frameState);
    const visibleCount = visibleContributionCount(cell);
    const slices = buildVisibleOrganizationSlices(cell);
    if (revealProgress <= 0 || visibleCount <= 0 || slices.length === 0) continue;

    const visibleWidth = pose.size * revealProgress;
    let sliceBottom = pose.y + pose.size;
    for (const slice of slices) {
      const sliceHeight = pose.size * slice.share;
      const sliceTop = sliceBottom - sliceHeight;
      fillPolygons.push({
        id: `fill-${cell.date}-${slice.key}`,
        polygon: rectangle(pose.x, sliceTop, visibleWidth, 1.2, sliceHeight),
        color: hexToColor(
          sourceCalendar.organizationColors[slice.key],
          Math.round(255 * distanceOpacity * introOpacity),
        ),
      });
      sliceBottom = sliceTop;
    }

    if (revealProgress >= 0.995 && pose.size >= 44) {
      const volume = normalizedDayVolume(visibleCount, sourceCalendar.volumeCeiling);
      const lineCount = Math.min(8, Math.max(1, Math.ceil(Math.log2(visibleCount + 1))));
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        const y = pose.y + pose.size - ((lineIndex + 1) / (lineCount + 1)) * pose.size;
        throughputPaths.push({
          id: `throughput-${cell.date}-${lineIndex}`,
          path: [
            [pose.x + pose.size * 0.1, y, 2.2],
            [pose.x + pose.size * 0.9, y, 2.2],
          ],
          color: [255, 255, 255, Math.round((22 + volume * 62) * distanceOpacity * introOpacity)],
          width: 0.75 + volume * 0.75,
        });
      }
    }
  }

  const activeCell = sourceLayout.cells[frameState.activeDayOrdinal];
  const activePose = buildVerticalCellPose(activeCell, frameState, sourceLayout);
  const activePath: PathDatum[] = frameState.isOverview || !showTileBorders ? [] : [{
    id: `active-${activeCell.date}`,
    path: rectanglePath(activePose.x, activePose.y, activePose.size, 3),
    color: [255, 255, 255, Math.round(frameState.introProgress * (110 + frameState.activeDayProgress * 110))],
    width: 2.25,
  }];

  const borderLayers: Layer[] = showTileBorders ? [
    new PathLayer<PathDatum>({
      id: "vertical-calendar-cell-outlines",
      data: outlinePaths,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPath: (datum) => datum.path,
      getColor: (datum) => datum.color,
      getWidth: (datum) => datum.width,
      widthUnits: "pixels",
      widthMinPixels: 0.45,
      rounded: true,
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false } as never,
      pickable: false,
    }),
    new PathLayer<PathDatum>({
      id: "vertical-calendar-active-day",
      data: activePath,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPath: (datum) => datum.path,
      getColor: (datum) => datum.color,
      getWidth: (datum) => datum.width,
      widthUnits: "pixels",
      widthMinPixels: 1.5,
      rounded: true,
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false } as never,
      pickable: false,
    }),
  ] : [];

  return [
    new SolidPolygonLayer<PolygonDatum>({
      id: "vertical-calendar-base-cells",
      data: basePolygons,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      positionFormat: "XYZ",
      getPolygon: (datum) => datum.polygon,
      getFillColor: (datum) => datum.color,
      parameters: { depthTest: false } as never,
      pickable: false,
    }),
    new SolidPolygonLayer<PolygonDatum>({
      id: "vertical-calendar-revealed-volume",
      data: fillPolygons,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      positionFormat: "XYZ",
      getPolygon: (datum) => datum.polygon,
      getFillColor: (datum) => datum.color,
      parameters: { depthTest: false } as never,
      pickable: false,
    }),
    ...borderLayers,
    new PathLayer<PathDatum>({
      id: "vertical-calendar-throughput-lines",
      data: throughputPaths,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPath: (datum) => datum.path,
      getColor: (datum) => datum.color,
      getWidth: (datum) => datum.width,
      widthUnits: "pixels",
      widthMinPixels: 0.65,
      rounded: true,
      capRounded: true,
      parameters: { depthTest: false } as never,
      pickable: false,
    }),
  ];
}

function rectangle(
  x: number,
  y: number,
  width: number,
  z: number,
  height = width,
): Position[] {
  return [
    [x, y, z],
    [x + width, y, z],
    [x + width, y + height, z],
    [x, y + height, z],
  ];
}

function rectanglePath(x: number, y: number, size: number, z: number): Position[] {
  return [
    [x, y, z],
    [x + size, y, z],
    [x + size, y + size, z],
    [x, y + size, z],
    [x, y, z],
  ];
}

function hexToColor(value: string, alpha: number): Color {
  const match = /^#([0-9a-f]{6})$/iu.exec(value);
  if (!match) return [125, 133, 144, alpha];
  const packed = Number.parseInt(match[1], 16);
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255, alpha];
}

function scaleAlpha(color: readonly [number, number, number, number], opacity: number): Color {
  return [color[0], color[1], color[2], Math.round(color[3] * opacity)];
}

async function renderWebm({ frameCount = renderContract.frameCount }: { frameCount?: number } = {}) {
  const safeFrameCount = Math.max(1, Math.min(renderContract.frameCount, Math.floor(frameCount)));
  const supported = await canEncodeVideo("vp9", {
    width: WIDTH,
    height: HEIGHT,
    bitrate: VIDEO_BITRATE,
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
  });
  if (!supported) throw new Error("This browser cannot encode the vertical 1080p VP9 alpha preview.");

  const target = new BufferTarget();
  const output = new Output({
    format: new WebMOutputFormat(),
    target,
  });
  await setFrame(0);
  const source = new CanvasSource(canvas, {
    codec: "vp9",
    bitrate: VIDEO_BITRATE,
    alpha: "keep",
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, {
    frameRate: FPS,
    maximumPacketCount: safeFrameCount + 2,
  });
  await output.start();

  for (let frameIndex = 0; frameIndex < safeFrameCount; frameIndex += 1) {
    if (frameIndex > 0) await setFrame(frameIndex);
    await source.add(frameIndex / FPS, 1 / FPS, {
      keyFrame: frameIndex === 0 || frameIndex % (FPS * 2) === 0,
    });
    if (frameIndex % 120 === 0 || frameIndex === safeFrameCount - 1) {
      console.log(`CONTRIBUTION_VERTICAL_PROGRESS ${frameIndex + 1}/${safeFrameCount}`);
    }
  }

  await source.close();
  await output.finalize();
  if (!target.buffer) throw new Error("The browser encoder returned no vertical WebM.");
  const filename = safeFrameCount === renderContract.frameCount
    ? `personal-github-contribution-vertical-deckgl-${renderContract.durationSeconds}s.webm`
    : `personal-github-contribution-vertical-deckgl-smoke-${safeFrameCount}f.webm`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([target.buffer], { type: "video/webm" }));
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  return { frameCount: safeFrameCount, frameRate: FPS, durationSeconds: safeFrameCount / FPS, filename };
}

function getDiagnostics(): Diagnostics {
  const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!context) {
    return {
      webgl: false,
      deckView: "OrbitView",
      deckLayerTypes: ["SolidPolygonLayer", "PathLayer"],
      monthCount: layout.monthKeys.length,
      dayCount: layout.cells.length,
      organizationCount: calendar.organizationCount,
      partialRevealMaximum: 1,
      cameraTimeDirection: "forward",
      calendarScreenDirection: "completed-history-toward-top-horizon",
      dayFillDirection: "left-to-right",
      calendarContinuityMode: "continuous-week-ribbon",
      monthDividerMode: "none",
      colorRevealMode: "horizontal-clip-only",
      historyVisibilityMode: "perspective-distance-only",
      transparentBackground: true,
      contract: renderContract,
    };
  }
  const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
  return {
    webgl: true,
    renderer: debugInfo
      ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : String(context.getParameter(context.RENDERER)),
    vendor: debugInfo
      ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
      : String(context.getParameter(context.VENDOR)),
    version: String(context.getParameter(context.VERSION)),
    deckView: "OrbitView",
    deckLayerTypes: ["SolidPolygonLayer", "PathLayer"],
    monthCount: layout.monthKeys.length,
    dayCount: layout.cells.length,
    organizationCount: calendar.organizationCount,
    partialRevealMaximum: 1,
    cameraTimeDirection: "forward",
    calendarScreenDirection: "completed-history-toward-top-horizon",
    dayFillDirection: "left-to-right",
    calendarContinuityMode: "continuous-week-ribbon",
    monthDividerMode: "none",
    colorRevealMode: "horizontal-clip-only",
    historyVisibilityMode: "perspective-distance-only",
    transparentBackground: true,
    contract: renderContract,
  };
}

const frameBuilder = (frameIndex: number, sourceCalendar: ContinuousCalendar) =>
  buildVerticalFrameState(frameIndex, sourceCalendar, layout, renderTiming);

window.__CONTRIBUTION_VERTICAL_CALENDAR__ = {
  ready,
  setFrame,
  setTimecodePreview,
  setLegendPreview,
  setOverlayCompositePreview,
  getState: () => state,
  getDiagnostics,
  renderWebm,
  renderTimecodeWebm: () => encodeTimecodeTrack(calendar, frameBuilder, renderTiming),
  renderLegendWebm: () => encodeLegendTrack(calendar, frameBuilder, renderTiming),
  getLegendDiagnostics: () => ({
    counterMode: "cumulative-to-date",
    rankingMode: "section-locked-rolling-heat",
    heatWindowDays: HEAT_WINDOW_DAYS,
    dayCount: legendTimeline.entriesByDay.length,
    doesNotOverlapTimecode: legendDoesNotOverlapTimecode(),
    style: ORGANIZATION_LEGEND_STYLE,
  }),
};
