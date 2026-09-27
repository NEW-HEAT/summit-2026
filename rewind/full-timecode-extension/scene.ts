import {
  FULL_TIMECODE_EXTENSION_CONTRACT,
  fullTimecodeExtensionFrame,
  type ExtensionFrame,
} from "./contract";

type ExtensionApi = {
  ready: Promise<void>;
  setFrame(frameIndex: number): Promise<ExtensionFrame>;
  getFrame(): ExtensionFrame;
};

declare global {
  interface Window {
    __FULL_TIMECODE_EXTENSION__: ExtensionApi;
  }
}

const canvas = required<HTMLCanvasElement>("#timecode-canvas");
const context = canvas.getContext("2d", { alpha: true });
if (!context) throw new Error("An alpha-aware Canvas2D context is required.");

const baseTransitionFrame = new Image();
baseTransitionFrame.decoding = "sync";
let currentFrame = fullTimecodeExtensionFrame(0);
const ready = loadImage(
  baseTransitionFrame,
  "./base-transition-frame.png"
).then(() => {
  drawFrame(currentFrame);
});

window.__FULL_TIMECODE_EXTENSION__ = {
  ready,
  setFrame: async (frameIndex) => {
    await ready;
    currentFrame = fullTimecodeExtensionFrame(frameIndex);
    drawFrame(currentFrame);
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve())
    );
    return currentFrame;
  },
  getFrame: () => currentFrame,
};

function drawFrame(frame: ExtensionFrame): void {
  const { width, height, finalDateLabel, finalRecapLabel } =
    FULL_TIMECODE_EXTENSION_CONTRACT;
  const progress = frame.easedTransitionProgress;
  context.clearRect(0, 0, width, height);

  drawReelRow({
    centerY: height / 2 - 46,
    clipHeight: 104,
    travel: 116,
    progress,
    drawIncoming: () => {
      context.font =
        '600 60px "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
      context.textAlign = "center";
      context.fillText(finalDateLabel, width / 2, height / 2 - 46);
    },
  });
  drawReelRow({
    centerY: height / 2 + 48,
    clipHeight: 76,
    travel: 88,
    progress,
    drawIncoming: () => {
      context.font = '650 42px "Helvetica Neue", Helvetica, Arial, sans-serif';
      drawCenteredTrackedText(finalRecapLabel, width / 2, height / 2 + 48, 2.8);
    },
  });
}

function drawReelRow({
  centerY,
  clipHeight,
  travel,
  progress,
  drawIncoming,
}: {
  centerY: number;
  clipHeight: number;
  travel: number;
  progress: number;
  drawIncoming: () => void;
}): void {
  const { width, height } = FULL_TIMECODE_EXTENSION_CONTRACT;
  context.save();
  context.beginPath();
  context.rect(0, centerY - clipHeight / 2, width, clipHeight);
  context.clip();
  if (progress < 1) {
    context.save();
    context.globalAlpha = 1 - smootherstepRange(progress, 0.08, 0.82);
    context.translate(0, -travel * progress);
    context.drawImage(baseTransitionFrame, 0, 0, width, height);
    context.restore();
  }
  if (progress > 0) {
    const incomingProgress = smootherstepRange(progress, 0.18, 1);
    context.save();
    context.globalAlpha = incomingProgress;
    context.translate(0, travel * (1 - progress));
    context.fillStyle = "#ffffff";
    context.textBaseline = "middle";
    context.shadowColor = "rgba(0, 0, 0, 0.82)";
    context.shadowBlur = 16;
    context.shadowOffsetY = 2;
    drawIncoming();
    context.restore();
  }
  context.restore();
}

function drawCenteredTrackedText(
  value: string,
  centerX: number,
  y: number,
  tracking: number
): void {
  context.save();
  context.textAlign = "left";
  let cursor = centerX - trackedTextWidth(value, tracking) / 2;
  for (const character of value) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + tracking;
  }
  context.restore();
}

function trackedTextWidth(value: string, tracking: number): number {
  return Array.from(value).reduce(
    (width, character, index) =>
      width +
      context.measureText(character).width +
      (index === value.length - 1 ? 0 : tracking),
    0
  );
}

function smootherstepRange(value: number, start: number, end: number): number {
  const progress = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return progress * progress * progress * (progress * (progress * 6 - 15) + 10);
}

function loadImage(image: HTMLImageElement, source: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Could not load ${source}.`));
    image.src = source;
  });
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
