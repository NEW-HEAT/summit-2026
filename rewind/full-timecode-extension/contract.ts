export const FULL_TIMECODE_EXTENSION_CONTRACT = Object.freeze({
  id: "visgl-talk-2026-clip-02-full-timecode-direct-recap",
  fps: 60,
  width: 1920,
  height: 1080,
  devicePixelRatio: 1,
  baseFrameCount: 1_854,
  baseDurationSeconds: 30.9,
  transitionSourceFrameIndex: 1_832,
  baseHeadFrameCount: 1_833,
  replacedBaseTailFrameCount: 21,
  appendedFrameCount: 252,
  appendedDurationSeconds: 4.2,
  recapSegmentFrameCount: 273,
  recapSegmentDurationSeconds: 4.55,
  totalFrameCount: 2_106,
  totalDurationSeconds: 35.1,
  transitionFrameCount: 72,
  finalDateLabel: "JAN 1, 2022–2023",
  finalRecapLabel: "YEAR RECAP",
});

export type ExtensionFrame = {
  frameIndex: number;
  seconds: number;
  transitionProgress: number;
  easedTransitionProgress: number;
};

export function fullTimecodeExtensionFrame(frameIndex: number): ExtensionFrame {
  if (
    !Number.isInteger(frameIndex) ||
    frameIndex < 0 ||
    frameIndex >= FULL_TIMECODE_EXTENSION_CONTRACT.recapSegmentFrameCount
  ) {
    throw new RangeError(
      `Recap segment frame must be an integer from 0 to ${FULL_TIMECODE_EXTENSION_CONTRACT.recapSegmentFrameCount - 1}.`
    );
  }
  const transitionProgress = Math.min(
    1,
    frameIndex /
      Math.max(FULL_TIMECODE_EXTENSION_CONTRACT.transitionFrameCount - 1, 1)
  );
  return {
    frameIndex,
    seconds: frameIndex / FULL_TIMECODE_EXTENSION_CONTRACT.fps,
    transitionProgress,
    easedTransitionProgress: smootherstep(transitionProgress),
  };
}

export function smootherstep(progress: number): number {
  const value = Math.min(1, Math.max(0, progress));
  return value * value * value * (value * (value * 6 - 15) + 10);
}
