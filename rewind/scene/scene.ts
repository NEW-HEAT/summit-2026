import {
  Deck,
  _GlobeView as GlobeView,
  type GlobeViewState,
} from "@deck.gl/core";
import { TileLayer, TripsLayer } from "@deck.gl/geo-layers";
import { BitmapLayer } from "@deck.gl/layers";
import {
  CLIP_CONTRACT,
  frameState,
  playbackFrameForElapsed,
  type FrameState,
} from "./clip-contract";
import {
  cameraForGeographicFlight,
  flightScheduleForFrame,
  focusZoomForMemory,
  geographicFrameState,
  rewindCutoffMs,
  type FitnessArchiveBundle,
  type GeographicFrameState,
  type GeographicMemoryBeat,
} from "./geographic-memory-model";
import {
  analogGlyphProgress,
  analogDateReelFrame,
  formatAnalogMemoryDateRange,
  formatMemoryLocationDisplay,
  memoryLocationTransitionMotion,
  reverseAnalogGlyphMotion,
  type AnalogDateReelFrame,
} from "./geographic-memory-caption";
import { resolveNewheatRouteColor } from "./newheat-route-colors";
import {
  advanceTileStabilitySample,
  EXPORT_PROGRESS_INTERVAL_FRAMES,
  isTileSnapshotReady,
  TILE_LOAD_TIMEOUT_MS,
  TILE_SETTLED_REDRAW_COUNT,
  TILE_STABILITY_SAMPLE_COUNT,
  type TileReadinessSnapshot,
} from "./render-policy";
import { type ArchiveRoute, type ArchiveRoutePath } from "./rewind-model";

type RouteDrawDatum = {
  id: string;
  routeId: string;
  path: [number, number][];
  recordedTimestamps: number[];
  editorialTimestamps: number[];
  provenanceTimestamps: number[];
  activityType: string;
  timing: ArchiveRoute["timing"];
  center: [number, number];
};
type UntimedMode = "provenance" | "editorial";
type ExportStatus = {
  state: "idle" | "running" | "ready" | "error";
  frame: number;
  frameCount: number;
  outputName: string;
  timestampOutputName: string;
  message?: string;
};
type MemoryCaption = {
  targetMs: number;
  sourceMs: number;
  dateRange: string;
  location: string;
  locationPrimary: string;
  locationSecondary: string;
  dateTime: string;
};
type MemoryCaptionPresentation = {
  outgoing: MemoryCaption;
  incoming: MemoryCaption;
  cycleProgress: number;
  reel: AnalogDateReelFrame;
};
type RewindDiagnostics = {
  ready: boolean;
  webgl2: boolean;
  renderer: string | null;
  vendor: string | null;
  version: string | null;
  data: {
    status: "loading" | "ready" | "missing" | "error";
    routeCount: number;
    visibleRouteCount: number;
    visiblePathCount: number;
    timedRouteCount: number;
    inferredRouteCount: number;
    ownerFingerprint: string | null;
    generatedAt: string | null;
    untimedMode: UntimedMode;
  };
  canvas: {
    left: number;
    top: number;
    cssWidth: number;
    cssHeight: number;
    clientWidth: number;
    clientHeight: number;
  };
  tiles: {
    preloaded: number;
    loaded: number;
    viewportTileCount: number;
    viewportRevision: number;
    errors: string[];
    layerLoaded: boolean;
  };
  frame: FrameState;
};
type WebGlReadback = {
  gl: WebGL2RenderingContext;
  stagingCanvas: HTMLCanvasElement;
  stagingContext: CanvasRenderingContext2D;
  pixels: Uint8ClampedArray<ArrayBuffer>;
};
type RewindApi = {
  ready: Promise<void>;
  setFrame(
    frameIndex: number,
    options?: { settleTiles?: boolean }
  ): Promise<FrameState>;
  stepFrames(frameDelta: number): Promise<FrameState>;
  play(): void;
  pause(): void;
  encodeFastMedia(frameCount?: number): Promise<{
    firstState: FrameState;
    lastState: FrameState;
  }>;
  encodeTimestampMedia(frameCount?: number): Promise<{
    firstState: FrameState;
    lastState: FrameState;
  }>;
  getState(): FrameState;
  getStatus(): RewindDiagnostics & { playing: boolean };
};
declare global {
  interface Window {
    __WORLD_IMAGERY_REWIND__: RewindApi;
    __NEWHEAT_QA__?: {
      schemaVersion: number;
      snapshot(): Record<string, unknown>;
    };
  }
}

const canvas = required<HTMLCanvasElement>("#world-imagery-canvas");
const playButton = required<HTMLButtonElement>("#play-toggle");
const frameSlider = required<HTMLInputElement>("#frame-slider");
const dateLabel = required<HTMLElement>("#rewind-date");
const exportTimestamp = required<HTMLTimeElement>("#export-timestamp");
const timestampPreviewCanvas = required<HTMLCanvasElement>(
  "#timestamp-preview-canvas"
);
const timestampPreviewContext = requiredAlphaContext(timestampPreviewCanvas);
const beatLabel = required<HTMLElement>("#rewind-beat");
const windowLabel = required<HTMLElement>("#rewind-window");
const zoneLabel = required<HTMLElement>("#rewind-zone");
const archiveLabel = required<HTMLElement>("#archive-status");
const modeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-untimed-mode]")
);
const query = new URLSearchParams(window.location.search);
const interactiveUi = query.get("ui") !== "0";
const previewTrack = query.get("track") === "timestamp" ? "timestamp" : "globe";
document.documentElement.dataset.ui = interactiveUi ? "interactive" : "clean";
document.documentElement.dataset.track = previewTrack;

const tileErrors: string[] = [];
let archiveStatus: RewindDiagnostics["data"]["status"] = "loading";
let archive: FitnessArchiveBundle | null = null;
let sequenceRoutes: ArchiveRoute[] = [];
let routeDrawData: RouteDrawDatum[] = [];
let outgoingRouteDrawData: RouteDrawDatum[] = [];
let incomingRouteDrawData: RouteDrawDatum[] = [];
let visibleRouteCount = 0;
let visiblePathCount = 0;
let outgoingOpacity = 0;
let incomingOpacity = 0;
let outgoingCalendarDay = 0;
let incomingCalendarDay = 0;
let focusBeatIndex = -1;
let focusIsFinalTail = false;
let untimedMode: UntimedMode = "provenance";
let focusRouteRevision = 0;
let preloadedTileCount = 0;
let loadedTileCount = 0;
let viewportTileCount = 0;
let viewportLoadRevision = 0;
let currentFrame = readInitialFrame();
let currentState: GeographicFrameState = {
  ...frameState(currentFrame),
  finalTailProgress: 0,
  inFinalTail: false,
};
let playing = false;
let playbackRequest = 0;
let playbackStartFrame = 0;
let playbackStartedAt = 0;
let exportState: ExportStatus["state"] = "idle";
let exportPollTimer = 0;
let readyResolved = false;
let frameQueue: Promise<FrameState> = Promise.resolve(currentState);
const renderWaiters = new Set<() => void>();

const view = new GlobeView({
  id: "fitness-rewind-globe",
  controller: false,
  clear: true,
  clearColor: [0, 0, 0, 1],
  resolution: 3,
});
let tileLayer: TileLayer<ImageBitmap>;

async function fetchWorldImageryResponse(
  url: string,
  signal?: AbortSignal
): Promise<Response> {
  const retryDelays = [0, 120, 400, 900] as const;
  let lastError: unknown = null;
  for (const delay of retryDelays) {
    if (signal?.aborted)
      throw new DOMException("Tile request aborted.", "AbortError");
    if (delay > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
    }
    try {
      const response = await fetch(url, { cache: "force-cache", signal });
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(
          `World Imagery tile failed (${response.status})${detail ? `: ${detail}` : ""}.`
        );
      }
      return response;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("World Imagery tile failed after retries.");
}

async function loadWorldImageryTile({
  url,
  signal,
}: {
  url?: string | null;
  signal?: AbortSignal;
}): Promise<ImageBitmap> {
  if (!url) throw new Error("World Imagery tile URL is missing.");
  const response = await fetchWorldImageryResponse(url, signal);
  return createImageBitmap(await response.blob());
}

function createTileLayer(): TileLayer<ImageBitmap> {
  const projectionBucket = currentState.viewState.zoom > 7.5 ? "flat" : "globe";
  return new TileLayer<ImageBitmap>({
    id: `fitness-rewind-world-imagery-${projectionBucket}`,
    data: CLIP_CONTRACT.imagery.tileUrl,
    getTileData: loadWorldImageryTile,
    maxCacheSize: CLIP_CONTRACT.imagery.maxCacheSize,
    maxRequests: CLIP_CONTRACT.imagery.maxRequests,
    maxZoom: CLIP_CONTRACT.imagery.maxZoom,
    minZoom: CLIP_CONTRACT.imagery.minZoom,
    opacity: 1,
    pickable: false,
    visible: true,
    refinementStrategy: CLIP_CONTRACT.imagery.refinementStrategy,
    tileSize: CLIP_CONTRACT.imagery.tileSize,
    zoomOffset: CLIP_CONTRACT.imagery.zoomOffset,
    onTileLoad: () => {
      loadedTileCount += 1;
    },
    onTileError: (error) =>
      tileErrors.push(error instanceof Error ? error.message : String(error)),
    onViewportLoad: (tiles) => {
      viewportTileCount = tiles.length;
      viewportLoadRevision += 1;
    },
    renderSubLayers: (props) => {
      const [[west, south], [east, north]] = props.tile.boundingBox as [
        [number, number],
        [number, number],
      ];
      const tileY = props.tile.index.y;
      const tileCount = 2 ** props.tile.index.z;
      const polarSouth = tileY === tileCount - 1 ? -90 : south;
      const polarNorth = tileY === 0 ? 90 : north;
      const { data: image, ...bitmapProps } = props;
      return new BitmapLayer(bitmapProps, {
        image,
        bounds: [west, polarSouth, east, polarNorth],
        parameters: {
          cullMode: "back",
          depthCompare: "always",
          depthWriteEnabled: false,
        },
      });
    },
  });
}

let deckLoadedResolve: () => void = () => {};
const deckLoaded = new Promise<void>((resolve) => {
  deckLoadedResolve = resolve;
});
const deck = new Deck({
  canvas,
  width: "100%",
  height: "100%",
  views: view,
  viewState: currentState.viewState as GlobeViewState,
  layers: buildLayers(),
  controller: false,
  useDevicePixels: CLIP_CONTRACT.devicePixelRatio,
  parameters: { clearColor: CLIP_CONTRACT.lighting.clearColor } as never,
  deviceProps: {
    powerPreference: "high-performance",
    webgl: { alpha: false, antialias: true, preserveDrawingBuffer: true },
  },
  onLoad: () => deckLoadedResolve(),
  onAfterRender: () => {
    for (const resolve of renderWaiters) resolve();
    renderWaiters.clear();
  },
  onError: (error) => {
    tileErrors.push(error.message);
    console.error(error);
  },
});

const ready = initialize();
window.__WORLD_IMAGERY_REWIND__ = {
  ready,
  setFrame,
  stepFrames: (delta) =>
    setFrame(clamp(currentFrame + delta, 0, CLIP_CONTRACT.frameCount - 1)),
  play,
  pause,
  encodeFastMedia,
  encodeTimestampMedia,
  getState: () => currentState,
  getStatus: () => ({ ...getDiagnostics(), playing }),
};

async function encodeFastMedia(frameCount = CLIP_CONTRACT.frameCount): Promise<{
  firstState: FrameState;
  lastState: FrameState;
}> {
  if (
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    frameCount > CLIP_CONTRACT.frameCount
  ) {
    throw new RangeError(
      `Export frame count must be an integer from 1 to ${CLIP_CONTRACT.frameCount}.`
    );
  }
  pause();
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = CLIP_CONTRACT.width;
  exportCanvas.height = CLIP_CONTRACT.height;
  const context = exportCanvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D is required for fast export.");
  const globeReadback = createWebGlReadback();
  const timestampCanvas = document.createElement("canvas");
  timestampCanvas.width = CLIP_CONTRACT.width;
  timestampCanvas.height = CLIP_CONTRACT.height;
  const timestampContext = timestampCanvas.getContext("2d", { alpha: true });
  if (!timestampContext)
    throw new Error("Canvas 2D alpha is required for timestamp export.");

  const {
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    WebMOutputFormat,
  } = await import("mediabunny");
  const globeTarget = new BufferTarget();
  const globeOutput = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: globeTarget,
  });
  const globeSource = new CanvasSource(exportCanvas, {
    codec: "avc",
    bitrate: 80_000_000,
    bitrateMode: "variable",
    latencyMode: "quality",
    keyFrameInterval: 1,
  });
  globeOutput.addVideoTrack(globeSource, {
    frameRate: CLIP_CONTRACT.fps,
    maximumPacketCount: frameCount + 2,
  });
  const timestampTarget = new BufferTarget();
  const timestampOutput = new Output({
    format: new WebMOutputFormat(),
    target: timestampTarget,
  });
  const timestampSource = new CanvasSource(timestampCanvas, {
    codec: "vp9",
    bitrate: 4_000_000,
    alpha: "keep",
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
    keyFrameInterval: 2,
  });
  timestampOutput.addVideoTrack(timestampSource, {
    frameRate: CLIP_CONTRACT.fps,
    maximumPacketCount: frameCount + 2,
  });
  await Promise.all([globeOutput.start(), timestampOutput.start()]);

  let firstState: FrameState = currentState;
  let lastState: FrameState = currentState;
  for (let exportFrame = 0; exportFrame < frameCount; exportFrame += 1) {
    const state = await applyFrame(exportFrame, true);
    if (exportFrame === 0) firstState = state;
    lastState = state;
    copyWebGlFrame(context, globeReadback);
    timestampContext.clearRect(0, 0, CLIP_CONTRACT.width, CLIP_CONTRACT.height);
    if (!archive)
      throw new Error("Timestamp export requires the fitness archive.");
    drawEncodedTimestamp(timestampContext, currentState, archive.sequence);
    const timestampSeconds = exportFrame / CLIP_CONTRACT.fps;
    const durationSeconds = 1 / CLIP_CONTRACT.fps;
    await Promise.all([
      globeSource.add(timestampSeconds, durationSeconds, {
        keyFrame: exportFrame === 0 || exportFrame % 120 === 0,
      }),
      timestampSource.add(timestampSeconds, durationSeconds, {
        keyFrame: exportFrame === 0 || exportFrame % 120 === 0,
      }),
    ]);
    if (
      exportFrame === 0 ||
      (exportFrame + 1) % EXPORT_PROGRESS_INTERVAL_FRAMES === 0 ||
      exportFrame === frameCount - 1
    ) {
      console.log(
        `WORLD_IMAGERY_REWIND_PROGRESS ${exportFrame + 1}/${frameCount}`
      );
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve())
      );
    }
  }

  await Promise.all([globeOutput.finalize(), timestampOutput.finalize()]);
  if (!globeTarget.buffer)
    throw new Error("Fast export produced no MP4 buffer.");
  if (!timestampTarget.buffer)
    throw new Error("Fast export produced no timestamp WebM buffer.");
  downloadEncodedBuffer(
    globeTarget.buffer,
    "video/mp4",
    "fitness-globe-rewind-intermediate.mp4"
  );
  downloadEncodedBuffer(
    timestampTarget.buffer,
    "video/webm",
    "fitness-globe-rewind-timestamps.webm"
  );
  return { firstState, lastState };
}

function createWebGlReadback(): WebGlReadback {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 readback is required for globe export.");
  if (
    gl.drawingBufferWidth !== CLIP_CONTRACT.width ||
    gl.drawingBufferHeight !== CLIP_CONTRACT.height
  ) {
    throw new Error(
      `Unexpected WebGL drawing buffer ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}.`
    );
  }
  const stagingCanvas = document.createElement("canvas");
  stagingCanvas.width = CLIP_CONTRACT.width;
  stagingCanvas.height = CLIP_CONTRACT.height;
  const stagingContext = stagingCanvas.getContext("2d", { alpha: false });
  if (!stagingContext) {
    throw new Error("Canvas 2D is required for WebGL export readback.");
  }
  return {
    gl,
    stagingCanvas,
    stagingContext,
    pixels: new Uint8ClampedArray(
      new ArrayBuffer(CLIP_CONTRACT.width * CLIP_CONTRACT.height * 4)
    ),
  };
}

function copyWebGlFrame(
  target: CanvasRenderingContext2D,
  readback: WebGlReadback
): void {
  const { gl, stagingCanvas, stagingContext, pixels } = readback;
  gl.finish();
  gl.readPixels(
    0,
    0,
    CLIP_CONTRACT.width,
    CLIP_CONTRACT.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels
  );
  stagingContext.putImageData(
    new ImageData(pixels, CLIP_CONTRACT.width, CLIP_CONTRACT.height),
    0,
    0
  );
  target.save();
  target.setTransform(1, 0, 0, -1, 0, CLIP_CONTRACT.height);
  target.drawImage(stagingCanvas, 0, 0);
  target.restore();
}

async function encodeTimestampMedia(
  frameCount = CLIP_CONTRACT.frameCount
): Promise<{ firstState: FrameState; lastState: FrameState }> {
  if (
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    frameCount > CLIP_CONTRACT.frameCount
  ) {
    throw new RangeError(
      `Export frame count must be an integer from 1 to ${CLIP_CONTRACT.frameCount}.`
    );
  }
  pause();
  await ready;
  if (!archive)
    throw new Error("Timestamp export requires the fitness archive.");

  const timestampCanvas = document.createElement("canvas");
  timestampCanvas.width = CLIP_CONTRACT.width;
  timestampCanvas.height = CLIP_CONTRACT.height;
  const timestampContext = timestampCanvas.getContext("2d", { alpha: true });
  if (!timestampContext) {
    throw new Error("Canvas 2D alpha is required for timestamp export.");
  }

  const { BufferTarget, CanvasSource, Output, WebMOutputFormat } =
    await import("mediabunny");
  const timestampTarget = new BufferTarget();
  const timestampOutput = new Output({
    format: new WebMOutputFormat(),
    target: timestampTarget,
  });
  const timestampSource = new CanvasSource(timestampCanvas, {
    codec: "vp9",
    bitrate: 8_000_000,
    alpha: "keep",
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
    keyFrameInterval: 2,
  });
  timestampOutput.addVideoTrack(timestampSource, {
    frameRate: CLIP_CONTRACT.fps,
    maximumPacketCount: frameCount + 2,
  });
  await timestampOutput.start();

  let firstState = timestampEvidenceState(
    geographicFrameState(0, archive.sequence),
    archive.sequence
  );
  let lastState = firstState;
  for (let exportFrame = 0; exportFrame < frameCount; exportFrame += 1) {
    const state = timestampEvidenceState(
      geographicFrameState(exportFrame, archive.sequence),
      archive.sequence
    );
    if (exportFrame === 0) firstState = state;
    lastState = state;
    timestampContext.clearRect(0, 0, CLIP_CONTRACT.width, CLIP_CONTRACT.height);
    drawEncodedTimestamp(timestampContext, state, archive.sequence);
    await timestampSource.add(
      exportFrame / CLIP_CONTRACT.fps,
      1 / CLIP_CONTRACT.fps,
      { keyFrame: exportFrame === 0 || exportFrame % 120 === 0 }
    );
    if (
      exportFrame === 0 ||
      (exportFrame + 1) % EXPORT_PROGRESS_INTERVAL_FRAMES === 0 ||
      exportFrame === frameCount - 1
    ) {
      console.log(
        `WORLD_IMAGERY_REWIND_PROGRESS ${exportFrame + 1}/${frameCount}`
      );
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve())
      );
    }
  }

  await timestampOutput.finalize();
  if (!timestampTarget.buffer) {
    throw new Error("Timestamp-only export produced no WebM buffer.");
  }
  downloadEncodedBuffer(
    timestampTarget.buffer,
    "video/webm",
    "fitness-globe-rewind-timestamps.webm"
  );
  return { firstState, lastState };
}

function downloadEncodedBuffer(
  buffer: ArrayBuffer,
  mimeType: string,
  downloadName: string
): void {
  const downloadUrl = URL.createObjectURL(
    new Blob([buffer], { type: mimeType })
  );
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = downloadName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
}

function drawEncodedTimestamp(
  context: CanvasRenderingContext2D,
  state: GeographicFrameState,
  sequence: FitnessArchiveBundle["sequence"]
): void {
  const presentation = memoryCaptionPresentationForFrame(state, sequence);
  drawAnalogDateReel(context, presentation.reel);
  drawMemoryLocationTransition(context, presentation);
}

function drawAnalogDateReel(
  context: CanvasRenderingContext2D,
  reel: AnalogDateReelFrame
): void {
  const glyphs = alignedReelGlyphs(reel.outgoing, reel.incoming);
  const cellWidth = 39;
  const cellHeight = 84;
  const boardWidth = glyphs.outgoing.length * cellWidth;
  const boardLeft = -boardWidth / 2;
  const boardCenterY = -46;
  context.save();
  context.translate(CLIP_CONTRACT.width / 2, CLIP_CONTRACT.height / 2);
  context.fillStyle = "#ffffff";
  context.font =
    '600 60px "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0, 0, 0, 0.82)";
  context.shadowBlur = 16;
  context.shadowOffsetY = 2;
  for (let index = 0; index < glyphs.outgoing.length; index += 1) {
    const outgoing = glyphs.outgoing[index];
    const incoming = glyphs.incoming[index];
    const x = boardLeft + (index + 0.5) * cellWidth;
    if (outgoing === incoming) {
      context.globalAlpha = 0.98;
      context.fillText(outgoing, x, boardCenterY);
      continue;
    }
    const progress = analogGlyphProgress(
      reel.progress,
      index,
      glyphs.outgoing.length
    );
    const motion = reverseAnalogGlyphMotion(progress, cellHeight);
    context.save();
    context.beginPath();
    context.rect(
      boardLeft + index * cellWidth,
      boardCenterY - cellHeight / 2,
      cellWidth,
      cellHeight
    );
    context.clip();
    context.globalAlpha = 0.98;
    context.fillText(outgoing, x, boardCenterY + motion.outgoingOffsetY);
    context.fillText(incoming, x, boardCenterY + motion.incomingOffsetY);
    context.restore();
  }
  context.restore();
}

function alignedReelGlyphs(
  outgoing: string,
  incoming: string
): { outgoing: string; incoming: string } {
  const length = Math.max(outgoing.length, incoming.length);
  const centerPad = (value: string): string => {
    const missing = length - value.length;
    const left = Math.floor(missing / 2);
    return `${" ".repeat(left)}${value}${" ".repeat(missing - left)}`;
  };
  return {
    outgoing: centerPad(outgoing),
    incoming: centerPad(incoming),
  };
}

function drawMemoryLocationTransition(
  context: CanvasRenderingContext2D,
  presentation: MemoryCaptionPresentation
): void {
  const motion = memoryLocationTransitionMotion(presentation.cycleProgress);
  drawMemoryLocation(
    context,
    presentation.outgoing,
    motion.outgoingOpacity,
    motion.outgoingOffsetY
  );
  drawMemoryLocation(
    context,
    presentation.incoming,
    motion.incomingOpacity,
    motion.incomingOffsetY
  );
}

function drawMemoryLocation(
  context: CanvasRenderingContext2D,
  caption: MemoryCaption,
  opacity: number,
  offsetY: number
): void {
  if (opacity <= 0.001) return;
  context.save();
  context.translate(
    CLIP_CONTRACT.width / 2,
    CLIP_CONTRACT.height / 2 + offsetY
  );
  context.globalAlpha = opacity;
  context.fillStyle = "#ffffff";
  context.shadowColor = "rgba(0, 0, 0, 0.82)";
  context.shadowBlur = 16;
  context.shadowOffsetY = 2;
  context.font = '650 42px "Helvetica Neue", Helvetica, Arial, sans-serif';
  drawCenteredFittedTrackedText(
    context,
    caption.locationPrimary.toUpperCase(),
    48,
    2.8,
    1_240
  );
  if (caption.locationSecondary) {
    context.globalAlpha = opacity * 0.7;
    context.font = '550 25px "Helvetica Neue", Helvetica, Arial, sans-serif';
    drawCenteredFittedTrackedText(
      context,
      caption.locationSecondary.toUpperCase(),
      92,
      2.4,
      1_180
    );
  }
  context.restore();
}

function drawCenteredFittedTrackedText(
  context: CanvasRenderingContext2D,
  value: string,
  y: number,
  tracking: number,
  maximumWidth: number
): void {
  const width = trackedTextWidth(context, value, tracking);
  if (width <= maximumWidth) {
    drawCenteredTrackedText(context, value, y, tracking);
    return;
  }
  context.save();
  const scale = maximumWidth / width;
  context.scale(scale, 1);
  drawCenteredTrackedText(context, value, y, tracking);
  context.restore();
}

function drawCenteredTrackedText(
  context: CanvasRenderingContext2D,
  value: string,
  y: number,
  tracking: number
): void {
  drawTrackedText(
    context,
    value,
    -trackedTextWidth(context, value, tracking) / 2,
    y,
    tracking
  );
}

function drawTrackedText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  tracking: number
): void {
  let cursor = x;
  for (const character of value) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + tracking;
  }
}

function trackedTextWidth(
  context: CanvasRenderingContext2D,
  value: string,
  tracking: number
): number {
  let width = 0;
  for (const character of value) width += context.measureText(character).width;
  return width + Math.max(value.length - 1, 0) * tracking;
}

function memoryCaptionForFrame(
  state: GeographicFrameState,
  sequence: FitnessArchiveBundle["sequence"]
): MemoryCaption {
  const presentation = memoryCaptionPresentationForFrame(state, sequence);
  return dominantMemoryCaption(presentation);
}

function dominantMemoryCaption(
  presentation: MemoryCaptionPresentation
): MemoryCaption {
  const motion = memoryLocationTransitionMotion(presentation.cycleProgress);
  return motion.incomingOpacity >= motion.outgoingOpacity
    ? presentation.incoming
    : presentation.outgoing;
}

function timestampEvidenceState(
  state: GeographicFrameState,
  sequence: FitnessArchiveBundle["sequence"]
): GeographicFrameState {
  const caption = memoryCaptionForFrame(state, sequence);
  return {
    ...state,
    calendarIso: caption.dateTime,
    calendarMs: Date.parse(`${caption.dateTime}T00:00:00.000Z`),
  };
}

function memoryCaptionPresentationForFrame(
  state: GeographicFrameState,
  sequence: FitnessArchiveBundle["sequence"]
): MemoryCaptionPresentation {
  const destination = sequence.beats[state.beatIndex - 1];
  const cycleProgress = state.inFinalTail
    ? state.stableHandoff
      ? 1
      : state.finalTailProgress
    : state.beatProgress;
  const outgoing = state.inFinalTail
    ? captionForMemoryBeat(destination)
    : state.beatIndex > 1
      ? captionForMemoryBeat(sequence.beats[state.beatIndex - 2])
      : initialTimestampCaption();
  const incoming = state.inFinalTail
    ? finalTimestampCaption()
    : captionForMemoryBeat(destination);
  return {
    outgoing,
    incoming,
    cycleProgress,
    reel: analogDateReelFrame(outgoing, incoming, cycleProgress),
  };
}

function captionForMemoryBeat(beat: GeographicMemoryBeat): MemoryCaption {
  const location = beat.zone.location
    ? formatMemoryLocationDisplay(beat.zone.location)
    : { primary: "Location unavailable", secondary: "" };
  return {
    targetMs: beat.targetMs,
    sourceMs: beat.sourceMs,
    dateRange: formatAnalogMemoryDateRange(beat),
    location: [location.primary, location.secondary].filter(Boolean).join(", "),
    locationPrimary: location.primary,
    locationSecondary: location.secondary,
    dateTime: beat.targetDate,
  };
}

function initialTimestampCaption(): MemoryCaption {
  const timestamp = Date.parse("2026-09-06T00:00:00.000Z");
  return {
    targetMs: timestamp,
    sourceMs: timestamp,
    dateRange: formatAnalogMemoryDateRange({
      targetMs: timestamp,
      sourceMs: timestamp,
    }),
    location: "Zürich, Switzerland",
    locationPrimary: "Zürich",
    locationSecondary: "Switzerland",
    dateTime: "2026-09-06",
  };
}

function finalTimestampCaption(): MemoryCaption {
  const timestamp = Date.parse("2023-01-01T00:00:00.000Z");
  return {
    targetMs: timestamp,
    sourceMs: timestamp,
    dateRange: formatAnalogMemoryDateRange({
      targetMs: timestamp,
      sourceMs: timestamp,
    }),
    location: "Earth",
    locationPrimary: "Earth",
    locationSecondary: "",
    dateTime: "2023-01-01",
  };
}
window.__NEWHEAT_QA__ = {
  schemaVersion: 1,
  snapshot: () => {
    const diagnostics = getDiagnostics();
    return {
      app: {
        ready: diagnostics.ready,
        reactReady: true,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        canvasFillsViewport:
          Math.abs(diagnostics.canvas.cssWidth - window.innerWidth) <= 1 &&
          Math.abs(diagnostics.canvas.cssHeight - window.innerHeight) <= 1,
      },
      rewind: {
        archiveStatus: diagnostics.data.status,
        routeCount: diagnostics.data.routeCount,
        clusterCount: archive?.sequence.beats.length ?? 0,
        alternateCount: archive?.sequence.alternates.length ?? 0,
        selectionKind: archive?.sequence.kind ?? null,
        visibleRouteCount: diagnostics.data.visibleRouteCount,
        timedRouteCount: diagnostics.data.timedRouteCount,
        inferredRouteCount: diagnostics.data.inferredRouteCount,
        ownerFingerprint: diagnostics.data.ownerFingerprint,
        frameIndex: diagnostics.frame.frameIndex,
        beatIndex: diagnostics.frame.beatIndex,
        calendarIso: diagnostics.frame.calendarIso,
        playing,
        webgl2: diagnostics.webgl2,
        imageryReady: diagnostics.tiles.layerLoaded,
        tileErrorCount: diagnostics.tiles.errors.length,
        colorSystem: "newheat-activity",
        exportState,
        exportTimestamp: exportTimestamp.dateTime,
        timestampTrack: "separate-alpha",
      },
      studio: {
        renderer: {
          webgl2Available: diagnostics.webgl2,
        },
      },
    };
  },
};

document.addEventListener("keydown", handleKeyDown);
playButton.addEventListener("click", () => (playing ? pause() : play()));
frameSlider.addEventListener("input", () => {
  pause();
  void setFrame(Number(frameSlider.value));
});
for (const button of modeButtons) {
  button.addEventListener("click", () => {
    untimedMode =
      button.dataset.untimedMode === "editorial" ? "editorial" : "provenance";
    updateModeButtons();
    void setFrame(currentFrame);
  });
}
window.addEventListener(
  "beforeunload",
  () => {
    deck.finalize();
  },
  { once: true }
);

async function initialize(): Promise<void> {
  const archiveRequest = loadArchive();
  await Promise.all([deckLoaded, preloadTilePyramid()]);
  await archiveRequest;
  deck.setProps({ layers: buildLayers() });
  await applyFrame(currentFrame);
  readyResolved = true;
  document.documentElement.dataset.ready = "true";
  if (interactiveUi) void refreshExportStatus();
  if (query.get("autoplay") === "1") play();
}

async function loadArchive(): Promise<void> {
  try {
    const response = await fetch("/fitness-archive.json", {
      cache: "no-store",
    });
    if (!response.ok) {
      archiveStatus = "missing";
      archiveLabel.textContent = "Local archive missing · run sync";
      return;
    }
    const payload = (await response.json()) as FitnessArchiveBundle;
    if (
      payload.status !== "ready" ||
      payload.schemaVersion !== 2 ||
      payload.sequence.kind !== "geographic-memories-v1" ||
      payload.sequence.beats.length !== 32
    )
      throw new Error("Fitness archive has an invalid scene contract.");
    archive = payload;
    archiveStatus = "ready";
    document.documentElement.dataset.archiveStatus = "ready";
    document.documentElement.dataset.archiveRouteCount = String(
      payload.routeCount
    );
    const selectedRouteIds = new Set(
      payload.sequence.beats.flatMap((beat) => beat.zone.allRouteIds)
    );
    sequenceRoutes = payload.routes.filter((route) =>
      selectedRouteIds.has(route.id)
    );
    buildStaticRouteData();
    archiveLabel.textContent = `${payload.sequence.beats.length} geographic memories · ${payload.sequence.alternates.length} alternates · ${sequenceRoutes.length.toLocaleString()} selected routes · E exports MOV`;
  } catch (error) {
    archiveStatus = "error";
    document.documentElement.dataset.archiveStatus = "error";
    archiveLabel.textContent = "Archive error · inspect console";
    console.error(error);
  }
}

function setFrame(
  frameIndex: number,
  options: { settleTiles?: boolean } = {}
): Promise<FrameState> {
  frameQueue = frameQueue
    .catch(() => currentState)
    .then(async () => {
      await ready;
      return applyFrame(frameIndex, options.settleTiles ?? true);
    });
  return frameQueue;
}

async function applyFrame(
  frameIndex: number,
  settleEveryTileSet = true
): Promise<FrameState> {
  const baseState = archive
    ? geographicFrameState(frameIndex, archive.sequence)
    : ({
        ...frameState(frameIndex),
        finalTailProgress: 0,
        inFinalTail: false,
      } satisfies GeographicFrameState);
  const beat = archive?.sequence.beats[baseState.beatIndex - 1];
  const schedule = flightScheduleForFrame(baseState);
  const camera = archive
    ? cameraForGeographicFlight(baseState, archive.sequence)
    : {
        ...baseState.viewState,
        unwrappedLongitude: baseState.unwrappedLongitude,
        diveWeight: 0,
        rewindProgress: 0,
      };
  if (
    beat &&
    (beat.beat !== focusBeatIndex || baseState.inFinalTail !== focusIsFinalTail)
  ) {
    rebuildFocusRoutes(beat, baseState.inFinalTail);
  }
  outgoingOpacity = beat ? schedule.outgoingOpacity : 0;
  incomingOpacity = beat ? schedule.incomingOpacity : 0;
  const outgoingBeat = beat
    ? baseState.inFinalTail
      ? beat
      : archive?.sequence.beats[beat.beat - 2]
    : undefined;
  outgoingCalendarDay = outgoingBeat
    ? toSceneDay(rewindCutoffMs(outgoingBeat, schedule.outgoingRewindProgress))
    : 0;
  incomingCalendarDay = beat
    ? toSceneDay(
        mix(beat.targetMs, beat.sourceMs, schedule.incomingPlaybackProgress)
      )
    : 0;
  const calendarMs = !beat
    ? baseState.calendarMs
    : baseState.stableHandoff
      ? Date.parse("2023-01-01T00:00:00.000Z")
      : baseState.inFinalTail
        ? beat.representativeMs
        : schedule.phase === "landing"
          ? beat.representativeMs
          : (outgoingBeat?.representativeMs ??
            Date.parse("2026-09-06T00:00:00.000Z"));
  currentState = {
    ...baseState,
    calendarMs,
    calendarIso: new Date(calendarMs).toISOString().slice(0, 10),
    unwrappedLongitude: camera.unwrappedLongitude,
    viewState: {
      longitude: camera.longitude,
      latitude: camera.latitude,
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
    },
  };
  currentFrame = frameIndex;
  visibleRouteCount = new Set(
    [...outgoingRouteDrawData, ...incomingRouteDrawData].map(
      (datum) => datum.routeId
    )
  ).size;
  visiblePathCount =
    outgoingRouteDrawData.length + incomingRouteDrawData.length;
  updateUi(beat);
  const waitForSettledFrame = !interactiveUi || !playing;
  deck.setProps({
    viewState: currentState.viewState as GlobeViewState,
    layers: buildLayers(),
  });
  if (waitForSettledFrame) {
    await waitForRender(`fitness-rewind-frame-${frameIndex}`);
    if (settleEveryTileSet) {
      await waitForTiles(frameIndex);
    } else {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await waitForRender(`fitness-rewind-export-yield-${frameIndex}`);
    }
  } else {
    deck.redraw(`fitness-rewind-frame-${frameIndex}`);
  }
  return currentState;
}

function buildStaticRouteData(): void {
  routeDrawData = [];
  for (const route of sequenceRoutes) {
    route.paths.forEach((path, index) => {
      if (path.positions.length < 2) return;
      const timestamps = routeTimestamps(route, path);
      routeDrawData.push({
        id: `${route.id}:${index}`,
        routeId: route.id,
        path: path.positions,
        ...timestamps,
        activityType: route.activityType,
        timing: route.timing,
        center: route.center,
      });
    });
  }
  outgoingRouteDrawData = [];
  incomingRouteDrawData = [];
  focusBeatIndex = -1;
  focusIsFinalTail = false;
}

function rebuildFocusRoutes(
  beat: GeographicMemoryBeat | undefined,
  finalTail: boolean
): void {
  focusBeatIndex = beat?.beat ?? -1;
  focusIsFinalTail = finalTail;
  if (!beat) {
    outgoingRouteDrawData = [];
    incomingRouteDrawData = [];
  } else if (finalTail) {
    const outgoingIds = new Set(beat.zone.routeIds);
    outgoingRouteDrawData = routeDrawData.filter((datum) =>
      outgoingIds.has(datum.routeId)
    );
    incomingRouteDrawData = [];
  } else {
    const previous = archive?.sequence.beats[beat.beat - 2];
    const outgoingIds = new Set(previous?.zone.routeIds ?? []);
    const incomingIds = new Set(beat.zone.routeIds);
    outgoingRouteDrawData = routeDrawData.filter((datum) =>
      outgoingIds.has(datum.routeId)
    );
    incomingRouteDrawData = routeDrawData.filter((datum) =>
      incomingIds.has(datum.routeId)
    );
  }
  focusRouteRevision += 1;
}

function buildLayers() {
  tileLayer = createTileLayer();
  return [
    tileLayer,
    createMemoryGlowLayer("outgoing"),
    createMemoryGlowLayer("incoming"),
    createMemoryRouteLayer("outgoing"),
    createMemoryRouteLayer("incoming"),
  ];
}

function createMemoryGlowLayer(
  role: "outgoing" | "incoming"
): TripsLayer<RouteDrawDatum> {
  const outgoing = role === "outgoing";
  return new TripsLayer<RouteDrawDatum>({
    id: `fitness-rewind-route-${role}-glow`,
    data: outgoing ? outgoingRouteDrawData : incomingRouteDrawData,
    getPath: (datum) => datum.path,
    getTimestamps: routeTimestampsForMode,
    getColor: (datum) =>
      resolveNewheatRouteColor(
        datum.activityType,
        datum.timing === "recorded"
          ? outgoing
            ? 98
            : 205
          : outgoing
            ? 64
            : 150
      ),
    getWidth: (datum) =>
      datum.timing === "recorded"
        ? outgoing
          ? 8.5
          : 13.5
        : outgoing
          ? 6.5
          : 10.5,
    currentTime: outgoing ? outgoingCalendarDay : incomingCalendarDay,
    trailLength: outgoing ? 10_000 : 0.08,
    fadeTrail: !outgoing,
    opacity:
      (outgoing ? outgoingOpacity : incomingOpacity) * (outgoing ? 0.82 : 1),
    widthUnits: "pixels",
    widthMinPixels: 0,
    widthMaxPixels: outgoing ? 10 : 15,
    capRounded: true,
    jointRounded: true,
    pickable: false,
    parameters: { depthCompare: "less-equal", depthWriteEnabled: false },
    updateTriggers: {
      getPath: [focusRouteRevision, role],
      getTimestamps: untimedMode,
      getColor: [focusRouteRevision, untimedMode, role],
      getWidth: [focusRouteRevision, role],
    },
  });
}

function createMemoryRouteLayer(
  role: "outgoing" | "incoming"
): TripsLayer<RouteDrawDatum> {
  const outgoing = role === "outgoing";
  return new TripsLayer<RouteDrawDatum>({
    id: `fitness-rewind-route-${role}`,
    data: outgoing ? outgoingRouteDrawData : incomingRouteDrawData,
    getPath: (datum) => datum.path,
    getTimestamps: routeTimestampsForMode,
    getColor: (datum) =>
      resolveNewheatRouteColor(
        datum.activityType,
        datum.timing === "recorded"
          ? 250
          : untimedMode === "editorial"
            ? 225
            : 175
      ),
    getWidth: (datum) => (datum.timing === "recorded" ? 5.5 : 4.75),
    currentTime: outgoing ? outgoingCalendarDay : incomingCalendarDay,
    trailLength: 10_000,
    fadeTrail: false,
    opacity: outgoing ? outgoingOpacity : incomingOpacity,
    widthUnits: "pixels",
    widthMinPixels: 1.5,
    widthMaxPixels: 6,
    capRounded: true,
    jointRounded: true,
    pickable: false,
    parameters: { depthCompare: "less-equal", depthWriteEnabled: false },
    updateTriggers: {
      getPath: [focusRouteRevision, role],
      getTimestamps: untimedMode,
      getColor: [focusRouteRevision, untimedMode, role],
      getWidth: [focusRouteRevision, role],
    },
  });
}

function routeTimestampsForMode(datum: RouteDrawDatum): number[] {
  if (datum.timing === "recorded") return datum.recordedTimestamps;
  return untimedMode === "editorial"
    ? datum.editorialTimestamps
    : datum.provenanceTimestamps;
}

function routeTimestamps(
  route: ArchiveRoute,
  path: ArchiveRoutePath
): Pick<
  RouteDrawDatum,
  "recordedTimestamps" | "editorialTimestamps" | "provenanceTimestamps"
> {
  const startDay = toSceneDay(route.startMs);
  const endDay = toSceneDay(Math.max(route.endMs, route.startMs));
  const editorialTimestamps = path.positions.map((_, index) =>
    mix(startDay, endDay, index / Math.max(path.positions.length - 1, 1))
  );
  const recordedTimestamps =
    path.timesMs?.length === path.positions.length
      ? path.timesMs.map(toSceneDay)
      : editorialTimestamps;
  const provenanceTimestamps = path.positions.map(() => startDay);
  return {
    recordedTimestamps,
    editorialTimestamps,
    provenanceTimestamps,
  };
}

function updateUi(
  beat = archive?.sequence.beats[currentState.beatIndex - 1]
): void {
  const loadingTimestamp = initialTimestampCaption();
  const presentation = archive
    ? memoryCaptionPresentationForFrame(currentState, archive.sequence)
    : ({
        outgoing: loadingTimestamp,
        incoming: loadingTimestamp,
        cycleProgress: 0,
        reel: analogDateReelFrame(loadingTimestamp, loadingTimestamp, 0),
      } satisfies MemoryCaptionPresentation);
  const caption = dominantMemoryCaption(presentation);
  frameSlider.value = String(currentFrame);
  dateLabel.textContent = caption.dateRange;
  updateTimestampPreview(presentation);
  exportTimestamp.dateTime = caption.dateTime;
  beatLabel.textContent = `WORLD ${String(currentState.beatIndex).padStart(2, "0")} / 32`;
  windowLabel.textContent = beat
    ? `${caption.location} · ${beat.zone.activeDays} active days · geographic rank ${beat.selectionRank}`
    : "Selecting geographic memories";
  zoneLabel.textContent = beat
    ? `${beat.zone.routeCount} emphasized of ${beat.zone.totalRouteCount} routes · ${Math.round(beat.zone.focusRadiusKm)} km visible frame / ${Math.round(beat.zone.radiusKm)} km visit · z${focusZoomForMemory(beat.zone).toFixed(2)} · ${Math.round(beat.nearestSelectedKm)} km from nearest selected memory`
    : "No approved geographic memory";
  playButton.textContent = playing ? "Pause" : "Play";
  playButton.setAttribute("aria-pressed", String(playing));
  updateModeButtons();
}

function updateTimestampPreview(presentation: MemoryCaptionPresentation): void {
  timestampPreviewContext.clearRect(
    0,
    0,
    CLIP_CONTRACT.width,
    CLIP_CONTRACT.height
  );
  drawAnalogDateReel(timestampPreviewContext, presentation.reel);
  drawMemoryLocationTransition(timestampPreviewContext, presentation);
}
function updateModeButtons(): void {
  for (const button of modeButtons) {
    const selected = button.dataset.untimedMode === untimedMode;
    button.dataset.selected = String(selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

async function waitForTiles(frameIndex: number): Promise<void> {
  const deadline = performance.now() + TILE_LOAD_TIMEOUT_MS;
  let stableSamples = 0;
  for (;;) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    if (tileErrors.length)
      throw new Error(`World Imagery tile error: ${tileErrors[0]}`);
    if (performance.now() >= deadline)
      throw new Error(
        `Timed out loading World Imagery for frame ${frameIndex}.`
      );
    stableSamples = advanceTileStabilitySample(
      stableSamples,
      tileReadinessSnapshot()
    );
    if (stableSamples < TILE_STABILITY_SAMPLE_COUNT) continue;
    for (let redraw = 0; redraw < TILE_SETTLED_REDRAW_COUNT; redraw += 1) {
      await waitForRender(`fitness-rewind-settled-${frameIndex}-${redraw + 1}`);
    }
    await waitForCanvasGpuCompletion();
    if (isTileSnapshotReady(tileReadinessSnapshot())) return;
    stableSamples = 0;
  }
}

async function waitForCanvasGpuCompletion(): Promise<void> {
  const gl = canvas.getContext("webgl2");
  gl?.finish();
  await new Promise<void>((resolve) =>
    window.requestAnimationFrame(() => resolve())
  );
  gl?.finish();
}

function tileReadinessSnapshot(): TileReadinessSnapshot {
  const selectedTiles = currentSelectedTiles();
  return {
    isLoaded: tileLayer.isLoaded,
    viewportTileCount: selectedTiles?.length ?? viewportTileCount,
  };
}
function currentSelectedTiles(): Array<{ id: string }> | null {
  const tileset = (
    tileLayer as unknown as {
      state?: {
        tileset?: {
          selectedTiles?: Array<{ id: string }> | null;
        };
      };
    }
  ).state?.tileset;
  return tileset?.selectedTiles ?? null;
}
function waitForRender(reason: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      renderWaiters.delete(onRender);
      reject(new Error(`Timed out waiting for deck.gl render: ${reason}.`));
    }, 15_000);
    const onRender = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    renderWaiters.add(onRender);
    deck.redraw(reason);
  });
}

async function preloadTilePyramid(): Promise<void> {
  const urls: string[] = [];
  for (const zoom of CLIP_CONTRACT.imagery.prefetchZooms) {
    const count = 2 ** zoom;
    for (let y = 0; y < count; y += 1)
      for (let x = 0; x < count; x += 1) {
        urls.push(
          CLIP_CONTRACT.imagery.tileUrl
            .replace("{z}", String(zoom))
            .replace("{y}", String(y))
            .replace("{x}", String(x))
        );
      }
  }
  for (
    let index = 0;
    index < urls.length;
    index += CLIP_CONTRACT.imagery.prefetchBatchSize
  ) {
    const batch = urls.slice(
      index,
      index + CLIP_CONTRACT.imagery.prefetchBatchSize
    );
    await Promise.all(
      batch.map(async (url) => {
        const response = await fetchWorldImageryResponse(url);
        await response.arrayBuffer();
        preloadedTileCount += 1;
      })
    );
  }
}

function play(): void {
  if (playing) return;
  if (currentFrame >= CLIP_CONTRACT.frameCount - 1) currentFrame = 0;
  playing = true;
  updateUi();
  playbackStartFrame = currentFrame;
  playbackStartedAt = performance.now();
  playbackRequest = requestAnimationFrame(updatePlayback);
}
function pause(): void {
  playing = false;
  cancelAnimationFrame(playbackRequest);
  updateUi();
}
function updatePlayback(now: number): void {
  if (!playing) return;
  const targetFrame = playbackFrameForElapsed(
    playbackStartFrame,
    now - playbackStartedAt
  );
  void setFrame(targetFrame)
    .then(() => {
      if (targetFrame >= CLIP_CONTRACT.frameCount - 1) pause();
      else if (playing) playbackRequest = requestAnimationFrame(updatePlayback);
    })
    .catch((error) => {
      pause();
      console.error(error);
    });
}
function handleKeyDown(event: KeyboardEvent): void {
  if (event.code === "KeyE" && interactiveUi) {
    event.preventDefault();
    void exportOrDownload();
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    if (playing) pause();
    else play();
    return;
  }
  if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
    event.preventDefault();
    pause();
    void window.__WORLD_IMAGERY_REWIND__.stepFrames(
      event.code === "ArrowLeft" ? -1 : 1
    );
    return;
  }
  if (event.code === "Home" || event.code === "End") {
    event.preventDefault();
    pause();
    void setFrame(event.code === "Home" ? 0 : CLIP_CONTRACT.frameCount - 1);
  }
}

async function exportOrDownload(): Promise<void> {
  if (exportState === "running") return;
  if (exportState === "ready") {
    downloadInteractiveTrack(
      "globe",
      "02-fitness-globe-geographic-memories.mov"
    );
    downloadInteractiveTrack(
      "timestamp",
      "02-fitness-globe-geographic-memory-timestamps.mov"
    );
    return;
  }
  exportState = "running";
  archiveLabel.textContent = `Rendering clean globe + alpha timestamp MOVs · 0 / ${CLIP_CONTRACT.frameCount}`;
  try {
    const response = await fetch("/__fitness-rewind-export", {
      method: "POST",
    });
    if (!response.ok)
      throw new Error(`Export request failed (${response.status}).`);
    applyExportStatus((await response.json()) as ExportStatus);
    scheduleExportPoll();
  } catch (error) {
    exportState = "error";
    archiveLabel.textContent = "Export could not start · press E to retry";
    console.error(error);
  }
}

async function refreshExportStatus(): Promise<void> {
  try {
    const response = await fetch("/__fitness-rewind-export", {
      cache: "no-store",
    });
    if (!response.ok) return;
    applyExportStatus((await response.json()) as ExportStatus);
    if (exportState === "running") scheduleExportPoll();
  } catch {
    // The scene remains usable when served without the interactive export lane.
  }
}

function applyExportStatus(status: ExportStatus): void {
  exportState = status.state;
  document.documentElement.dataset.exportState = status.state;
  if (status.state === "running") {
    archiveLabel.textContent = `Rendering clean globe + alpha timestamp MOVs · ${status.frame.toLocaleString()} / ${status.frameCount.toLocaleString()}`;
  } else if (status.state === "ready") {
    archiveLabel.textContent = `${status.outputName} + ${status.timestampOutputName} ready · press E to download both`;
  } else if (status.state === "error") {
    archiveLabel.textContent = "Export failed · press E to retry";
  }
}

function downloadInteractiveTrack(
  track: "globe" | "timestamp",
  name: string
): void {
  const anchor = document.createElement("a");
  anchor.href = `/__fitness-rewind-export/file?track=${track}`;
  anchor.download = name;
  anchor.click();
}

function scheduleExportPoll(): void {
  window.clearTimeout(exportPollTimer);
  exportPollTimer = window.setTimeout(async () => {
    await refreshExportStatus();
    if (exportState === "running") scheduleExportPoll();
  }, 1000);
}

function getDiagnostics(): RewindDiagnostics {
  const context = canvas.getContext("webgl2");
  const debugInfo = context?.getExtension("WEBGL_debug_renderer_info");
  const bounds = canvas.getBoundingClientRect();
  return {
    ready: readyResolved,
    webgl2: Boolean(context),
    renderer:
      context && debugInfo
        ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : context
          ? String(context.getParameter(context.RENDERER))
          : null,
    vendor:
      context && debugInfo
        ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
        : context
          ? String(context.getParameter(context.VENDOR))
          : null,
    version: context ? String(context.getParameter(context.VERSION)) : null,
    data: {
      status: archiveStatus,
      routeCount: archive?.routeCount ?? 0,
      visibleRouteCount,
      visiblePathCount,
      timedRouteCount: archive?.timedRouteCount ?? 0,
      inferredRouteCount: archive?.inferredRouteCount ?? 0,
      ownerFingerprint: archive?.ownerFingerprint ?? null,
      generatedAt: archive?.generatedAt ?? null,
      untimedMode,
    },
    canvas: {
      left: bounds.left,
      top: bounds.top,
      cssWidth: bounds.width,
      cssHeight: bounds.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
    },
    tiles: {
      preloaded: preloadedTileCount,
      loaded: loadedTileCount,
      viewportTileCount,
      viewportRevision: viewportLoadRevision,
      errors: [...tileErrors],
      layerLoaded: tileReadinessSnapshot().isLoaded,
    },
    frame: currentState,
  };
}

function readInitialFrame(): number {
  const value = Number(query.get("frame"));
  return Number.isInteger(value) &&
    value >= 0 &&
    value < CLIP_CONTRACT.frameCount
    ? value
    : 0;
}
function toSceneDay(value: number): number {
  return (value - Date.UTC(2022, 0, 1)) / 86_400_000;
}
function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}
function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing scene element: ${selector}`);
  return element;
}
function requiredAlphaContext(
  target: HTMLCanvasElement
): CanvasRenderingContext2D {
  const context = target.getContext("2d", { alpha: true });
  if (!context) {
    throw new Error("Canvas 2D alpha is required for timestamp preview.");
  }
  return context;
}
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
