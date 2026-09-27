import {WebMercatorViewport} from '@deck.gl/core';
import type {CameraState} from './types';

export const BRIDGE_VIEW = {zoom: 21, pitch: 87.3, bearing: 197.3} as const;
export const BRIDGE_LENS_FOVY = 44;
export const BRIDGE_EYE_HEIGHT_METERS = 1.3;

/** Provider ellipsoid heights, sampled from the actual bridge mesh, not sea-level zero. */
export const BRIDGE_DECK_PROFILE = [
  [0, -20.375300], [120 / 599, -20.459052], [300 / 599, -20.940614],
  [480 / 599, -20.869115], [1, -21.093245]
] as const;

export function bridgeDeckHeight(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  const index = Math.max(1, BRIDGE_DECK_PROFILE.findIndex(point => point[0] >= p));
  const a = BRIDGE_DECK_PROFILE[index - 1];
  const b = BRIDGE_DECK_PROFILE[index];
  const t = (p - a[0]) / Math.max(0.000001, b[0] - a[0]);
  const smooth = t * t * (3 - 2 * t);
  return a[1] + (b[1] - a[1]) * smooth;
}

/** Keep one projection through the dive, ground act and pull-out. Move its eye, not just its target. */
export function resolveBridgeRenderCamera(camera: CameraState, progress: number, width: number, height: number) {
  const t = Math.max(0, Math.min(1, (camera.zoom - 16) / (BRIDGE_VIEW.zoom - 16)));
  const landingBlend = t * t * t * (t * (t * 6 - 15) + 10);
  const fovy = 36.86989764584402 + (BRIDGE_LENS_FOVY - 36.86989764584402) * landingBlend;
  const base = new WebMercatorViewport({...camera, width, height, fovy});
  const baseEye = base.unprojectPosition(base.cameraPosition);
  const deckHeight = bridgeDeckHeight(progress);
  const desiredEyeHeight = deckHeight + BRIDGE_EYE_HEIGHT_METERS;
  const viewState = {
    ...camera,
    longitude: camera.longitude - (baseEye[0] - camera.longitude) * landingBlend,
    latitude: camera.latitude - (baseEye[1] - camera.latitude) * landingBlend,
    position: [0, 0, (desiredEyeHeight - baseEye[2]) * landingBlend],
    // Negative ellipsoid elevations must not collapse MapView's ground-derived far plane.
    nearZ: 0.001,
    // Keep a similar world-distance horizon while zooming. A fixed 1000 at
    // regional zoom requested thousands of distant tiles and starved the bridge.
    farZ: Math.min(1000, Math.max(5, 1000 * 2 ** (camera.zoom - BRIDGE_VIEW.zoom)))
  };
  let actual = new WebMercatorViewport({...viewState, width, height, fovy});
  let eye = actual.unprojectPosition(actual.cameraPosition);
  if (landingBlend === 1) {
    // Latitude-dependent meter scale introduces a tiny residual. Solve it twice.
    for (let i = 0; i < 2; i++) {
      viewState.longitude += camera.longitude - eye[0];
      viewState.latitude += camera.latitude - eye[1];
      viewState.position[2] += desiredEyeHeight - eye[2];
      actual = new WebMercatorViewport({...viewState, width, height, fovy});
      eye = actual.unprojectPosition(actual.cameraPosition);
    }
  }
  const eyeStandoffMeters = Math.hypot(
    (eye[0] - camera.longitude) * 111320 * Math.cos(camera.latitude * Math.PI / 180),
    (eye[1] - camera.latitude) * 110540
  );
  return {viewState, fovy, landingBlend, eyeStandoffMeters, eyeHeightAboveBridgeMeters: eye[2] - deckHeight};
}
