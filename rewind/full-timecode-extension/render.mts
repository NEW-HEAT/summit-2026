#!/usr/bin/env tsx

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import {
  FULL_TIMECODE_EXTENSION_CONTRACT,
  type ExtensionFrame,
} from "./contract";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIP_DIR = path.resolve(HERE, "..");
const BASE_TIMECODE = path.join(
  CLIP_DIR,
  "02-fitness-globe-geographic-memory-timestamps.mov"
);
const BASE_TRANSITION_FRAME = path.join(HERE, "base-transition-frame.png");
const RECAP_SEGMENT_MOV = path.join(
  HERE,
  "02-timecode-direct-year-recap-segment.mov"
);
const OUTPUT_MOV = path.join(
  HERE,
  "02-fitness-globe-full-timecode-direct-year-recap-4p2s.mov"
);
const EVIDENCE_JSON = path.join(HERE, "evidence-direct-recap.json");

type MovProbe = {
  codec: string;
  profile: string;
  tag: string;
  pixelFormat: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
  audioStreams: number;
  sizeBytes: number;
};

async function main(): Promise<void> {
  await assertBaseContract();
  await extractBaseTransitionFrame();
  const server = await startViteServer();
  const browser = await launchBrowser();
  try {
    await renderRecapSegment(server, browser);
  } finally {
    await browser.close();
    await server.close();
  }
  await concatenateTracks();
  await extractEvidenceFrames();

  const [probe, recapSegmentProbe, outputHash, baseHash, recapSegmentHash] =
    await Promise.all([
      probeMov(OUTPUT_MOV),
      probeMov(RECAP_SEGMENT_MOV),
      sha256(OUTPUT_MOV),
      sha256(BASE_TIMECODE),
      sha256(RECAP_SEGMENT_MOV),
    ]);
  assertFullContract(probe);
  assertRecapSegmentContract(recapSegmentProbe);
  const [alphaFirst, alphaLast, seamSimilarity] = await Promise.all([
    probeAlpha(OUTPUT_MOV, 0),
    probeAlpha(
      OUTPUT_MOV,
      FULL_TIMECODE_EXTENSION_CONTRACT.totalFrameCount - 1
    ),
    probeSeamSimilarity(),
  ]);
  if (alphaFirst.maximum < 3760 || alphaLast.maximum < 3760) {
    throw new Error("The full timecode does not retain visible alpha content.");
  }
  if (seamSimilarity.ssim < 0.99) {
    throw new Error(
      `The direct-recap seam is visibly discontinuous: SSIM ${seamSimilarity.ssim}.`
    );
  }

  const evidence = {
    status: "PASS",
    generatedAt: new Date().toISOString(),
    contract: FULL_TIMECODE_EXTENSION_CONTRACT,
    source: {
      path: BASE_TIMECODE,
      sha256: baseHash,
    },
    edit: {
      removedTerminalCard: "JAN 01 2023 / EARTH",
      transitionSourceFrameIndex:
        FULL_TIMECODE_EXTENSION_CONTRACT.transitionSourceFrameIndex,
      baseHeadFrameCount: FULL_TIMECODE_EXTENSION_CONTRACT.baseHeadFrameCount,
      replacedBaseTailFrameCount:
        FULL_TIMECODE_EXTENSION_CONTRACT.replacedBaseTailFrameCount,
      appendedFrameCount: FULL_TIMECODE_EXTENSION_CONTRACT.appendedFrameCount,
      appendedDurationSeconds:
        FULL_TIMECODE_EXTENSION_CONTRACT.appendedDurationSeconds,
    },
    recapSegment: {
      path: RECAP_SEGMENT_MOV,
      sha256: recapSegmentHash,
      probe: recapSegmentProbe,
    },
    output: {
      path: OUTPUT_MOV,
      sha256: outputHash,
      probe,
    },
    alpha: { first: alphaFirst, last: alphaLast },
    seamSimilarity,
    sourceProtection: {
      globeMovsRead: false,
      globeMovsModified: false,
      baseTimecodeModified: false,
    },
  };
  await fs.writeFile(EVIDENCE_JSON, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`FULL_TIMECODE_COMPLETE ${JSON.stringify(evidence)}\n`);
}

async function assertBaseContract(): Promise<void> {
  const probe = await probeMov(BASE_TIMECODE);
  const failures: string[] = [];
  if (probe.codec !== "prores") failures.push(`codec=${probe.codec}`);
  if (probe.profile !== "4444") failures.push(`profile=${probe.profile}`);
  if (probe.width !== FULL_TIMECODE_EXTENSION_CONTRACT.width) {
    failures.push(`width=${probe.width}`);
  }
  if (probe.height !== FULL_TIMECODE_EXTENSION_CONTRACT.height) {
    failures.push(`height=${probe.height}`);
  }
  if (probe.fps !== FULL_TIMECODE_EXTENSION_CONTRACT.fps) {
    failures.push(`fps=${probe.fps}`);
  }
  if (probe.frames !== FULL_TIMECODE_EXTENSION_CONTRACT.baseFrameCount) {
    failures.push(`frames=${probe.frames}`);
  }
  if (
    Math.abs(
      probe.durationSeconds -
        FULL_TIMECODE_EXTENSION_CONTRACT.baseDurationSeconds
    ) > 0.001
  ) {
    failures.push(`duration=${probe.durationSeconds}`);
  }
  if (failures.length > 0) {
    throw new Error(`Base timecode contract failed: ${failures.join(", ")}`);
  }
}

async function extractBaseTransitionFrame(): Promise<void> {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    BASE_TIMECODE,
    "-vf",
    `select=eq(n\\,${FULL_TIMECODE_EXTENSION_CONTRACT.transitionSourceFrameIndex})`,
    "-frames:v",
    "1",
    BASE_TRANSITION_FRAME,
  ]);
}

async function renderRecapSegment(
  server: ViteDevServer,
  browser: Awaited<ReturnType<typeof launchBrowser>>
): Promise<void> {
  const page = await browser.newPage({
    viewport: {
      width: FULL_TIMECODE_EXTENSION_CONTRACT.width,
      height: FULL_TIMECODE_EXTENSION_CONTRACT.height,
    },
    deviceScaleFactor: FULL_TIMECODE_EXTENSION_CONTRACT.devicePixelRatio,
    reducedMotion: "reduce",
  });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sceneUrl(server), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.evaluate(
    () =>
      (
        window as unknown as {
          __FULL_TIMECODE_EXTENSION__: { ready: Promise<void> };
        }
      ).__FULL_TIMECODE_EXTENSION__.ready
  );
  if (errors.length > 0)
    throw new Error(`Recap scene errors: ${errors.join(" | ")}`);

  const encoder = spawnAlphaEncoder(RECAP_SEGMENT_MOV);
  try {
    for (
      let frameIndex = 0;
      frameIndex < FULL_TIMECODE_EXTENSION_CONTRACT.recapSegmentFrameCount;
      frameIndex += 1
    ) {
      const frame = await page.evaluate(
        (index) =>
          (
            window as unknown as {
              __FULL_TIMECODE_EXTENSION__: {
                setFrame(frameIndex: number): Promise<ExtensionFrame>;
              };
            }
          ).__FULL_TIMECODE_EXTENSION__.setFrame(index),
        frameIndex
      );
      if (frameIndex === 0 && frame.easedTransitionProgress !== 0) {
        throw new Error(
          "Recap frame 0 must exactly preserve the Durham handoff."
        );
      }
      const png = await page.screenshot({
        type: "png",
        animations: "disabled",
        omitBackground: true,
      });
      if (!encoder.child.stdin.write(png)) {
        await new Promise<void>((resolve) =>
          encoder.child.stdin.once("drain", resolve)
        );
      }
      if (
        frameIndex === 0 ||
        (frameIndex + 1) % 30 === 0 ||
        frameIndex ===
          FULL_TIMECODE_EXTENSION_CONTRACT.recapSegmentFrameCount - 1
      ) {
        process.stdout.write(
          `FULL_TIMECODE_RECAP_PROGRESS ${frameIndex + 1}/${FULL_TIMECODE_EXTENSION_CONTRACT.recapSegmentFrameCount}\n`
        );
      }
    }
    encoder.child.stdin.end();
    await encoder.done;
  } finally {
    await page.close();
  }
}

function spawnAlphaEncoder(outputPath: string) {
  const child = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "image2pipe",
      "-framerate",
      String(FULL_TIMECODE_EXTENSION_CONTRACT.fps),
      "-i",
      "pipe:0",
      "-frames:v",
      String(FULL_TIMECODE_EXTENSION_CONTRACT.recapSegmentFrameCount),
      "-an",
      "-c:v",
      "prores_ks",
      "-profile:v",
      "4",
      "-pix_fmt",
      "yuva444p10le",
      "-alpha_bits",
      "16",
      "-vendor",
      "apl0",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { cwd: HERE, stdio: ["pipe", "ignore", "pipe"] }
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`Recap encoder exited ${code}: ${stderr.slice(-4000)}`)
        );
    });
  });
  return { child, done };
}

async function concatenateTracks(): Promise<void> {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    BASE_TIMECODE,
    "-i",
    RECAP_SEGMENT_MOV,
    "-filter_complex",
    `[0:v]trim=start_frame=0:end_frame=${FULL_TIMECODE_EXTENSION_CONTRACT.baseHeadFrameCount},setpts=PTS-STARTPTS[base];[1:v]setpts=PTS-STARTPTS[recap];[base][recap]concat=n=2:v=1:a=0,format=yuva444p10le[video]`,
    "-map",
    "[video]",
    "-frames:v",
    String(FULL_TIMECODE_EXTENSION_CONTRACT.totalFrameCount),
    "-an",
    "-c:v",
    "prores_aw",
    "-pix_fmt",
    "yuva444p10le",
    "-vendor",
    "apl0",
    "-movflags",
    "+faststart",
    OUTPUT_MOV,
  ]);
}

async function extractEvidenceFrames(): Promise<void> {
  const seamFrame = FULL_TIMECODE_EXTENSION_CONTRACT.baseHeadFrameCount;
  const contactFrames = [
    seamFrame - 1,
    seamFrame,
    seamFrame + 36,
    seamFrame + 71,
    FULL_TIMECODE_EXTENSION_CONTRACT.totalFrameCount - 1,
  ];
  await Promise.all([
    extractFrame(OUTPUT_MOV, seamFrame - 1, "direct-recap-seam-before.png"),
    extractFrame(OUTPUT_MOV, seamFrame, "direct-recap-seam-after.png"),
    extractFrame(
      OUTPUT_MOV,
      FULL_TIMECODE_EXTENSION_CONTRACT.totalFrameCount - 1,
      "direct-recap-final-frame.png"
    ),
    runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      OUTPUT_MOV,
      "-vf",
      `select=${contactFrames.map((frame) => `eq(n\\,${frame})`).join("+")},scale=640:360,tile=5x1:padding=2:margin=0:color=black`,
      "-frames:v",
      "1",
      path.join(HERE, "direct-recap-contact-sheet.png"),
    ]),
  ]);
}

async function extractFrame(
  input: string,
  frameIndex: number,
  outputName: string
): Promise<void> {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-vf",
    `select=eq(n\\,${frameIndex})`,
    "-frames:v",
    "1",
    path.join(HERE, outputName),
  ]);
}

async function probeSeamSimilarity(): Promise<{ ssim: number }> {
  const { stdout, stderr } = await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "info",
      "-i",
      path.join(HERE, "direct-recap-seam-before.png"),
      "-i",
      path.join(HERE, "direct-recap-seam-after.png"),
      "-lavfi",
      "ssim",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 4 * 1024 * 1024 }
  );
  const match = `${stdout}\n${stderr}`.match(/All:([0-9.]+)/u);
  if (!match) throw new Error("The seam SSIM probe returned no score.");
  return { ssim: Number(match[1]) };
}

async function probeAlpha(filePath: string, frameIndex: number) {
  const { stdout, stderr } = await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      filePath,
      "-vf",
      `select=eq(n\\,${frameIndex}),alphaextract,signalstats,metadata=print:file=-`,
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 4 * 1024 * 1024 }
  );
  const output = `${stdout}\n${stderr}`;
  const metric = (name: "YMIN" | "YMAX" | "YAVG") => {
    const match = output.match(
      new RegExp(`lavfi\\.signalstats\\.${name}=([0-9.]+)`, "u")
    );
    if (!match) throw new Error(`Alpha probe did not report ${name}.`);
    return Number(match[1]);
  };
  return {
    minimum: metric("YMIN"),
    maximum: metric("YMAX"),
    average: metric("YAVG"),
  };
}

async function probeMov(filePath: string): Promise<MovProbe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-count_frames",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams: Array<Record<string, string>>;
    format: Record<string, string>;
  };
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error(`No video stream in ${filePath}.`);
  const [numerator, denominator] = String(video.avg_frame_rate)
    .split("/")
    .map(Number);
  return {
    codec: String(video.codec_name),
    profile: String(video.profile),
    tag: String(video.codec_tag_string),
    pixelFormat: String(video.pix_fmt),
    width: Number(video.width),
    height: Number(video.height),
    fps: numerator / denominator,
    frames: Number(video.nb_read_frames),
    durationSeconds: Number(parsed.format.duration),
    audioStreams: parsed.streams.filter(
      (stream) => stream.codec_type === "audio"
    ).length,
    sizeBytes: Number(parsed.format.size),
  };
}

function assertFullContract(probe: MovProbe): void {
  assertMovContract(
    probe,
    FULL_TIMECODE_EXTENSION_CONTRACT.totalFrameCount,
    FULL_TIMECODE_EXTENSION_CONTRACT.totalDurationSeconds,
    "full"
  );
}

function assertRecapSegmentContract(probe: MovProbe): void {
  assertMovContract(
    probe,
    FULL_TIMECODE_EXTENSION_CONTRACT.recapSegmentFrameCount,
    FULL_TIMECODE_EXTENSION_CONTRACT.recapSegmentDurationSeconds,
    "recap segment"
  );
}

function assertMovContract(
  probe: MovProbe,
  frames: number,
  durationSeconds: number,
  label: string
): void {
  const failures: string[] = [];
  if (probe.codec !== "prores") failures.push(`codec=${probe.codec}`);
  if (probe.profile !== "4444") failures.push(`profile=${probe.profile}`);
  if (probe.tag !== "ap4h") failures.push(`tag=${probe.tag}`);
  if (!/^yuva444p(?:10|12)le$/u.test(probe.pixelFormat)) {
    failures.push(`pix_fmt=${probe.pixelFormat}`);
  }
  if (
    probe.width !== FULL_TIMECODE_EXTENSION_CONTRACT.width ||
    probe.height !== FULL_TIMECODE_EXTENSION_CONTRACT.height
  ) {
    failures.push(`dimensions=${probe.width}x${probe.height}`);
  }
  if (probe.fps !== FULL_TIMECODE_EXTENSION_CONTRACT.fps) {
    failures.push(`fps=${probe.fps}`);
  }
  if (probe.frames !== frames) failures.push(`frames=${probe.frames}`);
  if (Math.abs(probe.durationSeconds - durationSeconds) > 0.001) {
    failures.push(`duration=${probe.durationSeconds}`);
  }
  if (probe.audioStreams !== 0) failures.push(`audio=${probe.audioStreams}`);
  if (failures.length > 0) {
    throw new Error(`${label} MOV contract failed: ${failures.join(", ")}`);
  }
}

async function startViteServer(): Promise<ViteDevServer> {
  const port = await reserveLoopbackPort();
  const server = await createServer({
    root: HERE,
    configFile: false,
    publicDir: false,
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
  });
  await server.listen();
  return server;
}

async function launchBrowser() {
  const args = ["--hide-scrollbars"];
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args });
  } catch {
    return chromium.launch({ headless: true, args });
  }
}

function sceneUrl(server: ViteDevServer): string {
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) throw new Error("The Vite server URL is unavailable.");
  return `${baseUrl}scene.html`;
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve a loopback port.");
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

async function runCommand(command: string, args: string[]): Promise<void> {
  const { stderr } = await execFileAsync(command, args, {
    maxBuffer: 16 * 1024 * 1024,
  });
  if (stderr.trim()) process.stderr.write(stderr);
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

await main();
