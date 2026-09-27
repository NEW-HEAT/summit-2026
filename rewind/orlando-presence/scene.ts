import {
  Deck,
  LayerExtension,
  _GlobeView as GlobeView,
  type Layer,
  type GlobeViewState,
} from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type {
  FeatureCollection,
  GeoJsonProperties,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import type { ShaderModule } from "@luma.gl/shadertools";
import naturalEarthLand from "../scene/ne_50m_land.json";
import {
  ORLANDO_PRESENCE_CONTRACT,
  orlandoPresenceFrame,
  type OrlandoPresenceFrame,
} from "./contract";

type SceneDiagnostics = {
  ready: boolean;
  webgl2: boolean;
  renderer: string | null;
  renderStyle: RenderStyle;
  frame: OrlandoPresenceFrame;
  continents: {
    polygonCount: number;
    opacity: number;
    backFaceClipping: boolean;
  };
  tiles: {
    loaded: number;
    viewportTileCount: number;
    layerLoaded: boolean;
    errors: string[];
  };
};

type RenderStyle = "continents" | "grayscale";

type ContinentPolygon = {
  polygon: Position[][];
};

type HorizonClipShaderProps = {
  centerNormal: [number, number, number];
};

type SceneApi = {
  ready: Promise<void>;
  setFrame(
    frameIndex: number,
    options?: { settleTiles?: boolean }
  ): Promise<OrlandoPresenceFrame>;
  getStatus(): SceneDiagnostics;
};

declare global {
  interface Window {
    __ORLANDO_PRESENCE__: SceneApi;
  }
}

const canvas = required<HTMLCanvasElement>("#globe-canvas");
const timestampCanvas = required<HTMLCanvasElement>("#timestamp-canvas");
const timestampContext = timestampCanvas.getContext("2d", { alpha: true });
if (!timestampContext) throw new Error("An alpha-aware 2D canvas is required.");

const query = new URLSearchParams(window.location.search);
const track = query.get("track") === "timestamp" ? "timestamp" : "globe";
const renderStyle: RenderStyle =
  query.get("style") === "grayscale" ? "grayscale" : "continents";
const forceContinentGeometry =
  renderStyle === "continents" && query.get("geometryOnly") === "1";
document.documentElement.dataset.track = track;
document.documentElement.dataset.style = renderStyle;

const naturalEarthFeatureCollection = naturalEarthLand as FeatureCollection<
  Polygon | MultiPolygon,
  GeoJsonProperties
>;
const continentPolygons: ContinentPolygon[] =
  naturalEarthFeatureCollection.features.flatMap((feature) =>
    feature.geometry.type === "Polygon"
      ? [{ polygon: feature.geometry.coordinates }]
      : feature.geometry.coordinates.map((polygon) => ({ polygon }))
  );
const horizonCenterNormal = globeUnitVector(
  ORLANDO_PRESENCE_CONTRACT.startPose.longitude,
  ORLANDO_PRESENCE_CONTRACT.startPose.latitude
);

const HORIZON_CLIP_SHADER_MODULE: ShaderModule<HorizonClipShaderProps> = {
  name: "orlandoHorizonClip",
  vs: /* glsl */ `
layout(std140) uniform orlandoHorizonClipUniforms {
  vec3 centerNormal;
} orlandoHorizonClip;

out float orlandoHorizonVisibility;
`,
  fs: /* glsl */ `
in float orlandoHorizonVisibility;
`,
  inject: {
    "vs:DECKGL_FILTER_GL_POSITION": /* glsl */ `
  vec2 horizonLngLat = radians(geometry.worldPosition.xy);
  float horizonCosLatitude = cos(horizonLngLat.y);
  vec3 horizonSurfaceNormal = vec3(
    sin(horizonLngLat.x) * horizonCosLatitude,
    -cos(horizonLngLat.x) * horizonCosLatitude,
    sin(horizonLngLat.y)
  );
  orlandoHorizonVisibility = dot(
    horizonSurfaceNormal,
    orlandoHorizonClip.centerNormal
  );
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  if (orlandoHorizonVisibility < 0.002) {
    discard;
  }
`,
  },
  uniformTypes: {
    centerNormal: "vec3<f32>",
  },
};

class HorizonClipExtension extends LayerExtension {
  static extensionName = "HorizonClipExtension";

  getShaders(): { modules: ShaderModule<HorizonClipShaderProps>[] } {
    return { modules: [HORIZON_CLIP_SHADER_MODULE] };
  }

  draw(this: Layer): void {
    this.setShaderModuleProps({
      orlandoHorizonClip: { centerNormal: horizonCenterNormal },
    });
  }
}

const HORIZON_CLIP_EXTENSION = new HorizonClipExtension();

const tileErrors: string[] = [];
const renderWaiters = new Set<() => void>();
let loadedTileCount = 0;
let viewportTileCount = 0;
let currentFrame = orlandoPresenceFrame(readInitialFrame());
let tileLayer: TileLayer<ImageBitmap>;
let frameQueue: Promise<OrlandoPresenceFrame> = Promise.resolve(currentFrame);

drawTimestampTrack();

const view = new GlobeView({
  id: "orlando-presence-globe",
  controller: false,
  clear: false,
  resolution: 3,
  parameters: { cullMode: "back" } as never,
});

let deckLoadedResolve: () => void = () => {};
const deckLoaded = new Promise<void>((resolve) => {
  deckLoadedResolve = resolve;
});

const deck = new Deck({
  canvas,
  width: "100%",
  height: "100%",
  views: view,
  viewState: currentFrame.viewState as GlobeViewState,
  layers: buildLayers(),
  controller: false,
  useDevicePixels: ORLANDO_PRESENCE_CONTRACT.devicePixelRatio,
  parameters: { clearColor: [0, 0, 0, 0] } as never,
  deviceProps: {
    powerPreference: "high-performance",
    webgl: {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    },
  },
  onLoad: deckLoadedResolve,
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
window.__ORLANDO_PRESENCE__ = {
  ready,
  setFrame,
  getStatus,
};

async function initialize(): Promise<void> {
  await deckLoaded;
  await applyFrame(currentFrame.frameIndex, true);
}

function setFrame(
  frameIndex: number,
  options: { settleTiles?: boolean } = {}
): Promise<OrlandoPresenceFrame> {
  frameQueue = frameQueue
    .catch(() => currentFrame)
    .then(async () => {
      await ready;
      return applyFrame(frameIndex, options.settleTiles ?? true);
    });
  return frameQueue;
}

async function applyFrame(
  frameIndex: number,
  settleTiles: boolean
): Promise<OrlandoPresenceFrame> {
  currentFrame = orlandoPresenceFrame(frameIndex);
  if (renderStyle === "grayscale") {
    canvas.style.filter = `grayscale(${currentFrame.grayscaleProgress})`;
  } else {
    canvas.style.filter = "none";
  }
  deck.setProps({
    viewState: currentFrame.viewState as GlobeViewState,
    layers: buildLayers(),
  });
  await waitForRender(`orlando-presence-frame-${frameIndex}`);
  if (settleTiles) await waitForTiles(frameIndex);
  return currentFrame;
}

function buildLayers() {
  const continentOpacity = renderStyle === "continents" ? 1 : 0;
  const satelliteOpacity =
    renderStyle === "continents"
      ? forceContinentGeometry
        ? 0
        : 1 - currentFrame.continentProgress
      : 1;
  const markerOpacity = satelliteOpacity;
  tileLayer = new TileLayer<ImageBitmap>({
    id: "orlando-presence-world-imagery",
    data: ORLANDO_PRESENCE_CONTRACT.imagery.tileUrl,
    getTileData: loadWorldImageryTile,
    maxCacheSize: ORLANDO_PRESENCE_CONTRACT.imagery.maxCacheSize,
    maxRequests: ORLANDO_PRESENCE_CONTRACT.imagery.maxRequests,
    maxZoom: ORLANDO_PRESENCE_CONTRACT.imagery.maxZoom,
    minZoom: ORLANDO_PRESENCE_CONTRACT.imagery.minZoom,
    opacity: satelliteOpacity,
    pickable: false,
    refinementStrategy: ORLANDO_PRESENCE_CONTRACT.imagery.refinementStrategy,
    tileSize: ORLANDO_PRESENCE_CONTRACT.imagery.tileSize,
    zoomOffset: ORLANDO_PRESENCE_CONTRACT.imagery.zoomOffset,
    onTileLoad: () => {
      loadedTileCount += 1;
    },
    onTileError: (error) => {
      tileErrors.push(error instanceof Error ? error.message : String(error));
    },
    onViewportLoad: (tiles) => {
      viewportTileCount = tiles.length;
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

  const markerPosition = [
    ORLANDO_PRESENCE_CONTRACT.marker.longitude,
    ORLANDO_PRESENCE_CONTRACT.marker.latitude,
  ] as [number, number];
  const markerData = [{ position: markerPosition }];
  const continentLayer =
    renderStyle === "continents"
      ? new PolygonLayer<ContinentPolygon>({
          id: "orlando-presence-continent-geometry",
          data: continentPolygons,
          getPolygon: (datum) => datum.polygon,
          getFillColor: ORLANDO_PRESENCE_CONTRACT.continentGeometry.fillColor,
          opacity: continentOpacity,
          filled: true,
          stroked: false,
          pickable: false,
          extensions: [HORIZON_CLIP_EXTENSION],
          parameters: {
            cullMode: "back",
            depthCompare: "less-equal",
            depthWriteEnabled: true,
          },
        })
      : null;
  return [
    continentLayer,
    tileLayer,
    new ScatterplotLayer({
      id: "orlando-presence-halo",
      data: markerData,
      getPosition: (datum) => datum.position,
      getRadius: ORLANDO_PRESENCE_CONTRACT.marker.haloRadiusPx,
      radiusUnits: "pixels",
      filled: true,
      stroked: true,
      getFillColor: [255, 226, 148, 38],
      getLineColor: [255, 248, 220, 150],
      getLineWidth: 1.5,
      lineWidthUnits: "pixels",
      opacity: markerOpacity,
      pickable: false,
      parameters: {
        depthCompare: "less-equal",
        depthWriteEnabled: false,
      },
    }),
    new ScatterplotLayer({
      id: "orlando-presence-core",
      data: markerData,
      getPosition: (datum) => datum.position,
      getRadius: ORLANDO_PRESENCE_CONTRACT.marker.coreRadiusPx,
      radiusUnits: "pixels",
      filled: true,
      stroked: true,
      getFillColor: [255, 247, 222, 255],
      getLineColor: [30, 25, 18, 235],
      getLineWidth: 1.5,
      lineWidthUnits: "pixels",
      opacity: markerOpacity,
      pickable: false,
      parameters: {
        depthCompare: "less-equal",
        depthWriteEnabled: false,
      },
    }),
  ];
}

async function loadWorldImageryTile({
  url,
  signal,
}: {
  url?: string | null;
  signal?: AbortSignal;
}): Promise<ImageBitmap> {
  if (!url) throw new Error("World Imagery tile URL is missing.");
  const response = await fetch(url, { cache: "force-cache", signal });
  if (!response.ok) {
    throw new Error(`World Imagery tile failed (${response.status}).`);
  }
  return createImageBitmap(await response.blob());
}

async function waitForTiles(frameIndex: number): Promise<void> {
  const deadline = performance.now() + 120_000;
  let stableSamples = 0;
  for (;;) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    if (tileErrors.length > 0) {
      throw new Error(`World Imagery tile error: ${tileErrors[0]}`);
    }
    if (performance.now() >= deadline) {
      throw new Error(
        `Timed out loading World Imagery for frame ${frameIndex}.`
      );
    }
    const selectedTiles = currentSelectedTiles();
    const readyNow =
      tileLayer.isLoaded && (selectedTiles?.length ?? viewportTileCount) > 0;
    stableSamples = readyNow ? stableSamples + 1 : 0;
    if (stableSamples < 3) continue;
    await waitForRender(`orlando-presence-settled-${frameIndex}`);
    const gl = canvas.getContext("webgl2");
    gl?.finish();
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve())
    );
    gl?.finish();
    return;
  }
}

function currentSelectedTiles(): Array<{ id: string }> | null {
  return (
    (
      tileLayer as unknown as {
        state?: {
          tileset?: { selectedTiles?: Array<{ id: string }> | null };
        };
      }
    ).state?.tileset?.selectedTiles ?? null
  );
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

function getStatus(): SceneDiagnostics {
  const gl = canvas.getContext("webgl2");
  const renderer = gl ? (gl.getParameter(gl.RENDERER) as string) : null;
  return {
    ready: true,
    webgl2: Boolean(gl),
    renderer,
    renderStyle,
    frame: currentFrame,
    continents: {
      polygonCount: continentPolygons.length,
      opacity: renderStyle === "continents" ? 1 : 0,
      backFaceClipping: renderStyle === "continents",
    },
    tiles: {
      loaded: loadedTileCount,
      viewportTileCount: currentSelectedTiles()?.length ?? viewportTileCount,
      layerLoaded: tileLayer.isLoaded,
      errors: [...tileErrors],
    },
  };
}

function drawTimestampTrack(): void {
  const { width, height, dateLabel, locationLabel } = ORLANDO_PRESENCE_CONTRACT;
  timestampContext.clearRect(0, 0, width, height);
  timestampContext.save();
  timestampContext.translate(width / 2, height / 2);
  timestampContext.fillStyle = "#ffffff";
  timestampContext.textAlign = "center";
  timestampContext.textBaseline = "middle";
  timestampContext.shadowColor = "rgba(0, 0, 0, 0.82)";
  timestampContext.shadowBlur = 16;
  timestampContext.shadowOffsetY = 2;
  timestampContext.font =
    '600 60px "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
  timestampContext.globalAlpha = 0.98;
  timestampContext.fillText(dateLabel, 0, -46);
  timestampContext.font =
    '650 42px "Helvetica Neue", Helvetica, Arial, sans-serif';
  timestampContext.globalAlpha = 1;
  drawCenteredTrackedText(locationLabel, 48, 2.8);
  timestampContext.restore();
}

function drawCenteredTrackedText(
  value: string,
  y: number,
  tracking: number
): void {
  timestampContext.save();
  timestampContext.textAlign = "left";
  let cursor = -trackedTextWidth(value, tracking) / 2;
  for (const character of value) {
    timestampContext.fillText(character, cursor, y);
    cursor += timestampContext.measureText(character).width + tracking;
  }
  timestampContext.restore();
}

function trackedTextWidth(value: string, tracking: number): number {
  return Array.from(value).reduce(
    (width, character, index) =>
      width +
      timestampContext.measureText(character).width +
      (index === value.length - 1 ? 0 : tracking),
    0
  );
}

function globeUnitVector(
  longitude: number,
  latitude: number
): [number, number, number] {
  const longitudeRadians = (longitude * Math.PI) / 180;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const cosLatitude = Math.cos(latitudeRadians);
  return [
    Math.sin(longitudeRadians) * cosLatitude,
    -Math.cos(longitudeRadians) * cosLatitude,
    Math.sin(latitudeRadians),
  ];
}

function readInitialFrame(): number {
  const raw = Number(query.get("frame") ?? 0);
  return Number.isInteger(raw) &&
    raw >= 0 &&
    raw < ORLANDO_PRESENCE_CONTRACT.frameCount
    ? raw
    : 0;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
