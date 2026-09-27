export const LOCKED_VISGL_CUTOFF = '2026-08-31T01:47:35Z';

export function getVisglSnapshotName(cutoff) {
  const timestamp = Date.parse(cutoff);
  if (!Number.isFinite(timestamp) || !cutoff.endsWith('Z')) throw new Error('Use an explicit UTC snapshot cutoff');
  if (timestamp === Date.parse(LOCKED_VISGL_CUTOFF)) return 'visgl-2026-08-31';
  // Different times on the same day must never overwrite or reuse a frozen snapshot.
  return 'visgl-' + new Date(timestamp).toISOString().replaceAll(':', '-');
}
