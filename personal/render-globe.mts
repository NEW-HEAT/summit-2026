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
  type OwnerProjectContributionSnapshot,
} from "./scene/calendar-model";
import {
  LOCATION_HEAT_SCHEMA_VERSION,
  buildCommitLocationHeat,
  type CommitLocationHeatDataset,
  type PrivateLocationArchive,
} from "./scene/location-heat-model";
import { VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT } from "./scene/vertical-calendar-model";
import {
  CLIP_02_ORLANDO_HANDOFF_ALPHA_BOUNDS_AT_128,
  CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX,
} from "./scene/globe-camera-model";
import { CONTINENT_LAND_FILL_COLOR } from "./scene/continent-land-model";
import { CONTRIBUTION_BANG_DURATION_DAYS } from "./scene/globe-impact-model";
import type { ContributionOverlayKind } from "./scene/geographic-memory-timecode";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(archiveFileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

type Options = {
  source: string | null;
  locationArchive: string | null;
  dataset: string | null;
  output: string;
  timecodeOutput: string | null;
  overlayDir: string | null;
  overlayKinds: Exclude<ContributionOverlayKind, "combined">[];
  onlyOverlayKind: Exclude<ContributionOverlayKind, "combined"> | null;
  standaloneOverlayKind: Exclude<ContributionOverlayKind, "combined"> | null;
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
  const locationArchive = values.get("--location-archive");
  const dataset = values.get("--dataset");
  const output = values.get("--output");
  if (!output || (!dataset && (!source || !locationArchive))) {
    throw new Error(
      "Usage: render-globe.mts (--source <owner-contributions.json> " +
      "--location-archive <private-fitness-scene.json> | " +
      "--dataset <derived-location-heat.json>) --output <globe.mov> " +
      "[--timecode-output <timestamp.mov>] [--smoke-frames N] [--headed]",
    );
  }
  if (dataset && (source || locationArchive)) {
    throw new Error("--dataset cannot be combined with --source or --location-archive.");
  }
  if (path.extname(output).toLowerCase() !== ".mov") {
    throw new Error("Transparent globe output must use the .mov extension.");
  }
  const timecodeOutput = values.get("--timecode-output") ?? null;
  if (timecodeOutput && path.extname(timecodeOutput).toLowerCase() !== ".mov") {
    throw new Error("Transparent date-and-organization timecode output must use the .mov extension.");
  }
  const smokeFrames = values.has("--smoke-frames") ? Number(values.get("--smoke-frames")) : null;
  if (smokeFrames != null && (!Number.isInteger(smokeFrames) || smokeFrames <= 0)) {
    throw new Error("--smoke-frames must be a positive integer.");
  }
  const onlyOverlayKind = values.get("--only-overlay");
  const standaloneOverlayKind = values.get("--standalone-overlay");
  if (standaloneOverlayKind && (onlyOverlayKind || values.has("--overlay-dir") || timecodeOutput
    || !["date", "organizations", "total"].includes(standaloneOverlayKind))) {
    throw new Error("--standalone-overlay requires date, organizations, or total, and cannot combine with other overlay modes.");
  }
  const overlayKinds = values.get("--overlay-kinds")?.split(",") ?? ["date", "organizations", "total"];
  if (values.has("--overlay-kinds") && (!values.has("--overlay-dir") || onlyOverlayKind
    || overlayKinds.some((kind) => !["date", "organizations", "total"].includes(kind))
    || new Set(overlayKinds).size !== overlayKinds.length)) {
    throw new Error("--overlay-kinds requires unique date, organizations, or total values and an --overlay-dir; it cannot combine with --only-overlay.");
  }
  if (onlyOverlayKind && (!values.has("--overlay-dir") || smokeFrames != null
    || !["date", "organizations", "total"].includes(onlyOverlayKind))) {
    throw new Error("--only-overlay requires date, organizations, or total, an --overlay-dir, and a full export.");
  }
  return {
    source: source ? path.resolve(source) : null,
    locationArchive: locationArchive ? path.resolve(locationArchive) : null,
    dataset: dataset ? path.resolve(dataset) : null,
    output: path.resolve(output),
    timecodeOutput: timecodeOutput ? path.resolve(timecodeOutput) : null,
    overlayDir: values.has("--overlay-dir") ? path.resolve(values.get("--overlay-dir")!) : null,
    overlayKinds: overlayKinds as Options["overlayKinds"],
    onlyOverlayKind: onlyOverlayKind as Options["onlyOverlayKind"] ?? null,
    standaloneOverlayKind: standaloneOverlayKind as Options["standaloneOverlayKind"] ?? null,
    smokeFrames,
    headed,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const outputDir = path.dirname(options.output);
  await fs.mkdir(outputDir, { recursive: true });
  if (options.timecodeOutput) await fs.mkdir(path.dirname(options.timecodeOutput), { recursive: true });
  if (options.overlayDir) await fs.mkdir(options.overlayDir, { recursive: true });
  const dataset = await loadDataset(options);
  const requestedFrameCount = options.smokeFrames ?? VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount;
  const output = options.smokeFrames
    ? path.join(outputDir, `personal-github-contribution-location-globe-smoke-${requestedFrameCount}f.mov`)
    : options.output;
  const previousEvidence = options.onlyOverlayKind
    ? JSON.parse(await fs.readFile(path.join(outputDir, "globe-evidence-final.json"), "utf8"))
    : null;
  if (previousEvidence && (previousEvidence.status !== "PASS"
    || previousEvidence.artifact !== output
    || previousEvidence.sourceSnapshot !== (options.source ?? options.dataset))) {
    throw new Error("Overlay-only rendering requires a passed globe export with the same artifact and contribution source.");
  }
  const timecodeOutput = options.timecodeOutput
    ? options.smokeFrames
      ? path.join(
        path.dirname(options.timecodeOutput),
        `personal-github-contribution-timecode-organization-shares-smoke-${requestedFrameCount}f.mov`,
      )
      : options.timecodeOutput
    : null;
  const privatePayload = path.join(outputDir, `.location-heat-render-${process.pid}.json`);
  const webmIntermediate = `${output}.webm`;
  const timecodeWebmIntermediate = timecodeOutput ? `${timecodeOutput}.webm` : null;
  await fs.writeFile(privatePayload, `${JSON.stringify(dataset)}\n`, { mode: 0o600 });
  await fs.chmod(privatePayload, 0o600);

  const server = await createServer({
    root: HERE,
    configFile: false,
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      fs: { allow: [REPO_ROOT, outputDir] },
    },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) throw new Error("Vite did not expose a globe render URL.");
  const renderUrl = `${baseUrl}scene/globe-index.html?${new URLSearchParams({ data: `/@fs${privatePayload}` })}`;
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
    await page.goto(renderUrl, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForFunction(
      () => Boolean(window.__CONTRIBUTION_LOCATION_GLOBE__),
      undefined,
      { timeout: 120_000 },
    );
    await page.evaluate(() => window.__CONTRIBUTION_LOCATION_GLOBE__.ready);
    const diagnostics = await page.evaluate(() => window.__CONTRIBUTION_LOCATION_GLOBE__.getDiagnostics());
    if (options.standaloneOverlayKind) {
      const kind = options.standaloneOverlayKind;
      const result = await renderGeographicTimecode(page, webmIntermediate, output, requestedFrameCount, kind);
      const status = validAlphaMov(result.probe, result.alpha, requestedFrameCount)
        && result.fullDecode === "PASS" && pageErrors.length === 0
        && result.renderResult.counterClock === "exact-circle-landing-frame"
        && result.renderResult.initialTotal === (dataset.prefilledHistory?.contributionVolume ?? 0)
        && (options.smokeFrames != null || result.renderResult.finalTotal === dataset.metrics.contributionVolume)
        ? "PASS" : "FAIL";
      for (const [label, frame] of [["opening", 0], ["activity", 1140], ["landing", 3096], ["final", 3719]] as const) {
        if (frame >= requestedFrameCount) continue;
        await execFileAsync("ffmpeg", ["-y", "-v", "error", "-ss", String(frame / FPS),
          "-i", output, "-frames:v", "1", path.join(outputDir, `${kind}-${label}.png`)]);
      }
      await fs.writeFile(path.join(outputDir, `${kind}-evidence-final.json`), `${JSON.stringify({
        status: options.smokeFrames ? "UNVERIFIED" : status, generatedAt: new Date().toISOString(),
        artifact: output, kind, ...result, pageErrors, source: await getGitState(),
        sourceSnapshot: options.source ?? options.dataset,
        otherMoviesChanged: false, editorImport: "UNVERIFIED",
      }, null, 2)}\n`);
      process.stdout.write(`CONTRIBUTION_OVERLAY_COMPLETE ${status} ${output}\n`);
      if (status !== "PASS") process.exitCode = 1;
      return;
    }
    const proof = await captureProofFrames(page, outputDir);
    const pinArrivalProof = await capturePinArrivalProof(page, dataset, outputDir);
    for (const [label, frameIndex] of [["opening", 0], ["cumulative", 2760]] as const) {
      const png = await page.evaluate((frame) =>
        window.__CONTRIBUTION_LOCATION_GLOBE__.getTimecodePreview(frame), frameIndex);
      await fs.writeFile(path.join(outputDir, `organization-corners-${label}.png`),
        Buffer.from(png.split(",")[1], "base64"));
    }

    let renderResult = previousEvidence?.renderResult;
    if (!options.onlyOverlayKind) {
      const downloadPromise = page.waitForEvent("download", { timeout: 0 });
      const renderPromise = page.evaluate(
        (frameCount) => window.__CONTRIBUTION_LOCATION_GLOBE__.renderGlobeWebm({ frameCount }),
        requestedFrameCount,
      );
      const [download, result] = await Promise.all([downloadPromise, renderPromise]);
      renderResult = result;
      await download.saveAs(webmIntermediate);
      await normalizeGlobeAlphaMov(webmIntermediate, output, requestedFrameCount, Boolean(dataset.prefilledHistory));
      await fs.rm(webmIntermediate, { force: true });
    }

    let timecodeResult: Awaited<ReturnType<typeof renderGeographicTimecode>> | null = null;
    if (timecodeOutput && timecodeWebmIntermediate) {
      timecodeResult = await renderGeographicTimecode(
        page,
        timecodeWebmIntermediate,
        timecodeOutput,
        requestedFrameCount,
      );
    }

    const overlays: Array<{ kind: ContributionOverlayKind; output: string;
      result: Awaited<ReturnType<typeof renderGeographicTimecode>> }> = previousEvidence
      ? previousEvidence.overlays.filter((overlay: { kind: ContributionOverlayKind }) =>
        overlay.kind !== options.onlyOverlayKind)
      : [];
    if (options.overlayDir) {
      for (const kind of options.onlyOverlayKind ? [options.onlyOverlayKind] : options.overlayKinds) {
        const overlayOutput = path.join(options.overlayDir,
          `personal-github-contribution-${kind}-only-alpha-62s.mov`);
        const result = await renderGeographicTimecode(page, `${overlayOutput}.webm`,
          overlayOutput, requestedFrameCount, kind);
        overlays.push({ kind, output: overlayOutput, result });
        for (const [label, frame] of [["opening", 0], ["landing", 3096], ["final", 3719]] as const) {
          // Proof images show the actual encoded alpha movie, not a separate
          // browser canvas redraw that can differ from the delivered frame.
          await execFileAsync("ffmpeg", ["-y", "-v", "error", "-ss", String(frame / FPS),
            "-i", overlayOutput, "-frames:v", "1",
            path.join(options.overlayDir, `${kind}-${label}.png`)]);
        }
      }
    }

    const [probe, alpha, handoffColor, handoffBounds, decode, git] = await Promise.all([
      ffprobe(output),
      alphaProbe(output),
      handoffColorProbe(output),
      alphaBoundsProbe(output, 128),
      fullDecode(output),
      getGitState(),
    ]);
    const mediaPass = validAlphaMov(probe, alpha, requestedFrameCount);
    const explicitAlphaMaskPass = renderResult.alphaTransport
      === "dual-video-track-grayscale-mask";
    const timecodePass = !timecodeResult || (
      validAlphaMov(timecodeResult.probe, timecodeResult.alpha, requestedFrameCount)
      && timecodeResult.fullDecode === "PASS"
      && timecodeResult.renderResult.dateMode === "opening-range-to-live-calendar"
      && timecodeResult.renderResult.openingRangeLabel === "JAN 01 2022–2023"
      && timecodeResult.renderResult.calendarAlignment === "shared-day-count"
      && timecodeResult.renderResult.legendLayout === "one-organization-per-corner"
    );
    const statePass = proof.states.every((state, index) =>
      index === 0 || state.currentDate >= proof.states[index - 1].currentDate,
    ) && proof.states.every((state, index) =>
      index === 0 || state.cumulativeLocatedVolume >= proof.states[index - 1].cumulativeLocatedVolume,
    );
    const lockedIntroScalePass = proof.states.every((state) =>
      state.cameraZoom === diagnostics.clip02HandoffViewState.zoom
    ) && Math.abs(
      proof.traversalAlphaBounds.heightRatio - diagnostics.targetGlobeHeightRatio,
    ) <= 0.02;
    const continentPolygonBasemapPass = diagnostics.baseMapLayerType === "PolygonLayer"
      && diagnostics.landSource === "Natural Earth 1:50m land polygons"
      && diagnostics.continentPolygonCount >= 1_000
      && diagnostics.rasterSurfaceLayerCount === 0
      && diagnostics.oceanUnderlay === false
      && diagnostics.backFaceCulling === "back"
      && diagnostics.hemisphereClipping === "spherical-horizon-fragment-discard";
    const clip02HandoffPass = proof.states[0].cameraLongitude
      === diagnostics.clip02HandoffViewState.longitude
      && proof.states[0].cameraLatitude === diagnostics.clip02HandoffViewState.latitude
      && proof.states[0].cameraZoom === diagnostics.clip02HandoffViewState.zoom;
    const clip02HandoffGlobeScalePass = Math.abs(
      handoffBounds.width - CLIP_02_ORLANDO_HANDOFF_ALPHA_BOUNDS_AT_128.width,
    ) <= 1 && Math.abs(
      handoffBounds.height - CLIP_02_ORLANDO_HANDOFF_ALPHA_BOUNDS_AT_128.height,
    ) <= 1;
    const highResolutionMeshPass = diagnostics.meshResolutionDegrees <= 0.25;
    const prefilledHistoryPass = !dataset.prefilledHistory || (
      proof.states[0].prefilledHeatOpacity === 0
      && proof.states[1].prefilledHeatOpacity === 1
      && Math.abs(proof.states[0].cumulativeLocatedVolume
        - dataset.prefilledHistory.locatedContributionVolume) < 1e-6
      && dataset.prefilledHistory.dateRange.to < dataset.dateRange.from
    );
    const cleanHandoffColorPass = handoffColor.opaquePixelCount > 10_000
      && handoffColor.offContractOpaquePixelCount === 0;
    const continentFillColorPass = JSON.stringify(diagnostics.continentFillColor)
      === JSON.stringify([158, 162, 168, 255]);
    const organizationLegendPass = diagnostics.organizationShareCount === 4
      && diagnostics.activeDayPercentTotal === 100
      && diagnostics.contributionPercentTotal === 100
      && diagnostics.organizationProgressDayCount === diagnostics.dayCount
      && diagnostics.organizationProgressFinalTotal === diagnostics.metrics.contributionVolume;
    const discreteOrganizationColorPass = diagnostics.organizationColorCount === 4
      && diagnostics.workColorMode === "solid-discrete-organization-heat-contours"
      && diagnostics.settledWorkGeometry === "organization-split-geographic-heat-cells"
      && diagnostics.persistentWorkScatterplots === false
      && diagnostics.settledTrainingGeometry === "cumulative-geographic-heat-cells"
      && diagnostics.persistentTrainingScatterplots === false
      && diagnostics.impactTransition === "solid-bang-then-delayed-heat-cell"
      && diagnostics.settledWorkBrightnessFloor >= 0.7
      && diagnostics.settledTrainingBrightnessFloor >= 0.46
      && diagnostics.maximumImpactWavePixels <= 30
      && diagnostics.maximumFocusWavePixels <= 32
      && diagnostics.workColorBlending === false;
    const quickFocusSnapPass = diagnostics.focusTransitionFraction <= 0.12
      && diagnostics.focusMotionMode === "quick-ease-out-section-snap";
    const pinArrivalPass = diagnostics.arrivalMotion === "absolute-corner-curved-recession"
      && diagnostics.arrivalTrailLayer === "TripsLayer"
      && diagnostics.arrivalTrailShape === "cubic-bezier-tapered-wake"
      && diagnostics.arrivalView === "OrthographicView"
      && diagnostics.arrivalFraction === 0.62
      && diagnostics.arrivalStartDiameter === CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX
      && diagnostics.arrivalHoldFraction === 0.12
      && diagnostics.arrivalRecessionExponent === 5;
    const requestedOverlayKinds = options.onlyOverlayKind ? [options.onlyOverlayKind] : options.overlayKinds;
    const splitOverlayPass = !options.overlayDir || (requestedOverlayKinds.every((kind) =>
      overlays.some((overlay) => overlay.kind === kind)) && overlays.every(({ kind, result }) =>
      validAlphaMov(result.probe, result.alpha, requestedFrameCount)
      && result.fullDecode === "PASS"
      && result.renderResult.kind === kind
      && result.renderResult.counterClock === "exact-circle-landing-frame"
      && result.renderResult.initialTotal === (dataset.prefilledHistory?.contributionVolume ?? 0)
      && (options.smokeFrames != null || result.renderResult.finalTotal === dataset.metrics.contributionVolume)
    ));
    const status = mediaPass
      && timecodePass
      && explicitAlphaMaskPass
      && decode === "PASS"
      && diagnostics.webgl
      && diagnostics.deckView === "GlobeView"
      && lockedIntroScalePass
      && continentPolygonBasemapPass
      && clip02HandoffPass
      && clip02HandoffGlobeScalePass
      && highResolutionMeshPass
      && prefilledHistoryPass
      && cleanHandoffColorPass
      && continentFillColorPass
      && organizationLegendPass
      && discreteOrganizationColorPass
      && quickFocusSnapPass
      && pinArrivalPass
      && splitOverlayPass
      && diagnostics.transparentBackground
      && diagnostics.independentOverlay
      && diagnostics.locationEvidence === "same-local-date-private-route-center"
      && diagnostics.metrics.matchedContributionDays > 0
      && diagnostics.metrics.unmatchedContributionDays > 0
      && diagnostics.metrics.trainingRouteCount > 0
      && diagnostics.trainingPointCount > 0
      && diagnostics.trainingLocationCellCount >= diagnostics.locationCellCount
      && statePass
      && pageErrors.length === 0
      ? "PASS"
      : "FAIL";
    const evidence = {
      status: options.smokeFrames ? "UNVERIFIED" : status,
      lane: options.smokeFrames ? "smoke-only transparent globe" : "local deterministic transparent globe export",
      generatedAt: new Date().toISOString(),
      artifact: output,
      sourceSnapshot: options.source ?? options.dataset,
      privateLocationArchive: options.locationArchive,
      reusedDerivedDataset: Boolean(options.dataset),
      reusedGlobeArtifact: Boolean(options.onlyOverlayKind),
      renderResult,
      geographicMemoryTimecode: timecodeResult ? {
        artifact: timecodeOutput,
        ...timecodeResult,
      } : null,
      probe,
      alpha,
      handoffColor,
      handoffBounds,
      fullDecode: decode,
      diagnostics,
      proof,
      pinArrivalProof,
      overlays,
      pageErrors,
      source: git,
      verificationLanes: {
        deckGlGlobeView: diagnostics.webgl && diagnostics.deckView === "GlobeView" ? "PASS" : "FAIL",
        lockedIntroScaleAllFrames: lockedIntroScalePass ? "PASS" : "FAIL",
        continentPolygonBasemap: continentPolygonBasemapPass ? "PASS" : "FAIL",
        clip02FinalViewStateHandoff: clip02HandoffPass ? "PASS" : "FAIL",
        clip02EncodedLandSilhouetteHandoff: clip02HandoffGlobeScalePass ? "PASS" : "FAIL",
        highResolutionGlobeMesh: highResolutionMeshPass ? "PASS" : "FAIL",
        prefilledHistoryWithoutRetiming: dataset.prefilledHistory ? (prefilledHistoryPass ? "PASS" : "FAIL") : "NOT REQUESTED",
        cleanClip02HandoffColor: cleanHandoffColorPass ? "PASS" : "FAIL",
        farSidePolygonHorizonClip: diagnostics.hemisphereClipping === "spherical-horizon-fragment-discard"
          ? "PASS" : "FAIL",
        continentFillColor: continentFillColorPass ? "PASS" : "FAIL",
        integratedOrganizationLegend: organizationLegendPass ? "PASS" : "FAIL",
        discreteOrganizationWorkColors: discreteOrganizationColorPass ? "PASS" : "FAIL",
        quickActiveLocationSnap: quickFocusSnapPass ? "PASS" : "FAIL",
        globeSizedRecedingContributionPins: pinArrivalPass ? "PASS" : "FAIL",
        absoluteCornerTripsTrails: pinArrivalPass ? "PASS" : "FAIL",
        requestedIndependentOverlays: options.overlayDir ? (splitOverlayPass ? "PASS" : "FAIL") : "NOT REQUESTED",
        fourCornerOrganizationLegend: timecodeResult && timecodePass ? "PASS" : "NOT REQUESTED",
        hardwareAcceleratedGpu: diagnostics.webgl && !/swiftshader|software/iu.test(diagnostics.renderer ?? "")
          ? "PASS" : "UNVERIFIED",
        transparentBackground: mediaPass && alpha.maximum - alpha.minimum > 512 && alpha.average < 1_000
          ? "PASS" : "FAIL",
        explicitGrayscaleAlphaMask: explicitAlphaMaskPass ? "PASS" : "FAIL",
        exactSameDayLocationEvidence: diagnostics.locationEvidence === "same-local-date-private-route-center"
          ? "PASS" : "FAIL",
        broadLocationQuantization: diagnostics.quantizationDegrees === 1 ? "PASS" : "FAIL",
        unmatchedDaysRemainUnlocated: diagnostics.metrics.unmatchedContributionDays > 0 ? "PASS" : "FAIL",
        cumulativeTrainingActivityCoverage: diagnostics.metrics.trainingRouteCount > 0
          && diagnostics.trainingPointCount > 0
          && diagnostics.trainingLocationCellCount >= diagnostics.locationCellCount
          ? "PASS" : "FAIL",
        synchronizedSixtyTwoSecondContract: !options.smokeFrames && mediaPass ? "PASS" : "UNVERIFIED",
        synchronizedOrganizationTimecode: !options.smokeFrames && timecodeResult && timecodePass
          ? "PASS"
          : timecodeResult
            ? "UNVERIFIED"
            : "NOT REQUESTED",
        editorComposite: "UNVERIFIED (separate alpha movie; editor import not performed)",
      },
      note: "Located work is added only when an attributed contribution day has a private route center on the same America/New_York calendar date. Frame zero copies Clip 02's exact fixed-view Orlando pose and 996-pixel globe height. The globe keeps that exact zoom for all 3,720 frames; only longitude and latitude move toward contribution areas during the one-second empty-calendar lead-in and subsequent 32 location snaps. The globe base uses deterministic Natural Earth 1:50m land geometry in one PolygonLayer with a 0.25-degree GlobeView mesh and an opaque #9EA2A8 fill (RGBA 158, 162, 168, 255): there is no raster basemap, image tile, or ocean underlay. Every polygon surface combines back-face culling with spherical horizon fragment discard, preventing rear-hemisphere ribbons around the north pole or across South America. Each located day arrives as a brief solid NEW HEAT red, AGINTEL green, VisualPT blue, or vis.gl purple impact, then leaves the transient scatter layer and settles into a bright organization-split one-degree geographic heat cell. Settled work cells retain at least 70% of their exact organization color, remain fully opaque, and disable blending, so organizations never collapse into an averaged heat color or linger as persistent scatterplot points. The independent blue-green training field includes every valid private route in the contribution date range and also settles into bright opaque cumulative one-degree heat cells instead of permanent circles. Both work and training quantize route centers before browser rendering; exact routes and coordinates never enter the scene payload. Unmatched contribution days add no work location signal. The locked-scale globe uses 32 fast ease-out location snaps, never a continuous spin, and remains a separate transparent ProRes 4444 layer synchronized to the 62-second vis.gl handoff calendar master. The independent timecode shows JAN 01 2022–2023 only as its opening state, resolves to JAN 01 2023 during the one-second empty-calendar lead-in, then follows the same day-count clock as the contribution calendar and globe for the full traversal. ACTIVE DAYS remains a proxy for time allocation, not estimated working hours.",
    };
    const suffix = options.smokeFrames ? `smoke-${requestedFrameCount}f` : "final";
    await fs.writeFile(
      path.join(outputDir, `globe-evidence-${suffix}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    if (!options.smokeFrames) {
      await fs.writeFile(path.join(outputDir, "GLOBE-EVIDENCE.md"), renderEvidence(evidence));
    }
    process.stdout.write(`CONTRIBUTION_GLOBE_COMPLETE ${options.smokeFrames ? "UNVERIFIED" : status} ${output}\n`);
    if (!options.smokeFrames && status !== "PASS") process.exitCode = 1;
  } finally {
    await browser.close();
    await server.close();
    await Promise.all([
      fs.rm(privatePayload, { force: true }),
      fs.rm(webmIntermediate, { force: true }),
      ...(timecodeWebmIntermediate ? [fs.rm(timecodeWebmIntermediate, { force: true })] : []),
    ]);
  }
}

async function loadDataset(options: Options): Promise<CommitLocationHeatDataset> {
  if (options.dataset) {
    const dataset = await fs.readFile(options.dataset, "utf8")
      .then((value) => JSON.parse(value) as CommitLocationHeatDataset);
    if (dataset.schemaVersion !== LOCATION_HEAT_SCHEMA_VERSION || dataset.dayCount <= 0) {
      throw new Error("Derived contribution location heat dataset is invalid.");
    }
    return dataset;
  }
  if (!options.source || !options.locationArchive) {
    throw new Error("Contribution source and private location archive are required.");
  }
  const [snapshot, archive] = await Promise.all([
    fs.readFile(options.source, "utf8")
      .then((value) => JSON.parse(value) as OwnerProjectContributionSnapshot),
    fs.readFile(options.locationArchive, "utf8")
      .then((value) => JSON.parse(value) as PrivateLocationArchive),
  ]);
  return buildCommitLocationHeat(snapshot, archive);
}

async function captureProofFrames(page: Page, outputDir: string) {
  const frames = [0, 60, 480, 1_140, 2_040, 2_760, VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.frameCount - 1];
  const paths: string[] = [];
  const states: Array<Awaited<ReturnType<typeof setFrame>>> = [];
  for (let index = 0; index < frames.length; index += 1) {
    states.push(await setFrame(page, frames[index]));
    const output = path.join(outputDir, `globe-sample-${String(index + 1).padStart(2, "0")}.png`);
    await page.screenshot({ path: output, omitBackground: true });
    paths.push(output);
  }
  await buildContactSheet(paths, path.join(outputDir, "globe-contact-sheet.png"), 3);
  await fs.copyFile(paths[3], path.join(outputDir, "globe-transparent-preview.png"));
  const [openingAlphaBounds, traversalAlphaBounds] = await Promise.all([
    measureAlphaBounds(paths[0]),
    measureAlphaBounds(paths[1]),
  ]);
  return { frames, paths, states, openingAlphaBounds, traversalAlphaBounds };
}

async function capturePinArrivalProof(
  page: Page,
  dataset: CommitLocationHeatDataset,
  outputDir: string,
) {
  const point = dataset.points.filter((point) =>
    point.dayOrdinal > dataset.dayCount * 0.1 && point.dayOrdinal < dataset.dayCount * 0.9
  ).sort((a, b) => b.volume - a.volume)[0];
  if (!point) throw new Error("A located contribution day is required for arrival proof.");
  const frames = [0.03, 0.18, 0.4, 0.65, 0.9].map((progress) => Math.round(FPS * (
    VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds
      + (point.dayOrdinal + 1 + CONTRIBUTION_BANG_DURATION_DAYS * progress)
      / dataset.dayCount * VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.traversalSeconds
  )));
  const paths: string[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    await setFrame(page, frames[index]);
    const output = path.join(outputDir, `pin-arrival-${String(index + 1).padStart(2, "0")}.png`);
    await page.screenshot({ path: output, omitBackground: true });
    paths.push(output);
  }
  await buildContactSheet(paths, path.join(outputDir, "pin-arrival-contact-sheet.png"), 3);
  return { frames, paths, contributionDayOrdinal: point.dayOrdinal };
}

async function measureAlphaBounds(input: string) {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-v", "info", "-i", input, "-frames:v", "1",
    "-vf", "alphaextract,bbox=min_val=1", "-f", "null", "-",
  ], { maxBuffer: 8 * 1024 * 1024 });
  const matches = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  const match = matches.at(-1);
  if (!match) throw new Error(`Unable to measure alpha bounds for ${input}.`);
  const [, width, height, x, y] = match.map(Number);
  return {
    x,
    y,
    width,
    height,
    widthRatio: width / WIDTH,
    heightRatio: height / HEIGHT,
  };
}

async function setFrame(page: Page, frameIndex: number) {
  return page.evaluate((frame) => window.__CONTRIBUTION_LOCATION_GLOBE__.setFrame(frame), frameIndex);
}

async function renderGeographicTimecode(
  page: Page,
  webmIntermediate: string,
  output: string,
  frameCount: number,
  kind: ContributionOverlayKind = "combined",
) {
  const downloadPromise = page.waitForEvent("download", { timeout: 0 });
  const renderPromise = page.evaluate(
    ({ requestedFrameCount, overlayKind }) => window.__CONTRIBUTION_LOCATION_GLOBE__
      .renderGeographicTimecodeWebm({ frameCount: requestedFrameCount, kind: overlayKind }),
    { requestedFrameCount: frameCount, overlayKind: kind },
  );
  const [download, renderResult] = await Promise.all([downloadPromise, renderPromise]);
  await download.saveAs(webmIntermediate);
  await normalizeAlphaMov(webmIntermediate, output, frameCount);
  await fs.rm(webmIntermediate, { force: true });
  const [probe, alpha, fullDecodeResult] = await Promise.all([
    ffprobe(output),
    alphaProbe(output),
    fullDecode(output),
  ]);
  return { renderResult, probe, alpha, fullDecode: fullDecodeResult };
}

async function normalizeAlphaMov(input: string, output: string, frameCount: number) {
  // Typography and organization rules retain their own RGB values from frame 0.
  // The gray normalization below belongs only to the empty polygon-globe lead-in.
  await execFileAsync("ffmpeg", [
    "-y", "-v", "error", "-c:v", "libvpx-vp9", "-i", input,
    "-vf", "format=yuva444p10le",
    "-frames:v", String(frameCount), "-an",
    "-c:v", "prores_aw", "-pix_fmt", "yuva444p10le", "-vendor", "apl0",
    "-movflags", "+faststart", output,
  ]);
}

async function normalizeGlobeAlphaMov(input: string, output: string, frameCount: number, hasPrefilledHistory = false) {
  const cleanFrameCount = Math.min(
    frameCount,
    // Keep frame zero's exact gray handoff, but preserve the quick history fade.
    hasPrefilledHistory ? 1 : Math.round(VERTICAL_VISGL_HANDOFF_EXPORT_CONTRACT.emptyPreRollSeconds * FPS),
  );
  const cleanDurationSeconds = cleanFrameCount / FPS;
  const fillHex = CONTINENT_LAND_FILL_COLOR.slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("");
  const filter = frameCount > cleanFrameCount
    ? `[0:v:1]split=2[maskpre][maskpost];`
      + `[maskpre]trim=start_frame=0:end_frame=${cleanFrameCount},setpts=PTS-STARTPTS,format=gray[prealpha];`
      + `[1:v][prealpha]alphamerge[pre];`
      + `[0:v:0]trim=start_frame=${cleanFrameCount},setpts=PTS-STARTPTS,format=rgba[postcolor];`
      + `[maskpost]trim=start_frame=${cleanFrameCount},setpts=PTS-STARTPTS,format=gray[postalpha];`
      + `[postcolor][postalpha]alphamerge[post];`
      + `[pre][post]concat=n=2:v=1:a=0,format=yuva444p10le[out]`
    : `[0:v:1]trim=start_frame=0:end_frame=${cleanFrameCount},setpts=PTS-STARTPTS,format=gray[prealpha];`
      + `[1:v][prealpha]alphamerge,format=yuva444p10le[out]`;
  await execFileAsync("ffmpeg", [
    "-y", "-v", "error", "-c:v", "libvpx-vp9", "-i", input,
    "-f", "lavfi", "-i",
    `color=c=0x${fillHex}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${cleanDurationSeconds}`,
    "-filter_complex", filter,
    "-frames:v", String(frameCount), "-map", "[out]", "-an",
    "-c:v", "prores_aw", "-pix_fmt", "yuva444p10le", "-vendor", "apl0",
    "-movflags", "+faststart", output,
  ]);
}

async function ffprobe(file: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-count_frames", "-show_entries",
    "stream=index,codec_name,profile,codec_tag_string,codec_type,width,height,pix_fmt,avg_frame_rate,nb_read_frames:format=duration,size",
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
    frameRate: numerator / denominator,
    frameCount: Number(video.nb_read_frames),
    durationSeconds: Number(parsed.format.duration),
    sizeBytes: Number(parsed.format.size),
    audioStreamCount: parsed.streams.filter((stream: { codec_type: string }) => stream.codec_type === "audio").length,
  };
}

async function alphaProbe(input: string) {
  const { stdout } = await execFileAsync("ffmpeg", [
    "-v", "error", "-i", input, "-vf", "alphaextract", "-frames:v", "1",
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

async function handoffColorProbe(input: string) {
  const { stdout } = await execFileAsync("ffmpeg", [
    "-v", "error", "-i", input, "-frames:v", "1",
    "-pix_fmt", "rgba", "-f", "rawvideo", "-",
  ], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  let opaquePixelCount = 0;
  let offContractOpaquePixelCount = 0;
  let maximumChannelDelta = 0;
  for (let offset = 0; offset + 3 < bytes.length; offset += 4) {
    if (bytes[offset + 3] < 250) continue;
    opaquePixelCount += 1;
    const delta = Math.max(
      Math.abs(bytes[offset] - CONTINENT_LAND_FILL_COLOR[0]),
      Math.abs(bytes[offset + 1] - CONTINENT_LAND_FILL_COLOR[1]),
      Math.abs(bytes[offset + 2] - CONTINENT_LAND_FILL_COLOR[2]),
    );
    maximumChannelDelta = Math.max(maximumChannelDelta, delta);
    if (delta > 8) offContractOpaquePixelCount += 1;
  }
  return { opaquePixelCount, offContractOpaquePixelCount, maximumChannelDelta };
}

async function alphaBoundsProbe(input: string, minimumAlpha: number) {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-v", "info", "-i", input, "-frames:v", "1",
    "-vf", `alphaextract,format=gray,bbox=min_val=${minimumAlpha}`, "-f", "null", "-",
  ], { maxBuffer: 8 * 1024 * 1024 });
  const matches = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  const match = matches.at(-1);
  if (!match) throw new Error(`Unable to measure encoded alpha bounds for ${input}.`);
  const [, width, height, x, y] = match.map(Number);
  return { minimumAlpha, x, y, width, height };
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

function validAlphaMov(
  probe: MediaProbe,
  alpha: { minimum: number; maximum: number; average: number },
  frameCount: number,
) {
  return probe.width === WIDTH
    && probe.height === HEIGHT
    && probe.frameRate === FPS
    && probe.frameCount === frameCount
    && Math.abs(probe.durationSeconds - frameCount / FPS) < 0.001
    && probe.codec === "prores"
    && probe.profile === "4444"
    && probe.codecTag === "ap4h"
    && /^yuva444p(?:10|12)le$/.test(probe.pixelFormat)
    && probe.audioStreamCount === 0
    && alpha.maximum - alpha.minimum > 512
    && alpha.average < 1_000;
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
  return {
    head: head.trim(),
    dirty: status.trim().length > 0,
    runnerCheckout: REPO_ROOT,
  };
}

function renderEvidence(evidence: {
  status: string;
  artifact: string;
  geographicMemoryTimecode?: { artifact: string | null } | null;
  diagnostics: {
    renderer?: string;
    baseMapLayerType: string;
    landSource: string;
    continentPolygonCount: number;
    continentFillColor: number[];
    rasterSurfaceLayerCount: number;
    oceanUnderlay: boolean;
    backFaceCulling: string;
    organizationShareCount: number;
    organizationProgressDayCount: number;
    organizationProgressFinalTotal: number;
    dayCount: number;
    focusTransitionFraction: number;
    focusMotionMode: string;
    organizationColorCount: number;
    workColorMode: string;
    settledWorkBrightnessFloor: number;
    settledTrainingBrightnessFloor: number;
    maximumImpactWavePixels: number;
    maximumFocusWavePixels: number;
    workColorBlending: boolean;
    activeDayPercentTotal: number;
    contributionPercentTotal: number;
    metrics: {
      activeContributionDays: number;
      matchedContributionDays: number;
      unmatchedContributionDays: number;
      exactDayMatchRate: number;
      locatedContributionVolume: number;
      trainingRouteCount: number;
      trainingLocationCellCount: number;
      trainingByActivity: Record<string, number>;
    };
  };
  verificationLanes: Record<string, string>;
  note: string;
}) {
  return `# Transparent contribution location globe evidence\n\n` +
    `Status: **${evidence.status}**\n\n` +
    `- Globe overlay: \`${evidence.artifact}\`\n` +
    (evidence.geographicMemoryTimecode?.artifact
      ? `- Date + organization timecode: \`${evidence.geographicMemoryTimecode.artifact}\`\n`
      : "") +
    `- Renderer: ${evidence.diagnostics.renderer ?? "unknown"}\n` +
    `- Active / exact-day matched / unlocated days: ${evidence.diagnostics.metrics.activeContributionDays} / ${evidence.diagnostics.metrics.matchedContributionDays} / ${evidence.diagnostics.metrics.unmatchedContributionDays}\n` +
    `- Exact-day match rate: ${(evidence.diagnostics.metrics.exactDayMatchRate * 100).toFixed(1)}%\n` +
    `- Located attributed volume: ${evidence.diagnostics.metrics.locatedContributionVolume.toFixed(0)}\n` +
    `- Training routes / broad cells: ${evidence.diagnostics.metrics.trainingRouteCount} / ${evidence.diagnostics.metrics.trainingLocationCellCount}\n` +
    `- Training activity mix: ${Object.entries(evidence.diagnostics.metrics.trainingByActivity).map(([activity, count]) => `${activity} ${count}`).join(", ")}\n` +
    `- Focus transition: ${(evidence.diagnostics.focusTransitionFraction * 100).toFixed(0)}% of each section, ${evidence.diagnostics.focusMotionMode}\n` +
    `- deck.gl GlobeView: **${evidence.verificationLanes.deckGlGlobeView}**\n` +
    `- Locked Clip 02 globe scale for every proof frame: **${evidence.verificationLanes.lockedIntroScaleAllFrames}**\n` +
    `- Continent-only PolygonLayer basemap: **${evidence.verificationLanes.continentPolygonBasemap}**\n` +
    `- Clip 02 final view-state handoff: **${evidence.verificationLanes.clip02FinalViewStateHandoff}**\n` +
    `- Clip 02 fixed-view ${CLIP_02_ORLANDO_HANDOFF_GLOBE_HEIGHT_PX}px projected globe contract: **${evidence.verificationLanes.clip02FinalViewStateHandoff}**\n` +
    `- Clip 02 encoded land silhouette handoff: **${evidence.verificationLanes.clip02EncodedLandSilhouetteHandoff}**\n` +
    `- High-resolution 0.25-degree globe mesh: **${evidence.verificationLanes.highResolutionGlobeMesh}**\n` +
    `- Clean #9EA2A8 handoff color: **${evidence.verificationLanes.cleanClip02HandoffColor}**\n` +
    `- Far-side polygon horizon clip: **${evidence.verificationLanes.farSidePolygonHorizonClip}**\n` +
    `- Continent fill #9EA2A8 / RGBA 158, 162, 168, 255: **${evidence.verificationLanes.continentFillColor}**\n` +
    `- Integrated organization legend: **${evidence.verificationLanes.integratedOrganizationLegend}**\n` +
    `- Discrete organization work colors: **${evidence.verificationLanes.discreteOrganizationWorkColors}**\n` +
    `- Quick active-location snap: **${evidence.verificationLanes.quickActiveLocationSnap}**\n` +
    `- Globe-sized corner arrivals with TripsLayer trails: **${evidence.verificationLanes.globeSizedRecedingContributionPins}**\n` +
    `- Separate date, organizations, and landing-synchronized total: **${evidence.verificationLanes.independentDateOrganizationsAndTotal}**\n` +
    `- One organization per corner: **${evidence.verificationLanes.fourCornerOrganizationLegend}**\n` +
    `- Transparent ProRes background: **${evidence.verificationLanes.transparentBackground}**\n` +
    `- Explicit grayscale alpha-mask transport: **${evidence.verificationLanes.explicitGrayscaleAlphaMask}**\n` +
    `- Same-day location evidence: **${evidence.verificationLanes.exactSameDayLocationEvidence}**\n` +
    `- Unmatched days stay unlocated: **${evidence.verificationLanes.unmatchedDaysRemainUnlocated}**\n` +
    `- Cumulative training activity coverage: **${evidence.verificationLanes.cumulativeTrainingActivityCoverage}**\n` +
    `- Exact 62-second frame lock: **${evidence.verificationLanes.synchronizedSixtyTwoSecondContract}**\n` +
    `- Date + organization timecode lock: **${evidence.verificationLanes.synchronizedOrganizationTimecode}**\n` +
    `- Editor composite: **${evidence.verificationLanes.editorComposite}**\n\n` +
    `${evidence.note}\n`;
}

await main();
