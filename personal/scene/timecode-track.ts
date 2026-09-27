import {
  BufferTarget,
  CanvasSource,
  Output,
  WebMOutputFormat,
} from "mediabunny";
import {
  DURATION_SECONDS,
  FPS,
  FRAME_COUNT,
  HEIGHT,
  WIDTH,
  buildTrainFrameState,
  formatTimecodeDate,
  type ContinuousCalendar,
  type TrainFrameState,
} from "./calendar-model";

const TIMECODE_BITRATE = 8_000_000;

export const TIMECODE_EXCLUSION_BOUNDS = {
  x: 520,
  y: 450,
  width: 880,
  height: 180,
} as const;

export async function encodeTimecodeTrack(
  calendar: ContinuousCalendar,
  buildFrameState: (frameIndex: number, calendar: ContinuousCalendar) => TrainFrameState = buildTrainFrameState,
  timing: { frameCount: number; durationSeconds: number } = {
    frameCount: FRAME_COUNT,
    durationSeconds: DURATION_SECONDS,
  },
) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D alpha is required for the timecode track.");

  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const source = new CanvasSource(canvas, {
    codec: "vp9",
    bitrate: TIMECODE_BITRATE,
    alpha: "keep",
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: timing.frameCount + 2 });
  await output.start();

  let firstState = buildFrameState(0, calendar);
  let lastState = firstState;
  for (let frameIndex = 0; frameIndex < timing.frameCount; frameIndex += 1) {
    const state = buildFrameState(frameIndex, calendar);
    if (frameIndex === 0) firstState = state;
    lastState = state;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    drawTimecode(context, state);
    await source.add(frameIndex / FPS, 1 / FPS, {
      keyFrame: frameIndex === 0 || frameIndex % (FPS * 2) === 0,
    });
    if (frameIndex % 240 === 0 || frameIndex === timing.frameCount - 1) {
      console.log(`CONTRIBUTION_TIMECODE_RENDER_PROGRESS ${frameIndex + 1}/${timing.frameCount}`);
    }
  }

  await source.close();
  await output.finalize();
  if (!target.buffer) throw new Error("The encoded timecode WebM buffer is empty.");
  const filename = "personal-github-contribution-timecode.webm";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([target.buffer], { type: "video/webm" }));
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  return {
    frameCount: timing.frameCount,
    frameRate: FPS,
    durationSeconds: timing.durationSeconds,
    filename,
    firstState,
    lastState,
  };
}

export function drawTimecode(context: CanvasRenderingContext2D, state: TrainFrameState) {
  const value = formatTimecodeDate(state.currentDate);
  context.save();
  context.translate(WIDTH / 2, HEIGHT / 2);
  context.fillStyle = "#ffffff";
  context.shadowColor = "rgba(0,0,0,0.82)";
  context.shadowBlur = 18;
  context.shadowOffsetY = 3;
  context.textBaseline = "middle";
  context.font = '700 64px "Helvetica Neue", Helvetica, Arial, sans-serif';
  drawCenteredTrackedText(context, value, 5.5);
  context.restore();
}

function drawCenteredTrackedText(
  context: CanvasRenderingContext2D,
  value: string,
  tracking: number
) {
  let width = 0;
  for (const character of value) width += context.measureText(character).width;
  width += Math.max(0, value.length - 1) * tracking;
  let cursor = -width / 2;
  for (const character of value) {
    context.fillText(character, cursor, 0);
    cursor += context.measureText(character).width + tracking;
  }
}
