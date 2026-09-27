import {WebMercatorViewport, type Viewport} from '@deck.gl/core';
import {Tile3DLayer} from '@deck.gl/geo-layers';
import {meshHeightAt, registerBridgeSurfaces} from './surface';

/** Keep street-height drawing independent from the aerial detail-selection camera. */
export class BridgeTile3DLayer extends Tile3DLayer<unknown, {
  selectionCamera?: {longitude: number; latitude: number; zoom: number; pitch: number; bearing: number};
}> {
  static layerName = 'BridgeTile3DLayer';
  private captureViewport: Viewport | null = null;

  override get isLoaded(): boolean {
    return super.isLoaded && traversalIsCurrent(this.state?.tileset3d as any,
      this.state?.frameNumber, this.captureViewport,
      this.captureViewport ? this.state?.lastUpdatedViewports?.[this.captureViewport.id] : null);
  }

  override activateViewport(viewport: Viewport): void {
    if (viewport.id === 'closing-globe') {
      registerBridgeSurfaces(((this.state.tileset3d?.tiles ?? []) as Array<{selected: boolean; content: any}>)
        .filter(tile => tile.selected && tile.content?.gltf).map(tile => tile.content));
    }
    if (viewport.id === 'closing-globe' && new URLSearchParams(location.search).get('calibrate') === '1') {
      (window as unknown as Record<string, unknown>).__NEWHEAT_SAMPLE_DECK__ = (east = 0, north = 0) => {
        const eye = viewport.unprojectPosition(viewport.cameraPosition);
        const point = [eye[0] + east / (111320 * Math.cos(eye[1] * Math.PI / 180)), eye[1] + north / 110540];
        const heights: number[] = [];
        for (const tile of (this.state.tileset3d?.tiles ?? []) as Array<{content: any; selected: boolean}>) {
          const content = tile.content;
          const origin = content?.cartographicOrigin;
          if (!tile.selected || !content?.gltf || !origin) continue;
          const distance = Math.hypot((origin[0] - point[0]) * 111320 * Math.cos(point[1] * Math.PI / 180), (origin[1] - point[1]) * 110540);
          if (distance > 150) continue;
          const height = meshHeightAt(content, point);
          if (height !== null) heights.push(height);
        }
        return {heightMeters: heights.length ? Math.max(...heights) : null, intersectedMeshes: heights.length};
      };
    }
    (window as unknown as Record<string, unknown>).__NEWHEAT_TILE_READINESS__ = () => {
      const tiles = (this.state.tileset3d?.tiles ?? []) as Array<{selected: boolean; tileDrawn: boolean; lodMetricValue: number; screenSpaceError: number}>;
      const selected = tiles.filter(tile => tile.selected);
      return {cached: tiles.length, selected: selected.length, undrawn: selected.filter(tile => !tile.tileDrawn).length, loaded: this.isLoaded,
        traversalFrame: this.state.frameNumber ?? null,
        geometricErrors: selected.map(tile => tile.lodMetricValue).sort((a, b) => b - a).slice(0, 20),
        screenSpaceErrors: selected.map(tile => tile.screenSpaceError).sort((a, b) => b - a).slice(0, 20),
        selectionZooms: Object.values(this.state.lastUpdatedViewports ?? {}).map(v => v.zoom)};
    };
    const camera = this.props.selectionCamera;
    const selection = camera && viewport.id === 'closing-globe'
      ? new WebMercatorViewport({
          id: viewport.id, width: viewport.width, height: viewport.height,
          ...camera, nearZMultiplier: 0.001, farZMultiplier: 12
        })
      : viewport;
    this.captureViewport = selection;
    super.activateViewport(selection);
    if (this.internalState) this.internalState.viewport = viewport;
  }
}

/** Pinned loaders.gl can say isLoaded while a new selectTiles timer is queued. */
export function traversalIsCurrent(
  tileset: {updatePromise?: unknown; traverseCounter?: number; frameNumber?: number} | null | undefined,
  drawnTraversal: number | undefined,
  expected: Viewport | null,
  applied: Viewport | null | undefined
): boolean {
  return Boolean(tileset && !tileset.updatePromise && !tileset.traverseCounter &&
    tileset.frameNumber === drawnTraversal && expected && applied && expected.equals(applied));
}
