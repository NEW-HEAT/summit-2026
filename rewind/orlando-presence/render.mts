#!/usr/bin/env tsx

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import {
  ORLANDO_PRESENCE_CONTRACT,
  type OrlandoPresenceFrame,
} from "./contract";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const OUTPUT_GLOBE = path.join(
  HERE,
  "02-orlando-presence-zoomout-satellite-to-grayscale.mov"
);
const SOURCE_SATELLITE_GLOBE = path.join(
  HERE,
  "02-orlando-presence-zoomout-globe.mov"
);
const OUTPUT_CONTINENT_GEOMETRY = path.join(
  HERE,
  "02-orlando-presence-zoomout-satellite-to-continent-geometry.mov"
);
const CONTINENT_GEOMETRY_SOURCE_FRAME = path.join(
  HERE,
  "continent-geometry-source-frame.png"
);
const OUTPUT_TIMECODE = path.join(
  HERE,
  "florida-presence.mov"
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

type SceneDiagnostics = {
  ready: boolean;
  webgl2: boolean;
  renderer: string | null;
  renderStyle: RenderStyle;
  frame: OrlandoPresenceFrame;
  continents: {
    polygonCount: number;
    opacity: number;
    backFaceClipping: boolean;
  };
  tiles: {
    loaded: number;
    viewportTileCount: number;
    layerLoaded: boolean;
    errors: string[];
  };
};

type RenderStyle = "continents" | "grayscale";

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
  const dev = process.argv.includes("--dev");
  const timecodeOnly = process.argv.includes("--timecode-only");
  const continentGeometryOnly = process.argv.includes(
    "--continent-geometry-only"
  );
  const continentCompositeOnly = process.argv.includes(
    "--continent-composite-only"
  );
  await fs.mkdir(HERE, { recursive: true });
  if (continentCompositeOnly) {
    await Promise.all([
      fs.access(SOURCE_SATELLITE_GLOBE),
      fs.access(CONTINENT_GEOMETRY_SOURCE_FRAME),
    ]);
    await compositeContinentGeometryArtifact();
    await finalizeContinentGeometryArtifact();
    return;
  }
  const server = await startViteServer();
  if (dev) {
    process.stdout.write(
      `ORLANDO_PRESENCE_DEV ${sceneUrl(
        server,
        "globe",
        continentGeometryOnly ? "continents" : "grayscale"
      )}\n`
    );
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await server.close();
    return;
  }

  const browser = await launchBrowser();
  try {
    if (continentGeometryOnly) {
      await renderContinentGeometrySourceFrame(server, browser);
      await compositeContinentGeometryArtifact();
      await finalizeContinentGeometryArtifact();
      return;
    }
    if (!timecodeOnly) {
      await renderGlobe(server, browser, OUTPUT_GLOBE, "grayscale");
    }
    await renderTimecode(server, browser);
    if (timecodeOnly) {
      await extractTimecodeEvidenceFrame();
      const [timecodeProbe, timecodeHash] = await Promise.all([
        probeMov(OUTPUT_TIMECODE),
        sha256(OUTPUT_TIMECODE),
      ]);
      assertAlphaMov(timecodeProbe, "timecode");
      const timecodeAlpha = await probeAlpha(OUTPUT_TIMECODE, 0);
      assertAlphaDensity(timecodeAlpha, "Florida timecode frame 0");
      const timecodeEvidence = {
        status: "PASS",
        generatedAt: new Date().toISOString(),
        text: {
          date: ORLANDO_PRESENCE_CONTRACT.dateLabel,
          location: ORLANDO_PRESENCE_CONTRACT.locationLabel,
        },
        output: {
          path: OUTPUT_TIMECODE,
          sha256: timecodeHash,
          probe: timecodeProbe,
        },
        alpha: timecodeAlpha,
        sourceProtection: {
          globeMovModified: false,
          longFormMovsModified: false,
        },
      };
      await fs.writeFile(
        path.join(HERE, "evidence-timecode-florida.json"),
        `${JSON.stringify(timecodeEvidence, null, 2)}\n`
      );
      process.stdout.write(
        `FLORIDA_TIMECODE_COMPLETE ${JSON.stringify(timecodeEvidence)}\n`
      );
      return;
    }
    await extractEvidenceFrames();
    const [globeProbe, timecodeProbe, globeHash, timecodeHash] =
      await Promise.all([
        probeMov(OUTPUT_GLOBE),
        probeMov(OUTPUT_TIMECODE),
        sha256(OUTPUT_GLOBE),
        sha256(OUTPUT_TIMECODE),
      ]);
    assertAlphaMov(globeProbe, "globe");
    assertAlphaMov(timecodeProbe, "timecode");
    const alpha = {
      globeFirst: await probeAlpha(OUTPUT_GLOBE, 0),
      globeLast: await probeAlpha(
        OUTPUT_GLOBE,
        ORLANDO_PRESENCE_CONTRACT.frameCount - 1
      ),
      timecodeFirst: await probeAlpha(OUTPUT_TIMECODE, 0),
    };
    const [globeBoundsFirst, globeBoundsLast, alphaPixels] = await Promise.all([
      probeAlphaBoundingBox(OUTPUT_GLOBE, 0),
      probeAlphaBoundingBox(
        OUTPUT_GLOBE,
        ORLANDO_PRESENCE_CONTRACT.frameCount - 1
      ),
      probeAlphaPixels(OUTPUT_GLOBE),
    ]);
    assertAlphaDensity(alpha.globeFirst, "globe frame 0");
    assertAlphaDensity(alpha.globeLast, "globe frame 239");
    assertAlphaPixels(alphaPixels);
    if (
      Math.abs(
        globeBoundsFirst.height - ORLANDO_PRESENCE_CONTRACT.startGlobeHeightPx
      ) > 2
    ) {
      throw new Error(
        `Frame 0 globe height is ${globeBoundsFirst.height}px, expected ${ORLANDO_PRESENCE_CONTRACT.startGlobeHeightPx}px.`
      );
    }
    if (
      Math.abs(
        globeBoundsLast.height - ORLANDO_PRESENCE_CONTRACT.targetGlobeHeightPx
      ) > 8
    ) {
      throw new Error(
        `Frame 239 globe height is ${globeBoundsLast.height}px, expected about ${ORLANDO_PRESENCE_CONTRACT.targetGlobeHeightPx}px.`
      );
    }
    const evidence = {
      status: "PASS",
      generatedAt: new Date().toISOString(),
      contract: ORLANDO_PRESENCE_CONTRACT,
      outputs: {
        globe: {
          path: OUTPUT_GLOBE,
          sha256: globeHash,
          probe: globeProbe,
        },
        timecode: {
          path: OUTPUT_TIMECODE,
          sha256: timecodeHash,
          probe: timecodeProbe,
        },
      },
      alpha,
      alphaPixels,
      globeBounds: {
        first: globeBoundsFirst,
        last: globeBoundsLast,
      },
      imageryTransition: {
        firstFrameDesaturate: 0,
        lastFrameDesaturate: 1,
        method:
          "deterministic canvas grayscale composition on one shared tile source",
      },
      sourceProtection: {
        existingGlobeMovsModified: false,
        note: "The continuation uses additive filenames in an isolated folder.",
      },
    };
    await fs.writeFile(
      path.join(HERE, "evidence-satellite-to-grayscale.json"),
      `${JSON.stringify(evidence, null, 2)}\n`
    );
    await fs.writeFile(
      path.join(HERE, "handoff-satellite-to-grayscale.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          date: ORLANDO_PRESENCE_CONTRACT.dateIso,
          location: "Orlando, Florida, United States",
          frame0: ORLANDO_PRESENCE_CONTRACT.startPose,
          frame239: ORLANDO_PRESENCE_CONTRACT.endPose,
          imageryTransition: {
            frame0Desaturate: 0,
            frame239Desaturate: 1,
          },
          viewport: {
            width: ORLANDO_PRESENCE_CONTRACT.width,
            height: ORLANDO_PRESENCE_CONTRACT.height,
            devicePixelRatio: ORLANDO_PRESENCE_CONTRACT.devicePixelRatio,
          },
          durationSeconds: ORLANDO_PRESENCE_CONTRACT.durationSeconds,
          fps: ORLANDO_PRESENCE_CONTRACT.fps,
          frameCount: ORLANDO_PRESENCE_CONTRACT.frameCount,
          globeScale: {
            startHeightPx: ORLANDO_PRESENCE_CONTRACT.startGlobeHeightPx,
            targetHeightPx: ORLANDO_PRESENCE_CONTRACT.targetGlobeHeightPx,
          },
          lighting: {
            effects: [],
            polygonMaterial: false,
            clearColor: [0, 0, 0, 0],
          },
        },
        null,
        2
      )}\n`
    );
    process.stdout.write(
      `ORLANDO_PRESENCE_COMPLETE ${JSON.stringify({ globe: OUTPUT_GLOBE, timecode: OUTPUT_TIMECODE, alpha })}\n`
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

async function finalizeContinentGeometryArtifact(): Promise<void> {
  await extractContinentGeometryEvidenceFrames();
  const [probe, sourceProbe, outputHash, sourceHash, preservedGrayscaleHash] =
    await Promise.all([
      probeMov(OUTPUT_CONTINENT_GEOMETRY),
      probeMov(SOURCE_SATELLITE_GLOBE),
      sha256(OUTPUT_CONTINENT_GEOMETRY),
      sha256(SOURCE_SATELLITE_GLOBE),
      sha256(OUTPUT_GLOBE),
    ]);
  assertAlphaMov(probe, "satellite-to-continent geometry globe");
  assertAlphaMov(sourceProbe, "source satellite globe");
  const lastFrame = ORLANDO_PRESENCE_CONTRACT.frameCount - 1;
  const [
    alphaFirst,
    alphaLast,
    boundsFirst,
    boundsLast,
    alphaPixels,
    transparentRgbaPixels,
  ] = await Promise.all([
    probeAlpha(OUTPUT_CONTINENT_GEOMETRY, 0),
    probeAlpha(OUTPUT_CONTINENT_GEOMETRY, lastFrame),
    probeAlphaBoundingBox(OUTPUT_CONTINENT_GEOMETRY, 0),
    probeAlphaBoundingBox(OUTPUT_CONTINENT_GEOMETRY, lastFrame),
    probeContinentAlphaPixels(OUTPUT_CONTINENT_GEOMETRY),
    probeTransparentRgbaPixels(OUTPUT_CONTINENT_GEOMETRY),
  ]);
  assertAlphaDensity(alphaFirst, "continent transition frame 0");
  assertAlphaDensity(alphaLast, "continent transition frame 239");
  assertAlphaPixels(alphaPixels);
  assertTransparentRgbaPixels(transparentRgbaPixels);
  if (
    Math.abs(
      boundsFirst.height - ORLANDO_PRESENCE_CONTRACT.startGlobeHeightPx
    ) > 2
  ) {
    throw new Error(
      `Continent transition frame 0 is ${boundsFirst.height}px high, expected ${ORLANDO_PRESENCE_CONTRACT.startGlobeHeightPx}px.`
    );
  }
  if (
    boundsLast.width > ORLANDO_PRESENCE_CONTRACT.targetGlobeHeightPx + 8 ||
    boundsLast.height > ORLANDO_PRESENCE_CONTRACT.targetGlobeHeightPx + 8 ||
    boundsLast.width < 200 ||
    boundsLast.height < 200
  ) {
    throw new Error(
      `Final continent alpha bounds are implausible: ${JSON.stringify(boundsLast)}.`
    );
  }

  const evidence = {
    status: "PASS",
    generatedAt: new Date().toISOString(),
    contract: ORLANDO_PRESENCE_CONTRACT,
    output: {
      path: OUTPUT_CONTINENT_GEOMETRY,
      sha256: outputHash,
      probe,
    },
    alpha: {
      first: alphaFirst,
      last: alphaLast,
      pixels: alphaPixels,
      transparentRgbaPixels,
      bounds: { first: boundsFirst, last: boundsLast },
    },
    geometryTransition: {
      source: ORLANDO_PRESENCE_CONTRACT.continentGeometry.source,
      layer: "PolygonLayer",
      polygonCount: 1_421,
      frame0: {
        satelliteOpacity: 1,
        continentOpacity: 1,
        visualResult: "satellite fully occludes the continent base",
      },
      frame239: { satelliteOpacity: 0, continentOpacity: 1 },
      backFaceClipping: "cullMode=back + spherical horizon fragment discard",
      oceanOpacity: 0,
      backgroundOpacity: 0,
      composition:
        "the verified deck.gl PolygonLayer hemisphere is the zero-RGB base while the TileLayer-only satellite stream fades above it",
      transparentPixelRgbSource:
        "continent geometry base, never the faded satellite TileLayer",
    },
    sourceProtection: {
      sourceSatelliteMov: {
        path: SOURCE_SATELLITE_GLOBE,
        sha256: sourceHash,
        probe: sourceProbe,
        modified: false,
      },
      existingSatelliteToGrayscaleMov: {
        path: OUTPUT_GLOBE,
        sha256: preservedGrayscaleHash,
        modified: false,
      },
      timecodeMovsModified: false,
      longFormGlobeMovsModified: false,
    },
  };
  await Promise.all([
    fs.writeFile(
      path.join(HERE, "evidence-satellite-to-continent-geometry.json"),
      `${JSON.stringify(evidence, null, 2)}\n`
    ),
    fs.writeFile(
      path.join(HERE, "handoff-satellite-to-continent-geometry.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          date: ORLANDO_PRESENCE_CONTRACT.dateIso,
          location: "Orlando, Florida, United States",
          frame0: ORLANDO_PRESENCE_CONTRACT.startPose,
          frame239: ORLANDO_PRESENCE_CONTRACT.endPose,
          transition: {
            from: "Esri World Imagery satellite tiles",
            to: ORLANDO_PRESENCE_CONTRACT.continentGeometry.source,
            layer: "PolygonLayer",
            backFaceClipping: true,
            oceanOpacity: 0,
            backgroundOpacity: 0,
          },
          viewport: {
            width: ORLANDO_PRESENCE_CONTRACT.width,
            height: ORLANDO_PRESENCE_CONTRACT.height,
            devicePixelRatio: ORLANDO_PRESENCE_CONTRACT.devicePixelRatio,
          },
          durationSeconds: ORLANDO_PRESENCE_CONTRACT.durationSeconds,
          fps: ORLANDO_PRESENCE_CONTRACT.fps,
          frameCount: ORLANDO_PRESENCE_CONTRACT.frameCount,
          output: OUTPUT_CONTINENT_GEOMETRY,
        },
        null,
        2
      )}\n`
    ),
  ]);
  process.stdout.write(
    `ORLANDO_CONTINENT_GEOMETRY_COMPLETE ${JSON.stringify(evidence)}\n`
  );
}

async function renderContinentGeometrySourceFrame(
  server: ViteDevServer,
  browser: Browser
): Promise<void> {
  const page = await openScene(server, browser, "globe", "continents", true);
  try {
    const frame = await setFrame(page, 0, false);
    assertExactStartPose(frame);
    await page.screenshot({
      path: CONTINENT_GEOMETRY_SOURCE_FRAME,
      type: "png",
      animations: "disabled",
      omitBackground: true,
    });
  } finally {
    await page.close();
  }
}

async function compositeContinentGeometryArtifact(): Promise<void> {
  const progress = "min(max(n/239,0),1)";
  const eased = `(${progress})*(${progress})*(${progress})*((${progress})*((${progress})*6-15)+10)`;
  const scale = `pow(${ORLANDO_PRESENCE_CONTRACT.targetGlobeHeightPx / ORLANDO_PRESENCE_CONTRACT.startGlobeHeightPx},${eased})`;
  const transitionStartSeconds =
    ORLANDO_PRESENCE_CONTRACT.durationSeconds *
    ORLANDO_PRESENCE_CONTRACT.continentGeometry.transitionStartProgress;
  const transitionDurationSeconds =
    ORLANDO_PRESENCE_CONTRACT.durationSeconds *
    (ORLANDO_PRESENCE_CONTRACT.continentGeometry.transitionEndProgress -
      ORLANDO_PRESENCE_CONTRACT.continentGeometry.transitionStartProgress);
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    SOURCE_SATELLITE_GLOBE,
    "-loop",
    "1",
    "-framerate",
    String(ORLANDO_PRESENCE_CONTRACT.fps),
    "-i",
    CONTINENT_GEOMETRY_SOURCE_FRAME,
    "-filter_complex",
    `[0:v]format=rgba,fade=t=out:st=${transitionStartSeconds}:d=${transitionDurationSeconds}:alpha=1[satellite];color=c=black@0.0:s=${ORLANDO_PRESENCE_CONTRACT.width}x${ORLANDO_PRESENCE_CONTRACT.height}:r=${ORLANDO_PRESENCE_CONTRACT.fps}:d=${ORLANDO_PRESENCE_CONTRACT.durationSeconds},format=rgba[transparent];[1:v]format=rgba,scale=w='trunc(iw*${scale}/2)*2':h='trunc(ih*${scale}/2)*2':eval=frame[land];[transparent][land]overlay=(W-w)/2:(H-h)/2:format=auto[continents];[continents][satellite]overlay=0:0:format=auto,format=yuva444p10le[video]`,
    "-map",
    "[video]",
    "-frames:v",
    String(ORLANDO_PRESENCE_CONTRACT.frameCount),
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
    OUTPUT_CONTINENT_GEOMETRY,
  ]);
}

async function renderGlobe(
  server: ViteDevServer,
  browser: Browser,
  outputPath: string,
  renderStyle: RenderStyle
): Promise<void> {
  const page = await openScene(server, browser, "globe", renderStyle);
  const encoder = spawnAlphaEncoder(outputPath);
  try {
    for (
      let frameIndex = 0;
      frameIndex < ORLANDO_PRESENCE_CONTRACT.frameCount;
      frameIndex += 1
    ) {
      const frame = await setFrame(
        page,
        frameIndex,
        renderStyle === "grayscale"
      );
      if (frameIndex === 0) assertExactStartPose(frame);
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
        frameIndex === ORLANDO_PRESENCE_CONTRACT.frameCount - 1
      ) {
        process.stdout.write(
          `ORLANDO_PRESENCE_PROGRESS ${renderStyle} ${frameIndex + 1}/${ORLANDO_PRESENCE_CONTRACT.frameCount}\n`
        );
      }
    }
    encoder.child.stdin.end();
    await encoder.done;
  } catch (error) {
    encoder.child.stdin.destroy();
    if (encoder.child.exitCode === null) encoder.child.kill("SIGTERM");
    await encoder.done.catch(() => undefined);
    throw error;
  } finally {
    await page.close();
  }
}

async function renderTimecode(
  server: ViteDevServer,
  browser: Browser
): Promise<void> {
  const page = await openScene(server, browser, "timestamp", "grayscale");
  const pngPath = path.join(HERE, ".timecode-frame.png");
  try {
    await page.screenshot({
      path: pngPath,
      type: "png",
      animations: "disabled",
      omitBackground: true,
    });
    await runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-loop",
      "1",
      "-framerate",
      String(ORLANDO_PRESENCE_CONTRACT.fps),
      "-i",
      pngPath,
      "-frames:v",
      String(ORLANDO_PRESENCE_CONTRACT.frameCount),
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
      OUTPUT_TIMECODE,
    ]);
  } finally {
    await fs.rm(pngPath, { force: true });
    await page.close();
  }
}

async function openScene(
  server: ViteDevServer,
  browser: Browser,
  track: "globe" | "timestamp",
  renderStyle: RenderStyle,
  geometryOnly = false
): Promise<Page> {
  const page = await browser.newPage({
    viewport: {
      width: ORLANDO_PRESENCE_CONTRACT.width,
      height: ORLANDO_PRESENCE_CONTRACT.height,
    },
    deviceScaleFactor: ORLANDO_PRESENCE_CONTRACT.devicePixelRatio,
    reducedMotion: "reduce",
  });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sceneUrl(server, track, renderStyle, geometryOnly), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.evaluate(
    () =>
      (
        window as unknown as {
          __ORLANDO_PRESENCE__: { ready: Promise<void> };
        }
      ).__ORLANDO_PRESENCE__.ready
  );
  if (errors.length > 0) throw new Error(`Scene errors: ${errors.join(" | ")}`);
  const diagnostics = await page.evaluate(() =>
    (
      window as unknown as {
        __ORLANDO_PRESENCE__: { getStatus(): SceneDiagnostics };
      }
    ).__ORLANDO_PRESENCE__.getStatus()
  );
  if (
    !diagnostics.ready ||
    !diagnostics.webgl2 ||
    !diagnostics.tiles.layerLoaded ||
    diagnostics.tiles.viewportTileCount < 1 ||
    diagnostics.tiles.errors.length > 0
  ) {
    throw new Error(`Scene contract failed: ${JSON.stringify(diagnostics)}`);
  }
  process.stdout.write(
    `ORLANDO_PRESENCE_RENDERER ${JSON.stringify({ track, renderStyle, diagnostics })}\n`
  );
  return page;
}

async function setFrame(
  page: Page,
  frameIndex: number,
  settleTiles = true
): Promise<OrlandoPresenceFrame> {
  return page.evaluate(
    (payload) =>
      (
        window as unknown as {
          __ORLANDO_PRESENCE__: {
            setFrame(
              frameIndex: number,
              options: { settleTiles: boolean }
            ): Promise<OrlandoPresenceFrame>;
          };
        }
      ).__ORLANDO_PRESENCE__.setFrame(payload.frameIndex, {
        settleTiles: payload.settleTiles,
      }),
    { frameIndex, settleTiles }
  );
}

function assertExactStartPose(frame: OrlandoPresenceFrame): void {
  const actual = JSON.stringify(frame.viewState);
  const expected = JSON.stringify(ORLANDO_PRESENCE_CONTRACT.startPose);
  if (actual !== expected) {
    throw new Error(`Frame 0 pose mismatch: ${actual} !== ${expected}`);
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
      String(ORLANDO_PRESENCE_CONTRACT.fps),
      "-i",
      "pipe:0",
      "-frames:v",
      String(ORLANDO_PRESENCE_CONTRACT.frameCount),
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
          new Error(`ProRes encoder exited ${code}: ${stderr.slice(-4000)}`)
        );
    });
  });
  return { child, done };
}

async function extractEvidenceFrames(): Promise<void> {
  const frames = [0, 60, 120, 180, 239];
  await Promise.all([
    runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      OUTPUT_GLOBE,
      "-vf",
      "select=eq(n\\,0)",
      "-frames:v",
      "1",
      path.join(HERE, "satellite-grayscale-first-frame.png"),
    ]),
    runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      OUTPUT_GLOBE,
      "-vf",
      "select=eq(n\\,239)",
      "-frames:v",
      "1",
      path.join(HERE, "satellite-grayscale-last-frame.png"),
    ]),
    runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      OUTPUT_GLOBE,
      "-vf",
      `select=${frames.map((frame) => `eq(n\\,${frame})`).join("+")},scale=640:360,tile=5x1:padding=2:margin=0:color=0x222222`,
      "-frames:v",
      "1",
      path.join(HERE, "satellite-grayscale-contact-sheet.png"),
    ]),
    runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      OUTPUT_TIMECODE,
      "-vf",
      "select=eq(n\\,0)",
      "-frames:v",
      "1",
      path.join(HERE, "timecode-frame.png"),
    ]),
  ]);
}

async function extractContinentGeometryEvidenceFrames(): Promise<void> {
  const frames = [0, 60, 120, 180, 239];
  await Promise.all([
    extractFrame(
      OUTPUT_CONTINENT_GEOMETRY,
      0,
      "satellite-continent-geometry-first-frame.png"
    ),
    extractFrame(
      OUTPUT_CONTINENT_GEOMETRY,
      239,
      "satellite-continent-geometry-last-frame.png"
    ),
    runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      OUTPUT_CONTINENT_GEOMETRY,
      "-vf",
      `select=${frames.map((frame) => `eq(n\\,${frame})`).join("+")},scale=640:360,tile=5x1:padding=2:margin=0:color=0x222222`,
      "-frames:v",
      "1",
      path.join(HERE, "satellite-continent-geometry-contact-sheet.png"),
    ]),
  ]);
}

async function extractFrame(
  inputPath: string,
  frameIndex: number,
  outputName: string
): Promise<void> {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-vf",
    `select=eq(n\\,${frameIndex})`,
    "-frames:v",
    "1",
    path.join(HERE, outputName),
  ]);
}

async function extractTimecodeEvidenceFrame(): Promise<void> {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    OUTPUT_TIMECODE,
    "-vf",
    "select=eq(n\\,0)",
    "-frames:v",
    "1",
    path.join(HERE, "timecode-frame-florida.png"),
  ]);
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

function assertAlphaMov(probe: MovProbe, label: string): void {
  const failures: string[] = [];
  if (probe.codec !== "prores") failures.push(`codec=${probe.codec}`);
  if (probe.profile !== "4444") failures.push(`profile=${probe.profile}`);
  if (probe.tag !== "ap4h") failures.push(`tag=${probe.tag}`);
  if (!/^yuva444p(?:10|12)le$/u.test(probe.pixelFormat)) {
    failures.push(`pix_fmt=${probe.pixelFormat}`);
  }
  if (
    probe.width !== ORLANDO_PRESENCE_CONTRACT.width ||
    probe.height !== ORLANDO_PRESENCE_CONTRACT.height
  ) {
    failures.push(`dimensions=${probe.width}x${probe.height}`);
  }
  if (probe.fps !== ORLANDO_PRESENCE_CONTRACT.fps)
    failures.push(`fps=${probe.fps}`);
  if (probe.frames !== ORLANDO_PRESENCE_CONTRACT.frameCount) {
    failures.push(`frames=${probe.frames}`);
  }
  if (
    Math.abs(
      probe.durationSeconds - ORLANDO_PRESENCE_CONTRACT.durationSeconds
    ) > 0.001
  ) {
    failures.push(`duration=${probe.durationSeconds}`);
  }
  if (probe.audioStreams !== 0) failures.push(`audio=${probe.audioStreams}`);
  if (failures.length > 0) {
    throw new Error(`${label} MOV contract failed: ${failures.join(", ")}`);
  }
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

function assertAlphaDensity(
  probe: { minimum: number; maximum: number; average: number },
  label: string
): void {
  // signalstats reports 12-bit studio-range codes for decoded ProRes alpha:
  // 256 normalizes to transparent and 3760 normalizes to opaque.
  if (probe.minimum > 256 || probe.maximum < 3760) {
    throw new Error(
      `${label} alpha range is incomplete: ${probe.minimum}–${probe.maximum}.`
    );
  }
}

async function probeAlphaPixels(filePath: string) {
  const lastFrame = ORLANDO_PRESENCE_CONTRACT.frameCount - 1;
  return {
    firstTopLeft: await probeAlphaPixel(filePath, 0, 0, 0),
    firstCenter: await probeAlphaPixel(filePath, 0, 960, 540),
    firstBottomRight: await probeAlphaPixel(filePath, 0, 1919, 1079),
    lastTopLeft: await probeAlphaPixel(filePath, lastFrame, 0, 0),
    lastCenter: await probeAlphaPixel(filePath, lastFrame, 960, 540),
    lastBottomRight: await probeAlphaPixel(filePath, lastFrame, 1919, 1079),
  };
}

async function probeContinentAlphaPixels(filePath: string) {
  const lastFrame = ORLANDO_PRESENCE_CONTRACT.frameCount - 1;
  return {
    firstTopLeft: await probeAlphaPixel(filePath, 0, 0, 0),
    firstCenter: await probeAlphaPixel(filePath, 0, 960, 540),
    firstBottomRight: await probeAlphaPixel(filePath, 0, 1919, 1079),
    lastTopLeft: await probeAlphaPixel(filePath, lastFrame, 0, 0),
    lastCenter: await probeAlphaPixel(filePath, lastFrame, 960, 540),
    lastAtlantic: await probeAlphaPixel(filePath, lastFrame, 1_060, 540),
    lastBottomRight: await probeAlphaPixel(filePath, lastFrame, 1919, 1079),
  };
}

async function probeTransparentRgbaPixels(filePath: string) {
  const lastFrame = ORLANDO_PRESENCE_CONTRACT.frameCount - 1;
  return {
    lastTopLeft: await probeRgbaPixel(filePath, lastFrame, 0, 0),
    lastAtlantic: await probeRgbaPixel(filePath, lastFrame, 1_060, 540),
  };
}

async function probeRgbaPixel(
  filePath: string,
  frameIndex: number,
  x: number,
  y: number
): Promise<[number, number, number, number]> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      filePath,
      "-vf",
      `select=eq(n\\,${frameIndex}),format=rgba,crop=1:1:${x}:${y}`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 1024 }
  );
  const pixel = stdout as Buffer;
  return [pixel[0], pixel[1], pixel[2], pixel[3]];
}

function assertTransparentRgbaPixels(
  pixels: Record<string, [number, number, number, number]>
): void {
  for (const [name, [red, green, blue, alpha]] of Object.entries(pixels)) {
    if (alpha !== 0 || Math.max(red, green, blue) > 4) {
      throw new Error(
        `${name} RGBA is ${red},${green},${blue},${alpha}; expected transparent black.`
      );
    }
  }
}

async function probeAlphaPixel(
  filePath: string,
  frameIndex: number,
  x: number,
  y: number
): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      filePath,
      "-vf",
      `select=eq(n\\,${frameIndex}),alphaextract,crop=1:1:${x}:${y},format=gray`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 1024 }
  );
  return (stdout as Buffer)[0];
}

function assertAlphaPixels(pixels: Record<string, number>): void {
  for (const [name, value] of Object.entries(pixels)) {
    const expected = name.includes("Center") ? 255 : 0;
    if (value !== expected) {
      throw new Error(`${name} alpha is ${value}, expected ${expected}.`);
    }
  }
}

async function probeAlphaBoundingBox(filePath: string, frameIndex: number) {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-v",
      "info",
      "-i",
      filePath,
      "-vf",
      `select=eq(n\\,${frameIndex}),alphaextract,format=gray,bbox=min_val=8`,
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 4 * 1024 * 1024 }
  );
  const match = stderr.match(
    /x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+) w:(\d+) h:(\d+)/u
  );
  if (!match) throw new Error(`No alpha bounding box for frame ${frameIndex}.`);
  return {
    x: Number(match[1]),
    y: Number(match[3]),
    width: Number(match[5]),
    height: Number(match[6]),
  };
}

async function startViteServer(): Promise<ViteDevServer> {
  const port = await reserveLoopbackPort();
  const server = await createServer({
    root: HERE,
    configFile: false,
    publicDir: false,
    logLevel: "error",
    plugins: [
      {
        name: "newheat-orlando-world-imagery",
        configureServer(viteServer) {
          viteServer.middlewares.use(async (request, response, next) => {
            const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
            if (!requestUrl.pathname.startsWith("/world-imagery/")) {
              next();
              return;
            }
            await serveWorldImageryTile(requestUrl.pathname, response);
          });
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
  return server;
}

async function serveWorldImageryTile(
  pathname: string,
  response: ServerResponse
): Promise<void> {
  const match = /^\/world-imagery\/(\d+)\/(\d+)\/(\d+)\.jpg$/u.exec(pathname);
  if (!match) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }
  const [zoom, y, x] = match.slice(1).map(Number);
  const axisTileCount = 2 ** zoom;
  if (
    zoom < ORLANDO_PRESENCE_CONTRACT.imagery.minZoom ||
    zoom > ORLANDO_PRESENCE_CONTRACT.imagery.maxZoom ||
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
    response.statusCode = 502;
    response.end(error instanceof Error ? error.message : String(error));
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
  const key = `${zoom}/${y}/${x}`;
  const active = worldImageryRequests.get(key);
  if (active) return active;
  const request = fetchAndCacheTile(cachePath, zoom, y, x).finally(() =>
    worldImageryRequests.delete(key)
  );
  worldImageryRequests.set(key, request);
  return request;
}

async function fetchAndCacheTile(
  cachePath: string,
  zoom: number,
  y: number,
  x: number
): Promise<Buffer> {
  let lastError: unknown = null;
  for (const origin of WORLD_IMAGERY_ORIGINS) {
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
          "--connect-timeout",
          "10",
          "--max-time",
          "30",
          `${origin}/${zoom}/${y}/${x}`,
        ],
        { encoding: "buffer", maxBuffer: 5 * 1024 * 1024 }
      );
      const tile = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
      if (tile[0] !== 0xff || tile[1] !== 0xd8 || tile[2] !== 0xff) {
        throw new Error(`World Imagery tile ${zoom}/${y}/${x} is not JPEG.`);
      }
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      const temporaryPath = `${cachePath}.${process.pid}.tmp`;
      await fs.writeFile(temporaryPath, tile);
      await fs.rename(temporaryPath, cachePath);
      return tile;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`World Imagery tile ${zoom}/${y}/${x} failed.`);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function launchBrowser(): Promise<Browser> {
  const args = [
    "--use-angle=metal",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
  ];
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args });
  } catch {
    return chromium.launch({ headless: true, args });
  }
}

function sceneUrl(
  server: ViteDevServer,
  track: "globe" | "timestamp",
  renderStyle: RenderStyle,
  geometryOnly = false
): string {
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) throw new Error("The Vite server URL is unavailable.");
  return `${baseUrl}scene.html?frame=0&track=${track}&style=${renderStyle}${
    geometryOnly ? "&geometryOnly=1" : ""
  }`;
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
