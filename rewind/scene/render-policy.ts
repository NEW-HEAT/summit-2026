export const TILE_STABILITY_SAMPLE_COUNT = 3;
export const TILE_SETTLED_REDRAW_COUNT = 3;
export const TILE_LOAD_TIMEOUT_MS = 300_000;
export const EXPORT_PROGRESS_INTERVAL_FRAMES = 30;
const EXPORT_DOWNLOAD_BASE_TIMEOUT_MS = 600_000;
const EXPORT_DOWNLOAD_TIMEOUT_PER_FRAME_MS = 7_200;

export type TileReadinessSnapshot = {
  isLoaded: boolean;
  viewportTileCount: number;
};

export function isTileSnapshotReady(snapshot: TileReadinessSnapshot): boolean {
  return snapshot.isLoaded && snapshot.viewportTileCount > 0;
}

export function advanceTileStabilitySample(
  stableSamples: number,
  snapshot: TileReadinessSnapshot
): number {
  return isTileSnapshotReady(snapshot) ? stableSamples + 1 : 0;
}

export function exportDownloadTimeoutMs(frameCount: number): number {
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new RangeError("Export frame count must be a positive integer.");
  }
  return (
    EXPORT_DOWNLOAD_BASE_TIMEOUT_MS +
    frameCount * EXPORT_DOWNLOAD_TIMEOUT_PER_FRAME_MS
  );
}

export function proResEncoderForPlatform(platform: string): {
  codec: "prores_videotoolbox" | "prores_ks";
  extraArgs: string[];
} {
  return platform === "darwin"
    ? { codec: "prores_videotoolbox", extraArgs: ["-prio_speed", "1"] }
    : { codec: "prores_ks", extraArgs: [] };
}

export const TIMESTAMP_PRORES_PROFILE = Object.freeze({
  codec: "prores_aw" as const,
  pixelFormat: "yuva444p10le" as const,
  vendor: "apl0" as const,
  codecTag: "ap4h" as const,
});
