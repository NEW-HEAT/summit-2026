import {execFile, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {build as viteBuild} from 'vite';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, '..');
const fps = 60;
const durationSeconds = 9.8;
const frameCount = Math.round(fps * durationSeconds);
const cameraLatitudeEnd = 36.72 + ((37.74 - 36.72) / 9.25) * durationSeconds;
const waterFieldSize = {width: 128, height: 72};
const requested4k = process.argv.includes('--4k');
const evidenceOnly = process.argv.includes('--evidence-only');
const smokeOnly = process.argv.includes('--smoke');
const stateSampleTimes = [0, 0.9, 1.4, 1.7, 2.3, 3.5, 4.15, 4.45, 4.625, 5.35, 6.55, 6.85, 7.15, 7.45, 7.8, 8.05, 8.25, 8.45, 8.65, 8.9, 9.1, 9.25, 9.42, 9.55, 9.7, 9.79, 9.8];
const apertureMaskStartSeconds = 7.15;
const apertureMaskEndSeconds = 8.05;
const pixelationStartSeconds = 8.05;
const pixelationEndSeconds = 9.42;
const finalPointPattern = [
  'OOOOOOOOOO',
  'OOOOOOOOOO',
  'OOOOOOOOOO',
  'OOOOOOOOOO',
  'OOOOOOOOOO'
];
const sizes = requested4k
  ? [
      {name: 'newheat-authorship-intro', width: 1920, height: 1080},
      {name: 'newheat-authorship-intro-4k', width: 3840, height: 2160}
    ]
  : [{name: 'newheat-authorship-intro', width: 1920, height: 1080}];

const sourcePaths = {
  world: path.join(here, 'cyclades-world-imagery.jpg'),
  flame: path.join(here, 'NH.gif'),
  deckScene: path.join(here, 'cyclades-deck-scene.mjs')
};

async function run(command, args, options = {}) {
  const {stdout, stderr} = await execFileAsync(command, args, {
    cwd: options.cwd || here,
    maxBuffer: 32 * 1024 * 1024
  });
  if (stderr && options.forwardStderr) process.stderr.write(stderr);
  return stdout;
}

async function runFfmpeg(args) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    forwardStderr: true
  });
}

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

async function buildDeckRuntime(tempRoot) {
  const outputDirectory = path.join(tempRoot, 'deck-runtime');
  await viteBuild({
    root: workspaceRoot,
    configFile: false,
    publicDir: false,
    logLevel: 'error',
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env': '{}'
    },
    build: {
      emptyOutDir: true,
      outDir: outputDirectory,
      lib: {
        entry: sourcePaths.deckScene,
        name: 'NewHeatCycladesDeck',
        formats: ['iife'],
        fileName: 'cyclades-deck-runtime'
      },
      rollupOptions: {
        output: {inlineDynamicImports: true}
      }
    }
  });
  return path.join(outputDirectory, 'cyclades-deck-runtime.iife.js');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function startAssetServer(tempRoot) {
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif'
  };
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const decodedPath = decodeURIComponent(requestUrl.pathname);
      const [prefix, ...segments] = decodedPath.split('/').filter(Boolean);
      const root = prefix === 'workspace'
        ? workspaceRoot
        : prefix === 'temp'
          ? tempRoot
          : null;
      if (!root) {
        response.writeHead(404).end('Not found');
        return;
      }
      const filePath = path.resolve(root, ...segments);
      if (!isInside(root, filePath)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const contents = await readFile(filePath);
      response.writeHead(200, {
        'content-type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      response.end(contents);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end('Asset error');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    pageUrl: `${baseUrl}/workspace/${path.relative(workspaceRoot, path.join(here, 'render.html'))}`,
    workspaceUrl: (filePath) =>
      `${baseUrl}/workspace/${path.relative(workspaceRoot, filePath).split(path.sep).join('/')}`,
    tempUrl: (filePath) =>
      `${baseUrl}/temp/${path.relative(tempRoot, filePath).split(path.sep).join('/')}`,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    )
  };
}

async function extractFlameFrames(tempRoot) {
  const framesDirectory = path.join(tempRoot, 'flame-frames');
  await mkdir(framesDirectory, {recursive: true});
  await runFfmpeg([
    '-y',
    '-i',
    sourcePaths.flame,
    '-fps_mode',
    'passthrough',
    '-q:v',
    '2',
    path.join(framesDirectory, 'flame-%03d.jpg')
  ]);
  const frames = (await readdir(framesDirectory))
    .filter((fileName) => fileName.endsWith('.jpg'))
    .sort()
    .map((fileName) => path.join(framesDirectory, fileName));
  if (frames.length !== 123) {
    throw new Error(`Expected 123 deterministic NH.gif frames; found ${frames.length}`);
  }
  return frames;
}

async function extractWaterField() {
  const {stdout} = await execFileAsync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourcePaths.world,
      '-vf',
      `scale=${waterFieldSize.width}:${waterFieldSize.height}:flags=area`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1'
    ],
    {
      cwd: here,
      encoding: 'buffer',
      maxBuffer: 8 * 1024 * 1024
    }
  );
  const baseScores = [];
  for (let index = 0; index < waterFieldSize.width * waterFieldSize.height; index += 1) {
    const red = stdout[index * 3];
    const green = stdout[index * 3 + 1];
    const blue = stdout[index * 3 + 2];
    const blueLead = Math.max(0, Math.min(1, (blue - red) / 72));
    const blueOverGreen = Math.max(0, Math.min(1, (blue - green + 34) / 58));
    const darkOcean = Math.max(0, Math.min(1, (138 - red) / 115));
    const vegetation = Math.max(0, Math.min(1, (green - blue - 2) / 55));
    baseScores.push(
      Math.max(
        0,
        Math.min(
          1,
          blueLead * 0.56 +
            blueOverGreen * 0.28 +
            darkOcean * 0.16 -
            vegetation * 0.72
        )
      )
    );
  }

  const scores = [];
  for (let y = 0; y < waterFieldSize.height; y += 1) {
    for (let x = 0; x < waterFieldSize.width; x += 1) {
      let minimum = 1;
      let sum = 0;
      let count = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(waterFieldSize.width - 1, x + offsetX));
          const sampleY = Math.max(0, Math.min(waterFieldSize.height - 1, y + offsetY));
          const value = baseScores[sampleY * waterFieldSize.width + sampleX];
          minimum = Math.min(minimum, value);
          sum += value;
          count += 1;
        }
      }
      const clearanceScore =
        baseScores[y * waterFieldSize.width + x] * 0.58 +
        (sum / count) * 0.22 +
        minimum * 0.2;
      scores.push(Math.round(clearanceScore * 255));
    }
  }
  return {...waterFieldSize, scores};
}

function frameForTime(timeSeconds) {
  return Math.round((timeSeconds / durationSeconds) * (frameCount - 1));
}

async function inspectStateSamples(browser, waterField, assetServer, deckBundlePath) {
  const page = await browser.newPage({
    viewport: {width: 1920, height: 1080},
    deviceScaleFactor: 1
  });
  try {
    await page.goto(`${assetServer.pageUrl}?offline=1`);
    await page.addScriptTag({path: deckBundlePath});
    await page.evaluate(
      async ({worldUrl, waterField: nextWaterField}) => {
        await window.configureNewHeatAuthorshipAssets({
          worldUrl,
          waterField: nextWaterField
        });
      },
      {
        worldUrl: assetServer.workspaceUrl(sourcePaths.world),
        waterField
      }
    );
    return await page.evaluate((times) =>
      times.map((timeSeconds) => window.inspectNewHeatAuthorshipState(timeSeconds)),
      stateSampleTimes
    );
  } finally {
    await page.close();
  }
}

async function renderSize(
  browser,
  size,
  tempRoot,
  flameFrames,
  waterField,
  assetServer,
  deckBundlePath
) {
  const outputPath = path.join(here, `${size.name}.mp4`);
  const temporaryOutputPath = path.join(here, `${size.name}.rendering.mp4`);
  await rm(temporaryOutputPath, {force: true});

  const page = await browser.newPage({
    viewport: {width: size.width, height: size.height},
    deviceScaleFactor: 1
  });
  await page.goto(`${assetServer.pageUrl}?offline=1`);
  await page.addScriptTag({path: deckBundlePath});
  await page.evaluate(
    async ({worldUrl, waterField: nextWaterField}) => {
      await window.configureNewHeatAuthorshipAssets({
        worldUrl,
        waterField: nextWaterField
      });
    },
    {
      worldUrl: assetServer.workspaceUrl(sourcePaths.world),
      waterField
    }
  );

  const states = await page.evaluate((times) =>
    times.map((timeSeconds) => window.inspectNewHeatAuthorshipState(timeSeconds)),
    stateSampleTimes
  );

  const encoder = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      '-frames:v',
      String(frameCount),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '14',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      temporaryOutputPath
    ],
    {cwd: here, stdio: ['pipe', 'ignore', 'pipe']}
  );
  let encoderStderr = '';
  encoder.stderr.on('data', (chunk) => {
    encoderStderr += chunk.toString();
  });
  const encoderDone = new Promise((resolve, reject) => {
    encoder.once('error', reject);
    encoder.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg image pipe failed (${code}): ${encoderStderr}`));
    });
  });
  const keyframePaths = new Map(
    size.name === 'newheat-authorship-intro'
      ? [
          [0, 'first-frame.png'],
          [frameForTime(0.9), 'keyframe-opening.png'],
          [frameForTime(1.4), 'keyframe-reveal-early.png'],
          [frameForTime(2.3), 'keyframe-reveal-late.png'],
          [frameForTime(3.5), 'keyframe-flame-route-lock.png'],
          [frameForTime(4.3), 'keyframe-clean-map-early.png'],
          [frameForTime(5.6), 'keyframe-clean-map.png'],
          [frameForTime(7.35), 'keyframe-mask-entry.png'],
          [frameForTime(8.05), 'keyframe-map-apertures.png'],
          [frameForTime(8.45), 'keyframe-map-deresolve.png'],
          [frameForTime(8.9), 'keyframe-palette-emergence.png'],
          [frameForTime(9.25), 'keyframe-palette-cooling.png'],
          [frameForTime(9.6), 'keyframe-point-transition.png'],
          [frameForTime(9.79), 'keyframe-final-checkpoint.png'],
          [frameCount - 1, 'last-frame.png']
        ]
      : []
  );

  try {
    for (let frame = 0; frame < frameCount; frame += 1) {
      const timeSeconds = durationSeconds * (frame / (frameCount - 1));
      const flameFrameIndex = Math.floor(timeSeconds * 10) % flameFrames.length;
      const flameUrl = assetServer.tempUrl(flameFrames[flameFrameIndex]);
      await page.evaluate(
        async ({timeSeconds: time, width, height, flameUrl: nextFlameUrl}) => {
          await window.renderNewHeatAuthorshipFrame({
            timeSeconds: time,
            width,
            height,
            flameUrl: nextFlameUrl
          });
        },
        {timeSeconds, width: size.width, height: size.height, flameUrl}
      );
      const framePng = await page.screenshot({type: 'png'});
      const keyframeFileName = keyframePaths.get(frame);
      if (keyframeFileName) await writeFile(path.join(here, keyframeFileName), framePng);
      if (!encoder.stdin.write(framePng)) {
        await new Promise((resolve) => encoder.stdin.once('drain', resolve));
      }
    }
    encoder.stdin.end();
    await encoderDone;
    await rename(temporaryOutputPath, outputPath);
    if (size.name === 'newheat-authorship-intro') {
      await runFfmpeg([
        '-y',
        '-ss',
        '9.79',
        '-i',
        outputPath,
        '-frames:v',
        '1',
        path.join(here, 'keyframe-final-checkpoint.png')
      ]);
      await runFfmpeg([
        '-y',
        '-ss',
        String(durationSeconds - 1 / fps),
        '-i',
        outputPath,
        '-frames:v',
        '1',
        path.join(here, 'last-frame.png')
      ]);
    }
  } catch (error) {
    encoder.stdin.destroy();
    encoder.kill('SIGTERM');
    await rm(temporaryOutputPath, {force: true});
    throw error;
  } finally {
    await page.close();
  }

  return {outputPath, states};
}

async function renderSmokeSheet(
  browser,
  tempRoot,
  flameFrames,
  waterField,
  assetServer,
  deckBundlePath
) {
  const page = await browser.newPage({
    viewport: {width: 1920, height: 1080},
    deviceScaleFactor: 1
  });
  const smokeDirectory = path.join(tempRoot, 'smoke-frames');
  await mkdir(smokeDirectory, {recursive: true});
  const sampleTimes = [1.4, 3.5, 4.3, 5.6, 7.35, 8.05, 8.45, 8.9, 9.35, 9.79];
  try {
    await page.goto(`${assetServer.pageUrl}?offline=1`);
    await page.addScriptTag({path: deckBundlePath});
    await page.evaluate(
      async ({worldUrl, waterField: nextWaterField}) => {
        await window.configureNewHeatAuthorshipAssets({
          worldUrl,
          waterField: nextWaterField
        });
      },
      {
        worldUrl: assetServer.workspaceUrl(sourcePaths.world),
        waterField
      }
    );
    for (let index = 0; index < sampleTimes.length; index += 1) {
      const timeSeconds = sampleTimes[index];
      const flameFrameIndex = Math.floor(timeSeconds * 10) % flameFrames.length;
      await page.evaluate(
        async ({timeSeconds: time, flameUrl}) => {
          await window.renderNewHeatAuthorshipFrame({
            timeSeconds: time,
            width: 1920,
            height: 1080,
            flameUrl
          });
        },
        {
          timeSeconds,
          flameUrl: assetServer.tempUrl(flameFrames[flameFrameIndex])
        }
      );
      await page.screenshot({
        type: 'png',
        path: path.join(smokeDirectory, `smoke-${String(index).padStart(2, '0')}.png`)
      });
    }
  } finally {
    await page.close();
  }
  const outputPath = path.join(here, 'cyclades-smoke-contact-sheet.png');
  await runFfmpeg([
    '-y',
    '-framerate',
    '1',
    '-start_number',
    '0',
    '-i',
    path.join(smokeDirectory, 'smoke-%02d.png'),
    '-vf',
    'scale=768:432,tile=5x2:padding=2:margin=0:color=black',
    '-frames:v',
    '1',
    outputPath
  ]);
  return outputPath;
}

async function probeVideo(videoPath) {
  const output = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,nb_frames,pix_fmt',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    videoPath
  ]);
  return JSON.parse(output);
}

function assertPreviewContract(probe) {
  const stream = probe.streams?.[0];
  const format = probe.format;
  const failures = [];
  if (stream?.codec_name !== 'h264') failures.push(`codec=${stream?.codec_name}`);
  if (stream?.width !== 1920 || stream?.height !== 1080) {
    failures.push(`dimensions=${stream?.width}x${stream?.height}`);
  }
  if (stream?.r_frame_rate !== '60/1') failures.push(`fps=${stream?.r_frame_rate}`);
  if (stream?.nb_frames !== String(frameCount)) failures.push(`frames=${stream?.nb_frames}`);
  if (stream?.pix_fmt !== 'yuv420p') failures.push(`pix_fmt=${stream?.pix_fmt}`);
  if (Math.abs(Number(format?.duration) - durationSeconds) > 0.0001) {
    failures.push(`duration=${format?.duration}`);
  }
  if (failures.length > 0) {
    throw new Error(`Rendered preview contract failed: ${failures.join(', ')}`);
  }
}

function assertSceneStateContract(states) {
  const failures = [];
  const first = states[0];
  const final = states.at(-1);
  if (first?.durationSeconds !== durationSeconds) failures.push(`duration=${first?.durationSeconds}`);
  if (first?.singleTripBurstCount !== 0) {
    failures.push(`singleTripBursts=${first?.singleTripBurstCount}`);
  }
  if (first?.routesPerBurst !== 0) failures.push(`routesPerBurst=${first?.routesPerBurst}`);
  if (first?.routeEventCount !== 7) failures.push(`routeEventCount=${first?.routeEventCount}`);
  if (first?.openingStandingRouteCount !== 0) {
    failures.push(`openingStandingRoutes=${first?.openingStandingRouteCount}`);
  }
  if (first?.openingFlowRouteCount !== 7) {
    failures.push(`openingFlowRoutes=${first?.openingFlowRouteCount}`);
  }
  if (first?.closingTransitionRouteCount !== 0) {
    failures.push(`closingTransitionRoutes=${first?.closingTransitionRouteCount}`);
  }
  if (first?.routeOriginProgression?.join('>') !== 'bottom-origin-flame-route') {
    failures.push(`originProgression=${first?.routeOriginProgression?.join('>')}`);
  }
  if (first?.singleTripBurstStartSeconds !== null) {
    failures.push(`singleTripBurstStart=${first?.singleTripBurstStartSeconds}`);
  }
  if (first?.routeBurstTravelSeconds !== 0) {
    failures.push(`routeBurstTravel=${first?.routeBurstTravelSeconds}`);
  }
  if (first?.routeBurstTrailSeconds !== 0) {
    failures.push(`routeBurstTrail=${first?.routeBurstTrailSeconds}`);
  }
  if (first?.transitionBurstRouteCount !== 0) {
    failures.push(`transitionBurstRoutes=${first?.transitionBurstRouteCount}`);
  }
  if (first?.singleTripBurstClearSeconds !== null) {
    failures.push(`singleTripBurstClear=${first?.singleTripBurstClearSeconds}`);
  }
  if (Math.abs(first?.pixelationToPointCycleSeconds - 1.75) > 1e-9) {
    failures.push(`pixelationToPointCycle=${first?.pixelationToPointCycleSeconds}`);
  }
  if (first?.apertureMaskStartSeconds !== apertureMaskStartSeconds) {
    failures.push(`apertureMaskStart=${first?.apertureMaskStartSeconds}`);
  }
  if (first?.apertureMaskEndSeconds !== apertureMaskEndSeconds) {
    failures.push(`apertureMaskEnd=${first?.apertureMaskEndSeconds}`);
  }
  if (first?.apertureMaskBeforePixelation !== true) {
    failures.push('apertureMaskBeforePixelation=false');
  }
  const midpoint = states.find((state) => state.timeSeconds === 4.625);
  if (midpoint?.cycleOffscreenIngressCount !== 0) {
    failures.push(`offscreenIngress=${midpoint?.cycleOffscreenIngressCount}:${JSON.stringify(midpoint?.cycleIngressSamples)}`);
  }
  if (midpoint?.cycleOffscreenExitCount !== 0) {
    failures.push(`offscreenExit=${midpoint?.cycleOffscreenExitCount}:${JSON.stringify(midpoint?.cycleExitSamples)}`);
  }
  if (first?.transitionOffscreenIngressCount !== 0) {
    failures.push(`transitionOffscreenIngress=${first?.transitionOffscreenIngressCount}`);
  }
  if (first?.transitionOffscreenExitCount !== 0) {
    failures.push(`transitionOffscreenExit=${first?.transitionOffscreenExitCount}`);
  }
  for (const sampleTime of [4.15, 4.45, 5.35, 6.55, 7.15, 8.45, 9.25]) {
    const sample = states.find((state) => state.timeSeconds === sampleTime);
    if (!sample || sample.activeRouteEvents?.length > 0 || sample.activeTripCount > 0) {
      failures.push(`unexpectedLateRoutes@${sampleTime}`);
    }
  }
  const beforeCircles = states.find((state) => state.timeSeconds === 6.85);
  const circlesOnMap = states.find((state) => state.timeSeconds === 7.8);
  if (beforeCircles?.orbCount !== 0) failures.push(`earlyOrbs=${beforeCircles?.orbCount}`);
  if (circlesOnMap?.orbCount !== 50 || circlesOnMap?.coarsePixelationProgress !== 0) {
    failures.push(
      `circleBeforePixelation=${circlesOnMap?.orbCount}/${circlesOnMap?.coarsePixelationProgress}`
    );
  }
  if (Math.abs(first?.cameraZoom - 8.45) > 1e-9) failures.push(`cameraZoom=${first?.cameraZoom}`);
  if (Math.abs(first?.cameraPanPosition?.[0] - 25.08) > 1e-9) {
    failures.push(`cameraLongitude=${first?.cameraPanPosition?.[0]}`);
  }
  if (Math.abs(first?.cameraPanPosition?.[1] - 36.72) > 1e-9) {
    failures.push(`cameraStartLatitude=${first?.cameraPanPosition?.[1]}`);
  }
  if (Math.abs(midpoint?.cameraPanPosition?.[1] - 37.23) > 1e-9) {
    failures.push(`cameraMidLatitude=${midpoint?.cameraPanPosition?.[1]}`);
  }
  if (Math.abs(final?.cameraPanPosition?.[1] - cameraLatitudeEnd) > 1e-9) {
    failures.push(`cameraEndLatitude=${final?.cameraPanPosition?.[1]}`);
  }
  if (first?.cameraViewType !== 'deck.gl MapView with orthographic Web Mercator projection') {
    failures.push(`cameraViewType=${first?.cameraViewType}`);
  }
  if (first?.deckRuntimeReady !== true) failures.push('deckRuntimeReady=false');
  if (!first?.deckLayerTypes?.includes('TripsLayer')) {
    failures.push(`deckLayerTypes=${first?.deckLayerTypes?.join(',')}`);
  }
  if (first?.tripLayerClass !== 'TripsLayer') {
    failures.push(`tripLayerClass=${first?.tripLayerClass}`);
  }
  if (first?.tripCoordinateSpace !== 'WGS84 longitude-latitude in deck.gl MapView') {
    failures.push(`tripCoordinateSpace=${first?.tripCoordinateSpace}`);
  }
  if (first?.exportShortcut !== 'E') failures.push(`exportShortcut=${first?.exportShortcut}`);
  if (first?.cycleTripPathCount !== 0) {
    failures.push(`cycleTripPathCount=${first?.cycleTripPathCount}`);
  }
  if (
    first?.openingFlowTrailSeconds?.initial !== 0.16 ||
    first?.openingFlowTrailSeconds?.resolved !== 0.06
  ) {
    failures.push(`openingFlowTrailSeconds=${JSON.stringify(first?.openingFlowTrailSeconds)}`);
  }
  if (first?.openingFlowPulseCountPerRoute !== 5) {
    failures.push(`openingFlowPulseCountPerRoute=${first?.openingFlowPulseCountPerRoute}`);
  }
  if (final?.orbCount !== 50) failures.push(`finalPoints=${final?.orbCount}`);
  if (final?.finalMode !== 'daft-punk-red-top-center-columns-contained-grid') {
    failures.push(`finalMode=${final?.finalMode}`);
  }
  if (final?.finalGridBounds?.x?.join(',') !== '0.05,0.95') {
    failures.push(`finalGridX=${final?.finalGridBounds?.x?.join(',')}`);
  }
  if (final?.finalGridBounds?.y?.join(',') !== '0.15,0.85') {
    failures.push(`finalGridY=${final?.finalGridBounds?.y?.join(',')}`);
  }
  if (Math.abs(final?.finalPointRadiusNormalized - 0.06076) > 1e-9) {
    failures.push(`finalPointRadius=${final?.finalPointRadiusNormalized}`);
  }
  if (final?.finalPointRadiusScale !== 0.98) {
    failures.push(`finalPointRadiusScale=${final?.finalPointRadiusScale}`);
  }
  if (final?.finalPolishSeconds?.join(',') !== '9.58,9.8') {
    failures.push(`finalPolishSeconds=${final?.finalPolishSeconds?.join(',')}`);
  }
  if (final?.finalPolishProgress !== 1) {
    failures.push(`finalPolishProgress=${final?.finalPolishProgress}`);
  }
  if (final?.finalPointOverflowCount !== 0) {
    failures.push(`finalPointOverflow=${final?.finalPointOverflowCount}`);
  }
  if (Object.values(final?.finalPointViewportMarginsPx || {}).some((margin) => margin < 0)) {
    failures.push(`finalPointMargins=${JSON.stringify(final?.finalPointViewportMarginsPx)}`);
  }
  if (first?.tripWaterMaskResolution?.join('x') !== '128x72') {
    failures.push(`tripWaterMaskResolution=${first?.tripWaterMaskResolution?.join('x')}`);
  }
  if (final?.finalPixelResolution?.join('x') !== '10x5') {
    failures.push(`finalPixelResolution=${final?.finalPixelResolution?.join('x')}`);
  }
  if (final?.pointTransitionProgress !== 1) {
    failures.push(`pointTransition=${final?.pointTransitionProgress}`);
  }
  if (final?.referenceSpotFadeSeconds?.join(',') !== '8.85,9.72') {
    failures.push(`referenceSpotFadeSeconds=${final?.referenceSpotFadeSeconds?.join(',')}`);
  }
  if (final?.referenceSpotFadeProgress !== 1) {
    failures.push(`referenceSpotFadeProgress=${final?.referenceSpotFadeProgress}`);
  }
  if (final?.referenceSpotIndices?.join(',') !== '0,1,2,3,4,5,6,7,8,9,14,15,24,25,34,35,44,45') {
    failures.push(`referenceSpotIndices=${final?.referenceSpotIndices?.join(',')}`);
  }
  if (final?.brighterCenterRedIndices?.join(',') !== '14,15,24,25,34,35') {
    failures.push(`brighterCenterRedIndices=${final?.brighterCenterRedIndices?.join(',')}`);
  }
  if (final?.brighterCenterRedLightness?.join(',') !== '0.31,0.33,0.36,0.34,0.35,0.37') {
    failures.push(`brighterCenterRedLightness=${final?.brighterCenterRedLightness?.join(',')}`);
  }
  if (JSON.stringify(final?.finalPointPattern) !== JSON.stringify(finalPointPattern)) {
    failures.push('finalPointPatternMismatch');
  }
  if (final?.authorshipVisible !== false) failures.push('wordmarkStillVisible');
  if (final?.singularHeroGlobe !== false) failures.push('singularHeroGlobe=true');
  if (failures.length > 0) {
    throw new Error(`Scene state contract failed: ${failures.join(', ')}`);
  }
}

async function writeEvidence({previewPath, previewProbe, states}) {
  assertSceneStateContract(states);
  const sourceSha = (await run('git', ['rev-parse', 'HEAD'], {cwd: workspaceRoot})).trim();
  const gitStatus = await run('git', ['status', '--short'], {cwd: workspaceRoot});
  const keyframes = {
    opening: path.join(here, 'keyframe-opening.png'),
    revealEarly: path.join(here, 'keyframe-reveal-early.png'),
    revealLate: path.join(here, 'keyframe-reveal-late.png'),
    flameRouteLock: path.join(here, 'keyframe-flame-route-lock.png'),
    cleanMapEarly: path.join(here, 'keyframe-clean-map-early.png'),
    cleanMap: path.join(here, 'keyframe-clean-map.png'),
    maskEntry: path.join(here, 'keyframe-mask-entry.png'),
    mapApertures: path.join(here, 'keyframe-map-apertures.png'),
    mapDeresolve: path.join(here, 'keyframe-map-deresolve.png'),
    paletteEmergence: path.join(here, 'keyframe-palette-emergence.png'),
    paletteCooling: path.join(here, 'keyframe-palette-cooling.png'),
    pointTransition: path.join(here, 'keyframe-point-transition.png'),
    finalCheckpoint: path.join(here, 'keyframe-final-checkpoint.png'),
    final: path.join(here, 'last-frame.png')
  };
  const keyframeDigests = Object.fromEntries(
    await Promise.all(
      Object.entries(keyframes).map(async ([name, filePath]) => [name, await sha256(filePath)])
    )
  );
  let visualReview = null;
  try {
    const candidate = JSON.parse(
      await readFile(path.join(here, 'visual-review.json'), 'utf8')
    );
    const hashesMatch = Object.entries(keyframeDigests).every(
      ([name, digest]) => candidate.keyframeDigests?.[name] === digest
    );
    if (candidate.status === 'PASS' && hashesMatch) visualReview = candidate;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const evidence = {
    status: 'PASS',
    visualReview: visualReview?.status || 'UNVERIFIED',
    visualReviewNotes: visualReview?.notes || null,
    runnerCheckout: workspaceRoot,
    sourceCheckoutSha: sourceSha,
    servingBuildSha: null,
    existingUnrelatedDirtyWorkPreserved: gitStatus.trim().length > 0,
    render: {
      output: path.relative(workspaceRoot, previewPath),
      codec: previewProbe.streams[0].codec_name,
      width: previewProbe.streams[0].width,
      height: previewProbe.streams[0].height,
      fps: previewProbe.streams[0].r_frame_rate,
      frames: Number(previewProbe.streams[0].nb_frames),
      durationSeconds: Number(previewProbe.format.duration),
      pixelFormat: previewProbe.streams[0].pix_fmt,
      sha256: await sha256(previewPath)
    },
    sourceAssets: {
      cycladesWorldImagery: {
        path: path.relative(workspaceRoot, sourcePaths.world),
        boundsWgs84: [22.8, 35.8, 27.5, 38.7],
        imageProjection: 'EPSG:3857 Web Mercator',
        dimensions: [3072, 3072],
        source: 'ArcGIS World Imagery export service',
        attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        sha256: await sha256(sourcePaths.world)
      },
      deckGlScene: {
        path: path.relative(workspaceRoot, sourcePaths.deckScene),
        deckGlVersion: '9.4.0-alpha.1',
        layers: ['CycladesBitmapLayer (BitmapLayer)', 'TripsLayer'],
        sha256: await sha256(sourcePaths.deckScene)
      },
      newHeatFlameGif: {
        path: path.relative(workspaceRoot, sourcePaths.flame),
        decodedFrames: 123,
        fps: 10,
        durationSeconds: 12.3,
        sha256: await sha256(sourcePaths.flame)
      }
    },
    deterministicSceneContract: {
      finalPointCount: 50,
      timelineSeconds: {
        flameToFlowingOceanRoutes: [0, 3.2],
        northOnlyCameraTravel: [0, durationSeconds],
        cleanRouteFreeMap: [4, 7.15],
        blackApertureMask: [7.15, 8.05],
        mapDeresolutionInsideApertures: [8.05, 9.42],
        pointPaletteBlend: [8.65, 9.8],
        pixelationToPointCycle: [8.05, 9.8],
        saturatedPointWall: [9.8, durationSeconds]
      },
      mapRegion: 'Cyclades, Greece, centered around Mykonos and neighboring islands',
      mapView: 'deck.gl MapView with orthographic Web Mercator projection',
      cameraModel: `fixed-rate northbound MapView travel at longitude 25.08, latitude 36.72 to ${cameraLatitudeEnd.toFixed(5)}, zoom 8.45, pitch 0, bearing 0 across the full ${durationSeconds.toFixed(1)} seconds`,
      openingFlowRouteCount: 7,
      openingStandingRouteCount: 0,
      openingFlowPulseCountPerRoute: 5,
      openingFlowTrailSeconds: {initial: 0.16, resolved: 0.06},
      singleTripBurstCount: 0,
      routesPerBurst: 0,
      cycleTripPathCount: 0,
      routeEventCount: 7,
      singleTripBurstStartSeconds: null,
      singleTripBurstClearSeconds: null,
      transitionBurstRouteCount: 0,
      closingTransitionRouteCount: 0,
      routeBurstTravelSeconds: 0,
      routeBurstTrailSeconds: 0,
      tripLayerClass: 'TripsLayer',
      tripTrailModel: 'the animated flame texture is progressively constrained to the same projected WGS84 corridors for five quick pulses per route, rendered as moving deck.gl TripsLayer heads with compact 0.16-to-0.06-second tails; the burst clears by about 3.2 seconds and no separate post-flame burst is scheduled',
      routeOriginProgression: ['bottom-origin-flame-route'],
      routeReferenceTimeModel: 'opening flame-origin TripsLayer paths remain attached to the active moving MapView',
      cycleOffscreenIngressCount: 0,
      cycleOffscreenExitCount: 0,
      tripGeometryModel: 'deterministic water-aware opening paths connecting named real Cyclades islands and offshore port approaches; not a scheduled-ferry dataset',
      tripGeometryRegeneratedPerRoute: false,
      tripCoordinateSpace: 'WGS84 longitude-latitude in deck.gl MapView',
      tripWaterFieldResolution: [128, 72],
      tripDestinations: ['named Cyclades island ports', 'cross-Aegean ferry corridors'],
      tripPalette: ['flame orange', 'ember red', 'deep electric blue', 'dark cyan', 'teal', 'blue-cooled green'],
      singleTripBurstSchedule: null,
      apertureMaskStartSeconds,
      apertureMaskEndSeconds,
      apertureMaskBeforePixelation: true,
      circleSourceModel: 'one black mask fades over the resolved moving MapView while 50 fixed circular holes preserve map detail; after the mask is complete, the geography inside those holes de-resolves into the cool wall, then resolves the supplied reference accents without circle growth, rims, or glow',
      pixelationStartSeconds,
      pixelationEndSeconds,
      pixelationToPointCycleSeconds: 1.75,
      finalPixelResolution: [10, 5],
      referenceSpotFadeSeconds: [8.85, 9.72],
      referenceSpotIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 24, 25, 34, 35, 44, 45],
      brighterCenterRedIndices: [14, 15, 24, 25, 34, 35],
      brighterCenterRedLightness: [0.31, 0.33, 0.36, 0.34, 0.35, 0.37],
      finalPalette: ['deep electric blue', 'dark cyan', 'teal', 'blue-cooled green', 'dark red', 'lavender white', 'periwinkle'],
      finalPointPattern,
      finalGridBounds: {x: [0.05, 0.95], y: [0.15, 0.85]},
      finalPolishSeconds: [9.58, 9.8],
      finalPointRadiusScale: 0.98,
      finalPointRadiusNormalized: 0.06076,
      finalPointZoomScale: Number((0.06076 / 0.054).toFixed(4)),
      finalPointOverflowCount: 0,
      finalPointViewportMarginsPx: {left: 30.38, right: 30.38, top: 96.38, bottom: 96.38},
      finalPaletteStructure: 'the entire top row is dark red except for its two white-lavender center points; the same two dead-center columns continue in dark red through the remaining four rows, while every other point stays in the blue-cyan-restrained-green family; during only the final 0.22 seconds, the circles resolve into bright matte diagonal color gradients with no radial highlight',
      finalCompositeModel: `the renderer-owned contained 5x10 wall arrives only on the completed ${durationSeconds.toFixed(1)}s final frame; during the last 0.22 seconds every circle eases to 98% of its prior size, preserving the accepted center and grid proportions while leaving 30.38px horizontal and 96.38px vertical minimum margins`,
      exportShortcut: 'E downloads the latest rendered MP4 from the live preview',
      wordmarkRemoved: true,
      circleTransitionIncluded: true,
      crosshairsIncluded: false,
      finalMode: 'daft-punk-red-top-center-columns-contained-grid',
      singularHeroGlobe: false,
      stateSamples: states
    },
    keyframeDigests,
    renderCommand: 'opening/render.sh'
  };
  await writeFile(path.join(here, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);

  const evidenceMarkdown = `# NEW HEAT Authorship evidence

Status: **PASS** for the deterministic offline render contract.

## Provenance

- Runner checkout: \`${workspaceRoot}\`
- Source checkout SHA: \`${sourceSha}\`
- Serving build SHA: not applicable; this is an offline code-native render
- Existing unrelated dirty work was preserved; no commit was created
- Reproduction command: \`opening/render.sh\`

## PASS

- \`newheat-authorship-intro.mp4\`: H.264, 1920×1080, yuv420p, 60 fps, ${frameCount} frames, ${durationSeconds.toFixed(2)} seconds.
- The scene consumes the checked-in 123-frame \`public/NH.gif\`, a cached 3072×3072 ArcGIS World Imagery export of the real Cyclades, and a bundled deck.gl 9.4 runtime. No NEW HEAT logo or wordmark is drawn.
- The basemap is rendered in an actual orthographic deck.gl \`MapView\`; all moving route geometry is rendered by actual \`TripsLayer\` instances over named Cyclades island coordinates around Mykonos. A 128×72 water field extracted from the cached imagery bends and smooths each island-to-island hop around land.
- During the first 3.2 seconds, the flame texture itself narrows into five quick pulses per route with compact 0.16-to-0.06-second tails projected along the same WGS84 corridors used by the opening \`TripsLayer\`. The burst clears while the real map finishes resolving underneath through 4.0 seconds, without long residual streaks.
- The MapView stays at longitude 25.08 and zoom 8.45 while latitude moves linearly north from 36.72 to ${cameraLatitudeEnd.toFixed(5)} across the full ${durationSeconds.toFixed(1)} seconds, preserving the previous fixed northbound speed with zero pitch/bearing and no easing slowdown.
- The flame-origin TripsLayer flow is the only route event. Its shortened burst clears by about 3.2 seconds while the opening map transition completes by 4.0 seconds; no separate post-flame release or late volley appears anywhere in the flyover or point transition.
- The opening paths remain geographically attached while the MapView travels north, then the route-free map holds cleanly for more than three seconds before abstraction begins.
- The cinematic ferry corridors connect real Cyclades island/port coordinates in WGS84 and remain geographically attached during camera travel. They are authored motion paths, not claims about current scheduled ferry service.
- The opening routes move from flame orange and ember red into deep electric blue, dark cyan, teal, and restrained blue-cooled green.
- From 7.15–8.05 seconds, one black mask fades over the still-resolved, still-moving MapView while 50 fixed circular holes preserve full map detail. The holes never grow, glow, or acquire outlines. After the mask is complete, the geography inside those apertures progressively de-resolves from 8.05–9.42 seconds and cools into the point palette from 8.65–9.8 seconds; the screenshot-aligned accent spots fade in smoothly from 8.85–9.72 seconds during that same handoff.
- The completed wall spans x=5–95% and y=15–85% of frame. During only the final 0.22 seconds, every point eases to 98% of its prior size, finishing at a 6.076%-of-height radius with at least 30.38px horizontal and 96.38px vertical clearance. In that same last-frame polish, each point resolves into one bright matte diagonal color gradient: the upper edge remains deeper, the broad middle stays luminous, and no radial highlight or separate crown overlay survives. The entire top row remains dark red except for its two white-lavender center points, those same two dead-center columns continue in red through every remaining row, and the six-point run at indices 14, 15, 24, 25, 34, and 35 lands substantially brighter than the bottom pair and surrounding top-row reds. Every other point retains the deep electric-blue, cyan, teal, and restrained-green family. No title text, glossy hot spots, or heavy rims are introduced.
- Pressing \`E\` in the live preview downloads the latest rendered \`newheat-authorship-intro.mp4\`.
- The sequence never resolves to a singular hero globe.
- Encoded preview SHA-256: \`${evidence.render.sha256}\`

## ${visualReview ? 'VISUAL PASS' : 'UNVERIFIED'}

${visualReview ? `- Visual inspection: **PASS** — ${visualReview.notes}\n- The review is pinned to the exact rendered keyframe digests in \`visual-review.json\`.` : '- Visual review is **UNVERIFIED** until the newly rendered keyframes and contact sheet are inspected.'}

## UNVERIFIED

- The downstream Daft Punk clip insertion and audio synchronization are **UNVERIFIED** and intentionally outside this export.
- Signed, deployed, hardware-browser, and venue-playback behavior remain **UNVERIFIED**.

## Asset provenance

- Cyclades map bounds, imagery source, attribution, and route-coordinate caveat: \`CYCLADES_MAP.md\`
- Cyclades World Imagery SHA-256: \`${evidence.sourceAssets.cycladesWorldImagery.sha256}\`
- deck.gl scene source SHA-256: \`${evidence.sourceAssets.deckGlScene.sha256}\`
- NEW HEAT flame GIF SHA-256: \`${evidence.sourceAssets.newHeatFlameGif.sha256}\`
`;
  await writeFile(path.join(here, 'EVIDENCE.md'), evidenceMarkdown);
}

if (smokeOnly) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'newheat-authorship-smoke-'));
  const deckBundlePath = await buildDeckRuntime(tempRoot);
  const assetServer = await startAssetServer(tempRoot);
  const browser = await chromium.launch({headless: true});
  try {
    const flameFrames = await extractFlameFrames(tempRoot);
    const waterField = await extractWaterField();
    assertSceneStateContract(await inspectStateSamples(
      browser,
      waterField,
      assetServer,
      deckBundlePath
    ));
    const outputPath = await renderSmokeSheet(
      browser,
      tempRoot,
      flameFrames,
      waterField,
      assetServer,
      deckBundlePath
    );
    process.stdout.write(`Rendered Cyclades smoke sheet at ${outputPath}\n`);
  } finally {
    await browser.close();
    await assetServer.close();
    await rm(tempRoot, {recursive: true, force: true});
  }
} else if (evidenceOnly) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'newheat-authorship-evidence-'));
  const deckBundlePath = await buildDeckRuntime(tempRoot);
  const assetServer = await startAssetServer(tempRoot);
  const browser = await chromium.launch({headless: true});
  try {
    const waterField = await extractWaterField();
    const previewPath = path.join(here, 'newheat-authorship-intro.mp4');
    const previewProbe = await probeVideo(previewPath);
    assertPreviewContract(previewProbe);
    await writeEvidence({
      previewPath,
      previewProbe,
      states: await inspectStateSamples(
        browser,
        waterField,
        assetServer,
        deckBundlePath
      )
    });
  } finally {
    await browser.close();
    await assetServer.close();
    await rm(tempRoot, {recursive: true, force: true});
  }
  process.stdout.write(`Refreshed evidence for ${durationSeconds.toFixed(2)}s render in ${here}\n`);
} else {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'newheat-authorship-'));
  const deckBundlePath = await buildDeckRuntime(tempRoot);
  const assetServer = await startAssetServer(tempRoot);
  const browser = await chromium.launch({headless: true});
  try {
    const flameFrames = await extractFlameFrames(tempRoot);
    const waterField = await extractWaterField();
    const rendered = [];
    for (const size of sizes) {
      rendered.push(await renderSize(
        browser,
        size,
        tempRoot,
        flameFrames,
        waterField,
        assetServer,
        deckBundlePath
      ));
    }

    const preview = rendered[0];
    await runFfmpeg([
      '-y',
      '-i',
      preview.outputPath,
      '-vf',
      'fps=1,scale=384:216,tile=5x2:padding=2:margin=0:color=black',
      '-frames:v',
      '1',
      path.join(here, 'contact-sheet.png')
    ]);

    const previewProbe = await probeVideo(preview.outputPath);
    assertPreviewContract(previewProbe);
    await writeEvidence({
      previewPath: preview.outputPath,
      previewProbe,
      states: preview.states
    });
  } finally {
    await browser.close();
    await assetServer.close();
    await rm(tempRoot, {recursive: true, force: true});
  }

  process.stdout.write(
    `Rendered ${frameCount} frames at ${fps} fps (${durationSeconds.toFixed(2)}s) in ${here}\n`
  );
}
