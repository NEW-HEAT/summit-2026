import {
  Deck,
  OrthographicView,
  COORDINATE_SYSTEM,
  _GlobeView as GlobeView,
  type Layer,
} from "@deck.gl/core";
import {
  PolygonLayer,
  ScatterplotLayer,
} from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type {
  FeatureCollection,
  GeoJsonProperties,
  MultiPolygon,
  Polygon,
} from "geojson";
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
import {
  VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT,
} from "./vertical-calendar-model";
import {
  LOCATION_HEAT_SCHEMA_VERSION,
  type CommitLocationHeatDataset,
  type CommitLocationHeatPoint,
  type TrainingActivityCounts,
  type TrainingLocationHeatPoint,
} from "./location-heat-model";
import {
  CONTRIBUTION_GLOBE_LAYOUT,
} from "./globe-layout";
import {
  buildContributionFocusBeats,
  contributionFocusFrame,
  type ContributionFocusBeat,
} from "./globe-focus-model";
import {
  CONTRIBUTION_HEAT_BRIGHTNESS_FLOOR,
  CONTRIBUTION_IMPACT_WAVE_MAX_PIXELS,
  buildContributionImpactRings,
  buildContributionImpacts,
  contributionHeatCellPolygon,
  contributionImpactFlashStyle,
  contributionSettledHeatColor,
  contributionSettledHeatContourColor,
  geographicHeatCellPolygon,
  settledContributionRevealHead,
  type ContributionImpact,
  type ContributionImpactRing,
} from "./globe-impact-model";
import {
  encodeContributionGeographicMemoryTimecode,
  drawContributionOverlay,
  type ContributionOverlayKind,
} from "./geographic-memory-timecode";
import {
  CONTRIBUTION_PIN_ARRIVAL_FRACTION,
  CONTRIBUTION_PIN_ARRIVAL_HOLD_FRACTION,
  CONTRIBUTION_PIN_ARRIVAL_MAX_RADIUS,
  CONTRIBUTION_PIN_RECESSION_EXPONENT,
  CONTRIBUTION_PIN_TRAIL_LENGTH,
  contributionPinArrival,
  contributionPinTrail,
  contributionPinTrailSegments,
  contributionPinLandingImpact,
} from "./globe-pin-arrival-model";
import {
  CONTINENT_LAND_FILL_COLOR,
  type ContinentLandPolygon,
} from "./continent-land-model";
import {
  CLIP_02_ORLANDO_HANDOFF_VIEW_STATE,
  REFERENCE_CONTRIBUTION_GLOBE_FINAL_SCALE,
  contributionGlobeViewState,
} from "./globe-camera-model";
import {
  ContributionHorizonClipExtension,
} from "./globe-horizon-clip";
import naturalEarthLand from "./ne_50m_land.json";
import { prefilledHistoryOpacity } from "./prefilled-contribution-history";

const RECENT_HEAT_DAYS = 4;
const GLOBE_BITRATE = 60_000_000;
const ALPHA_MASK_BITRATE = 30_000_000;
const HORIZON_CLIP_EXTENSION = new ContributionHorizonClipExtension();

// Retired raster migration markers retained for the previous basemap contract test:
// Canvas/World_Dark_Gray_Base/MapServer/export · desaturate: 1 · Esri World Dark Gray Canvas atlas.
// The active scene contains no raster image request and no BitmapLayer.

type LonLat = [number, number];
type OrganizationHeatCell = {
  id: string;
  cellId: string;
  position: LonLat;
  organizationKey: OrganizationKey;
  organizationColor: [number, number, number];
  organizationIndex: number;
  volume: number;
  latestDayOrdinal: number;
};
type TrainingCell = {
  cellId: string;
  position: LonLat;
  routeCount: number;
  latestDayOrdinal: number;
  activityCounts: TrainingActivityCounts;
};
type TrainingHeatTile = {
  id: string;
  polygon: LonLat[];
  fillColor: [number, number, number, number];
};
type WorkHeatTile = {
  id: string;
  polygon: LonLat[];
  fillColor: [number, number, number, number];
  contourColor: [number, number, number, number];
  volume: number;
  organizationIndex: number;
};
type FocusRing = {
  id: string;
  position: LonLat;
  radius: number;
  color: [number, number, number, number];
  lineWidth: number;
};
export type GlobeFrameState = {
  frameIndex: number;
  prefilledHeatOpacity: number;
  elapsedSeconds: number;
  progress: number;
  traversalProgress: number;
  revealHead: number;
  activeDayOrdinal: number;
  currentDate: string;
  focusLongitude: number;
  latitude: number;
  cameraLongitude: number;
  cameraLatitude: number;
  cameraZoom: number;
  focusTargetLongitude: number;
  focusTargetLatitude: number;
  focusSectionIndex: number;
  focusSectionProgress: number;
  focusPulse: number;
  focusCellId: string;
  focusOrganizationKey: OrganizationKey;
  focusOrganizationColor: [number, number, number];
  focusLocationPrimary: string;
  focusLocationSecondary: string;
  overview: boolean;
  cumulativeLocationCellCount: number;
  cumulativeLocatedVolume: number;
};

type Diagnostics = {
  webgl: boolean;
  renderer?: string;
  vendor?: string;
  deckView: "GlobeView";
  globeZoom: number;
  meshResolutionDegrees: number;
  targetGlobeHeightRatio: number;
  transparentBackground: true;
  independentOverlay: true;
  baseMapLayerType: "PolygonLayer";
  landSource: "Natural Earth 1:50m land polygons";
  continentPolygonCount: number;
  continentFillColor: [number, number, number, number];
  rasterSurfaceLayerCount: 0;
  oceanUnderlay: false;
  backFaceCulling: "back";
  hemisphereClipping: "spherical-horizon-fragment-discard";
  clip02HandoffViewState: typeof CLIP_02_ORLANDO_HANDOFF_VIEW_STATE;
  referenceFinalScale: typeof REFERENCE_CONTRIBUTION_GLOBE_FINAL_SCALE;
  dayCount: number;
  heatPointCount: number;
  locationCellCount: number;
  trainingPointCount: number;
  trainingLocationCellCount: number;
  focusBeatCount: number;
  labeledFocusBeatCount: number;
  focusTransitionFraction: number;
  focusMotionMode: "quick-ease-out-section-snap";
  organizationShareCount: number;
  organizationProgressDayCount: number;
  organizationProgressFinalTotal: number;
  organizationColorCount: number;
  workColorMode: "solid-discrete-organization-heat-contours";
  settledWorkGeometry: "organization-split-geographic-heat-cells";
  persistentWorkScatterplots: false;
  settledTrainingGeometry: "cumulative-geographic-heat-cells";
  persistentTrainingScatterplots: false;
  impactTransition: "solid-bang-then-delayed-heat-cell";
  arrivalMotion: "absolute-corner-curved-recession";
  arrivalTrailLayer: "TripsLayer";
  arrivalTrailShape: "cubic-bezier-tapered-wake";
  arrivalView: "OrthographicView";
  arrivalFraction: number;
  arrivalStartDiameter: number;
  arrivalHoldFraction: number;
  arrivalRecessionExponent: number;
  settledWorkBrightnessFloor: number;
  settledTrainingBrightnessFloor: number;
  maximumImpactWavePixels: number;
  maximumFocusWavePixels: number;
  workColorBlending: false;
  activeDayPercentTotal: number;
  contributionPercentTotal: number;
  locationEvidence: CommitLocationHeatDataset["locationEvidence"];
  quantizationDegrees: number;
  metrics: CommitLocationHeatDataset["metrics"];
  prefilledHistory: CommitLocationHeatDataset["prefilledHistory"] | null;
  contract: typeof VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT;
};

declare global {
  interface Window {
    __CONTRIBUTION_LOCATION_GLOBE__: {
      ready: Promise<void>;
      setFrame(frameIndex: number): Promise<GlobeFrameState>;
      getState(): GlobeFrameState;
      getDiagnostics(): Diagnostics;
      getTimecodePreview(frameIndex: number, kind?: ContributionOverlayKind): string;
      renderGlobeWebm(options?: { frameCount?: number }): Promise<{
        frameCount: number;
        frameRate: number;
        durationSeconds: number;
        filename: string;
        alphaTransport: "dual-video-track-grayscale-mask";
      }>;
      renderGeographicTimecodeWebm(options?: { frameCount?: number; kind?: ContributionOverlayKind }):
        ReturnType<typeof encodeContributionGeographicMemoryTimecode>;
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#globe-canvas");
if (!canvas) throw new Error("Transparent globe canvas is missing.");
canvas.width = WIDTH;
canvas.height = HEIGHT;
const alphaMaskCanvas = document.createElement("canvas");
alphaMaskCanvas.width = WIDTH;
alphaMaskCanvas.height = HEIGHT;
const alphaMaskContext = alphaMaskCanvas.getContext("2d", { alpha: true });
if (!alphaMaskContext) throw new Error("Contribution globe alpha-mask canvas is unavailable.");

const dataUrl = new URLSearchParams(window.location.search).get("data");
if (!dataUrl) throw new Error("A private contribution location heat dataset is required.");
const dataResponse = await fetch(dataUrl, { cache: "no-store" });
if (!dataResponse.ok) throw new Error(`Contribution location heat failed to load (${dataResponse.status}).`);
const dataset = (await dataResponse.json()) as CommitLocationHeatDataset;
if (dataset.schemaVersion !== LOCATION_HEAT_SCHEMA_VERSION || dataset.dayCount <= 0) {
  throw new Error("Contribution location heat dataset is invalid.");
}

const naturalEarthFeatureCollection = naturalEarthLand as FeatureCollection<
  Polygon | MultiPolygon,
  GeoJsonProperties
>;
const continentPolygons: ContinentLandPolygon[] =
  naturalEarthFeatureCollection.features.flatMap((feature, featureIndex) =>
    feature.geometry.type === "Polygon"
      ? [{ id: `land-${featureIndex}-0`, polygon: feature.geometry.coordinates }]
      : feature.geometry.coordinates.map((polygon, polygonIndex) => ({
        id: `land-${featureIndex}-${polygonIndex}`,
        polygon,
      })),
  );
// Completed history contributes heat and counts, never camera targets or arrivals.
const livePoints = dataset.points.filter((point) => point.dayOrdinal >= 0);
const focusBeats = buildContributionFocusBeats(
  livePoints,
  dataset.locationZones,
  dataset.dateRange,
  dataset.dayCount,
  CONTRIBUTION_GLOBE_LAYOUT.focusSectionCount,
);
const maximumContributionPointVolume = Math.max(1, ...livePoints.map((point) => point.volume));
const view = new GlobeView({
  id: "personal-contribution-location-globe",
  x: CONTRIBUTION_GLOBE_LAYOUT.x,
  y: CONTRIBUTION_GLOBE_LAYOUT.y,
  width: CONTRIBUTION_GLOBE_LAYOUT.width,
  height: CONTRIBUTION_GLOBE_LAYOUT.height,
  controller: false,
  clear: true,
  clearDepth: 1,
  resolution: CONTRIBUTION_GLOBE_LAYOUT.meshResolutionDegrees,
  parameters: { cullMode: "back" } as never,
});
const arrivalView = new OrthographicView({
  id: "contribution-pin-arrivals",
  controller: false,
  clear: false,
  flipY: true,
});
const arrivalLayerId = "contribution-globe-foreground-pin-arrivals";
const arrivalTrailLayerId = "contribution-globe-corner-trips-trails";

function compositeViewState(frameState: GlobeFrameState) {
  return {
    [view.id]: globeViewState(frameState),
    [arrivalView.id]: { target: [WIDTH / 2, HEIGHT / 2, 0] as [number, number, number], zoom: 0 },
  };
}

let state = buildGlobeFrameState(0, dataset, focusBeats);
let frameResolver: (() => void) | null = null;
let deckReadyResolve: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  deckReadyResolve = resolve;
});

const deck = new Deck({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  views: [view, arrivalView],
  viewState: compositeViewState(state),
  layers: buildLayers(state),
  layerFilter: ({ layer, viewport }) => viewport.id === arrivalView.id
    ? layer.id === arrivalLayerId || layer.id === arrivalTrailLayerId
    : layer.id !== arrivalLayerId && layer.id !== arrivalTrailLayerId,
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
      premultipliedAlpha: true,
    },
  },
  onLoad: () => deckReadyResolve(),
  onAfterRender: () => {
    frameResolver?.();
    frameResolver = null;
  },
});

async function setFrame(frameIndex: number) {
  await ready;
  state = buildGlobeFrameState(frameIndex, dataset, focusBeats);
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      frameResolver = null;
      reject(new Error(`Timed out rendering contribution globe frame ${frameIndex}.`));
    }, 15_000);
    frameResolver = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    deck.setProps({
      viewState: compositeViewState(state),
      layers: buildLayers(state),
    });
    deck.redraw(`contribution-location-globe-${frameIndex}`);
  });
  return state;
}

function buildLayers(frameState: GlobeFrameState): Layer[] {
  HORIZON_CLIP_EXTENSION.setCamera(
    frameState.cameraLongitude,
    frameState.cameraLatitude,
  );
  const settledRevealHead = settledContributionRevealHead(
    frameState.revealHead,
    frameState.overview,
  );
  const heatCells = cumulativeOrganizationHeatCells(dataset.points, settledRevealHead);
  const trainingCells = cumulativeTrainingCells(dataset.trainingPoints, frameState.revealHead);
  const maxTrainingRoutes = Math.max(1, ...trainingCells.map((cell) => cell.routeCount));
  const trainingHeatTiles = buildTrainingHeatTiles(trainingCells, maxTrainingRoutes);
  const workHeatTiles = buildWorkHeatTiles(heatCells);
  const contributionImpacts = frameState.elapsedSeconds < VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds
    ? []
    : buildContributionImpacts(
      livePoints,
      (frameState.elapsedSeconds - VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds)
        / VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.traversalSeconds * dataset.dayCount,
      maximumContributionPointVolume,
    ).filter((impact) => isPositionOnVisibleHemisphere(impact.position, frameState));
  const projection = view.makeViewport({
    width: WIDTH,
    height: HEIGHT,
    viewState: globeViewState(frameState),
  })!;
  const pinArrivals = contributionImpacts.flatMap((impact) => {
    const screen = projection.project(impact.position);
    const pin = contributionPinArrival(impact, [screen[0], screen[1]], { width: WIDTH, height: HEIGHT });
    return pin ? [pin] : [];
  });
  const pinTrails = contributionImpacts.flatMap((impact) => {
    const screen = projection.project(impact.position);
    const trail = contributionPinTrail(impact, [screen[0], screen[1]], { width: WIDTH, height: HEIGHT });
    return trail ? contributionPinTrailSegments(trail) : [];
  });
  const landedImpacts = contributionImpacts.flatMap((impact) => {
    const landed = contributionPinLandingImpact(impact);
    return landed ? [landed] : [];
  });
  const contributionImpactFlashes = landedImpacts.filter((impact) =>
    contributionImpactFlashStyle(impact).alpha > 0,
  );
  const contributionImpactRings = buildContributionImpactRings(landedImpacts);
  const focusRings = buildFocusRings(frameState).filter((ring) =>
    isPositionOnVisibleHemisphere(ring.position, frameState),
  );
  const recentTrainingPoints = frameState.overview
    ? []
    : dataset.trainingPoints.filter((point) =>
      point.dayOrdinal >= 0 && point.dayOrdinal + 1 <= frameState.revealHead
        && point.dayOrdinal + 1 > frameState.revealHead - RECENT_HEAT_DAYS,
    ).filter((point) => isPositionOnVisibleHemisphere(
      [point.longitude, point.latitude],
      frameState,
    ),
    );
  return [
    new PolygonLayer<ContinentLandPolygon>({
      id: "contribution-globe-continent-land",
      data: continentPolygons,
      getPolygon: (datum) => datum.polygon,
      getFillColor: CONTINENT_LAND_FILL_COLOR,
      filled: true,
      stroked: false,
      material: false,
      pickable: false,
      extensions: [HORIZON_CLIP_EXTENSION],
      parameters: {
        cullMode: "back",
        depthTest: true,
        depthWriteEnabled: true,
      },
    }),
    new PolygonLayer<TrainingHeatTile>({
      id: "contribution-globe-training-geographic-heat-field",
      data: trainingHeatTiles,
      opacity: frameState.prefilledHeatOpacity,
      getPolygon: (datum) => datum.polygon,
      getFillColor: (datum) => datum.fillColor,
      filled: true,
      stroked: false,
      material: false,
      pickable: false,
      extensions: [HORIZON_CLIP_EXTENSION],
      parameters: {
        blend: frameState.prefilledHeatOpacity < 1,
        cullMode: "back",
        depthTest: true,
        depthWriteEnabled: false,
      },
    }),
    new PolygonLayer<WorkHeatTile>({
      id: "contribution-globe-discrete-organization-heat-core",
      data: workHeatTiles,
      opacity: frameState.prefilledHeatOpacity,
      getPolygon: (datum) => datum.polygon,
      getFillColor: (datum) => datum.fillColor,
      filled: true,
      stroked: false,
      material: false,
      pickable: false,
      extensions: [HORIZON_CLIP_EXTENSION],
      parameters: {
        blend: frameState.prefilledHeatOpacity < 1,
        cullMode: "back",
        depthTest: true,
        depthWriteEnabled: false,
      },
    }),
    new PolygonLayer<WorkHeatTile>({
      id: "contribution-globe-discrete-organization-volume-rings",
      data: workHeatTiles,
      opacity: frameState.prefilledHeatOpacity,
      getPolygon: (datum) => datum.polygon,
      filled: false,
      stroked: true,
      getLineColor: (datum) => datum.contourColor,
      getLineWidth: 0.45,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 0.35,
      material: false,
      pickable: false,
      extensions: [HORIZON_CLIP_EXTENSION],
      parameters: {
        blend: frameState.prefilledHeatOpacity < 1,
        cullMode: "back",
        depthTest: true,
        depthWriteEnabled: false,
      },
    }),
    new ScatterplotLayer<TrainingLocationHeatPoint>({
      id: "contribution-globe-recent-training-pulse",
      data: recentTrainingPoints,
      getPosition: (datum) => [datum.longitude, datum.latitude],
      getRadius: 5.25 + 1.25 * Math.sin(frameState.frameIndex * 0.13),
      radiusUnits: "pixels",
      radiusMinPixels: 4,
      radiusMaxPixels: 7,
      filled: false,
      stroked: true,
      getLineColor: [142, 255, 218, 255],
      getLineWidth: 0.65,
      lineWidthUnits: "pixels",
      pickable: false,
      parameters: { blend: false },
    }),
    new ScatterplotLayer<ContributionImpact>({
      id: "contribution-globe-discrete-organization-impact-core",
      data: contributionImpactFlashes,
      getPosition: (datum) => datum.position,
      getRadius: (datum) => contributionImpactFlashStyle(datum).radius,
      radiusUnits: "pixels",
      radiusMinPixels: 3,
      radiusMaxPixels: 22,
      filled: true,
      stroked: false,
      getFillColor: (datum) => [
        ...datum.organizationColor,
        255,
      ],
      pickable: false,
      parameters: { blend: false },
    }),
    new ScatterplotLayer<ContributionImpactRing>({
      id: "contribution-globe-work-impact-shockwaves",
      data: contributionImpactRings,
      getPosition: (datum) => datum.position,
      getRadius: (datum) => datum.radius,
      radiusUnits: "pixels",
      radiusMinPixels: 4,
      radiusMaxPixels: CONTRIBUTION_IMPACT_WAVE_MAX_PIXELS,
      filled: false,
      stroked: true,
      getLineColor: (datum) => [datum.color[0], datum.color[1], datum.color[2], 255],
      getLineWidth: (datum) => datum.lineWidth,
      lineWidthUnits: "pixels",
      pickable: false,
      parameters: { blend: false },
    }),
    new ScatterplotLayer<FocusRing>({
      id: "contribution-globe-section-focus-knock",
      data: focusRings,
      getPosition: (datum) => datum.position,
      getRadius: (datum) => datum.radius,
      radiusUnits: "pixels",
      radiusMinPixels: 5,
      radiusMaxPixels: 32,
      filled: false,
      stroked: true,
      getLineColor: (datum) => [datum.color[0], datum.color[1], datum.color[2], 255],
      getLineWidth: (datum) => datum.lineWidth,
      lineWidthUnits: "pixels",
      pickable: false,
      parameters: { blend: false },
    }),
    new TripsLayer<ReturnType<typeof contributionPinTrailSegments>[number]>({
      id: arrivalTrailLayerId,
      data: pinTrails,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPath: (datum) => datum.path,
      getTimestamps: (datum) => datum.timestamps,
      currentTime: 1,
      trailLength: CONTRIBUTION_PIN_TRAIL_LENGTH,
      fadeTrail: true,
      getColor: (datum) => datum.color,
      getWidth: (datum) => datum.width,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: false,
      parameters: { cullMode: "none", blend: true, depthTest: false, depthWriteEnabled: false },
    }),
    new ScatterplotLayer<NonNullable<ReturnType<typeof contributionPinArrival>>>({
      id: arrivalLayerId,
      data: pinArrivals,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPosition: (datum) => datum.position,
      getRadius: (datum) => datum.radius,
      radiusUnits: "pixels",
      radiusMaxPixels: CONTRIBUTION_PIN_ARRIVAL_MAX_RADIUS,
      getFillColor: (datum) => datum.color,
      filled: true,
      stroked: false,
      pickable: false,
      parameters: { blend: false, depthTest: false, depthWriteEnabled: false },
    }),
  ];
}

function buildGlobeFrameState(
  frameIndex: number,
  source: CommitLocationHeatDataset,
  beats: ContributionFocusBeat[],
): GlobeFrameState {
  const safeFrame = clamp(
    Math.floor(frameIndex),
    0,
    VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount - 1,
  );
  const elapsedSeconds = safeFrame / FPS;
  const overviewStartSeconds = VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds
    + VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.traversalSeconds;
  const overview = elapsedSeconds >= overviewStartSeconds;
  const traversalElapsedSeconds = clamp(
    elapsedSeconds - VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds,
    0,
    VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.traversalSeconds,
  );
  const traversalProgress = overview
    ? 1
    : traversalElapsedSeconds / VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.traversalSeconds;
  const revealHead = traversalProgress * source.dayCount;
  const activeDayOrdinal = clamp(Math.floor(Math.min(revealHead, source.dayCount - 1)), 0, source.dayCount - 1);
  const heatCells = cumulativeOrganizationHeatCells(
    source.points,
    settledContributionRevealHead(revealHead, overview),
  );
  const focus = contributionFocusFrame(
    traversalProgress,
    beats,
    CONTRIBUTION_GLOBE_LAYOUT.focusTransitionFraction,
  );
  const camera = contributionGlobeViewState({
    elapsedSeconds,
    focusLongitude: focus.longitude,
    focusLatitude: focus.latitude,
  }, VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds);
  return {
    frameIndex: safeFrame,
    prefilledHeatOpacity: source.prefilledHistory ? prefilledHistoryOpacity(elapsedSeconds) : 1,
    elapsedSeconds,
    progress: safeFrame / (VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount - 1),
    traversalProgress,
    revealHead,
    activeDayOrdinal,
    currentDate: dateAtOrdinal(source.dateRange.from, activeDayOrdinal),
    focusLongitude: focus.longitude,
    latitude: focus.latitude,
    cameraLongitude: camera.longitude,
    cameraLatitude: camera.latitude,
    cameraZoom: camera.zoom,
    focusTargetLongitude: focus.beat.longitude,
    focusTargetLatitude: focus.beat.latitude,
    focusSectionIndex: focus.sectionIndex,
    focusSectionProgress: focus.sectionProgress,
    focusPulse: overview || traversalElapsedSeconds <= 0 ? 0 : focus.pulse,
    focusCellId: focus.beat.cellId,
    focusOrganizationKey: focus.beat.organizationKey,
    focusOrganizationColor: focus.beat.organizationColor,
    focusLocationPrimary: focus.beat.locationPrimary,
    focusLocationSecondary: focus.beat.locationSecondary,
    overview,
    cumulativeLocationCellCount: heatCells.length,
    cumulativeLocatedVolume: heatCells.reduce((sum, cell) => sum + cell.volume, 0),
  };
}

function globeViewState(frameState: GlobeFrameState) {
  return {
    longitude: frameState.cameraLongitude,
    latitude: frameState.cameraLatitude,
    zoom: frameState.cameraZoom,
    bearing: 0,
    pitch: 0,
  };
}

function buildFocusRings(frameState: GlobeFrameState): FocusRing[] {
  if (frameState.overview || frameState.focusPulse <= 0.001) return [];
  const progress = 1 - frameState.focusPulse;
  const position: LonLat = [frameState.focusTargetLongitude, frameState.focusTargetLatitude];
  return [0, 1, 2].map((ringIndex) => ({
    id: `focus:${frameState.focusSectionIndex}:${ringIndex}`,
    position,
    radius: 6 + progress * 18 + ringIndex * 3,
    color: [
      ...frameState.focusOrganizationColor,
      Math.max(0, Math.round((1 - progress) * (245 - ringIndex * 48))),
    ],
    lineWidth: (1.8 - ringIndex * 0.3) * frameState.focusPulse,
  }));
}

export function isPositionOnVisibleHemisphere(
  position: LonLat,
  frameState: Pick<GlobeFrameState, "focusLongitude" | "latitude">,
) {
  const radians = Math.PI / 180;
  const positionLatitude = position[1] * radians;
  const focusLatitude = frameState.latitude * radians;
  const longitudeDelta = (position[0] - frameState.focusLongitude) * radians;
  const cameraFacingDot = Math.sin(positionLatitude) * Math.sin(focusLatitude)
    + Math.cos(positionLatitude) * Math.cos(focusLatitude) * Math.cos(longitudeDelta);
  return cameraFacingDot > 0;
}

function cumulativeOrganizationHeatCells(points: CommitLocationHeatPoint[], revealHead: number) {
  const byCell = new Map<string, OrganizationHeatCell>();
  for (const point of points) {
    if (point.dayOrdinal + 1 > revealHead) continue;
    const id = `${point.cellId}:${point.organizationKey}`;
    const current = byCell.get(id);
    byCell.set(id, current
      ? {
        ...current,
        volume: current.volume + point.volume,
        latestDayOrdinal: Math.max(current.latestDayOrdinal, point.dayOrdinal),
      }
      : {
        id,
        cellId: point.cellId,
        position: [point.longitude, point.latitude],
        organizationKey: point.organizationKey,
        organizationColor: point.organizationColor,
        organizationIndex: point.organizationIndex,
        volume: point.volume,
        latestDayOrdinal: point.dayOrdinal,
      });
  }
  return [...byCell.values()];
}

function cumulativeTrainingCells(points: TrainingLocationHeatPoint[], revealHead: number) {
  const byCell = new Map<string, TrainingCell>();
  for (const point of points) {
    if (point.dayOrdinal + 1 > revealHead) continue;
    const current = byCell.get(point.cellId);
    byCell.set(point.cellId, current
      ? {
        ...current,
        routeCount: current.routeCount + point.routeCount,
        latestDayOrdinal: Math.max(current.latestDayOrdinal, point.dayOrdinal),
        activityCounts: mergeTrainingActivityCounts(current.activityCounts, point.activityCounts),
      }
      : {
        cellId: point.cellId,
        position: [point.longitude, point.latitude],
        routeCount: point.routeCount,
        latestDayOrdinal: point.dayOrdinal,
        activityCounts: { ...point.activityCounts },
      });
  }
  return [...byCell.values()];
}

function buildTrainingHeatTiles(cells: TrainingCell[], maximum: number) {
  return cells.map((cell): TrainingHeatTile => ({
    id: `${cell.cellId}:training-heat-cell`,
    polygon: geographicHeatCellPolygon(cell.position),
    fillColor: trainingHeatColor(cell.activityCounts, cell.routeCount, maximum),
  }));
}

function buildWorkHeatTiles(cells: OrganizationHeatCell[]) {
  return cells.map((cell): WorkHeatTile => ({
    id: `${cell.id}:settled-heat-cell`,
    polygon: contributionHeatCellPolygon(cell.position, cell.organizationIndex),
    fillColor: contributionSettledHeatColor(cell.organizationColor, cell.volume),
    contourColor: contributionSettledHeatContourColor(cell.organizationColor, cell.volume),
    volume: cell.volume,
    organizationIndex: cell.organizationIndex,
  }));
}

function trainingIntensity(routeCount: number, maximum: number) {
  return 0.18 + 0.82 * Math.log1p(routeCount) / Math.log1p(maximum);
}

function trainingHeatColor(
  activityCounts: TrainingActivityCounts,
  routeCount: number,
  maximum: number,
): [number, number, number, number] {
  const color = trainingColor(activityCounts, 255);
  const strength = 0.46 + 0.46 * trainingIntensity(routeCount, maximum);
  return [
    Math.round(color[0] * strength),
    Math.round(color[1] * strength),
    Math.round(color[2] * strength),
    255,
  ];
}

function mergeTrainingActivityCounts(
  left: TrainingActivityCounts,
  right: TrainingActivityCounts,
): TrainingActivityCounts {
  return {
    ride: left.ride + right.ride,
    run: left.run + right.run,
    hike: left.hike + right.hike,
    swim: left.swim + right.swim,
    other: left.other + right.other,
  };
}

function trainingColor(activityCounts: TrainingActivityCounts, alpha: number): [number, number, number, number] {
  const palette: Record<keyof TrainingActivityCounts, [number, number, number]> = {
    ride: [62, 255, 112],
    run: [45, 232, 255],
    hike: [126, 186, 255],
    swim: [65, 116, 255],
    other: [176, 112, 255],
  };
  const total = Object.values(activityCounts).reduce((sum, count) => sum + count, 0);
  if (total <= 0) return [96, 220, 255, alpha];
  const color = (Object.keys(activityCounts) as Array<keyof TrainingActivityCounts>)
    .reduce<[number, number, number]>((result, activity) => {
      const weight = activityCounts[activity] / total;
      return [
        result[0] + palette[activity][0] * weight,
        result[1] + palette[activity][1] * weight,
        result[2] + palette[activity][2] * weight,
      ];
    }, [0, 0, 0]);
  return [Math.round(color[0]), Math.round(color[1]), Math.round(color[2]), alpha];
}

function dateAtOrdinal(startDate: string, ordinal: number) {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + ordinal);
  return date.toISOString().slice(0, 10);
}

async function updateAlphaMaskCanvas() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  alphaMaskContext.save();
  alphaMaskContext.clearRect(0, 0, WIDTH, HEIGHT);
  alphaMaskContext.globalCompositeOperation = "source-over";
  alphaMaskContext.fillStyle = "white";
  alphaMaskContext.fillRect(0, 0, WIDTH, HEIGHT);
  alphaMaskContext.globalCompositeOperation = "destination-in";
  alphaMaskContext.drawImage(canvas, 0, 0, WIDTH, HEIGHT);
  alphaMaskContext.globalCompositeOperation = "destination-over";
  alphaMaskContext.fillStyle = "black";
  alphaMaskContext.fillRect(0, 0, WIDTH, HEIGHT);
  alphaMaskContext.restore();
}

async function renderGlobeWebm(
  { frameCount = VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount }: { frameCount?: number } = {},
) {
  const safeFrameCount = clamp(
    Math.floor(frameCount),
    1,
    VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount,
  );
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  // captureProofFrames leaves the shared canvas on the final recap frame.
  // Prime the clean handoff frame before CanvasSource observes the canvas, or
  // VP9 alpha may retain heat-cell macroblocks in encoded frame zero.
  await setFrame(0);
  await updateAlphaMaskCanvas();
  const source = new CanvasSource(canvas, {
    codec: "vp9",
    bitrate: GLOBE_BITRATE,
    bitrateMode: "constant",
    alpha: "keep",
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
    keyFrameInterval: 2,
  });
  const alphaMaskSource = new CanvasSource(alphaMaskCanvas, {
    codec: "vp9",
    bitrate: ALPHA_MASK_BITRATE,
    bitrateMode: "constant",
    alpha: "discard",
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, {
    frameRate: FPS,
    maximumPacketCount: safeFrameCount + 2,
  });
  output.addVideoTrack(alphaMaskSource, {
    frameRate: FPS,
    maximumPacketCount: safeFrameCount + 2,
  });
  await output.start();
  for (let frameIndex = 0; frameIndex < safeFrameCount; frameIndex += 1) {
    if (frameIndex > 0) await setFrame(frameIndex);
    await updateAlphaMaskCanvas();
    const encodeOptions = {
      keyFrame: frameIndex === 0 || frameIndex % (FPS * 2) === 0,
    };
    await Promise.all([
      source.add(frameIndex / FPS, 1 / FPS, encodeOptions),
      alphaMaskSource.add(frameIndex / FPS, 1 / FPS, encodeOptions),
    ]);
    if (frameIndex % 120 === 0 || frameIndex === safeFrameCount - 1) {
      console.log(`CONTRIBUTION_GLOBE_RENDER_PROGRESS ${frameIndex + 1}/${safeFrameCount}`);
    }
  }
  await Promise.all([source.close(), alphaMaskSource.close()]);
  await output.finalize();
  if (!target.buffer) throw new Error("Transparent contribution globe WebM buffer is empty.");
  const filename = "personal-github-contribution-location-globe.webm";
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
    alphaTransport: "dual-video-track-grayscale-mask" as const,
  };
}

function getDiagnostics(): Diagnostics {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const debug = gl?.getExtension("WEBGL_debug_renderer_info");
  return {
    webgl: Boolean(gl),
    renderer: gl && debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : undefined,
    vendor: gl && debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : undefined,
    deckView: "GlobeView",
    globeZoom: CONTRIBUTION_GLOBE_LAYOUT.zoom,
    meshResolutionDegrees: CONTRIBUTION_GLOBE_LAYOUT.meshResolutionDegrees,
    targetGlobeHeightRatio: CONTRIBUTION_GLOBE_LAYOUT.targetGlobeHeightRatio,
    transparentBackground: true,
    independentOverlay: true,
    baseMapLayerType: "PolygonLayer",
    landSource: "Natural Earth 1:50m land polygons",
    continentPolygonCount: continentPolygons.length,
    continentFillColor: [...CONTINENT_LAND_FILL_COLOR],
    rasterSurfaceLayerCount: 0,
    oceanUnderlay: false,
    backFaceCulling: "back",
    hemisphereClipping: "spherical-horizon-fragment-discard",
    clip02HandoffViewState: CLIP_02_ORLANDO_HANDOFF_VIEW_STATE,
    referenceFinalScale: REFERENCE_CONTRIBUTION_GLOBE_FINAL_SCALE,
    dayCount: dataset.dayCount,
    heatPointCount: dataset.points.length,
    locationCellCount: dataset.metrics.locationCellCount,
    trainingPointCount: dataset.trainingPoints.length,
    trainingLocationCellCount: dataset.metrics.trainingLocationCellCount,
    focusBeatCount: focusBeats.length,
    labeledFocusBeatCount: focusBeats.filter((beat) =>
      beat.locationEvidence === "nearest-curated-memory-zone",
    ).length,
    focusTransitionFraction: CONTRIBUTION_GLOBE_LAYOUT.focusTransitionFraction,
    focusMotionMode: "quick-ease-out-section-snap",
    organizationShareCount: dataset.organizationShares.length,
    organizationProgressDayCount: dataset.organizationProgress.length,
    organizationProgressFinalTotal: Object.values(
      dataset.organizationProgress.at(-1)?.cumulativeContributions ?? {},
    ).reduce((sum, count) => sum + count, 0),
    organizationColorCount: new Set(dataset.points.map((point) => point.organizationKey)).size,
    workColorMode: "solid-discrete-organization-heat-contours",
    settledWorkGeometry: "organization-split-geographic-heat-cells",
    persistentWorkScatterplots: false,
    settledTrainingGeometry: "cumulative-geographic-heat-cells",
    persistentTrainingScatterplots: false,
    impactTransition: "solid-bang-then-delayed-heat-cell",
    arrivalMotion: "absolute-corner-curved-recession",
    arrivalTrailLayer: "TripsLayer",
    arrivalTrailShape: "cubic-bezier-tapered-wake",
    arrivalView: "OrthographicView",
    arrivalFraction: CONTRIBUTION_PIN_ARRIVAL_FRACTION,
    arrivalStartDiameter: CONTRIBUTION_PIN_ARRIVAL_MAX_RADIUS * 2,
    arrivalHoldFraction: CONTRIBUTION_PIN_ARRIVAL_HOLD_FRACTION,
    arrivalRecessionExponent: CONTRIBUTION_PIN_RECESSION_EXPONENT,
    settledWorkBrightnessFloor: CONTRIBUTION_HEAT_BRIGHTNESS_FLOOR,
    settledTrainingBrightnessFloor: 0.46,
    maximumImpactWavePixels: CONTRIBUTION_IMPACT_WAVE_MAX_PIXELS,
    maximumFocusWavePixels: 32,
    workColorBlending: false,
    activeDayPercentTotal: dataset.organizationShares.reduce(
      (sum, share) => sum + share.activeDayPercent,
      0,
    ),
    contributionPercentTotal: dataset.organizationShares.reduce(
      (sum, share) => sum + share.contributionPercent,
      0,
    ),
    locationEvidence: dataset.locationEvidence,
    quantizationDegrees: dataset.quantizationDegrees,
    metrics: dataset.metrics,
    prefilledHistory: dataset.prefilledHistory ?? null,
    contract: VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT,
  };
}

window.__CONTRIBUTION_LOCATION_GLOBE__ = {
  ready,
  setFrame,
  getState: () => state,
  getDiagnostics,
  getTimecodePreview: (frameIndex, kind = "combined") => {
    const preview = document.createElement("canvas");
    preview.width = WIDTH;
    preview.height = HEIGHT;
    const context = preview.getContext("2d")!;
    drawContributionOverlay(context, frameIndex, focusBeats, dataset.organizationShares,
      dataset.organizationProgress, kind);
    return preview.toDataURL("image/png");
  },
  renderGlobeWebm,
  renderGeographicTimecodeWebm: (options) =>
    encodeContributionGeographicMemoryTimecode(
      focusBeats,
      dataset.organizationShares,
      dataset.organizationProgress,
      options,
    ),
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
