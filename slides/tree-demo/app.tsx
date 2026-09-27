// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Deck,
  _GlobeView,
  _GlobeViewport,
  MapView,
  WebMercatorViewport,
  type MapViewState,
  type PickingInfo,
  type ViewStateChangeParameters,
  type Widget
} from '@deck.gl/core';
import {LineLayer, SolidPolygonLayer} from '@deck.gl/layers';
import type {Device} from '@luma.gl/core';
import {TreeLayer, type Season} from '@deck.gl-community/three';
import {
  FOREST_SITES,
  SEASONS,
  TREES_PER_SITE,
  createTreeSamples,
  getFoliageColor,
  getBarkColor,
  getSeasonalCanopyRadius,
  getSeasonalCrop,
  getSeasonDescription,
  createWinterBranches,
  type ForestTree
} from './forest-data';
import {createForestBasemap} from './forest-basemap';
import {getGroveView, pickTreeAtPixel, createGroveFlight} from './forest-camera';
import './style.css';
import land from '../assets/land.json';
import {landContains, crownOnLand, tileWaterFeatures} from './land-guard.mjs';

export type WildForestExampleOptions = {
  showControlsWidget?: boolean;
  /** Reuse the website's selected graphics device. */
  device?: Device;
  widgets?: Widget[];
  /** Restore the camera after a graphics backend switch. */
  initialViewState?: MapViewState;
  onViewStateChange?: <ViewStateT extends MapViewState>(
    params: ViewStateChangeParameters<ViewStateT>
  ) => ViewStateT;
  onDeckInitialized?: (deck: Deck<_GlobeView | MapView>) => void;
};

// Keep projection and controller paired through the handoff. GlobeView's implicit
// Mercator switch otherwise leaves GlobeController handling a flat viewport.
class ForestGlobeView extends _GlobeView {
  getViewportType() {
    return _GlobeViewport;
  }
}

type ExplorerState = {siteId: string; season: Season};
const containsLand = landContains(land);
const SAMPLES = createTreeSamples().filter(tree => crownOnLand(tree, containsLand));
const GROVES = FOREST_SITES.map(site => ({
  site,
  trees: SAMPLES.filter(tree => tree.siteId === site.id)
}));
const DEFAULT_SITE_ID = 'siwa';
const FLIGHT_DURATION = 1000;
// Preserve the two selectors when the website remounts for a graphics backend switch.
const HOST_STATE = new WeakMap<HTMLElement, ExplorerState>();
const VIEW_LIMITS: Partial<MapViewState> = {minZoom: -1, maxZoom: 21, maxPitch: 75};
const WORLD_POLYGON = [
  [
    [-180, 90],
    [0, 90],
    [180, 90],
    [180, -90],
    [0, -90],
    [-180, -90]
  ]
];

// Keep the depth-occluding globe just below tile geometry. Coincident tessellations
// otherwise produce white seams over the open ocean near the antimeridian.
const GLOBE_BACKGROUND = WORLD_POLYGON.map(polygon =>
  polygon.map(([lng, lat]) => [lng, lat, -20000])
);

/** Mount a grove explorer that starts in Siwa with metre-scale trees. */
export function mountWildForestExample(
  container: HTMLElement,
  options: WildForestExampleOptions = {}
): () => void {
  const doc = container.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'forest-explorer';
  root.dataset.flying = 'false';
  root.dataset.managedDevice = String(Boolean(options.device));
  const canvasHost = doc.createElement('div');
  canvasHost.className = 'forest-canvas';
  root.append(canvasHost);
  container.replaceChildren(root);
  const savedState = HOST_STATE.get(container);
  const state: ExplorerState = {...(savedState ?? {siteId: DEFAULT_SITE_ID, season: 'autumn'})};
  if (!FOREST_SITES.some(site => site.id === state.siteId)) state.siteId = DEFAULT_SITE_ID;
  let currentView =
    savedState && options.initialViewState ? options.initialViewState : getSelectedView();
  let flightFrame: number | null = null;
  const reducedMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let disposed = false;
  let rendered = false;
  const notifyReady = () => {
    if (rendered) parent.postMessage({type: 'newheat-tree-ready'}, 'http://127.0.0.1:8756');
  };
  const readyRequest = (event: MessageEvent) => {
    if (event.origin === 'http://127.0.0.1:8756' && event.source === parent && event.data?.type === 'newheat-tree-ready-request') notifyReady();
  };
  const showKey = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || ['INPUT','SELECT','TEXTAREA','BUTTON'].includes((event.target as HTMLElement)?.tagName)) return;
    const direction = ['PageDown','ArrowRight'].includes(event.key) ? 1 : ['PageUp','ArrowLeft'].includes(event.key) ? -1 : 0;
    if (direction) {event.preventDefault(); parent.postMessage({type:'newheat-tree-key',direction}, 'http://127.0.0.1:8756');}
  };
  addEventListener('message', readyRequest);
  addEventListener('keydown', showKey);
  const waterTiles = new Map<string, any[]>();
  let waterFrame = 0;
  let visibleGroves = GROVES;
  let visibleTrees = SAMPLES;
  let mapRevision = 0;
  let mapFailed = false;
  let mapLoaded = false;
  const ui = createControls(root, options.showControlsWidget !== false);
  let basemap = createBasemap();
  let globeProjection = currentView.zoom <= 12;
  // Keep every grove's GPU attributes resident across region and projection changes.
  // Only a season change needs to regenerate foliage, fruit, or winter branches.
  let groveLayers = createGroveLayers();
  const deck = new Deck({
    parent: canvasHost,
    device: options.device,
    views: createView(),
    initialViewState: {...currentView, ...VIEW_LIMITS},
    controller: {touchRotate: true, inertia: 100, scrollZoom: {smooth: false, speed: 0.025}},
    useDevicePixels: Math.min(2, doc.defaultView?.devicePixelRatio || 1),
    widgets: options.widgets ?? [],
    pickingRadius: 8,
    layers: buildLayers(),
    layerFilter({layer, viewport}) {
      const grove = GROVES.find(
        ({site}) =>
          layer.id.startsWith(`forest-trees-${site.id}`) || layer.id === `forest-winter-${site.id}`
      );
      if (!grove) return true;
      if (viewport.zoom < 13) return false;
      const lngDelta = ((grove.site.position[0] - currentView.longitude + 540) % 360) - 180;
      return Math.abs(lngDelta) < 1 && Math.abs(grove.site.position[1] - currentView.latitude) < 1;
    },
    onAfterRender() {
      if (!rendered && !waterFrame && (mapLoaded || mapFailed)) {
        rendered = true; root.dataset.rendered = 'true'; notifyReady();
      }
    },
    onViewStateChange(params) {
      // Ignore trailing controller callbacks while the flight owns the camera.
      // New native input cancels the flight in the capture listeners below.
      if (flightFrame !== null) return currentView as typeof params.viewState;
      const viewState = options.onViewStateChange?.(params) ?? params.viewState;
      currentView = viewState as MapViewState;
      // Camera motion only changes the viewport, not tree data or mesh attributes.
      if (globeProjection !== currentView.zoom <= 12) {
        globeProjection = currentView.zoom <= 12;
        deck.setProps({
          views: createView(),
          initialViewState: {...currentView, ...VIEW_LIMITS, transitionDuration: 0},
          layers: buildLayers()
        });
      }
      updateControls();
      return viewState;
    },
    getTooltip(info: PickingInfo<ForestTree>) {
      const tree = getTreeAtPointer(info);
      if (!tree) return null;
      const site = FOREST_SITES.find(item => item.id === tree.siteId)!;
      const crop = getSeasonalCrop(tree, state.season);
      const stage = tree.maturity[0].toUpperCase() + tree.maturity.slice(1);
      const structure =
        tree.species === 'pine'
          ? `${tree.branchLevels} branch tiers`
          : `${Math.round((getSeasonalCanopyRadius(tree, state.season) / tree.canopyRadius) * 100)}% crown fullness`;
      const yieldText = crop
        ? `${crop.count} fruit / flower markers · ${crop.droppedCount} fallen`
        : 'Resting crop';
      return {
        text: `${tree.label} · ${stage}\n${tree.height.toFixed(1)} m high · ${(tree.trunkRadius * 2).toFixed(2)} m trunk\n${Math.round(tree.vigor * 100)}% vigour · ${structure}\n${yieldText}\nSimulated tree · ${site.name}`
      };
    },
    onClick(info: PickingInfo<ForestTree>) {
      const tree = getTreeAtPointer(info);
      if (tree) focusTree(tree.siteId);
    }
  });
  options.onDeckInitialized?.(deck);
  const interactionEvents = ['pointerdown', 'wheel', 'keydown'] as const;
  const onUserInput = (event: Event) => {
    const target = event.target as Node | null;
    // A website-owned device may keep its canvas outside the mounting container.
    if (target && (container.contains(target) || target === deck.getCanvas())) stopFlight();
  };
  for (const event of interactionEvents) {
    doc.addEventListener(event, onUserInput, {capture: true, passive: true});
  }
  updateControls();
  ui.treeSelect.onchange = () => focusTree(ui.treeSelect.value);
  ui.seasonSelect.onchange = () => {
    state.season = ui.seasonSelect.value as Season;
    groveLayers = createGroveLayers();
    updateScene();
  };
  ui.zoomIn.onclick = () => zoomBy(1);
  ui.zoomOut.onclick = () => zoomBy(-1);
  ui.retry.onclick = () => {
    mapFailed = false;
    mapLoaded = false;
    mapRevision++;
    basemap = createBasemap();
    updateScene();
  };
  let previousSize = [container.clientWidth, container.clientHeight];
  const resizeObserver = new ResizeObserver(() => {
    const size = [container.clientWidth, container.clientHeight];
    if (size[0] && size[1] && size.some((value, index) => value !== previousSize[index])) {
      previousSize = size;
      focusTree(state.siteId, false);
    }
  });
  resizeObserver.observe(container);
  return () => {
    disposed = true;
    removeEventListener('message', readyRequest);
    removeEventListener('keydown', showKey);
    cancelAnimationFrame(waterFrame);
    stopFlight();
    for (const event of interactionEvents) doc.removeEventListener(event, onUserInput, true);
    resizeObserver.disconnect();
    HOST_STATE.set(container, {...state});
    deck.finalize();
    root.remove();
  };

  function createView() {
    // Distinct IDs also dispose the outgoing controller and its event listeners.
    return globeProjection
      ? new ForestGlobeView({id: 'forest-globe', resolution: 5})
      : new MapView({id: 'forest-map'});
  }
  function getSelectedView(): MapViewState {
    return getGroveView(
      GROVES.find(grove => grove.site.id === state.siteId)!.trees,
      container.clientWidth || 900,
      container.clientHeight || 600
    );
  }
  function zoomBy(delta: number) {
    stopFlight();
    const zoom = Math.max(-1, Math.min(21, currentView.zoom + delta));
    setView({...currentView, zoom});
  }
  function stopFlight() {
    if (flightFrame !== null) doc.defaultView!.cancelAnimationFrame(flightFrame);
    flightFrame = null;
    root.dataset.flying = 'false';
  }
  function flyTo(view: MapViewState) {
    stopFlight();
    if (reducedMotion?.matches) {
      setView(view);
      return;
    }
    const interpolate = createGroveFlight(
      currentView,
      view,
      container.clientWidth || 900,
      container.clientHeight || 600
    );
    let startedAt: number | null = null;
    root.dataset.flying = 'true';
    // Own the flight clock so crossing the globe/map boundary cannot cancel the flight
    // when the matching viewport and controller are replaced.
    const frame = (now: number) => {
      // Start on the first available frame rather than consuming the flight during setup.
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / FLIGHT_DURATION);
      const eased = progress * progress * (3 - 2 * progress);
      setView(interpolate(eased));
      if (progress < 1) {
        flightFrame = doc.defaultView!.requestAnimationFrame(frame);
      } else {
        flightFrame = null;
        root.dataset.flying = 'false';
      }
    };
    flightFrame = doc.defaultView!.requestAnimationFrame(frame);
  }
  function setView(view: MapViewState) {
    // Apply each camera frame directly; wheel input never waits behind a transition.
    currentView =
      options.onViewStateChange?.({
        viewId: view.zoom <= 12 ? 'forest-globe' : 'forest-map',
        viewState: view,
        oldViewState: currentView,
        interactionState: {}
      }) ?? view;
    const projectionChanged = globeProjection !== currentView.zoom <= 12;
    globeProjection = currentView.zoom <= 12;
    deck.setProps({
      initialViewState: {...currentView, ...VIEW_LIMITS, transitionDuration: 0},
      ...(projectionChanged ? {views: createView(), layers: buildLayers()} : {})
    });
    updateControls();
  }
  function focusTree(siteId: string, animate = true) {
    if (!FOREST_SITES.some(site => site.id === siteId)) return;
    state.siteId = siteId;
    HOST_STATE.set(container, {...state});
    if (animate) {
      flyTo(getSelectedView());
    } else {
      stopFlight();
      setView(getSelectedView());
    }
    updateControls();
  }
  function updateScene() {
    HOST_STATE.set(container, {...state});
    deck.setProps({layers: buildLayers()});
    updateControls();
  }
  function updateControls() {
    if (disposed) return;
    const site = FOREST_SITES.find(item => item.id === state.siteId)!;
    root.dataset.site = state.siteId;
    root.dataset.season = state.season;
    root.dataset.view = currentView.zoom <= 12 ? 'globe' : 'grove';
    ui.treeSelect.value = state.siteId;
    ui.seasonSelect.value = state.season;
    ui.heading.textContent = `${site.name}, ${site.country}`;
    const visibleCount = visibleGroves.find(grove => grove.site.id === state.siteId)!.trees.length;
    ui.caption.textContent = `${visibleCount} trees · ${getSeasonDescription(site, state.season)}`;
    root.dataset.zoom = currentView.zoom.toFixed(3);
    root.dataset.treeScale = '1';
    root.dataset.treeCount = String(visibleCount);
    root.dataset.totalTrees = String(visibleTrees.length);
    ui.scale.hidden = currentView.zoom < 12;
    if (!ui.scale.hidden) {
      const viewport = new WebMercatorViewport({...currentView, width: container.clientWidth || 1280, height: container.clientHeight || 720});
      const base = [currentView.longitude, currentView.latitude, 0];
      const a = viewport.project(base);
      const b = viewport.project([base[0] + 20 / (111320 * Math.cos(base[1] * Math.PI / 180)), base[1], 0]);
      const pixelsPerMeter = Math.hypot(b[0] - a[0], b[1] - a[1]) / 20;
      const metres = [1,2,5,10,20,50,100,200,500,1000].find(value => value * pixelsPerMeter >= 75) ?? 1000;
      ui.scale.style.width = (metres * pixelsPerMeter) + 'px';
      ui.scale.textContent = metres >= 1000 ? (metres / 1000) + ' km' : metres + ' m';
    }
    ui.source.hidden = false;
    ui.source.href = site.source;
    ui.scaleNote.textContent = 'Metre-scale trees · illustrative land locations';
    ui.zoomIn.disabled = currentView.zoom >= 21;
    ui.zoomOut.disabled = currentView.zoom <= -1;
    ui.status.textContent = mapFailed ? 'Map unavailable' : mapLoaded ? '' : 'Loading map…';
    ui.retry.hidden = !mapFailed;
  }
  function createBasemap() {
    return createForestBasemap({
      id: `forest-vector-${mapRevision}`,
      onWaterTile(tile) {
        if (tile.index.z !== 14 || disposed) return;
        waterTiles.set(tile.id, tileWaterFeatures(tile, 'wgs84'));
        cancelAnimationFrame(waterFrame);
        waterFrame = requestAnimationFrame(() => {
          waterFrame = 0;
          if (disposed) return;
          const inWater = landContains({features: [...waterTiles.values()].flat()});
          const next = GROVES.map(grove => ({...grove, trees: grove.trees.filter(tree => crownOnLand(tree, p => !inWater(p)))}));
          if (next.some((grove, i) => grove.trees.length !== visibleGroves[i].trees.length || grove.trees.some((tree, j) => tree !== visibleGroves[i].trees[j]))) {
            visibleGroves = next;
            visibleTrees = next.flatMap(grove => grove.trees);
            groveLayers = createGroveLayers();
            updateScene();
          }
          // Water filtering can settle after the last tile frame without changing data.
          // Request the frame that establishes the outgoing PR may safely dissolve.
          if (!rendered) deck.redraw(true);
        });
      },
      onLoad() {
        mapLoaded = true;
        updateControls();
      },
      onError() {
        mapFailed = true;
        updateControls();
      }
    });
  }
  function getTreeAtPointer({x, y}: PickingInfo<ForestTree>) {
    if (flightFrame !== null) return undefined;
    return pickTreeAtPixel(visibleTrees, deck.getViewports()[0], currentView, x, y);
  }
  function buildLayers() {
    return [
      new SolidPolygonLayer({
        id: 'forest-earth',
        data: globeProjection ? GLOBE_BACKGROUND : WORLD_POLYGON,
        getPolygon: polygon => polygon,
        getFillColor: [247, 247, 239, 255],
        parameters: {cullMode: 'back', depthWriteEnabled: globeProjection},
        pickable: false
      }),
      basemap,
      ...groveLayers
    ];
  }
  function createGroveLayers() {
    return visibleGroves.flatMap(({site, trees}) => [
      createTreeLayer(trees, site.id),
      new LineLayer({
        id: `forest-winter-${site.id}`,
        parameters: {cullMode: 'none'},
        data: state.season === 'winter' ? createWinterBranches(trees, 1) : [],
        getSourcePosition: branch => branch.source,
        getTargetPosition: branch => branch.target,
        getColor: [113, 92, 69, 255],
        getWidth: 1.5
      })
    ]);
  }
  function createTreeLayer(trees: ForestTree[], id: string) {
    const season = state.season;
    return new TreeLayer<ForestTree>({
      id: `forest-trees-${id}`,
      data: trees,
      getPosition: tree => tree.position,
      getTreeType: tree => tree.type,
      getHeight: tree => tree.height,
      getTrunkRadius: tree => tree.trunkRadius,
      getCanopyRadius: tree => getSeasonalCanopyRadius(tree, season),
      getTrunkColor: getBarkColor,
      getTrunkHeightFraction: tree => tree.trunkFraction,
      getBranchLevels: tree => tree.branchLevels,
      getCanopyColor: tree => getFoliageColor(tree, season),
      getCrop: tree => getSeasonalCrop(tree, season),
      sizeScale: 1,
      _subLayerProps:
        season === 'winter' && ['cherry', 'birch'].includes(trees[0]?.species)
          ? {'canopy-cherry': {visible: false}, 'canopy-birch': {visible: false}}
          : {},
      pickable: true,
      parameters: {cullMode: 'none'},
      updateTriggers: {
        getCanopyRadius: season,
        getCanopyColor: season,
        getCrop: season
      }
    });
  }
}

function createControls(root: HTMLElement, showControls: boolean) {
  const ui = root.ownerDocument.createElement('div');
  ui.className = 'forest-ui';
  ui.innerHTML = `
    <div class="forest-title"><h1 class="forest-heading">TreeLayer</h1><p class="forest-caption"></p><a class="forest-source" target="_blank" rel="noreferrer" hidden>About this region ↗</a></div>
    <div class="forest-toolbar" aria-label="Tree explorer" ${showControls ? '' : 'hidden'}>
      <select aria-label="Explore a tree">${FOREST_SITES.map(site => `<option value="${site.id}">${SAMPLES.find(tree => tree.siteId === site.id)!.label} · ${site.country}</option>`).join('')}</select>
      <select aria-label="Local season">${SEASONS.map(season => `<option value="${season}">${season[0].toUpperCase() + season.slice(1)}</option>`).join('')}</select>
      <div class="forest-zoom"><button type="button" data-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-action="zoom-in" aria-label="Zoom in">+</button></div>
    </div>
    <div class="forest-scale" aria-label="Ground scale"></div>
    <div class="forest-map-status" role="status"><span></span><button type="button" data-action="retry" hidden>Retry</button></div>
    <div class="forest-attribution"><span class="forest-scale-note"></span><span>© <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></span></div>`;
  root.append(ui);
  const find = <T extends HTMLElement>(selector: string) => ui.querySelector<T>(selector)!;
  return {
    heading: find('h1'),
    caption: find('.forest-caption'),
    source: find<HTMLAnchorElement>('.forest-source'),
    treeSelect: find<HTMLSelectElement>('[aria-label="Explore a tree"]'),
    seasonSelect: find<HTMLSelectElement>('[aria-label="Local season"]'),
    zoomIn: find<HTMLButtonElement>('[data-action="zoom-in"]'),
    zoomOut: find<HTMLButtonElement>('[data-action="zoom-out"]'),
    scaleNote: find('.forest-scale-note'),
    scale: find('.forest-scale'),
    status: find('.forest-map-status span'),
    retry: find<HTMLButtonElement>('[data-action="retry"]')
  };
}
