import {COORDINATE_SYSTEM, type Layer} from '@deck.gl/core';
import {PathLayer} from '@deck.gl/layers';
import {RoundedTripsLayer} from './RoundedTripsLayer';
import {BridgeTile3DLayer} from './BridgeTile3DLayer';
import {tileCredits} from './tileCredits';
import {Tiles3DLoader} from '@loaders.gl/3d-tiles';
import type {BiometricSample, LngLatZ, SceneConfig, TimelineState} from './types';
import {footRegisteredTrips} from './trail';
import {flightParticipants} from './participants';
import {buildGlobalHeatLayers, type HeatInput} from './globalHeat';

type TileStateHandler = (state: 'loading' | 'ready' | 'failed', detail?: string) => void;

const CONTINENTS: LngLatZ[][] = [
  [[-168, 14, 0], [-154, 58, 0], [-126, 72, 0], [-92, 58, 0], [-52, 48, 0], [-80, 8, 0], [-112, 17, 0]],
  [[-82, 10, 0], [-72, -5, 0], [-66, -54, 0], [-44, -24, 0], [-35, 5, 0], [-54, 12, 0]],
  [[-12, 36, 0], [12, 71, 0], [54, 66, 0], [88, 74, 0], [178, 58, 0], [146, 8, 0], [100, 2, 0], [72, 24, 0], [44, 32, 0], [28, 42, 0]],
  [[-18, 36, 0], [10, 37, 0], [43, 12, 0], [34, -35, 0], [10, -30, 0], [-8, 4, 0]],
  [[112, -10, 0], [154, -10, 0], [152, -40, 0], [116, -35, 0]],
  [[-52, 60, 0], [-22, 82, 0], [-12, 61, 0]]
];

const GRATICULE = createGraticule();

export function buildLayers({
  scene,
  state,
  tileUrl,
  tileApiKey,
  biometric,
  onTileState,
  onTileCredits,
  selectionCamera,
  viewportSize,
  heatInput
}: {
  scene: SceneConfig;
  state: TimelineState;
  tileUrl: string | null;
  tileApiKey: string | null;
  biometric: BiometricSample;
  onTileState: TileStateHandler;
  onTileCredits?: (credits: string) => void;
  selectionCamera?: {longitude: number; latitude: number; zoom: number; pitch: number; bearing: number};
  viewportSize: {width: number; height: number};
  heatInput?: HeatInput;
}): Layer[] {
  const alpha = Math.round(255 * state.sceneOpacity);
  const layers: Array<Layer | null> = [
    tileUrl
      ? new BridgeTile3DLayer({
          id: 'google-photorealistic-3d-tiles-ground-v018',
          data: tileUrl,
          selectionCamera,
          loaders: [Tiles3DLoader],
          operation: 'terrain+draw',
          pickable: '3d',
          opacity: state.sceneOpacity,
          pointSize: 2,
          _subLayerProps: {
            scenegraph: {
              parameters: {cullMode: 'none'}
            },
            mesh: {
              parameters: {cullMode: 'none'}
            }
          },
          loadOptions: {
            fetch: {
              headers: {'X-GOOG-API-KEY': tileApiKey}
            },
            tileset: {
              throttleRequests: true,
              maxRequests: 48,
              // Use content-ready replacement semantics. A tile selected by the
              // wider detail camera may never draw in the ground viewport, so
              // draw-gated ancestor retention otherwise leaves coarse slabs forever.
              onTraversalComplete: (tiles: Array<{tileDrawn: boolean; content?: unknown}>) => {
                onTileCredits?.(tileCredits(tiles));
                for (const tile of tiles) tile.tileDrawn = true;
                return tiles;
              },
              maximumMemoryUsage: scene.tiles.maximumMemoryUsage,
              maximumScreenSpaceError: scene.tiles.maximumScreenSpaceError,
              loadSiblings: true,
              skipLevelOfDetail: false
            }
          },
          onTilesetLoad: () => onTileState('ready'),
          onTileError: (_tile: unknown, message: string, url: string) =>
            onTileState('failed', `${message} ${redactUrl(url)}`),
          onError: (error: Error) => {
            onTileState('failed', sanitizeMessage(error.message));
            return true;
          }
        } as never)
      : null,
    !tileUrl
      ? new PathLayer<LngLatZ[]>({
          id: 'offline-staging-continent-outlines',
          data: CONTINENTS.map(polygon => [...polygon, polygon[0]]),
          getPath: path => path,
          getColor: [117, 165, 176, Math.round(alpha * 0.72)],
          getWidth: 1.2,
          widthUnits: 'pixels',
          pickable: false
        })
      : null,
    !tileUrl
      ? new PathLayer<LngLatZ[]>({
          id: 'offline-staging-graticule',
          data: GRATICULE,
          getPath: path => path,
          getColor: [54, 91, 104, Math.round(alpha * 0.52)],
          getWidth: 0.65,
          widthUnits: 'pixels',
          pickable: false
        })
      : null,
    state.trailOpacity > 0
      ? createTripLayer(scene, state, biometric, viewportSize)
      : null
  ];
  return [...layers.filter(Boolean) as Layer[], ...flightParticipants(scene, state, biometric, viewportSize.width, viewportSize.height), ...buildGlobalHeatLayers(state,heatInput)];
}

function createTripLayer(
  scene: SceneConfig,
  state: TimelineState,
  biometric: BiometricSample,
  viewportSize: {width: number; height: number}
): Layer {
  const trips = footRegisteredTrips(scene, state, viewportSize.width, viewportSize.height);
  const origin = trips[0]?.path.at(-1) ?? scene.route[0];
  const data = trips.map(trip => ({
    ...trip,
    color: [...(trip.kind === 'step' ? [218, 78, 17] : scene.trail.color),
      Math.round(248 * state.trailOpacity * trip.opacity)],
    path: trip.path.map(position => [
      (position[0] - origin[0]) * 111320 * Math.cos(origin[1] * Math.PI / 180),
      (position[1] - origin[1]) * 110540,
      position[2] - origin[2]
    ] as LngLatZ)
  }));
  return new RoundedTripsLayer({
    id: 'future-trip-trail',
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: origin,
    data,
    getPath: (item: typeof data[number]) => item.path,
    getTimestamps: (item: typeof data[number]) => item.timestamps,
    getColor: (item: typeof data[number]) => item.color,
    getWidth: (item: typeof data[number]) => item.width,
    widthUnits: 'meters',
    widthMinPixels: 1.5 + 4.5 * (1 - state.videoOpacity),
    widthMaxPixels: scene.trail.widthPixels * 2,
    currentTime: 0,
    trailLength: 1,
    capRounded: true,
    jointRounded: true,
    // Each path's normalized timestamps fade continuously from sole to tail.
    fadeTrail: true,
    billboard: false,
    shadowEnabled: false,
    pickable: false,
    extensions: [],
    parameters: {depthCompare: 'always', depthWriteEnabled: false, cullMode: 'none'} as never
  } as never);
}

function createGraticule(): LngLatZ[][] {
  const paths: LngLatZ[][] = [];
  for (let latitude = -75; latitude <= 75; latitude += 15) {
    const path: LngLatZ[] = [];
    for (let longitude = -180; longitude <= 180; longitude += 5) {
      path.push([longitude, latitude, 0]);
    }
    paths.push(path);
  }
  for (let longitude = -180; longitude < 180; longitude += 15) {
    const path: LngLatZ[] = [];
    for (let latitude = -85; latitude <= 85; latitude += 5) {
      path.push([longitude, latitude, 0]);
    }
    paths.push(path);
  }
  return paths;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    return url.toString();
  } catch {
    return 'tile-url-redacted';
  }
}

function sanitizeMessage(value: string): string {
  return value.replace(/https?:\/\/[^\s]+/g, match => redactUrl(match));
}
