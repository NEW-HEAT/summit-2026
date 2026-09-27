#!/usr/bin/env tsx
import {fileURLToPath as archiveFileURLToPath} from 'node:url';

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import {
  FPS,
  HEIGHT,
  WIDTH,
  buildContinuousCalendar,
  type ContributionSnapshot,
} from "./scene/calendar-model";
import { buildPersonalLaneBreakdown, renderPersonalLaneBreakdownMarkdown } from "./scene/misc-breakdown";
import { VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT, buildVerticalCalendarLayout } from "./scene/vertical-calendar-model";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(archiveFileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const FRAME_COUNT = VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount;
const INTRO_FRAMES = VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.introSeconds * FPS;
const EMPTY_PRE_ROLL_FRAMES = VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds * FPS;
const TRAVERSAL_FRAMES = VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.traversalSeconds * FPS;
const TRAVERSAL_START_FRAME = EMPTY_PRE_ROLL_FRAMES;
const COMMUNITY_RENDERER = path.resolve(HERE, "../community/render-synchronized-alpha-tracks.mjs");

type Options = {
  source: string;
  output: string;
  timecodeOutput: string;
  legendOutput: string;
  contributorHandoffOutput: string;
  onlyTrack: "all" | "timecode" | "legend" | "verify";
  smokeFrames: number | null;
  headed: boolean;
};

type MediaProbe = {
  codec: string;
  profile: string;
  codecTag: string;
  width: number;
  height: number;
  pixelFormat: string;
  colorRange?: string;
  colorSpace?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  frameRate: number;
  frameCount: number;
  durationSeconds: number;
  sizeBytes: number;
  audioStreamCount: number;
};

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  let headed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--headed") {
      headed = true;
      continue;
    }
    const value = argv[index + 1];
    if (!argument.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Invalid argument: ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }
  const source = values.get("--source");
  const output = values.get("--output");
  const timecodeOutput = values.get("--timecode-output");
  const legendOutput = values.get("--legend-output");
  if (!source || !output || !timecodeOutput || !legendOutput) {
    throw new Error(
      "Usage: render-vertical.mts --source <snapshot.json> --output <background.mov> " +
      "--timecode-output <timecode.mov> --legend-output <legend.mov> " +
      "[--contributor-handoff-output <frame.png>] " +
      "[--only-track all|timecode|legend|verify] [--smoke-frames N] [--headed]",
    );
  }
  const smokeFrames = values.has("--smoke-frames") ? Number(values.get("--smoke-frames")) : null;
  if (smokeFrames != null && (!Number.isInteger(smokeFrames) || smokeFrames <= 0)) {
    throw new Error("--smoke-frames must be a positive integer.");
  }
  if (path.extname(output).toLowerCase() !== ".mov") throw new Error("Background output must be .mov.");
  if (path.extname(timecodeOutput).toLowerCase() !== ".mov") throw new Error("Timecode output must be .mov.");
  if (path.extname(legendOutput).toLowerCase() !== ".mov") throw new Error("Legend output must be .mov.");
  const contributorHandoffOutput = path.resolve(
    values.get("--contributor-handoff-output")
      ?? path.join(path.dirname(path.resolve(output)), "personal-github-contribution-to-visgl-contributor-handoff.png"),
  );
  if (path.extname(contributorHandoffOutput).toLowerCase() !== ".png") {
    throw new Error("Contributor handoff output must be .png.");
  }
  const onlyTrack = values.get("--only-track") ?? "all";
  if (!(["all", "timecode", "legend", "verify"] as const).includes(onlyTrack as Options["onlyTrack"])) {
    throw new Error("--only-track must be all, timecode, legend, or verify.");
  }
  if (smokeFrames != null && onlyTrack !== "all") {
    throw new Error("--smoke-frames can only be used with --only-track all.");
  }
  return {
    source: path.resolve(source),
    output: path.resolve(output),
    timecodeOutput: path.resolve(timecodeOutput),
    legendOutput: path.resolve(legendOutput),
    contributorHandoffOutput,
    onlyTrack: onlyTrack as Options["onlyTrack"],
    smokeFrames,
    headed,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const outputDir = path.dirname(options.output);
  await Promise.all([
    fs.mkdir(outputDir, { recursive: true }),
    fs.mkdir(path.dirname(options.timecodeOutput), { recursive: true }),
    fs.mkdir(path.dirname(options.legendOutput), { recursive: true }),
    fs.mkdir(path.dirname(options.contributorHandoffOutput), { recursive: true }),
  ]);
  const snapshot = JSON.parse(await fs.readFile(options.source, "utf8")) as ContributionSnapshot;
  const calendar = buildContinuousCalendar(snapshot);
  const layout = buildVerticalCalendarLayout(calendar);
  const frameCount = options.smokeFrames ?? FRAME_COUNT;
  const outputPath = options.smokeFrames
    ? path.join(outputDir, `personal-github-contribution-vertical-deckgl-alpha-smoke-${frameCount}f.mov`)
    : options.output;
  const browserIntermediate = path.join(outputDir, `browser-encoded-${frameCount}f.webm`);
  const timecodeIntermediate = `${options.timecodeOutput}.webm`;
  const legendIntermediate = `${options.legendOutput}.webm`;

  const server = await createServer({
    root: HERE,
    configFile: false,
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      fs: { allow: [REPO_ROOT, path.dirname(options.source)] },
    },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) throw new Error("Vite did not expose a local render URL.");
  const renderUrl = `${baseUrl}scene/vertical-index.html?${new URLSearchParams({
    source: `/@fs${options.source}`,
    timingPreset: "visgl-contributor-handoff",
  })}`;
  const browser = await chromium.launch({
    headless: !options.headed,
    args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      acceptDownloads: true,
    });
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (text.startsWith("CONTRIBUTION_")) process.stdout.write(`${text}\n`);
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
      process.stderr.write(`PAGE_ERROR ${error.message}\n`);
    });
    await page.goto(renderUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => window.__CONTRIBUTION_VERTICAL_CALENDAR__.ready);

    const diagnostics = await page.evaluate(() => window.__CONTRIBUTION_VERTICAL_CALENDAR__.getDiagnostics());
    let renderResult: unknown = { mode: "verify-existing" };
    let timecodeRenderResult: unknown = { mode: "verify-existing" };
    let legendRenderResult: unknown = { mode: "verify-existing" };
    let proofResult: Awaited<ReturnType<typeof captureProofFrames>> | null = null;

    if (options.onlyTrack === "all") {
      const downloadPromise = page.waitForEvent("download", { timeout: 0 });
      const renderPromise = page.evaluate(
        (requestedFrameCount) => window.__CONTRIBUTION_VERTICAL_CALENDAR__.renderWebm({ frameCount: requestedFrameCount }),
        frameCount,
      );
      const [download, completedRender] = await Promise.all([downloadPromise, renderPromise]);
      renderResult = completedRender;
      await download.saveAs(browserIntermediate);
      await normalizeAlphaMov(browserIntermediate, outputPath, frameCount);
      const proof = await captureProofFrames(
        page,
        outputDir,
        calendar.dataDays.length,
        layout.monthBoundaries[1]?.firstDayOrdinal ?? 31,
      );
      proofResult = proof;

      if (options.smokeFrames) {
        const probe = await ffprobe(outputPath);
        const evidence = {
          status: "UNVERIFIED",
          lane: "smoke-only local deck.gl render",
          generatedAt: new Date().toISOString(),
          artifact: outputPath,
          renderResult,
          probe,
          diagnostics,
          proof,
          pageErrors,
        };
        await fs.writeFile(
          path.join(outputDir, `smoke-evidence-${frameCount}f.json`),
          `${JSON.stringify(evidence, null, 2)}\n`,
        );
        process.stdout.write(`CONTRIBUTION_VERTICAL_SMOKE_COMPLETE UNVERIFIED ${outputPath}\n`);
        return;
      }
    } else if (options.onlyTrack === "verify") {
      proofResult = await captureProofFrames(
        page,
        outputDir,
        calendar.dataDays.length,
        layout.monthBoundaries[1]?.firstDayOrdinal ?? 31,
      );
    } else {
      proofResult = await captureProofFrames(
        page,
        outputDir,
        calendar.dataDays.length,
        layout.monthBoundaries[1]?.firstDayOrdinal ?? 31,
      );
    }

    if (!proofResult) throw new Error("Contribution proof frames were not captured.");
    const proof = proofResult;

    if (options.onlyTrack === "all" || options.onlyTrack === "timecode") {
      const timecodeDownloadPromise = page.waitForEvent("download", { timeout: 0 });
      const timecodeRenderPromise = page.evaluate(() => window.__CONTRIBUTION_VERTICAL_CALENDAR__.renderTimecodeWebm());
      const [timecodeDownload, completedTimecodeRender] = await Promise.all([
        timecodeDownloadPromise,
        timecodeRenderPromise,
      ]);
      timecodeRenderResult = completedTimecodeRender;
      await timecodeDownload.saveAs(timecodeIntermediate);
      await normalizeAlphaMov(timecodeIntermediate, options.timecodeOutput);
      await fs.rm(timecodeIntermediate, { force: true });
      if (options.onlyTrack === "timecode") {
        process.stdout.write(`CONTRIBUTION_TIMECODE_COMPLETE PASS ${options.timecodeOutput}\n`);
        return;
      }
    }

    if (options.onlyTrack === "all" || options.onlyTrack === "legend") {
      const legendDownloadPromise = page.waitForEvent("download", { timeout: 0 });
      const legendRenderPromise = page.evaluate(() => window.__CONTRIBUTION_VERTICAL_CALENDAR__.renderLegendWebm());
      const [legendDownload, completedLegendRender] = await Promise.all([
        legendDownloadPromise,
        legendRenderPromise,
      ]);
      legendRenderResult = completedLegendRender;
      await legendDownload.saveAs(legendIntermediate);
      await normalizeAlphaMov(legendIntermediate, options.legendOutput);
      await fs.rm(legendIntermediate, { force: true });
      if (options.onlyTrack === "legend") {
        process.stdout.write(`CONTRIBUTION_LEGEND_COMPLETE PASS ${options.legendOutput}\n`);
        return;
      }
    }

    if (options.onlyTrack === "all") {
      await fs.rm(browserIntermediate, { force: true });
    }

    await buildContributorHandoffFrame(options.output, options.contributorHandoffOutput);
    const [handoffContract, handoffFrameProbe] = await Promise.all([
      readCommunityHandoffContract(),
      probeStillFrame(options.contributorHandoffOutput),
    ]);

    const [
      backgroundProbe,
      timecodeProbe,
      legendProbe,
      backgroundAlpha,
      backgroundIntroStartAlpha,
      backgroundIntroMidAlpha,
      timecodeAlpha,
      legendAlpha,
    ] = await Promise.all([
      ffprobe(options.output),
      ffprobe(options.timecodeOutput),
      ffprobe(options.legendOutput),
      alphaProbe(options.output),
      alphaProbe(options.output, 0),
      alphaProbe(options.output, Math.floor(INTRO_FRAMES / 2)),
      alphaProbe(options.timecodeOutput),
      alphaProbe(options.legendOutput),
    ]);
    const decodeResults = await Promise.all([
      fullDecode(options.output),
      fullDecode(options.timecodeOutput),
      fullDecode(options.legendOutput),
    ]);
    const git = await getGitState();
    const backgroundPass = validAlphaMov(backgroundProbe, backgroundAlpha);
    const introAlphaPass = backgroundIntroStartAlpha.maximum <= 300
      && backgroundIntroMidAlpha.maximum > backgroundIntroStartAlpha.maximum + 256
      && backgroundAlpha.maximum > backgroundIntroMidAlpha.maximum + 256;
    const timecodePass = validAlphaMov(timecodeProbe, timecodeAlpha);
    const legendPass = validAlphaMov(legendProbe, legendAlpha);
    const hardwareGpu = diagnostics.webgl && typeof diagnostics.renderer === "string"
      && !/swiftshader|software/iu.test(diagnostics.renderer);
    const statePass = proof.sampleStates.every((sample, index) =>
      index === 0 || sample.currentDate >= proof.sampleStates[index - 1].currentDate)
      && proof.sampleStates.every((sample, index) => index === 0 || sample.cameraY >= proof.sampleStates[index - 1].cameraY)
      && proof.sampleStates.every((sample) => sample.partialRevealCount <= 1);
    const emptyPreRollPass = proof.fadeStates[0].isPreRoll
      && proof.fadeStates[1].isPreRoll
      && proof.fadeStates[0].revealHead === 0
      && proof.fadeStates[1].revealHead === 0
      && proof.fadeStates[2].revealHead === 0
      && proof.fadeStates[1].cameraY > proof.fadeStates[0].cameraY
      && proof.fadeStates[2].cameraY > proof.fadeStates[1].cameraY
      && !proof.fadeStates[2].isPreRoll
      && proof.fadeStates[3].revealHead > 0;
    const movingFadePass = proof.fadeStates.every((sample, index) =>
      index === 0 || sample.cameraY > proof.fadeStates[index - 1].cameraY)
      && proof.fadeStates[0].introProgress === 0
      && proof.fadeStates[1].introProgress > 0
      && proof.fadeStates[3].introProgress === 1;
    const handoffFramePass = handoffFrameProbe.width === WIDTH
      && handoffFrameProbe.height === HEIGHT
      && handoffFrameProbe.pixelFormat === "rgb24"
      && handoffContract.aligned;
    const introMotionContractPass = "introOverlapsCalendarMotion" in diagnostics.contract
      && diagnostics.contract.introOverlapsCalendarMotion;
    const status = backgroundPass
      && introAlphaPass
      && emptyPreRollPass
      && movingFadePass
      && handoffFramePass
      && timecodePass
      && legendPass
      && decodeResults.every((result) => result === "PASS")
      && diagnostics.webgl
      && diagnostics.deckView === "OrbitView"
      && diagnostics.monthCount === layout.monthKeys.length
      && diagnostics.dayCount === calendar.dataDays.length
      && diagnostics.organizationCount === 4
      && diagnostics.calendarContinuityMode === "continuous-week-ribbon"
      && diagnostics.monthDividerMode === "none"
      && diagnostics.calendarScreenDirection === "completed-history-toward-top-horizon"
      && diagnostics.historyVisibilityMode === "perspective-distance-only"
      && statePass
      && pageErrors.length === 0
      ? "PASS"
      : "FAIL";
    const evidence = {
      status,
      generatedAt: new Date().toISOString(),
      artifacts: {
        background: options.output,
        timecode: options.timecodeOutput,
        legend: options.legendOutput,
        contributorHandoffFrame: options.contributorHandoffOutput,
      },
      sourceSnapshot: options.source,
      renderResult,
      timecodeRenderResult,
      legendRenderResult,
      probes: { background: backgroundProbe, timecode: timecodeProbe, legend: legendProbe },
      alpha: {
        background: backgroundAlpha,
        backgroundIntroStart: backgroundIntroStartAlpha,
        backgroundIntroMiddle: backgroundIntroMidAlpha,
        timecode: timecodeAlpha,
        legend: legendAlpha,
      },
      fullDecode: { background: decodeResults[0], timecode: decodeResults[1], legend: decodeResults[2] },
      diagnostics,
      handoff: {
        contract: handoffContract,
        frame: handoffFrameProbe,
      },
      proof,
      pageErrors,
      source: git,
      verificationLanes: {
        localDeckGlOrbitView: diagnostics.webgl && diagnostics.deckView === "OrbitView" ? "PASS" : "FAIL",
        hardwareAcceleratedGpu: hardwareGpu ? "PASS" : "UNVERIFIED",
        sequentialSingleDayReveal: statePass ? "PASS" : "FAIL",
        continuousCalendarRibbon: statePass && diagnostics.calendarContinuityMode === "continuous-week-ribbon" ? "PASS" : "FAIL",
        noMonthDividers: diagnostics.monthDividerMode === "none" ? "PASS" : "FAIL",
        completedHistoryRecedesToTop: diagnostics.calendarScreenDirection === "completed-history-toward-top-horizon" ? "PASS" : "FAIL",
        historyPersistsToProjectionHorizon: diagnostics.historyVisibilityMode === "perspective-distance-only" ? "PASS" : "FAIL",
        horizontalSweepOnlyColorReveal: diagnostics.colorRevealMode === "horizontal-clip-only" ? "PASS" : "FAIL",
        movingCalendarFadeIn: introAlphaPass && movingFadePass
          && introMotionContractPass ? "PASS" : "FAIL",
        emptyMovingCalendarPreRoll: emptyPreRollPass ? "PASS" : "FAIL",
        visglContributorRecapBoundary: handoffFramePass ? "PASS" : "FAIL",
        halfSecondFullTimelineRecap: proof.finalState.overviewSettled
          && diagnostics.contract.overviewHoldSeconds === 0.5 ? "PASS" : "FAIL",
        transparentCommitTrack: backgroundPass ? "PASS" : "FAIL",
        synchronizedBackgroundLegendTimecode: backgroundPass && timecodePass && legendPass ? "PASS" : "FAIL",
        authenticatedOwnerProjectData: snapshot.schemaVersion === 2 && snapshot.provenance.authenticated ? "PASS" : "UNVERIFIED",
        foregroundComposite: "UNVERIFIED (foreground editor source not selected)",
        editorImport: "UNVERIFIED (local export only)",
      },
      note: "The transparent commit-track master begins moving on frame zero while an empty borderless calendar eases in over 1.5 seconds. Its one-second pre-roll advances at the same calendar velocity as roughly three weeks of the ensuing contribution traversal, keeping every contribution tile empty until the 00:46.0 boundary. A full 60-second reveal then runs before a half-second stack transition and half-second recap complete the exact 00:45.0–01:47.0 / 62-second slot used by the vis.gl rebuild generator. The opaque-black handoff PNG is extracted from frame 3719 for the contributor recap generator's decoded-pixel-exact --input-frame boundary. Organization legend and date timecode remain separate synchronized transparent ProRes 4444 MOV files.",
    };
    await fs.writeFile(path.join(outputDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, "EVIDENCE.md"), renderEvidence(evidence));
    const excluded = buildPersonalLaneBreakdown(snapshot);
    const excludedJson = path.join(outputDir, "excluded-contribution-breakdown.json");
    const excludedMarkdown = path.join(outputDir, "EXCLUDED-CONTRIBUTION-BREAKDOWN.md");
    await fs.writeFile(excludedJson, `${JSON.stringify(excluded, null, 2)}\n`, { mode: 0o600 });
    await fs.writeFile(excludedMarkdown, renderPersonalLaneBreakdownMarkdown(excluded), { mode: 0o600 });
    await Promise.all([fs.chmod(excludedJson, 0o600), fs.chmod(excludedMarkdown, 0o600)]);
    process.stdout.write(`CONTRIBUTION_VERTICAL_COMPLETE ${status} ${options.output} ${options.timecodeOutput} ${options.legendOutput}\n`);
    if (status !== "PASS") process.exitCode = 1;
  } finally {
    await browser.close();
    await server.close();
  }
}

async function captureProofFrames(
  page: Page,
  outputDir: string,
  dayCount: number,
  continuityBoundaryOrdinal: number,
) {
  const fadeFrames = [
    0,
    Math.floor(EMPTY_PRE_ROLL_FRAMES / 2),
    EMPTY_PRE_ROLL_FRAMES,
    INTRO_FRAMES,
  ];
  const fadePaths: string[] = [];
  const fadeStates: VerticalStateSample[] = [];
  for (let index = 0; index < fadeFrames.length; index += 1) {
    fadeStates.push(await setFrame(page, fadeFrames[index]));
    const output = path.join(outputDir, `moving-fade-${String(index + 1).padStart(2, "0")}.png`);
    await page.locator("#deck-canvas").screenshot({ path: output });
    fadePaths.push(output);
  }
  await buildContactSheet(fadePaths, path.join(outputDir, "moving-fade-proof.png"), 4);

  const sampleFrames = [0];
  sampleFrames.push(...[0.2, 0.4, 0.6, 0.8].map((progress) => TRAVERSAL_START_FRAME + Math.round(progress * (TRAVERSAL_FRAMES - 1))));
  sampleFrames.push(TRAVERSAL_START_FRAME + TRAVERSAL_FRAMES - 1, FRAME_COUNT - 1);
  const samplePaths: string[] = [];
  const sampleStates: VerticalStateSample[] = [];
  for (let index = 0; index < sampleFrames.length; index += 1) {
    sampleStates.push(await setFrame(page, sampleFrames[index]));
    const output = path.join(outputDir, `vertical-sample-${String(index + 1).padStart(2, "0")}.png`);
    await page.locator("#deck-canvas").screenshot({ path: output });
    samplePaths.push(output);
  }
  await fs.copyFile(samplePaths[0], path.join(outputDir, "first-frame.png"));
  await fs.copyFile(samplePaths.at(-1)!, path.join(outputDir, "last-frame.png"));
  await buildContactSheet(samplePaths, path.join(outputDir, "vertical-contact-sheet.png"), 4);

  const boundaryCenterFrame = TRAVERSAL_START_FRAME + Math.round((continuityBoundaryOrdinal / dayCount) * (TRAVERSAL_FRAMES - 1));
  const continuityFrames = [-20, -12, -6, 0, 6, 12, 20].map((offset) => clampFrame(boundaryCenterFrame + offset));
  const continuityPaths: string[] = [];
  for (let index = 0; index < continuityFrames.length; index += 1) {
    await setFrame(page, continuityFrames[index]);
    const output = path.join(outputDir, `continuity-boundary-${String(index + 1).padStart(2, "0")}.png`);
    await page.locator("#deck-canvas").screenshot({ path: output });
    continuityPaths.push(output);
  }
  await buildContactSheet(continuityPaths, path.join(outputDir, "continuity-boundary-proof.png"), 4);

  const sequentialCenter = TRAVERSAL_START_FRAME + Math.round(0.48 * (TRAVERSAL_FRAMES - 1));
  const sequentialFrames = [-2, -1, 0, 1, 2].map((offset) => clampFrame(sequentialCenter + offset));
  const sequentialPaths: string[] = [];
  for (let index = 0; index < sequentialFrames.length; index += 1) {
    await setFrame(page, sequentialFrames[index]);
    const output = path.join(outputDir, `sequential-day-${String(index + 1).padStart(2, "0")}.png`);
    await page.locator("#deck-canvas").screenshot({ path: output });
    sequentialPaths.push(output);
  }
  await buildContactSheet(sequentialPaths, path.join(outputDir, "sequential-day-proof.png"), 5);

  await page.evaluate((frameIndex) => window.__CONTRIBUTION_VERTICAL_CALENDAR__.setOverlayCompositePreview(frameIndex), TRAVERSAL_START_FRAME + Math.round(0.55 * (TRAVERSAL_FRAMES - 1)));
  await page.screenshot({ path: path.join(outputDir, "legend-timecode-composite-proof.png") });
  const finalState = await setFrame(page, FRAME_COUNT - 1);
  await page.locator("#deck-canvas").screenshot({ path: path.join(outputDir, "overview-proof.png") });
  return { fadeFrames, fadeStates, sampleFrames, sampleStates, continuityFrames, sequentialFrames, finalState };
}

type VerticalStateSample = {
  frameIndex: number;
  currentDate: string;
  currentDayOrdinal: number;
  introProgress: number;
  isPreRoll: boolean;
  preRollProgress: number;
  revealHead: number;
  cameraY: number;
  cameraDayOrdinal: number;
  activeDayOrdinal: number;
  activeDayProgress: number;
  partialRevealCount: number;
  monthKey: string;
  overviewSettled: boolean;
};

async function setFrame(page: Page, frameIndex: number): Promise<VerticalStateSample> {
  return page.evaluate(
    (requestedFrame) => window.__CONTRIBUTION_VERTICAL_CALENDAR__.setFrame(requestedFrame),
    frameIndex,
  );
}

async function normalizeAlphaMov(input: string, output: string, frameCount = FRAME_COUNT) {
  await execFileAsync("ffmpeg", [
    "-y", "-v", "error", "-c:v", "libvpx-vp9", "-i", input,
    "-frames:v", String(frameCount), "-map", "0:v:0", "-an",
    "-c:v", "prores_aw", "-pix_fmt", "yuva444p10le", "-vendor", "apl0",
    "-movflags", "+faststart", output,
  ]);
}

async function buildContributorHandoffFrame(input: string, output: string) {
  const lastFrame = FRAME_COUNT - 1;
  await execFileAsync("ffmpeg", [
    "-y", "-v", "error", "-i", input,
    "-filter_complex",
    `[0:v]trim=start_frame=${lastFrame}:end_frame=${lastFrame + 1},setpts=PTS-STARTPTS[fg];`
      + `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}[bg];`
      + "[bg][fg]overlay=format=auto:shortest=1,format=rgb24[out]",
    "-map", "[out]", "-frames:v", "1", output,
  ]);
}

async function probeStillFrame(file: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,pix_fmt", "-of", "json", file,
  ]);
  const video = JSON.parse(stdout).streams[0];
  return {
    width: Number(video.width),
    height: Number(video.height),
    pixelFormat: String(video.pix_fmt),
  };
}

async function readCommunityHandoffContract() {
  const source = await fs.readFile(COMMUNITY_RENDERER, "utf8");
  const fps = readNumericSourceConstant(source, "FPS");
  const boundaryFrame = readNumericSourceConstant(source, "SOURCE_BOUNDARY_FRAME_INDEX");
  const contract = VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT;
  return {
    aligned: fps === FPS && boundaryFrame === contract.frameCount - 1,
    fps,
    durationSeconds: contract.durationSeconds,
    frameCount: contract.frameCount,
    repeatCount: contract.sectionCount,
    secondsPerRepeat: contract.sectionSeconds,
    boundaryFrame,
    communityRenderer: path.relative(REPO_ROOT, COMMUNITY_RENDERER),
    downstreamPixelMatch: "UNVERIFIED",
    note: "Checks the archived renderers' source-frame contract. A fresh community capture must verify decoded boundary pixels."
  };
}

function readNumericSourceConstant(source: string, name: string) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9.]+)`));
  if (!match) throw new Error(`Unable to read ${name} from the community renderer.`);
  return Number(match[1]);
}

async function ffprobe(file: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-count_frames", "-show_entries",
    "stream=index,codec_name,profile,codec_tag_string,codec_type,width,height,pix_fmt,color_range,color_space,color_transfer,color_primaries,avg_frame_rate,nb_read_frames:format=duration,size",
    "-of", "json", file,
  ]);
  const parsed = JSON.parse(stdout);
  const video = parsed.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
  const [numerator, denominator] = String(video.avg_frame_rate).split("/").map(Number);
  return {
    codec: video.codec_name,
    profile: video.profile,
    codecTag: video.codec_tag_string,
    width: Number(video.width),
    height: Number(video.height),
    pixelFormat: video.pix_fmt,
    colorRange: video.color_range,
    colorSpace: video.color_space,
    colorTransfer: video.color_transfer,
    colorPrimaries: video.color_primaries,
    frameRate: numerator / denominator,
    frameCount: Number(video.nb_read_frames),
    durationSeconds: Number(parsed.format.duration),
    sizeBytes: Number(parsed.format.size),
    audioStreamCount: parsed.streams.filter((stream: { codec_type: string }) => stream.codec_type === "audio").length,
  };
}

async function alphaProbe(input: string, frameIndex = INTRO_FRAMES) {
  const { stdout } = await execFileAsync("ffmpeg", [
    "-v", "error", "-i", input,
    "-vf", `trim=start_frame=${frameIndex}:end_frame=${frameIndex + 1},setpts=PTS-STARTPTS,alphaextract`,
    "-frames:v", "1",
    "-pix_fmt", "gray12le", "-f", "rawvideo", "-",
  ], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  let minimum = 65_535;
  let maximum = 0;
  let sum = 0;
  let samples = 0;
  for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
    const value = bytes.readUInt16LE(offset);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    sum += value;
    samples += 1;
  }
  if (samples === 0) throw new Error("Alpha probe returned no pixels.");
  return { minimum, maximum, average: sum / samples, samples };
}

async function fullDecode(input: string) {
  try {
    await execFileAsync("ffmpeg", ["-v", "error", "-i", input, "-f", "null", "-"], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return "PASS" as const;
  } catch (error) {
    return `FAIL (${error instanceof Error ? error.message : String(error)})`;
  }
}

function validAlphaMov(probe: MediaProbe, alpha: { minimum: number; maximum: number }) {
  return probe.width === WIDTH
    && probe.height === HEIGHT
    && probe.frameRate === FPS
    && probe.frameCount === FRAME_COUNT
    && Math.abs(probe.durationSeconds - FRAME_COUNT / FPS) < 0.001
    && probe.codec === "prores"
    && probe.profile === "4444"
    && probe.codecTag === "ap4h"
    && /^yuva444p(?:10|12)le$/.test(probe.pixelFormat)
    && probe.audioStreamCount === 0
    && alpha.maximum - alpha.minimum > 512;
}

async function buildContactSheet(inputs: string[], output: string, columns: number) {
  const inputArgs = inputs.flatMap((input) => ["-i", input]);
  const thumbWidth = Math.floor(WIDTH / columns);
  const thumbHeight = Math.floor(thumbWidth * HEIGHT / WIDTH);
  const filters = inputs.map((_, index) => `[${index}:v]scale=${thumbWidth}:${thumbHeight}[s${index}]`).join(";");
  const labels = inputs.map((_, index) => `[s${index}]`).join("");
  const layout = inputs.map((_, index) => `${(index % columns) * thumbWidth}_${Math.floor(index / columns) * thumbHeight}`).join("|");
  await execFileAsync("ffmpeg", [
    "-y", "-v", "error", ...inputArgs,
    "-filter_complex", `${filters};${labels}xstack=inputs=${inputs.length}:layout=${layout}:fill=black[out]`,
    "-map", "[out]", "-frames:v", "1", output,
  ]);
}

async function getGitState() {
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT }),
    execFileAsync("git", ["status", "--short"], { cwd: REPO_ROOT }),
  ]);
  const changedPaths = status.trim().split("\n").filter(Boolean);
  return {
    head: head.trim(),
    dirty: changedPaths.length > 0,
    changedPathCount: changedPaths.length,
    runnerCheckout: REPO_ROOT,
  };
}

function clampFrame(frameIndex: number) {
  return Math.max(TRAVERSAL_START_FRAME, Math.min(TRAVERSAL_START_FRAME + TRAVERSAL_FRAMES - 1, frameIndex));
}

function renderEvidence(evidence: {
  status: string;
  artifacts: { background: string; timecode: string; legend: string; contributorHandoffFrame: string };
  diagnostics: { renderer?: string; monthCount: number; dayCount: number };
  verificationLanes: Record<string, string>;
  note: string;
}) {
  return `# Vertical deck.gl contribution calendar evidence\n\n` +
    `Status: **${evidence.status}**\n\n` +
    `- Background: \`${evidence.artifacts.background}\`\n` +
    `- Legend: \`${evidence.artifacts.legend}\`\n` +
    `- Timecode: \`${evidence.artifacts.timecode}\`\n` +
    `- Contributor handoff frame: \`${evidence.artifacts.contributorHandoffFrame}\`\n` +
    `- Renderer: ${evidence.diagnostics.renderer ?? "unknown"}\n` +
    `- Months / days: ${evidence.diagnostics.monthCount} / ${evidence.diagnostics.dayCount}\n` +
    `- deck.gl OrbitView: **${evidence.verificationLanes.localDeckGlOrbitView}**\n` +
    `- Single-day reveal: **${evidence.verificationLanes.sequentialSingleDayReveal}**\n` +
    `- Continuous calendar ribbon: **${evidence.verificationLanes.continuousCalendarRibbon}**\n` +
    `- No month dividers: **${evidence.verificationLanes.noMonthDividers}**\n` +
    `- Completed history recedes to top: **${evidence.verificationLanes.completedHistoryRecedesToTop}**\n` +
    `- History persists to projection horizon: **${evidence.verificationLanes.historyPersistsToProjectionHorizon}**\n` +
    `- Transparent commit track: **${evidence.verificationLanes.transparentCommitTrack}**\n` +
    `- Moving calendar fade-in: **${evidence.verificationLanes.movingCalendarFadeIn}**\n` +
    `- Empty moving calendar pre-roll: **${evidence.verificationLanes.emptyMovingCalendarPreRoll}**\n` +
    `- vis.gl contributor recap boundary: **${evidence.verificationLanes.visglContributorRecapBoundary}**\n` +
    `- Half-second full-timeline recap: **${evidence.verificationLanes.halfSecondFullTimelineRecap}**\n` +
    `- Media frame lock: **${evidence.verificationLanes.synchronizedBackgroundLegendTimecode}**\n` +
    `- Hardware GPU: **${evidence.verificationLanes.hardwareAcceleratedGpu}**\n` +
    `- Foreground composite: **${evidence.verificationLanes.foregroundComposite}**\n\n` +
    `${evidence.note}\n`;
}

await main();
