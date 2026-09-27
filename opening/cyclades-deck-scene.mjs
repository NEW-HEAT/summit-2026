import {Deck, MapView, WebMercatorViewport} from '@deck.gl/core';
import {BitmapLayer} from '@deck.gl/layers';
import {TripsLayer} from '@deck.gl/geo-layers';

const MAP_VIEW = new MapView({
  id: 'cyclades-map',
  orthographic: true,
  repeat: false
});

let deck = null;
let deckCanvas = null;
let basemapImage = null;
let basemapBounds = null;
let resolveAfterRender = null;
let lastFrameState = null;

// The locally pinned 9.4 alpha BitmapLayer expects its model and mesh to exist
// before the first bounds update. Seed both here so the artifact can use the
// repository's exact deck.gl packages without patching shared dependencies.
class CycladesBitmapLayer extends BitmapLayer {
  initializeState() {
    super.initializeState();
    this._seedModelAndMesh();
  }

  updateState(params) {
    if (!this.state.model) this._seedModelAndMesh();
    super.updateState(params);
  }

  _seedModelAndMesh() {
    const mesh = this._createMesh();
    this.state.mesh = mesh;
    this.state.model = this._getModel();
    Object.assign(this.state, this._getCoordinateUniforms());
    this.getAttributeManager().invalidateAll();
  }
}
CycladesBitmapLayer.layerName = 'CycladesBitmapLayer';

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

function layerParameters() {
  return {
    cullMode: 'none',
    depthCompare: 'always',
    depthWriteEnabled: false
  };
}

function tripLayer({id, data, currentTime, trailLength, opacity}) {
  return new TripsLayer({
    id,
    data,
    getPath: (trip) => trip.path,
    getTimestamps: (trip) => trip.timestamps,
    getColor: (trip) => trip.color,
    getWidth: (trip) => trip.width,
    currentTime,
    trailLength,
    fadeTrail: true,
    widthUnits: 'pixels',
    widthScale: 1,
    widthMinPixels: 2,
    widthMaxPixels: 30,
    capRounded: true,
    jointRounded: true,
    billboard: true,
    opacity,
    pickable: false,
    parameters: layerParameters()
  });
}

function sceneLayers({timeSeconds, openingTrips, cycleTrips, transitionTrips}) {
  const openingResolve = clamp((timeSeconds - 0.35) / 3.3);
  const openingOpacity =
    clamp((timeSeconds - 0.7) / 1.45) *
    (1 - clamp((timeSeconds - 3.62) / 0.38));
  return [
    basemapImage && new CycladesBitmapLayer({
      id: 'cyclades-world-imagery',
      image: basemapImage,
      bounds: basemapBounds,
      opacity: 1,
      pickable: false,
      parameters: layerParameters()
    }),
    timeSeconds < 4 && tripLayer({
      id: 'cyclades-opening-trips',
      data: openingTrips,
      currentTime: timeSeconds,
      trailLength: mix(0.42, 0.18, openingResolve),
      opacity: openingOpacity
    })
  ].filter(Boolean);
}

function viewportFor(viewState, width, height) {
  return new WebMercatorViewport({
    width,
    height,
    ...viewState
  });
}

function routeViewportCoverage(trips, viewState, width, height) {
  const viewport = viewportFor(viewState, width, height);
  const outside = ([x, y]) => x < 0 || x > width || y < 0 || y > height;
  let offscreenIngressCount = 0;
  let offscreenExitCount = 0;
  const ingressSamples = [];
  const exitSamples = [];
  for (const trip of trips) {
    if (!trip.path?.length) continue;
    const ingress = viewport.project(trip.path[0]);
    const exit = viewport.project(trip.path.at(-1));
    if (outside(ingress)) offscreenIngressCount += 1;
    if (outside(exit)) offscreenExitCount += 1;
    if (ingressSamples.length < 6) {
      ingressSamples.push([ingress[0] / width, ingress[1] / height]);
      exitSamples.push([exit[0] / width, exit[1] / height]);
    }
  }
  return {
    offscreenIngressCount,
    offscreenExitCount,
    ingressSamples,
    exitSamples
  };
}

async function initializeCycladesDeck({canvas, image, bounds, width = 1920, height = 1080}) {
  if (deck) deck.finalize();
  deckCanvas = canvas;
  basemapImage = image;
  basemapBounds = bounds;
  if (deckCanvas.width !== width) deckCanvas.width = width;
  if (deckCanvas.height !== height) deckCanvas.height = height;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    deck = new Deck({
      canvas: deckCanvas,
      width,
      height,
      useDevicePixels: false,
      views: MAP_VIEW,
      controller: false,
      viewState: {
        longitude: 25.08,
        latitude: 36.72,
        zoom: 8.45,
        pitch: 0,
        bearing: 0
      },
      layers: sceneLayers({
        timeSeconds: 0,
        openingTrips: [],
        cycleTrips: [],
        transitionTrips: []
      }),
      glOptions: {
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: false,
        premultipliedAlpha: true
      },
      parameters: {
        clearColor: [0, 0.035, 0.09, 1]
      },
      onLoad: finish,
      onAfterRender: () => {
        finish();
        if (resolveAfterRender) {
          const resolveFrame = resolveAfterRender;
          resolveAfterRender = null;
          resolveFrame(lastFrameState);
        }
      },
      onError: (error) => reject(error)
    });
    deck.redraw(true);
  });
  return true;
}

async function renderCycladesDeckFrame({
  timeSeconds,
  width,
  height,
  viewState,
  openingTrips,
  cycleTrips,
  transitionTrips
}) {
  if (!deck) throw new Error('Cyclades deck runtime has not been initialized');
  if (deckCanvas.width !== width) deckCanvas.width = width;
  if (deckCanvas.height !== height) deckCanvas.height = height;
  const allCycleTrips = [...cycleTrips, ...transitionTrips];
  const cycleCoverage = routeViewportCoverage(
    allCycleTrips,
    viewState,
    width,
    height
  );
  lastFrameState = {
    timeSeconds,
    viewState,
    layerTypes: ['BitmapLayer', 'TripsLayer'],
    openingTripCount: openingTrips.length,
    cycleTripCount: cycleTrips.length,
    closingTripCount: transitionTrips.length,
    cycleOffscreenIngressCount: cycleCoverage.offscreenIngressCount,
    cycleOffscreenExitCount: cycleCoverage.offscreenExitCount,
    cycleIngressSamples: cycleCoverage.ingressSamples,
    cycleExitSamples: cycleCoverage.exitSamples
  };
  const rendered = new Promise((resolve) => {
    resolveAfterRender = resolve;
  });
  deck.setProps({
    width,
    height,
    viewState,
    layers: sceneLayers({timeSeconds, openingTrips, cycleTrips, transitionTrips})
  });
  deck.redraw(true);
  return rendered;
}

function projectCycladesCoordinate(coordinate, viewState, width, height) {
  return viewportFor(viewState, width, height).project(coordinate);
}

function unprojectCycladesCoordinate(pixel, viewState, width, height) {
  return viewportFor(viewState, width, height).unproject(pixel);
}

window.__NEWHEAT_CYCLADES_DECK__ = {
  initialize: initializeCycladesDeck,
  renderFrame: renderCycladesDeckFrame,
  project: projectCycladesCoordinate,
  unproject: unprojectCycladesCoordinate,
  getState: () => lastFrameState,
  finalize: () => {
    deck?.finalize();
    deck = null;
  }
};
