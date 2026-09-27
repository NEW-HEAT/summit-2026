#!/usr/bin/env tsx
import {spawn} from "node:child_process";
import {once} from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import {VIDEO_FEED_CONTRACT} from "./contract";
import {buildManifest, startVideoFeedServer} from "./server.mts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.join(HERE, "02-around-the-world-video-feed-alpha.mov");

async function main(): Promise<void> {
  const output = resolveOutput(process.argv.slice(2));
  const allowUnapproved = process.argv.includes("--draft");
  const sampleFrameCount = parseSampleFrames(process.argv.slice(2));
  const manifest = await buildManifest();
  if (manifest.media.readyCount !== manifest.media.expectedCount) {
    throw new Error(
      `Media gate failed: ${manifest.media.readyCount}/${manifest.media.expectedCount} source videos are ready in ${manifest.media.cachePath}.`
    );
  }
  const unapproved = manifest.beats.filter((beat) => !beat.trim.approved);
  if (!allowUnapproved && unapproved.length > 0) {
    throw new Error(
      `${unapproved.length} trims are not approved. Approve them in the dev viewer or pass --draft for a review render.`
    );
  }
  try {
    await fs.access(output);
    throw new Error(`Output already exists: ${output}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(output), {recursive: true});
  await prepareRenderMedia(manifest);

  const {server, url} = await startVideoFeedServer({port: 0});
  const browser = await chromium.launch({channel: "chrome", headless: true});
  const page = await browser.newPage({
    viewport: {width: VIDEO_FEED_CONTRACT.width, height: VIDEO_FEED_CONTRACT.height},
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const frameCount = sampleFrameCount ?? VIDEO_FEED_CONTRACT.frameCount;
  const encoder = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-n",
      "-f",
      "image2pipe",
      "-framerate",
      String(VIDEO_FEED_CONTRACT.fps),
      "-i",
      "pipe:0",
      "-frames:v",
      String(frameCount),
      "-an",
      "-c:v",
      "prores_ks",
      "-profile:v",
      "4",
      "-pix_fmt",
      "yuva444p10le",
      "-alpha_bits",
      "16",
      "-threads",
      "4",
      "-vendor",
      "apl0",
      "-movflags",
      "+faststart",
      output,
    ],
    {stdio: ["pipe", "ignore", "pipe"]}
  );
  let encoderError = "";
  encoder.stderr!.on("data", (chunk) => (encoderError += chunk.toString()));
  let encoderFailure: Error | null = null;
  const encoded = new Promise<void>((resolve, reject) => {
    encoder.once("error", reject);
    encoder.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(encoderError || `ffmpeg exited ${code}`))
    );
  });
  void encoded.catch((error) => (encoderFailure = error));

  try {
    const renderUrl = new URL(url);
    renderUrl.search = "?ui=0&autoplay=0&frame=0&prepared=1";
    await page.goto(renderUrl.toString(), {waitUntil: "load"});
    await page.waitForFunction(() => Boolean(window.videoFeed), undefined, {timeout: 15_000});
    for (let frame = 0; frame < frameCount; frame++) {
      if (encoderFailure) throw encoderFailure;
      await page.evaluate((nextFrame) => window.videoFeed.setFrame(nextFrame), frame);
      const png = await page.screenshot({
        type: "png",
        omitBackground: true,
        animations: "disabled",
      });
      if (!encoder.stdin!.write(png)) await once(encoder.stdin!, "drain");
      if (frame === 0 || (frame + 1) % 120 === 0 || frame === frameCount - 1) {
        process.stdout.write(`AROUND_THE_WORLD_RENDER ${frame + 1}/${frameCount}\n`);
      }
    }
    encoder.stdin!.end();
    await encoded;
    if (errors.length > 0) {
      throw new Error(`Browser errors during render:\n${errors.join("\n")}`);
    }
  } catch (error) {
    encoder.stdin!.destroy();
    encoder.kill("SIGTERM");
    await fs.rm(output, {force: true});
    throw error;
  } finally {
    await page.close();
    await browser.close();
    await server.close();
  }
  process.stdout.write(`AROUND_THE_WORLD_MOV ${output}\n`);
}

async function prepareRenderMedia(manifest: Awaited<ReturnType<typeof buildManifest>>): Promise<void> {
  const preparedRoot = path.join(path.dirname(manifest.media.cachePath), "prepared");
  const trimsStat = await fs.stat(
    path.join(path.dirname(manifest.media.cachePath), "trims.json")
  );
  await fs.mkdir(preparedRoot, {recursive: true});
  const desktopFiles = await fs.readdir(manifest.media.watchedPath);
  const filesByName = new Map(
    desktopFiles.map((name) => [name.toLocaleLowerCase(), name])
  );
  const jobs = manifest.beats.map((beat) => async () => {
    const actualName = filesByName.get(beat.source.fileName.toLocaleLowerCase());
    if (!actualName) throw new Error(`Missing render source ${beat.source.fileName}.`);
    const input = path.join(manifest.media.watchedPath, actualName);
    const prepared = path.join(preparedRoot, `${beat.beat}.mp4`);
    const preparedStat = await fs.stat(prepared).catch(() => null);
    if (
      preparedStat &&
      preparedStat.size > 64 * 1_024 &&
      preparedStat.mtimeMs >= trimsStat.mtimeMs
    ) {
      process.stdout.write(`AROUND_THE_WORLD_PREPARED ${beat.beat}/32 cached\n`);
      return;
    }
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", input,
      "-ss", String(beat.trim.trimInSeconds),
      "-t", String(VIDEO_FEED_CONTRACT.feed.trimWindowSeconds),
      "-an",
      "-vf", "scale=1920:1920:force_original_aspect_ratio=decrease,fps=60,format=yuv420p",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "15",
      "-movflags", "+faststart",
      prepared,
    ]);
    process.stdout.write(`AROUND_THE_WORLD_PREPARED ${beat.beat}/32\n`);
  });
  for (let index = 0; index < jobs.length; index += 4) {
    await Promise.all(jobs.slice(index, index + 4).map((job) => job()));
  }
}

async function runProcess(command: string, args: string[]): Promise<void> {
  const child = spawn(command, args, {stdio: ["ignore", "ignore", "pipe"]});
  let errorOutput = "";
  child.stderr!.on("data", (chunk) => (errorOutput += chunk.toString()));
  const [code] = (await once(child, "close")) as [number];
  if (code !== 0) throw new Error(errorOutput || `${command} exited ${code}`);
}

function resolveOutput(argv: string[]): string {
  const index = argv.indexOf("--output");
  if (index === -1) return DEFAULT_OUTPUT;
  const value = argv[index + 1];
  if (!value) throw new Error("--output requires a path.");
  return path.resolve(value);
}

function parseSampleFrames(argv: string[]): number | null {
  const index = argv.indexOf("--sample-frames");
  if (index === -1) return null;
  const value = Number(argv[index + 1]);
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > VIDEO_FEED_CONTRACT.frameCount
  ) {
    throw new Error(
      `--sample-frames must be from 1 through ${VIDEO_FEED_CONTRACT.frameCount}.`
    );
  }
  return value;
}

await main();
