#!/usr/bin/env tsx

import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, type Browser, type Download, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import {
  CLIP_CONTRACT,
  buildHandoffManifest,
  buildTimelineManifest,
  type FrameState,
  type SourceFingerprint,
} from "./scene/clip-contract";
import {
  exportDownloadTimeoutMs,
  EXPORT_PROGRESS_INTERVAL_FRAMES,
  proResEncoderForPlatform,
  TIMESTAMP_PRORES_PROFILE,
} from "./scene/render-policy";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const SOURCE_WORKTREE =
  process.env.DECKGL_REFERENCE_ROOT ?? HERE;
const SOURCE_RELATIVE_PATH = "scene/scene.ts";
const SOURCE_PATH = path.join(SOURCE_WORKTREE, SOURCE_RELATIVE_PATH);
const DEFAULT_OUTPUT = path.join(
  HERE,
  "02-fitness-globe-geographic-memories.mov"
);
const DEFAULT_TIMESTAMP_OUTPUT = path.join(
  HERE,
  "02-fitness-globe-geographic-memory-timestamps.mov"
);
const FITNESS_ARCHIVE_BUNDLE = path.join(
  REPO_ROOT,
  ".cache/fitness-archive/scene.json"
);
const WORLD_IMAGERY_CACHE = path.join(
  REPO_ROOT,
  ".cache/fitness-rewind-world-imagery"
);
const WORLD_IMAGERY_ORIGINS = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile",
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile",
] as const;
const worldImageryRequests = new Map<string, Promise<Buffer>>();
const SMOKE_FRAME_INDICES = [0, 20, 60, 900, 1800, 1853] as const;

type Options = {
  mode: "dev" | "smoke" | "render" | "timestamp";
  headed: boolean;
  output: string;
  timestampOutput: string;
  frameCount: number;
};

type BrowserLaunch = {
  browser: Browser;
  channel: "chrome" | "bundled-chromium";
};

type SceneDiagnostics = {
  ready: boolean;
  webgl2: boolean;
  renderer: string | null;
  vendor: string | null;
  version: string | null;
  data: {
    status: "loading" | "ready" | "missing" | "error";
    routeCount: number;
    visibleRouteCount: number;
    visiblePathCount: number;
    timedRouteCount: number;
    inferredRouteCount: number;
    ownerFingerprint: string | null;
    generatedAt: string | null;
    untimedMode: "provenance" | "editorial";
  };
  canvas: {
    left: number;
    top: number;
    cssWidth: number;
    cssHeight: number;
    clientWidth: number;
    clientHeight: number;
  };
  tiles: {
    preloaded: number;
    loaded: number;
    viewportTileCount: number;
    errors: string[];
    layerLoaded: boolean;
  };
  frame: FrameState;
  playing: boolean;
};

type Probe = {
  codecName: string;
  profile: string;
  codecTag: string;
  width: number;
  height: number;
  frameRate: number;
  frameCount: number;
  pixelFormat: string;
  durationSeconds: number;
  sizeBytes: number;
  audioStreamCount: number;
};

type AlphaProbe = {
  minimum: number;
  maximum: number;
  average: number;
};

type InteractiveExportStatus = {
  state: "idle" | "running" | "ready" | "error";
  frame: number;
  frameCount: number;
  outputName: string;
  timestampOutputName: string;
  message?: string;
};

let interactiveExportStatus: InteractiveExportStatus = {
  state: "idle",
  frame: 0,
  frameCount: CLIP_CONTRACT.frameCount,
  outputName: path.basename(DEFAULT_OUTPUT),
  timestampOutputName: path.basename(DEFAULT_TIMESTAMP_OUTPUT),
};
let interactiveExportChild: ChildProcessWithoutNullStreams | null = null;

function parseOptions(argv: string[]): Options {
  let mode: Options["mode"] = "render";
  let headed = false;
  let output = DEFAULT_OUTPUT;
  let timestampOutput = DEFAULT_TIMESTAMP_OUTPUT;
  let frameCount: number = CLIP_CONTRACT.frameCount;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--dev") {
      if (mode !== "render") throw new Error("Choose only one mode.");
      mode = "dev";
      continue;
    }
    if (argument === "--smoke") {
      if (mode !== "render") throw new Error("Choose only one mode.");
      mode = "smoke";
      continue;
    }
    if (argument === "--timestamp-only") {
      if (mode !== "render") throw new Error("Choose only one mode.");
      mode = "timestamp";
      continue;
    }
    if (argument === "--headed") {
      headed = true;
      continue;
    }
    if (argument === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--output requires a .mov path.");
      }
      output = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--timestamp-output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--timestamp-output requires a .mov path.");
      }
      timestampOutput = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--sample-frames") {
      const value = Number(argv[index + 1]);
      if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > CLIP_CONTRACT.frameCount
      ) {
        throw new Error(
          `--sample-frames must be an integer from 1 to ${CLIP_CONTRACT.frameCount}.`
        );
      }
      frameCount = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (path.extname(output).toLowerCase() !== ".mov") {
    throw new Error("The render output must use the .mov extension.");
  }
  if (path.extname(timestampOutput).toLowerCase() !== ".mov") {
    throw new Error("The timestamp output must use the .mov extension.");
  }
  if (output === timestampOutput) {
    throw new Error("The globe and timestamp outputs must be different paths.");
  }
  return { mode, headed, output, timestampOutput, frameCount };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const source = await sourceFingerprint();
  await writeManifests(source);
  if (options.mode === "dev") await hydrateInteractiveExportStatus();
  const server = await startViteServer(options.mode === "dev");

  if (options.mode === "dev") {
    const url = sceneUrl(server, false);
    process.stdout.write(`WORLD_IMAGERY_REWIND_DEV ${url}\n`);
    await waitForShutdown(server);
    return;
  }

  const launch = await launchBrowser(options.headed);
  try {
    await runBrowserCapture(server, launch, options, source);
  } finally {
    await launch.browser.close();
    await server.close();
  }
}

async function hydrateInteractiveExportStatus(): Promise<void> {
  try {
    const [outputStat, timestampOutputStat] = await Promise.all([
      fs.stat(DEFAULT_OUTPUT),
      fs.stat(DEFAULT_TIMESTAMP_OUTPUT),
    ]);
    if (!outputStat.isFile() || !timestampOutputStat.isFile()) return;
    interactiveExportStatus = {
      state: "ready",
      frame: CLIP_CONTRACT.frameCount,
      frameCount: CLIP_CONTRACT.frameCount,
      outputName: path.basename(DEFAULT_OUTPUT),
      timestampOutputName: path.basename(DEFAULT_TIMESTAMP_OUTPUT),
    };
  } catch {
    // A dev server with no completed masters stays idle; E starts a fresh render.
  }
}

async function startViteServer(
  interactiveExportEnabled: boolean
): Promise<ViteDevServer> {
  const port = await reserveLoopbackPort();
  const server = await createServer({
    root: HERE,
    configFile: false,
    publicDir: false,
    logLevel: "error",
    plugins: [
      {
        name: "newheat-fitness-archive",
        configureServer(viteServer) {
          viteServer.middlewares.use(async (request, response, next) => {
            const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
            if (!requestUrl.pathname.startsWith("/world-imagery/")) {
              next();
              return;
            }
            await serveWorldImageryTile(requestUrl.pathname, response);
          });
          viteServer.middlewares.use(async (request, response, next) => {
            const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
            const pathname = requestUrl.pathname;
            if (!pathname.startsWith("/__fitness-rewind-export")) {
              next();
              return;
            }
            if (!interactiveExportEnabled) {
              response.statusCode = 404;
              response.end("Not found");
              return;
            }
            if (
              pathname === "/__fitness-rewind-export/file" &&
              request.method === "GET"
            ) {
              await serveInteractiveExport(
                response,
                requestUrl.searchParams.get("track")
              );
              return;
            }
            if (pathname !== "/__fitness-rewind-export") {
              response.statusCode = 404;
              response.end("Not found");
              return;
            }
            if (request.method === "POST") startInteractiveExport();
            if (request.method !== "GET" && request.method !== "POST") {
              response.statusCode = 405;
              response.setHeader("Allow", "GET, POST");
              response.end("Method not allowed");
              return;
            }
            response.statusCode =
              interactiveExportStatus.state === "running" ? 202 : 200;
            response.setHeader("Content-Type", "application/json");
            response.setHeader("Cache-Control", "no-store");
            response.end(JSON.stringify(interactiveExportStatus));
          });
          viteServer.middlewares.use(
            "/fitness-archive.json",
            async (_request, response) => {
              try {
                const payload = await fs.readFile(FITNESS_ARCHIVE_BUNDLE);
                response.statusCode = 200;
                response.setHeader("Content-Type", "application/json");
                response.setHeader("Cache-Control", "no-store");
                response.end(payload);
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                response.statusCode = 503;
                response.setHeader("Content-Type", "application/json");
                response.end(
                  JSON.stringify({
                    status: "missing",
                    message:
                      "The local fitness archive has not been synchronized.",
                    detail: message,
                  })
                );
              }
            }
          );
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      fs: { allow: [REPO_ROOT] },
    },
  });
  await server.listen();
  if (!server.resolvedUrls?.local[0]) {
    await server.close();
    throw new Error("Vite did not expose a local dev-server URL.");
  }
  return server;
}

async function serveWorldImageryTile(
  pathname: string,
  response: ServerResponse
): Promise<void> {
  const match = /^\/world-imagery\/(\d+)\/(\d+)\/(\d+)\.jpg$/.exec(pathname);
  if (!match) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }
  const [zoom, y, x] = match.slice(1).map(Number);
  const axisTileCount = 2 ** zoom;
  if (
    zoom < CLIP_CONTRACT.imagery.minZoom ||
    zoom > CLIP_CONTRACT.imagery.maxZoom ||
    x < 0 ||
    y < 0 ||
    x >= axisTileCount ||
    y >= axisTileCount
  ) {
    response.statusCode = 400;
    response.end("Invalid tile index");
    return;
  }
  try {
    const tile = await loadCachedWorldImageryTile(zoom, y, x);
    response.statusCode = 200;
    response.setHeader("Content-Type", "image/jpeg");
    response.setHeader("Content-Length", tile.length);
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.end(tile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`WORLD_IMAGERY_CACHE_ERROR ${message}\n`);
    response.statusCode = 502;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(message);
  }
}

async function loadCachedWorldImageryTile(
  zoom: number,
  y: number,
  x: number
): Promise<Buffer> {
  const cachePath = path.join(
    WORLD_IMAGERY_CACHE,
    String(zoom),
    String(y),
    `${x}.jpg`
  );
  try {
    return await fs.readFile(cachePath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  const requestKey = `${zoom}/${y}/${x}`;
  const activeRequest = worldImageryRequests.get(requestKey);
  if (activeRequest) return activeRequest;
  const request = fetchAndCacheWorldImageryTile(cachePath, zoom, y, x).finally(
    () => worldImageryRequests.delete(requestKey)
  );
  worldImageryRequests.set(requestKey, request);
  return request;
}

async function fetchAndCacheWorldImageryTile(
  cachePath: string,
  zoom: number,
  y: number,
  x: number
): Promise<Buffer> {
  let tile: Buffer | null = null;
  let lastError: unknown = null;
  for (const origin of WORLD_IMAGERY_ORIGINS) {
    const url = `${origin}/${zoom}/${y}/${x}`;
    try {
      const { stdout } = await execFileAsync(
        "curl",
        [
          "--fail",
          "--silent",
          "--show-error",
          "--location",
          "--retry",
          "4",
          "--retry-all-errors",
          "--retry-delay",
          "1",
          "--retry-max-time",
          "20",
          "--connect-timeout",
          "10",
          "--max-time",
          "30",
          url,
        ],
        { encoding: "buffer", maxBuffer: 5 * 1024 * 1024 }
      );
      tile = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!tile) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`World Imagery tile ${zoom}/${y}/${x} failed on both hosts.`);
  }
  if (
    tile.length < 3 ||
    tile[0] !== 0xff ||
    tile[1] !== 0xd8 ||
    tile[2] !== 0xff
  ) {
    throw new Error(`World Imagery tile ${zoom}/${y}/${x} is not a JPEG.`);
  }
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, tile);
    await fs.rename(temporaryPath, cachePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  return tile;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function startInteractiveExport(): void {
  if (interactiveExportChild) return;
  interactiveExportStatus = {
    state: "running",
    frame: 0,
    frameCount: CLIP_CONTRACT.frameCount,
    outputName: path.basename(DEFAULT_OUTPUT),
    timestampOutputName: path.basename(DEFAULT_TIMESTAMP_OUTPUT),
  };
  const child = spawn(
    "pnpm",
    [
      "exec",
      "tsx",
      path.join(HERE, "render.mts"),
      "--output",
      DEFAULT_OUTPUT,
      "--timestamp-output",
      DEFAULT_TIMESTAMP_OUTPUT,
    ],
    {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  interactiveExportChild = child;
  let output = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-16_000);
    const matches = [
      ...output.matchAll(/WORLD_IMAGERY_REWIND_PROGRESS (\d+)\/(\d+)/g),
    ];
    const latest = matches.at(-1);
    if (latest) interactiveExportStatus.frame = Number(latest[1]);
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
  });
  child.once("error", (error) => {
    interactiveExportChild = null;
    interactiveExportStatus = {
      ...interactiveExportStatus,
      state: "error",
      message: error.message,
    };
  });
  child.once("close", async (code) => {
    interactiveExportChild = null;
    try {
      const [outputStat, timestampOutputStat] =
        code === 0
          ? await Promise.all([
              fs.stat(DEFAULT_OUTPUT),
              fs.stat(DEFAULT_TIMESTAMP_OUTPUT),
            ])
          : [null, null];
      if (!outputStat?.isFile() || !timestampOutputStat?.isFile()) {
        throw new Error(
          `Deterministic renderer exited ${code}: ${stderr.trim().slice(-2000)}`
        );
      }
      interactiveExportStatus = {
        state: "ready",
        frame: CLIP_CONTRACT.frameCount,
        frameCount: CLIP_CONTRACT.frameCount,
        outputName: path.basename(DEFAULT_OUTPUT),
        timestampOutputName: path.basename(DEFAULT_TIMESTAMP_OUTPUT),
      };
    } catch (error) {
      interactiveExportStatus = {
        ...interactiveExportStatus,
        state: "error",
        message: errorMessage(error),
      };
    }
  });
}

async function serveInteractiveExport(
  response: import("node:http").ServerResponse,
  track: string | null
): Promise<void> {
  if (interactiveExportStatus.state !== "ready") {
    response.statusCode = 409;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(interactiveExportStatus));
    return;
  }
  try {
    const outputPath =
      track === "timestamp" ? DEFAULT_TIMESTAMP_OUTPUT : DEFAULT_OUTPUT;
    const outputStat = await fs.stat(outputPath);
    response.statusCode = 200;
    response.setHeader("Content-Type", "video/quicktime");
    response.setHeader("Content-Length", String(outputStat.size));
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(outputPath)}"`
    );
    createReadStream(outputPath).pipe(response);
  } catch (error) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: errorMessage(error) }));
  }
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
    throw new Error("Could not reserve a loopback port for Vite.");
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

function sceneUrl(server: ViteDevServer, exportSurface: boolean): string {
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) throw new Error("The Vite server URL is unavailable.");
  return `${baseUrl}scene/index.html?autoplay=0&frame=0&ui=${exportSurface ? "0" : "1"}&track=globe`;
}

async function launchBrowser(headed: boolean): Promise<BrowserLaunch> {
  const args = [
    "--use-angle=metal",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
  ];
  try {
    return {
      browser: await chromium.launch({
        channel: "chrome",
        headless: !headed,
        args,
      }),
      channel: "chrome",
    };
  } catch (error) {
    process.stderr.write(
      `Chrome launch failed; trying bundled Chromium: ${errorMessage(error)}\n`
    );
    return {
      browser: await chromium.launch({ headless: !headed, args }),
      channel: "bundled-chromium",
    };
  }
}

async function runBrowserCapture(
  server: ViteDevServer,
  launch: BrowserLaunch,
  options: Options,
  source: SourceFingerprint
): Promise<void> {
  const page = await launch.browser.newPage({
    viewport: {
      width: CLIP_CONTRACT.width,
      height: CLIP_CONTRACT.height,
    },
    deviceScaleFactor: CLIP_CONTRACT.devicePixelRatio,
    reducedMotion: "reduce",
  });
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    const messageText = message.text();
    if (message.type() === "error") consoleErrors.push(messageText);
    if (messageText.startsWith("WORLD_IMAGERY_REWIND_PROGRESS ")) {
      process.stdout.write(`${messageText}\n`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const url = sceneUrl(server, true);
  const startedAt = Date.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORLD_IMAGERY_REWIND__: { ready: Promise<void> };
          }
        ).__WORLD_IMAGERY_REWIND__.ready
    );
    const diagnostics = await getDiagnostics(page);
    assertSceneContract(diagnostics);
    process.stdout.write(
      `WORLD_IMAGERY_REWIND_RENDERER ${JSON.stringify(diagnostics)}\n`
    );

    if (options.mode === "smoke") {
      await runSmoke(
        page,
        diagnostics,
        launch.channel,
        source,
        url,
        consoleErrors,
        pageErrors,
        startedAt
      );
      return;
    }

    if (options.mode === "timestamp") {
      await runTimestampRender(
        page,
        diagnostics,
        launch.channel,
        source,
        url,
        options.timestampOutput,
        options.frameCount,
        consoleErrors,
        pageErrors,
        startedAt
      );
      return;
    }

    await runFullRender(
      page,
      diagnostics,
      launch.channel,
      source,
      url,
      options.output,
      options.timestampOutput,
      options.frameCount,
      consoleErrors,
      pageErrors,
      startedAt
    );
  } finally {
    await page.close();
  }
}

async function runSmoke(
  page: Page,
  initialDiagnostics: SceneDiagnostics,
  browserChannel: BrowserLaunch["channel"],
  source: SourceFingerprint,
  url: string,
  consoleErrors: string[],
  pageErrors: string[],
  startedAt: number
): Promise<void> {
  const samples: Array<{ frame: FrameState; diagnostics: SceneDiagnostics }> =
    [];
  const screenshotPaths: string[] = [];

  for (let index = 0; index < SMOKE_FRAME_INDICES.length; index += 1) {
    const frameIndex = SMOKE_FRAME_INDICES[index];
    const frame = await setFrame(page, frameIndex);
    const diagnostics = await getDiagnostics(page);
    assertSceneContract(diagnostics);
    const screenshotPath = path.join(
      HERE,
      `fitness-smoke-${String(index + 1).padStart(2, "0")}-frame-${String(frameIndex).padStart(4, "0")}.png`
    );
    await page.screenshot({
      path: screenshotPath,
      type: "png",
      animations: "disabled",
    });
    screenshotPaths.push(screenshotPath);
    samples.push({ frame, diagnostics });
  }

  await createSmokeContactSheet(screenshotPaths);
  const hardware = hardwareStatus(initialDiagnostics.renderer);
  const evidence = {
    status: hardware === "PASS" ? "PASS" : "UNVERIFIED",
    lane: "local hardware browser and World Imagery tile smoke",
    generatedAt: new Date().toISOString(),
    command:
      "pnpm exec tsx rewind/render.mts --smoke",
    contract: buildTimelineManifest(source),
    source,
    serving: {
      kind: "ephemeral local Vite source server",
      urlShape: redactPort(url),
      runnerCheckout: REPO_ROOT,
      runnerHead: await gitHead(REPO_ROOT),
      runnerDirty: await gitDirty(REPO_ROOT),
    },
    browser: {
      channel: browserChannel,
      consoleErrors,
      pageErrors,
      initialDiagnostics,
    },
    samples,
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    verificationLanes: {
      typedTimelineContract: "PASS",
      localWebGl2FrameRender: initialDiagnostics.webgl2 ? "PASS" : "FAIL",
      hardwareAcceleratedGpu: hardware,
      worldImageryTiles:
        initialDiagnostics.tiles.layerLoaded &&
        initialDiagnostics.tiles.errors.length === 0
          ? "PASS"
          : "FAIL",
      localFitnessArchive:
        initialDiagnostics.data.status === "ready" &&
        initialDiagnostics.data.routeCount > 0
          ? "PASS"
          : "FAIL",
      encodedProResArtifact: "UNVERIFIED",
      soundtrackSync: "UNVERIFIED",
      endCreditAssembly: "UNVERIFIED",
      deployedProvider: "UNVERIFIED",
    },
  };
  await fs.writeFile(
    path.join(HERE, "evidence-fitness-smoke.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(
    `WORLD_IMAGERY_REWIND_SMOKE ${evidence.status} ${screenshotPaths.length} frames\n`
  );
}

async function runTimestampRender(
  page: Page,
  initialDiagnostics: SceneDiagnostics,
  browserChannel: BrowserLaunch["channel"],
  source: SourceFingerprint,
  url: string,
  timestampOutputPath: string,
  frameCount: number,
  consoleErrors: string[],
  pageErrors: string[],
  startedAt: number
): Promise<void> {
  await fs.mkdir(path.dirname(timestampOutputPath), { recursive: true });
  const temporaryTimestampOutputPath = temporaryMovPath(timestampOutputPath);
  await fs.rm(temporaryTimestampOutputPath, { force: true });

  try {
    const { firstState, lastState } = await captureBrowserTimestampProRes(
      page,
      temporaryTimestampOutputPath,
      frameCount
    );
    const [timestampProbe, timestampAlphaProbe] = await Promise.all([
      probeMov(temporaryTimestampOutputPath),
      probeTimestampAlpha(temporaryTimestampOutputPath),
    ]);
    assertTimestampMovContract(timestampProbe, frameCount);
    assertTimestampAlphaContract(timestampAlphaProbe);
    await fs.rename(temporaryTimestampOutputPath, timestampOutputPath);
    await extractTimestampEvidenceFrame(timestampOutputPath);

    const finalDiagnostics = await getDiagnostics(page);
    assertSceneContract(finalDiagnostics);
    const evidence = {
      status: frameCount === CLIP_CONTRACT.frameCount ? "PASS" : "UNVERIFIED",
      lane: "deterministic centered reverse-time captions encoded as a transparent ProRes 4444 timestamp track",
      generatedAt: new Date().toISOString(),
      timestampArtifact: path.relative(REPO_ROOT, timestampOutputPath),
      sampleFrameCount: frameCount,
      command: `pnpm exec tsx rewind/render.mts --timestamp-only --timestamp-output ${path.relative(REPO_ROOT, timestampOutputPath)}${frameCount === CLIP_CONTRACT.frameCount ? "" : ` --sample-frames ${frameCount}`}`,
      contract: buildTimelineManifest(source),
      timestampProbe,
      timestampAlphaProbe,
      source,
      serving: {
        kind: "ephemeral local Vite source server",
        urlShape: redactPort(url),
        runnerCheckout: REPO_ROOT,
        runnerHead: await gitHead(REPO_ROOT),
        runnerDirty: await gitDirty(REPO_ROOT),
      },
      browser: {
        channel: browserChannel,
        consoleErrors,
        pageErrors,
        initialDiagnostics,
        finalDiagnostics,
      },
      captionEvidence: { firstState, lastState },
      elapsedSeconds: (Date.now() - startedAt) / 1000,
      verificationLanes: {
        typedTimelineContract: "PASS",
        localCanvas2dAlphaRender: "PASS",
        encodedTimestampAlphaArtifact: "PASS",
        fullDurationMaster:
          frameCount === CLIP_CONTRACT.frameCount ? "PASS" : "UNVERIFIED",
        soundtrackSync: "UNVERIFIED",
      },
    };
    await fs.writeFile(
      path.join(HERE, "evidence-timestamp.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8"
    );
    process.stdout.write(
      `WORLD_IMAGERY_REWIND_TIMESTAMP_COMPLETE ${evidence.status} ${timestampOutputPath}\n`
    );
  } catch (error) {
    await Promise.all([
      fs.rm(temporaryTimestampOutputPath, { force: true }),
      fs.rm(`${temporaryTimestampOutputPath}.webm`, { force: true }),
    ]);
    throw error;
  }
}

async function runFullRender(
  page: Page,
  initialDiagnostics: SceneDiagnostics,
  browserChannel: BrowserLaunch["channel"],
  source: SourceFingerprint,
  url: string,
  outputPath: string,
  timestampOutputPath: string,
  frameCount: number,
  consoleErrors: string[],
  pageErrors: string[],
  startedAt: number
): Promise<void> {
  await Promise.all([
    fs.mkdir(path.dirname(outputPath), { recursive: true }),
    fs.mkdir(path.dirname(timestampOutputPath), { recursive: true }),
  ]);
  const temporaryOutputPath = temporaryMovPath(outputPath);
  const temporaryTimestampOutputPath = temporaryMovPath(timestampOutputPath);
  await Promise.all([
    fs.rm(temporaryOutputPath, { force: true }),
    fs.rm(temporaryTimestampOutputPath, { force: true }),
  ]);

  try {
    const { firstState, lastState } = await captureBrowserProRes(
      page,
      temporaryOutputPath,
      temporaryTimestampOutputPath,
      frameCount
    );
    const [probe, timestampProbe, timestampAlphaProbe] = await Promise.all([
      probeMov(temporaryOutputPath),
      probeMov(temporaryTimestampOutputPath),
      probeTimestampAlpha(temporaryTimestampOutputPath),
    ]);
    assertMovContract(probe, frameCount);
    assertTimestampMovContract(timestampProbe, frameCount);
    assertTimestampAlphaContract(timestampAlphaProbe);
    await Promise.all([
      fs.rename(temporaryOutputPath, outputPath),
      fs.rename(temporaryTimestampOutputPath, timestampOutputPath),
    ]);
    await Promise.all([
      extractEncodedEvidenceFrames(outputPath, frameCount),
      extractTimestampEvidenceFrame(timestampOutputPath),
    ]);

    const finalDiagnostics = await getDiagnostics(page);
    assertSceneContract(finalDiagnostics);
    const hardware = hardwareStatus(finalDiagnostics.renderer);
    const evidence = {
      status:
        hardware === "PASS" && frameCount === CLIP_CONTRACT.frameCount
          ? "PASS"
          : "UNVERIFIED",
      lane: "deterministic deck.gl canvas frames encoded as a clean ProRes HQ globe master plus a frame-matched transparent ProRes 4444 timestamp track",
      generatedAt: new Date().toISOString(),
      artifact: path.relative(REPO_ROOT, outputPath),
      timestampArtifact: path.relative(REPO_ROOT, timestampOutputPath),
      sampleFrameCount: frameCount,
      command: `pnpm exec tsx rewind/render.mts --output ${path.relative(REPO_ROOT, outputPath)} --timestamp-output ${path.relative(REPO_ROOT, timestampOutputPath)}${frameCount === CLIP_CONTRACT.frameCount ? "" : ` --sample-frames ${frameCount}`}`,
      contract: buildTimelineManifest(source),
      handoff:
        frameCount === CLIP_CONTRACT.frameCount
          ? buildHandoffManifest(source)
          : null,
      probe,
      timestampProbe,
      timestampAlphaProbe,
      source,
      serving: {
        kind: "ephemeral local Vite source server",
        urlShape: redactPort(url),
        runnerCheckout: REPO_ROOT,
        runnerHead: await gitHead(REPO_ROOT),
        runnerDirty: await gitDirty(REPO_ROOT),
      },
      browser: {
        channel: browserChannel,
        consoleErrors,
        pageErrors,
        initialDiagnostics,
        finalDiagnostics,
      },
      cameraEvidence: { firstState, lastState },
      elapsedSeconds: (Date.now() - startedAt) / 1000,
      verificationLanes: {
        typedTimelineContract: "PASS",
        localWebGl2FrameRender: finalDiagnostics.webgl2 ? "PASS" : "FAIL",
        hardwareAcceleratedGpu: hardware,
        worldImageryTiles:
          finalDiagnostics.tiles.layerLoaded &&
          finalDiagnostics.tiles.errors.length === 0
            ? "PASS"
            : "FAIL",
        localFitnessArchive:
          finalDiagnostics.data.status === "ready" &&
          finalDiagnostics.data.routeCount > 0
            ? "PASS"
            : "FAIL",
        encodedProResArtifact: "PASS",
        encodedTimestampAlphaArtifact: "PASS",
        fullDurationMaster:
          frameCount === CLIP_CONTRACT.frameCount ? "PASS" : "UNVERIFIED",
        soundtrackSync: "UNVERIFIED",
        endCreditAssembly: "UNVERIFIED",
        deployedProvider: "UNVERIFIED",
      },
    };
    await Promise.all([
      fs.writeFile(
        path.join(HERE, "evidence.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
        "utf8"
      ),
      fs.writeFile(
        path.join(HERE, "EVIDENCE.md"),
        renderEvidenceMarkdown(evidence),
        "utf8"
      ),
    ]);
    process.stdout.write(
      `WORLD_IMAGERY_REWIND_COMPLETE ${evidence.status} ${outputPath} ${timestampOutputPath}\n`
    );
  } catch (error) {
    await Promise.all([
      fs.rm(temporaryOutputPath, { force: true }),
      fs.rm(temporaryTimestampOutputPath, { force: true }),
      fs.rm(`${temporaryOutputPath}.mp4`, { force: true }),
      fs.rm(`${temporaryTimestampOutputPath}.webm`, { force: true }),
    ]);
    throw error;
  }
}

async function captureBrowserProRes(
  page: Page,
  outputPath: string,
  timestampOutputPath: string,
  frameCount: number
): Promise<{ firstState: FrameState; lastState: FrameState }> {
  const intermediatePath = `${outputPath}.mp4`;
  const timestampIntermediatePath = `${timestampOutputPath}.webm`;
  await Promise.all([
    fs.rm(intermediatePath, { force: true }),
    fs.rm(timestampIntermediatePath, { force: true }),
  ]);
  const downloadsPromise = collectDownloads(
    page,
    2,
    exportDownloadTimeoutMs(frameCount)
  );
  const statePromise = page.evaluate(
    (sampleFrameCount) =>
      (
        window as unknown as {
          __WORLD_IMAGERY_REWIND__: {
            encodeFastMedia(frameCount?: number): Promise<{
              firstState: FrameState;
              lastState: FrameState;
            }>;
          };
        }
      ).__WORLD_IMAGERY_REWIND__.encodeFastMedia(sampleFrameCount),
    frameCount
  );
  const [downloads, states] = await Promise.all([
    downloadsPromise,
    statePromise,
  ]);
  const globeDownload = downloads.find((download) =>
    download.suggestedFilename().endsWith(".mp4")
  );
  const timestampDownload = downloads.find((download) =>
    download.suggestedFilename().endsWith(".webm")
  );
  if (!globeDownload || !timestampDownload) {
    throw new Error(
      `Expected MP4 and WebM downloads, received: ${downloads
        .map((download) => download.suggestedFilename())
        .join(", ")}`
    );
  }
  await Promise.all([
    globeDownload.saveAs(intermediatePath),
    timestampDownload.saveAs(timestampIntermediatePath),
  ]);
  const encoder = proResEncoderForPlatform(process.platform);
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    intermediatePath,
    "-frames:v",
    String(frameCount),
    "-an",
    "-c:v",
    encoder.codec,
    "-profile:v",
    "3",
    "-pix_fmt",
    "yuv422p10le",
    "-vendor",
    "apl0",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    ...encoder.extraArgs,
    "-movflags",
    "+faststart",
    outputPath,
  ]);
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-c:v",
    "libvpx-vp9",
    "-i",
    timestampIntermediatePath,
    "-frames:v",
    String(frameCount),
    "-map",
    "0:v:0",
    "-an",
    "-c:v",
    TIMESTAMP_PRORES_PROFILE.codec,
    "-pix_fmt",
    TIMESTAMP_PRORES_PROFILE.pixelFormat,
    "-vendor",
    TIMESTAMP_PRORES_PROFILE.vendor,
    "-movflags",
    "+faststart",
    timestampOutputPath,
  ]);
  await Promise.all([
    fs.rm(intermediatePath, { force: true }),
    fs.rm(timestampIntermediatePath, { force: true }),
  ]);
  await setFrame(page, frameCount - 1, true);
  return states;
}

async function captureBrowserTimestampProRes(
  page: Page,
  timestampOutputPath: string,
  frameCount: number
): Promise<{ firstState: FrameState; lastState: FrameState }> {
  const timestampIntermediatePath = `${timestampOutputPath}.webm`;
  await fs.rm(timestampIntermediatePath, { force: true });
  const downloadsPromise = collectDownloads(
    page,
    1,
    exportDownloadTimeoutMs(frameCount)
  );
  const statePromise = page.evaluate(
    (sampleFrameCount) =>
      (
        window as unknown as {
          __WORLD_IMAGERY_REWIND__: {
            encodeTimestampMedia(frameCount?: number): Promise<{
              firstState: FrameState;
              lastState: FrameState;
            }>;
          };
        }
      ).__WORLD_IMAGERY_REWIND__.encodeTimestampMedia(sampleFrameCount),
    frameCount
  );
  const [downloads, states] = await Promise.all([
    downloadsPromise,
    statePromise,
  ]);
  const timestampDownload = downloads.find((download) =>
    download.suggestedFilename().endsWith(".webm")
  );
  if (!timestampDownload) {
    throw new Error(
      `Expected one WebM timestamp download, received: ${downloads
        .map((download) => download.suggestedFilename())
        .join(", ")}`
    );
  }
  await timestampDownload.saveAs(timestampIntermediatePath);
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-c:v",
    "libvpx-vp9",
    "-i",
    timestampIntermediatePath,
    "-frames:v",
    String(frameCount),
    "-map",
    "0:v:0",
    "-an",
    "-c:v",
    TIMESTAMP_PRORES_PROFILE.codec,
    "-pix_fmt",
    TIMESTAMP_PRORES_PROFILE.pixelFormat,
    "-vendor",
    TIMESTAMP_PRORES_PROFILE.vendor,
    "-movflags",
    "+faststart",
    timestampOutputPath,
  ]);
  await fs.rm(timestampIntermediatePath, { force: true });
  return states;
}

function collectDownloads(
  page: Page,
  count: number,
  timeoutMs: number
): Promise<Download[]> {
  return new Promise<Download[]>((resolve, reject) => {
    const downloads: Download[] = [];
    const timeout = setTimeout(() => {
      page.off("download", handleDownload);
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for ${count} export downloads.`
        )
      );
    }, timeoutMs);
    const handleDownload = (download: Download) => {
      downloads.push(download);
      if (downloads.length < count) return;
      clearTimeout(timeout);
      page.off("download", handleDownload);
      resolve(downloads);
    };
    page.on("download", handleDownload);
  });
}

async function captureScreenshotProRes(
  page: Page,
  outputPath: string
): Promise<{ firstState: FrameState; lastState: FrameState }> {
  const encoder = spawnEncoder(outputPath);
  let encoderFailure: Error | null = null;
  void encoder.done.catch((error) => {
    encoderFailure = error instanceof Error ? error : new Error(String(error));
  });
  let firstState = await setFrame(page, 0, false);
  let lastState = firstState;

  try {
    for (
      let frameIndex = 0;
      frameIndex < CLIP_CONTRACT.frameCount;
      frameIndex += 1
    ) {
      if (encoderFailure) throw encoderFailure;
      const state =
        frameIndex === 0 ? firstState : await setFrame(page, frameIndex, false);
      lastState = state;
      const frameImage = await page.screenshot({
        type: "png",
        animations: "disabled",
      });
      if (!encoder.child.stdin.write(frameImage)) {
        await new Promise<void>((resolve) =>
          encoder.child.stdin.once("drain", resolve)
        );
      }
      if (
        frameIndex === 0 ||
        (frameIndex + 1) % EXPORT_PROGRESS_INTERVAL_FRAMES === 0 ||
        frameIndex === CLIP_CONTRACT.frameCount - 1
      ) {
        process.stdout.write(
          `WORLD_IMAGERY_REWIND_PROGRESS ${frameIndex + 1}/${CLIP_CONTRACT.frameCount}\n`
        );
      }
    }
    encoder.child.stdin.end();
    await encoder.done;
    return { firstState, lastState };
  } catch (error) {
    encoder.child.stdin.destroy();
    if (encoder.child.exitCode === null) encoder.child.kill("SIGTERM");
    await encoder.done.catch(() => undefined);
    throw error;
  }
}

function spawnEncoder(outputPath: string): {
  child: ChildProcessWithoutNullStreams;
  done: Promise<void>;
} {
  const encoder = proResEncoderForPlatform(process.platform);
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
      String(CLIP_CONTRACT.fps),
      "-i",
      "pipe:0",
      "-frames:v",
      String(CLIP_CONTRACT.frameCount),
      "-an",
      "-c:v",
      encoder.codec,
      "-profile:v",
      "3",
      "-pix_fmt",
      "yuv422p10le",
      "-vendor",
      "apl0",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      ...encoder.extraArgs,
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
          new Error(
            `ffmpeg ProRes pipe exited ${code}: ${stderr.trim().slice(-4000)}`
          )
        );
    });
  });
  return { child, done };
}

async function setFrame(
  page: Page,
  frameIndex: number,
  settleTiles = true
): Promise<FrameState> {
  return page.evaluate(
    ({ index, settle }) =>
      (
        window as unknown as {
          __WORLD_IMAGERY_REWIND__: {
            setFrame(
              value: number,
              options?: { settleTiles?: boolean }
            ): Promise<FrameState>;
          };
        }
      ).__WORLD_IMAGERY_REWIND__.setFrame(index, { settleTiles: settle }),
    { index: frameIndex, settle: settleTiles }
  );
}

async function getDiagnostics(page: Page): Promise<SceneDiagnostics> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __WORLD_IMAGERY_REWIND__: { getStatus(): SceneDiagnostics };
      }
    ).__WORLD_IMAGERY_REWIND__.getStatus()
  );
}

function assertSceneContract(diagnostics: SceneDiagnostics): void {
  const failures: string[] = [];
  if (!diagnostics.ready) failures.push("scene not ready");
  if (!diagnostics.webgl2) failures.push("WebGL2 unavailable");
  if (diagnostics.data.status !== "ready") {
    failures.push(`fitness archive=${diagnostics.data.status}`);
  }
  if (diagnostics.data.routeCount < 1) {
    failures.push("fitness archive contains no routes");
  }
  const expectedPreloadedTiles = CLIP_CONTRACT.imagery.prefetchZooms.reduce(
    (total, zoom) => total + 4 ** zoom,
    0
  );
  if (diagnostics.tiles.preloaded !== expectedPreloadedTiles) {
    failures.push(`preloaded tiles=${diagnostics.tiles.preloaded}`);
  }
  if (!diagnostics.tiles.layerLoaded) failures.push("TileLayer not loaded");
  if (diagnostics.tiles.errors.length > 0) {
    failures.push(`tile errors=${diagnostics.tiles.errors.length}`);
  }
  if (
    diagnostics.canvas.clientWidth !== CLIP_CONTRACT.width ||
    diagnostics.canvas.clientHeight !== CLIP_CONTRACT.height
  ) {
    failures.push(
      `canvas=${diagnostics.canvas.clientWidth}x${diagnostics.canvas.clientHeight}`
    );
  }
  if (Math.abs(diagnostics.canvas.left) > 0.1) {
    failures.push(`canvas left=${diagnostics.canvas.left}`);
  }
  if (Math.abs(diagnostics.canvas.top) > 0.1) {
    failures.push(`canvas top=${diagnostics.canvas.top}`);
  }
  if (failures.length > 0) {
    throw new Error(`Scene contract failed: ${failures.join(", ")}`);
  }
}

async function writeManifests(source: SourceFingerprint): Promise<void> {
  await Promise.all([
    fs.writeFile(
      path.join(HERE, "timeline.json"),
      `${JSON.stringify(buildTimelineManifest(source), null, 2)}\n`,
      "utf8"
    ),
    fs.writeFile(
      path.join(HERE, "handoff.json"),
      `${JSON.stringify(buildHandoffManifest(source), null, 2)}\n`,
      "utf8"
    ),
  ]);
}

async function sourceFingerprint(): Promise<SourceFingerprint> {
  const [contents, head, status] = await Promise.all([
    fs.readFile(SOURCE_PATH),
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: SOURCE_WORKTREE }),
    execFileAsync("git", ["status", "--short"], { cwd: SOURCE_WORKTREE }),
  ]);
  return {
    worktree: SOURCE_WORKTREE,
    head: head.stdout.trim(),
    dirty: status.stdout.trim().length > 0,
    sourcePath: SOURCE_RELATIVE_PATH,
    sourceSha256: createHash("sha256").update(contents).digest("hex"),
  };
}

async function probeMov(filePath: string): Promise<Probe> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-show_entries",
      "stream=codec_type,codec_name,profile,codec_tag_string,width,height,avg_frame_rate,nb_read_frames,pix_fmt:format=duration,size",
      "-of",
      "json",
      filePath,
    ],
    { maxBuffer: 4 * 1024 * 1024 }
  );
  const parsed = JSON.parse(stdout) as {
    streams: Array<Record<string, string | number>>;
    format: Record<string, string>;
  };
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("ffprobe found no video stream.");
  const [numerator, denominator] = String(video.avg_frame_rate)
    .split("/")
    .map(Number);
  return {
    codecName: String(video.codec_name),
    profile: String(video.profile),
    codecTag: String(video.codec_tag_string),
    width: Number(video.width),
    height: Number(video.height),
    frameRate: numerator / denominator,
    frameCount: Number(video.nb_read_frames),
    pixelFormat: String(video.pix_fmt),
    durationSeconds: Number(parsed.format.duration),
    sizeBytes: Number(parsed.format.size),
    audioStreamCount: parsed.streams.filter(
      (stream) => stream.codec_type === "audio"
    ).length,
  };
}

async function probeTimestampAlpha(filePath: string): Promise<AlphaProbe> {
  const { stdout, stderr } = await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      filePath,
      "-vf",
      "alphaextract,signalstats,metadata=print:file=-",
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 4 * 1024 * 1024 }
  );
  const output = `${stdout}\n${stderr}`;
  const readMetric = (name: "YMIN" | "YMAX" | "YAVG"): number => {
    const match = output.match(
      new RegExp(`lavfi\\.signalstats\\.${name}=([0-9.]+)`, "u")
    );
    if (!match)
      throw new Error(`Timestamp alpha probe did not report ${name}.`);
    return Number(match[1]);
  };
  return {
    minimum: readMetric("YMIN"),
    maximum: readMetric("YMAX"),
    average: readMetric("YAVG"),
  };
}

function assertMovContract(probe: Probe, frameCount: number): void {
  const failures: string[] = [];
  if (probe.codecName !== "prores") failures.push(`codec=${probe.codecName}`);
  if (probe.profile !== "HQ") failures.push(`profile=${probe.profile}`);
  if (probe.codecTag !== "apch") failures.push(`tag=${probe.codecTag}`);
  if (
    probe.width !== CLIP_CONTRACT.width ||
    probe.height !== CLIP_CONTRACT.height
  ) {
    failures.push(`dimensions=${probe.width}x${probe.height}`);
  }
  if (probe.frameRate !== CLIP_CONTRACT.fps) {
    failures.push(`fps=${probe.frameRate}`);
  }
  if (probe.frameCount !== frameCount) {
    failures.push(`frames=${probe.frameCount}`);
  }
  if (probe.pixelFormat !== "yuv422p10le") {
    failures.push(`pix_fmt=${probe.pixelFormat}`);
  }
  if (
    Math.abs(probe.durationSeconds - frameCount / CLIP_CONTRACT.fps) > 0.001
  ) {
    failures.push(`duration=${probe.durationSeconds}`);
  }
  if (probe.audioStreamCount !== 0) {
    failures.push(`audio streams=${probe.audioStreamCount}`);
  }
  if (failures.length > 0) {
    throw new Error(`Encoded MOV contract failed: ${failures.join(", ")}`);
  }
}

function assertTimestampMovContract(probe: Probe, frameCount: number): void {
  const failures: string[] = [];
  if (probe.codecName !== "prores") failures.push(`codec=${probe.codecName}`);
  if (probe.profile !== "4444") failures.push(`profile=${probe.profile}`);
  if (probe.codecTag !== "ap4h") failures.push(`tag=${probe.codecTag}`);
  if (
    probe.width !== CLIP_CONTRACT.width ||
    probe.height !== CLIP_CONTRACT.height
  ) {
    failures.push(`dimensions=${probe.width}x${probe.height}`);
  }
  if (probe.frameRate !== CLIP_CONTRACT.fps) {
    failures.push(`fps=${probe.frameRate}`);
  }
  if (probe.frameCount !== frameCount) {
    failures.push(`frames=${probe.frameCount}`);
  }
  if (!/^yuva444p(?:10|12)le$/u.test(probe.pixelFormat)) {
    failures.push(`pix_fmt=${probe.pixelFormat}`);
  }
  if (
    Math.abs(probe.durationSeconds - frameCount / CLIP_CONTRACT.fps) > 0.001
  ) {
    failures.push(`duration=${probe.durationSeconds}`);
  }
  if (probe.audioStreamCount !== 0) {
    failures.push(`audio streams=${probe.audioStreamCount}`);
  }
  if (failures.length > 0) {
    throw new Error(`Timestamp MOV contract failed: ${failures.join(", ")}`);
  }
}

function assertTimestampAlphaContract(probe: AlphaProbe): void {
  if (
    !Number.isFinite(probe.minimum) ||
    !Number.isFinite(probe.maximum) ||
    !Number.isFinite(probe.average) ||
    probe.maximum - probe.minimum < 512
  ) {
    throw new Error(
      `Timestamp alpha contract failed: min=${probe.minimum}, max=${probe.maximum}, avg=${probe.average}`
    );
  }
}

async function extractEncodedEvidenceFrames(
  outputPath: string,
  frameCount: number
): Promise<void> {
  const lastFrame = frameCount - 1;
  const contactFrames = Array.from(
    new Set(
      [0, 0.2, 0.4, 0.6, 0.8, 1].map((ratio) => Math.round(lastFrame * ratio))
    )
  );
  await Promise.all([
    runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      outputPath,
      "-vf",
      "select=eq(n\\,0)",
      "-frames:v",
      "1",
      path.join(HERE, "first-frame.png"),
    ]),
    runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      outputPath,
      "-vf",
      `select=eq(n\\,${lastFrame})`,
      "-frames:v",
      "1",
      path.join(HERE, "last-frame.png"),
    ]),
    runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      outputPath,
      "-vf",
      `select=${contactFrames.map((frame) => `eq(n\\,${frame})`).join("+")},scale=640:360,tile=3x2:padding=2:margin=0:color=black`,
      "-frames:v",
      "1",
      path.join(HERE, "contact-sheet.png"),
    ]),
  ]);
}

async function extractTimestampEvidenceFrame(
  outputPath: string
): Promise<void> {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    outputPath,
    "-vf",
    "select=eq(n\\,0)",
    "-frames:v",
    "1",
    path.join(HERE, "timestamp-first-frame.png"),
  ]);
}

async function createSmokeContactSheet(paths: string[]): Promise<void> {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const filePath of paths) args.push("-i", filePath);
  args.push(
    "-filter_complex",
    "[0:v]scale=640:360[a];[1:v]scale=640:360[b];[2:v]scale=640:360[c];[3:v]scale=640:360[d];[4:v]scale=640:360[e];[5:v]scale=640:360[f];[a][b][c][d][e][f]xstack=inputs=6:layout=0_0|640_0|1280_0|0_360|640_360|1280_360:fill=black[out]",
    "-map",
    "[out]",
    "-frames:v",
    "1",
    path.join(HERE, "fitness-smoke-contact-sheet.png")
  );
  await runCommand("ffmpeg", args);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, {
    cwd: HERE,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function renderEvidenceMarkdown(evidence: {
  status: string;
  artifact: string;
  timestampArtifact: string;
  sampleFrameCount: number;
  command: string;
  probe: Probe;
  timestampProbe: Probe;
  timestampAlphaProbe: AlphaProbe;
  source: SourceFingerprint;
  browser: { finalDiagnostics: SceneDiagnostics };
  verificationLanes: Record<string, string>;
}): string {
  const lanes = Object.entries(evidence.verificationLanes)
    .map(([lane, status]) => `- **${lane}:** ${status}`)
    .join("\n");
  return (
    `# World Imagery Rewind evidence\n\n` +
    `- **Result:** ${evidence.status}\n` +
    `- **Artifact:** \`${evidence.artifact}\`\n` +
    `- **Timestamp track:** \`${evidence.timestampArtifact}\`\n` +
    `- **Encoded sample:** 1920x1080, 60 fps, ${evidence.sampleFrameCount} frames, ${(evidence.sampleFrameCount / CLIP_CONTRACT.fps).toFixed(3)} seconds\n` +
    `- **Globe codec:** ProRes 422 HQ, yuv422p10le, no audio\n` +
    `- **Timestamp codec:** ProRes 4444, ${evidence.timestampProbe.pixelFormat}, no audio\n` +
    `- **Timestamp alpha:** decoded range ${evidence.timestampAlphaProbe.minimum}–${evidence.timestampAlphaProbe.maximum}\n` +
    `- **Calendar:** 2026-09-06 -> 2023-01-01 in 32 editorial 42-day steps\n` +
    `- **Renderer:** ${String(evidence.browser.finalDiagnostics.renderer)}\n` +
    `- **Source hero:** \`${evidence.source.head}\`, ${evidence.source.dirty ? "dirty" : "clean"}, SHA-256 \`${evidence.source.sourceSha256}\`\n` +
    `- **Artifact bytes:** ${evidence.probe.sizeBytes}\n\n` +
    `Dates are editorial timing states. The current Esri World Imagery tiles are not represented as historical imagery. The clean MOV has no visible attribution; final-talk end-credit assembly remains independently gated.\n\n` +
    `## Verification lanes\n\n${lanes}\n\n` +
    `Reproduce with:\n\n\`\`\`sh\n${evidence.command}\n\`\`\`\n`
  );
}

function hardwareStatus(renderer: string | null): "PASS" | "UNVERIFIED" {
  return renderer && !/swiftshader|software/iu.test(renderer)
    ? "PASS"
    : "UNVERIFIED";
}

function temporaryMovPath(outputPath: string): string {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.rendering${parsed.ext}`);
}

function redactPort(url: string): string {
  return url.replace(/127\.0\.0\.1:\d+/u, "127.0.0.1:<ephemeral>");
}

async function gitHead(worktree: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: worktree,
  });
  return stdout.trim();
}

async function gitDirty(worktree: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["status", "--short"], {
    cwd: worktree,
  });
  return stdout.trim().length > 0;
}

async function waitForShutdown(server: ViteDevServer): Promise<void> {
  await new Promise<void>((resolve) => {
    const shutdown = () => resolve();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  await server.close();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`
  );
  process.exitCode = 1;
});
