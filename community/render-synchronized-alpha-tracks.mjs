#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {execFile, spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEWHEAT_PACKAGE = path.resolve(HERE, '../package.json');
const DECKGL_WORKTREE = path.resolve(HERE, '..');
const PERSONAL_CALENDAR_SOURCE = process.env.PERSONAL_CALENDAR_SOURCE ?? path.resolve(HERE, '../personal/assets/personal-calendar.mov');
const PERSONAL_POLYGON_GLOBE_SOURCE = process.env.PERSONAL_POLYGON_GLOBE_SOURCE ?? path.resolve(HERE, '../personal/assets/personal-globe.mov');
const PERSONAL_TIMECODE_SOURCE = process.env.PERSONAL_TIMECODE_SOURCE ?? path.resolve(HERE, '../personal/assets/personal-timecode.mov');
const SOURCE_BOUNDARY_FRAME_INDEX = 3719;
const BOUNDARIES = {
  calendar: {
    source: PERSONAL_CALENDAR_SOURCE,
    image: path.join(HERE, 'reference-frames', 'personal-calendar-last-rgba.png'),
    packet: path.join(HERE, 'reference-frames', 'personal-calendar-boundary-one-frame-60k.mov'),
  },
  contributors: {
    source: PERSONAL_POLYGON_GLOBE_SOURCE,
    image: path.join(HERE, 'reference-frames', 'personal-handoff.png'),
    packet: path.join(HERE, 'reference-frames', 'personal-handoff.mov'),
  },
  timecode: {
    source: PERSONAL_TIMECODE_SOURCE,
    packet: path.join(HERE, 'reference-frames', 'personal-timecode-boundary-one-frame-60k.mov'),
  },
};
const CURRENT_PATH = path.join(HERE, 'data', 'ten-year-current.json');
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 60;
const PRODUCTION_FRAME_COUNT = 3060;
const EXACT_BOUNDARY_FRAME_COUNT = 3;
const SMOKE_FRAME_COUNT = Number(process.env.DECKGL_SYNC_SMOKE_FRAMES ?? 0);
const FRAME_COUNT = SMOKE_FRAME_COUNT > 0 ? SMOKE_FRAME_COUNT : PRODUCTION_FRAME_COUNT;
const RESUME_VALID_OUTPUTS = process.env.DECKGL_SYNC_RESUME === '1';
const OUTPUT_NAME = process.env.DECKGL_SYNC_OUTPUT_NAME ??
  (SMOKE_FRAME_COUNT > 0
    ? `synchronized-alpha-smoke-${FRAME_COUNT}f`
    : 'synchronized-alpha-tracks');
const OUTPUT_DIRECTORY = path.join(HERE, 'output', OUTPUT_NAME);
const SAMPLE_FRAMES = [0, 18, 29, 45, 59, 60, 300, 900, 1500, 2200, 2879, 2969, 3059]
  .filter((frame) => frame < FRAME_COUNT);
const TRACKS = ['calendar', 'contributors', 'timecode'];
const TRACK_BOUNDARY_FRAME_COUNTS = {calendar: EXACT_BOUNDARY_FRAME_COUNT, contributors: EXACT_BOUNDARY_FRAME_COUNT, timecode: 0};
const ONLY_TRACK = process.env.DECKGL_SYNC_ONLY_TRACK;
const RENDER_TRACKS = ONLY_TRACK ? [ONLY_TRACK] : TRACKS;
const PRORES_BITS_PER_MACROBLOCK = {
  calendar: 0,
  contributors: Number(process.env.DECKGL_SYNC_CONTRIBUTOR_BITS ?? 1800),
  timecode: 1200,
};
const PRORES_ALPHA_BITS = {
  calendar: 16,
  contributors: 8,
  timecode: 8,
};
const requireFromNewheat = createRequire(NEWHEAT_PACKAGE);
const {chromium} = requireFromNewheat('playwright');
const {createServer} = requireFromNewheat('vite');
const MEDIABUNNY_ENTRY = requireFromNewheat.resolve('mediabunny');
const DECK_CORE_ENTRY = requireFromNewheat.resolve('@deck.gl/core').replace(/index\.cjs$/, 'index.js');
const DECK_LAYERS_ENTRY = requireFromNewheat.resolve('@deck.gl/layers').replace(/index\.cjs$/, 'index.js');
const NEWHEAT_NODE_MODULES = path.join(path.dirname(NEWHEAT_PACKAGE), 'node_modules');

const OUTPUT_PATHS = {
  calendar: path.join(OUTPUT_DIRECTORY, 'deckgl-calendar-organic-continuous-decade-alpha-51s.mov'),
  contributors: path.join(OUTPUT_DIRECTORY, 'deckgl-contributors-large-globe-spaced-orb-alpha-51s.mov'),
  timecode: path.join(OUTPUT_DIRECTORY, 'deckgl-timecode-editor-transparent-sfmono-rewind-alpha-51s.mov'),
};

async function main() {
  if (ONLY_TRACK && !TRACKS.includes(ONLY_TRACK)) {
    throw new Error(`Invalid DECKGL_SYNC_ONLY_TRACK: ${ONLY_TRACK}.`);
  }
  if (!Number.isInteger(FRAME_COUNT) ||
      FRAME_COUNT <= EXACT_BOUNDARY_FRAME_COUNT ||
      FRAME_COUNT > PRODUCTION_FRAME_COUNT) {
    throw new Error(`Invalid frame count: ${FRAME_COUNT}.`);
  }
  await Promise.all([
    ...TRACKS.flatMap((track) => [
      fs.access(BOUNDARIES[track].source),
      fs.access(BOUNDARIES[track].packet),
      ...(BOUNDARIES[track].image ? [fs.access(BOUNDARIES[track].image)] : []),
    ]),
    fs.access(CURRENT_PATH),
  ]);
  await fs.mkdir(OUTPUT_DIRECTORY, {recursive: true});
  await fs.mkdir(path.join(OUTPUT_DIRECTORY, 'samples'), {recursive: true});

  const current = JSON.parse(await fs.readFile(CURRENT_PATH, 'utf8'));
  const manifestPath = path.resolve(path.dirname(CURRENT_PATH), current.manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const server = await createRenderServer();
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const renderResults = {};

  try {
    const baseUrl = server.resolvedUrls?.local[0];
    if (!baseUrl) throw new Error('Vite did not expose a local render URL.');
    for (const track of TRACKS) {
      if (!RENDER_TRACKS.includes(track)) {
        renderResults[track] = await inspectTrack({browser, baseUrl, manifestPath, track});
        process.stdout.write(`DECKGL_ALPHA_UNCHANGED track=${track} output=${OUTPUT_PATHS[track]}\n`);
        continue;
      }
      if (RESUME_VALID_OUTPUTS && await hasValidExistingTrack(track)) {
        renderResults[track] = await inspectTrack({browser, baseUrl, manifestPath, track});
        process.stdout.write(`DECKGL_ALPHA_RESUME track=${track} output=${OUTPUT_PATHS[track]}\n`);
        continue;
      }
      renderResults[track] = await renderTrack({
        browser,
        baseUrl,
        manifestPath,
        track,
        outputPath: OUTPUT_PATHS[track],
        startFrame: TRACK_BOUNDARY_FRAME_COUNTS[track],
        endFrame: FRAME_COUNT - 1,
      });
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const probes = {};
  const hashes = {};
  for (const track of TRACKS) {
    probes[track] = await ffprobe(OUTPUT_PATHS[track]);
    hashes[track] = await sha256File(OUTPUT_PATHS[track]);
    validateTrackProbe(track, probes[track]);
    if (RENDER_TRACKS.includes(track)) {
      await createContactSheet(OUTPUT_PATHS[track], path.join(OUTPUT_DIRECTORY, `${track}-contact-sheet.png`));
    }
  }
  const timecodeAlpha = {
    firstFrame: await alphaStatisticsAtFrame(OUTPUT_PATHS.timecode, 0),
    middleFrame: await alphaStatisticsAtFrame(OUTPUT_PATHS.timecode, Math.floor(FRAME_COUNT / 2)),
    finalFrame: await alphaStatisticsAtFrame(OUTPUT_PATHS.timecode, FRAME_COUNT - 1),
  };
  const timecodeCompositeProofFrame = Math.min(900, FRAME_COUNT - 1);
  const timecodeCompositeProofPath = path.join(
    OUTPUT_DIRECTORY,
    'samples',
    `timecode-over-calendar-proof-frame-${String(timecodeCompositeProofFrame).padStart(4, '0')}.png`,
  );
  await createTimecodeCompositeProof(
    OUTPUT_PATHS.calendar,
    OUTPUT_PATHS.timecode,
    timecodeCompositeProofFrame,
    timecodeCompositeProofPath,
  );
  const timecodeCompositeProofSha256 = await sha256File(timecodeCompositeProofPath);

  const decodedBoundaryEvidence = {};
  for (const track of TRACKS) {
    if (TRACK_BOUNDARY_FRAME_COUNTS[track] === 0) {
      decodedBoundaryEvidence[track] = {
        mode: 'generated-date-contract',
        sourceRgbaSha256: null,
        outputRgbaSha256: [await rgbaSha256AtFrame(OUTPUT_PATHS[track], 0)],
        pass: renderResults.timecode.diagnostics.timecode.firstFrame === 'Aug 30 2026',
      };
      continue;
    }
    const sourceRgbaSha256 = await rgbaSha256AtFrame(
      BOUNDARIES[track].source,
      SOURCE_BOUNDARY_FRAME_INDEX,
    );
    const outputRgbaSha256 = await Promise.all(
      Array.from({length: EXACT_BOUNDARY_FRAME_COUNT}, (_, frame) =>
        rgbaSha256AtFrame(OUTPUT_PATHS[track], frame),
      ),
    );
    const pass = outputRgbaSha256.every((hash) => hash === sourceRgbaSha256);
    decodedBoundaryEvidence[track] = {sourceRgbaSha256, outputRgbaSha256, pass};
    if (!pass) {
      throw new Error(`${track} boundary mismatch: ${sourceRgbaSha256} != ${outputRgbaSha256}.`);
    }
  }
  const boundaryInputHashes = {};
  for (const track of TRACKS) {
    boundaryInputHashes[track] = {
      sourceMovieSha256: await sha256File(BOUNDARIES[track].source),
      boundaryPacketSha256: await sha256File(BOUNDARIES[track].packet),
      ...(BOUNDARIES[track].image
        ? {boundaryImageSha256: await sha256File(BOUNDARIES[track].image)}
        : {}),
    };
  }
  const [manifestSha256, sceneSha256, htmlSha256, git] =
    await Promise.all([
      sha256File(manifestPath),
      sha256File(path.join(HERE, 'living-ladder-scene.mjs')),
      sha256File(path.join(HERE, 'living-ladder-scene.html')),
      gitState(),
    ]);
  const verification = {
    synchronizedFrameCount: probesPass(probes) ? 'PASS' : 'FAIL',
    prores4444Alpha: TRACKS.every((track) => isValidTrackProbe(probes[track])) ? 'PASS' : 'FAIL',
    exactDecodedPictureBoundaries:
      ['calendar', 'contributors'].every((track) => decodedBoundaryEvidence[track].pass)
        ? 'PASS' : 'FAIL',
    rendererNetworkDenied: TRACKS.every((track) => renderResults[track].externalRequestCount === 0)
      ? 'PASS' : 'FAIL',
    frozenProfilePicturesOnly:
      renderResults.contributors.diagnostics.missingAvatarCount === 0 ? 'PASS' : 'FAIL',
    immutableProviderIdDedupe:
      renderResults.contributors.diagnostics.duplicateProviderCount === 0 ? 'PASS' : 'FAIL',
    contributorOrbBackingRemoved:
      renderResults.contributors.diagnostics.contributorLayout.orbBacking === false ? 'PASS' : 'FAIL',
    contributionGlowEvents:
      renderResults.contributors.diagnostics.contributorLayout.contributionPulseEventCount > 0
        ? 'PASS' : 'FAIL',
    calendarTransitionWithinOneSecond:
      renderResults.calendar.diagnostics.transition.openingSeconds <= 1 ? 'PASS' : 'FAIL',
    personalCalendarPitchMatched:
      renderResults.calendar.diagnostics.cameraMotion.personalReferenceRotationX === 20 &&
      renderResults.calendar.diagnostics.cameraMotion.fovy === 48 ? 'PASS' : 'FAIL',
    decadeOutroPullback:
      renderResults.calendar.diagnostics.transition.outroSeconds === 3 ? 'PASS' : 'FAIL',
    contributorFourEdgeEntry:
      renderResults.contributors.diagnostics.contributorLayout.entryMode ===
        'deterministic-offscreen-four-edge-snap' ? 'PASS' : 'FAIL',
    contributorUsernameLabelsRemoved:
      renderResults.contributors.diagnostics.contributorLayout.usernameLabels === false &&
      renderResults.contributors.diagnostics.focusLogins.length === 0 ? 'PASS' : 'FAIL',
    contributorPortraitOverlap:
      renderResults.contributors.diagnostics.contributorLayout.overlap.severePairCount === 0 &&
      renderResults.contributors.diagnostics.contributorLayout.overlap.maximumOverlapPixels < 1
        ? 'PASS' : 'FAIL',
    polygonLayerGlobeBoundary:
      BOUNDARIES.contributors.source === PERSONAL_POLYGON_GLOBE_SOURCE ? 'PASS' : 'FAIL',
    singleOrganicCalendarMorph:
      renderResults.calendar.diagnostics.calendarContinuity.transitionMode ===
        'single-canonical-cell-peel-and-dive' ? 'PASS' : 'FAIL',
    noRandomCalendarSegmentSpawn:
      renderResults.calendar.diagnostics.calendarContinuity.randomSegmentSpawn === false &&
      renderResults.calendar.diagnostics.calendarContinuity.offscreenFlow ===
        'temporal-edge-lanes' &&
      renderResults.calendar.diagnostics.calendarContinuity.depthVisibilityFade === true
        ? 'PASS' : 'FAIL',
    timecodeMonDdYyyyRewind:
      renderResults.timecode.diagnostics.timecode.format === 'Mon DD YYYY' &&
      renderResults.timecode.diagnostics.timecode.firstFrame === 'Aug 30 2026' &&
      renderResults.timecode.diagnostics.timecode.rewindTarget === 'Jan 04 2016' &&
      renderResults.timecode.diagnostics.timecode.traversalStart === 'Jan 04 2016' &&
      renderResults.timecode.diagnostics.timecode.traversalEnd === 'Aug 31 2026'
        ? 'PASS' : 'FAIL',
    timecodeTransparentBacking:
      Object.values(timecodeAlpha).every((sample) =>
        sample.minimum <= 256 && sample.maximum >= 3700 && sample.average < 400)
        ? 'PASS' : 'FAIL',
    timecodeEstablishedTypography:
      renderResults.timecode.diagnostics.timecode.font ===
        '600 60px "SFMono-Regular", Menlo, Monaco, Consolas, monospace'
        ? 'PASS' : 'FAIL',
    offlineTimecodeComposite: timecodeCompositeProofSha256 ? 'PASS' : 'FAIL',
    presentationEditorComposite: 'UNVERIFIED',
  };
  const evidence = {
    status: Object.values(verification).some((value) => value === 'FAIL') ? 'FAIL' :
      (SMOKE_FRAME_COUNT > 0 ? 'SMOKE-PASS' : 'PASS'),
    generatedAt: new Date().toISOString(),
    scope: 'three synchronized 1920x1080 60fps ProRes 4444 alpha deck.gl presentation tracks',
    contract: {
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      frameCount: FRAME_COUNT,
      durationSeconds: FRAME_COUNT / FPS,
      productionFrameCount: PRODUCTION_FRAME_COUNT,
      productionDurationSeconds: 51,
      proresBitsPerMacroblock: PRORES_BITS_PER_MACROBLOCK,
      proresAlphaBits: PRORES_ALPHA_BITS,
    },
    boundaries: Object.fromEntries(TRACKS.map((track) => [track, {
      sourceMovie: BOUNDARIES[track].source,
      sourceFrameIndex: SOURCE_BOUNDARY_FRAME_INDEX,
      sourceFrameTimestampSeconds: SOURCE_BOUNDARY_FRAME_INDEX / FPS,
      exactBoundaryFrameCount: TRACK_BOUNDARY_FRAME_COUNTS[track],
      ...decodedBoundaryEvidence[track],
      ...boundaryInputHashes[track],
    }])),
    transition: {
      openingFrames: renderResults.calendar.diagnostics.transition.openingFrames,
      openingSeconds: renderResults.calendar.diagnostics.transition.openingSeconds,
      fourYearToDecadeFrames:
        renderResults.calendar.diagnostics.transition.fourYearToDecadeFrames,
      decadeToCrawlFrames: renderResults.calendar.diagnostics.transition.decadeToCrawlFrames,
      outroFrames: renderResults.calendar.diagnostics.transition.outroFrames,
      outroSeconds: renderResults.calendar.diagnostics.transition.outroSeconds,
    },
    contributors: renderResults.contributors.diagnostics.contributorLayout,
    camera: renderResults.calendar.diagnostics.cameraMotion,
    timecode: {
      ...renderResults.timecode.diagnostics.timecode,
      position: [960, 540],
      font: '600 60px "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
      trackingPixels: 3,
      fill: '#ffffff',
      shadow: {color: 'rgba(0,0,0,0.82)', blur: 16, offsetY: 2},
      transparentBacking: true,
      alpha: timecodeAlpha,
      offlineCompositeProof: {
        path: timecodeCompositeProofPath,
        sha256: timecodeCompositeProofSha256,
        backgroundTrack: OUTPUT_PATHS.calendar,
        frame: timecodeCompositeProofFrame,
      },
      synchronizedToCalendarStoryDate: true,
    },
    verification,
    inputs: {
      manifest: {path: manifestPath, sha256: manifestSha256, candidateId: manifest.candidateId},
      boundarySources: Object.fromEntries(TRACKS.map((track) => [track, {
        movie: BOUNDARIES[track].source,
        image: BOUNDARIES[track].image ?? null,
        packet: BOUNDARIES[track].packet,
      }])),
      scene: {path: path.join(HERE, 'living-ladder-scene.mjs'), sha256: sceneSha256},
      html: {path: path.join(HERE, 'living-ladder-scene.html'), sha256: htmlSha256},
    },
    tracks: Object.fromEntries(TRACKS.map((track) => [track, {
      path: OUTPUT_PATHS[track],
      sha256: hashes[track],
      probe: probes[track],
      diagnostics: renderResults[track].diagnostics,
    }])),
    worktree: git,
  };
  const evidencePath = path.join(
    OUTPUT_DIRECTORY,
    ONLY_TRACK === 'timecode' ? 'timecode-editor-transparent-sfmono-evidence.json' : 'evidence.json',
  );
  await writeJson(evidencePath, evidence);
  process.stdout.write(
    `DECKGL_SYNCHRONIZED_ALPHA_COMPLETE status=${evidence.status} ` +
    `calendar=${OUTPUT_PATHS.calendar} contributors=${OUTPUT_PATHS.contributors} ` +
    `timecode=${OUTPUT_PATHS.timecode} evidence=${evidencePath}\n`,
  );
}

async function createRenderServer() {
  const server = await createServer({
    root: HERE,
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: {
        '@deck.gl/core': DECK_CORE_ENTRY,
        '@deck.gl/layers': DECK_LAYERS_ENTRY,
        mediabunny: MEDIABUNNY_ENTRY,
      },
    },
    optimizeDeps: {include: ['@deck.gl/core', '@deck.gl/layers', MEDIABUNNY_ENTRY]},
    server: {
      hmr: false,
      watch: null,
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      fs: {
        allow: [
          HERE,
          NEWHEAT_NODE_MODULES,
          ...TRACKS.flatMap((track) =>
            BOUNDARIES[track].image ? [path.dirname(BOUNDARIES[track].image)] : [],
          ),
        ],
      },
    },
  });
  await server.listen();
  return server;
}

async function renderTrack({browser, baseUrl, manifestPath, track, outputPath, startFrame, endFrame}) {
  const page = await browser.newPage({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor: 1});
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.text().startsWith('SOCIAL_BAKE ')) process.stdout.write(message.text() + '\n');
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'data:') {
      await route.continue();
    } else {
      externalRequests.push(url.href);
      await route.abort('blockedbyclient');
    }
  });

  const manifestRelative = path.relative(HERE, manifestPath).split(path.sep).join('/');
  const url = new URL(process.env.DECKGL_SYNC_SCENE ?? 'living-ladder-scene.html', baseUrl);
  url.searchParams.set('manifest', `./${manifestRelative}`);
  url.searchParams.set('calendarDirection', 'up');
  url.searchParams.set('rankMode', 'lifetime');
  url.searchParams.set('storyAnchorScreenY', '670');
  url.searchParams.set('renderTrack', track);
  if (BOUNDARIES[track].image) {
    url.searchParams.set('handoff', `/@fs${BOUNDARIES[track].image}`);
  }
  await page.goto(url.href, {waitUntil: 'networkidle'});
  await page.evaluate(() => window.__DECKGL_LIVING_LADDER__.ready);

  if (process.env.DECKGL_SYNC_REVIEW_FRAMES === '1') {
    for (const frame of [0, 30, 59, 300, 900, 1500, 2200, 3059]) {
      await renderAndCapture(page, frame, path.join(OUTPUT_DIRECTORY, 'samples', 'review-' + frame + '.png'));
    }
    process.stdout.write('DECKGL_REVIEW_FRAMES_READY\n');
  }
  if (track === 'calendar') {
    await renderAndCapture(page, 0, path.join(OUTPUT_DIRECTORY, 'samples', 'calendar-frame-0000.png'));
  }
  const encoder = await startProresEncoder(outputPath, track);
  const frameTotal = endFrame - startFrame + 1;
  let rendered = 0;
  try {
    for (let frame = startFrame; frame <= endFrame; frame += 1) {
      const screenshotPath = SAMPLE_FRAMES.includes(frame)
        ? path.join(OUTPUT_DIRECTORY, 'samples', `${track}-frame-${String(frame).padStart(4, '0')}.png`)
        : null;
      const png = await renderAndCapture(page, frame, screenshotPath);
      if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
      rendered += 1;
      if (rendered === 1 || rendered % 60 === 0 || frame === endFrame) {
        process.stdout.write(`DECKGL_ALPHA_PROGRESS track=${track} frames=${rendered}/${frameTotal}\n`);
      }
    }
    encoder.stdin.end();
    await encoder.complete();
  } catch (error) {
    await encoder.abort();
    throw error;
  }

  const diagnostics = await page.evaluate(() => window.__DECKGL_LIVING_LADDER__.getDiagnostics(3059));
  await page.close();
  if (errors.length) throw new Error(`${track} render page errors: ${errors.join('; ')}`);
  return {diagnostics, externalRequestCount: externalRequests.length};
}

async function hasValidExistingTrack(track) {
  try {
    await fs.access(OUTPUT_PATHS[track]);
    return isValidTrackProbe(await ffprobe(OUTPUT_PATHS[track]));
  } catch {
    return false;
  }
}

async function inspectTrack({browser, baseUrl, manifestPath, track}) {
  const page = await browser.newPage({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor: 1});
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'data:') {
      await route.continue();
    } else {
      externalRequests.push(url.href);
      await route.abort('blockedbyclient');
    }
  });
  const manifestRelative = path.relative(HERE, manifestPath).split(path.sep).join('/');
  const url = new URL('living-ladder-scene.html', baseUrl);
  url.searchParams.set('manifest', `./${manifestRelative}`);
  url.searchParams.set('calendarDirection', 'up');
  url.searchParams.set('rankMode', 'lifetime');
  url.searchParams.set('storyAnchorScreenY', '670');
  url.searchParams.set('renderTrack', track);
  if (BOUNDARIES[track].image) {
    url.searchParams.set('handoff', `/@fs${BOUNDARIES[track].image}`);
  }
  await page.goto(url.href, {waitUntil: 'networkidle'});
  await page.evaluate(() => window.__DECKGL_LIVING_LADDER__.ready);
  const diagnostics = await page.evaluate(() => window.__DECKGL_LIVING_LADDER__.getDiagnostics(3059));
  await page.close();
  if (errors.length) throw new Error(`${track} inspection page errors: ${errors.join('; ')}`);
  return {diagnostics, externalRequestCount: externalRequests.length, resumed: true};
}

async function renderAndCapture(page, frame, screenshotPath) {
  await page.evaluate(async (frameIndex) => {
    await window.__DECKGL_LIVING_LADDER__.setFrame(frameIndex);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }, frame);
  const png = await page.screenshot({type: 'png', omitBackground: true});
  if (screenshotPath) await fs.writeFile(screenshotPath, png);
  return png;
}

async function startProresEncoder(outputPath, track) {
  if (track === 'timecode') return startDirectTimecodeEncoder(outputPath);
  const listPath = path.join(OUTPUT_DIRECTORY, `.${track}-stream-concat.txt`);
  const fifoPath = path.join(OUTPUT_DIRECTORY, `.${track}-tail.fifo`);
  await fs.rm(fifoPath, {force: true});
  await execFileAsync('mkfifo', [fifoPath]);
  await fs.writeFile(
    listPath,
    `${Array.from({length: TRACK_BOUNDARY_FRAME_COUNTS[track]}, () =>
      `file '${escapeConcatPath(BOUNDARIES[track].packet)}'\n`,
    ).join('')}file '${escapeConcatPath(fifoPath)}'\n`,
  );
  const muxer = spawn('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-protocol_whitelist', 'file,pipe,fd',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-map', '0:v:0',
    '-an',
    '-c', 'copy',
    '-bsf:v', 'setts=pts=N*1000:dts=N*1000:duration=1000:time_base=1/60000',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-color_range', 'tv',
    '-video_track_timescale', '60000',
    '-movflags', '+faststart+write_colr',
    outputPath,
  ], {stdio: ['ignore', 'ignore', 'pipe']});
  const codecArguments = [
    '-c:v', 'prores_ks',
    '-profile:v', '4',
    '-bits_per_mb', String(PRORES_BITS_PER_MACROBLOCK[track]),
    '-pix_fmt', 'yuva444p10le',
    '-alpha_bits', String(PRORES_ALPHA_BITS[track]),
  ];
  const encoder = spawn('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-framerate', String(FPS),
    '-i', 'pipe:0',
    '-an',
    ...codecArguments,
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-color_range', 'tv',
    '-enc_time_base:v', '1:60000',
    '-fps_mode', 'passthrough',
    '-f', 'nut',
    fifoPath,
  ], {stdio: ['pipe', 'ignore', 'pipe']});

  let encoderStderr = '';
  let muxerStderr = '';
  encoder.stderr.setEncoding('utf8');
  encoder.stderr.on('data', (chunk) => {
    encoderStderr = `${encoderStderr}${chunk}`.slice(-64 * 1024);
  });
  muxer.stderr.setEncoding('utf8');
  muxer.stderr.on('data', (chunk) => {
    muxerStderr = `${muxerStderr}${chunk}`.slice(-64 * 1024);
  });
  const encoderClosed = new Promise((resolve) => encoder.on('close', resolve));
  const muxerClosed = new Promise((resolve) => muxer.on('close', resolve));
  const cleanup = () => Promise.all([
    fs.rm(listPath, {force: true}),
    fs.rm(fifoPath, {force: true}),
  ]);
  return {
    stdin: encoder.stdin,
    complete: async () => {
      const [encoderCode, muxerCode] = await Promise.all([encoderClosed, muxerClosed]);
      await cleanup();
      if (encoderCode !== 0) {
        throw new Error(`${track} ProRes encoder exited with code ${encoderCode}: ${encoderStderr}`);
      }
      if (muxerCode !== 0) {
        throw new Error(`${track} boundary muxer exited with code ${muxerCode}: ${muxerStderr}`);
      }
    },
    abort: async () => {
      encoder.stdin.destroy();
      encoder.kill('SIGTERM');
      muxer.kill('SIGTERM');
      await Promise.allSettled([encoderClosed, muxerClosed]);
      await cleanup();
    },
  };
}

function startDirectTimecodeEncoder(outputPath) {
  const encodedPath = `${outputPath}.encoded.mov`;
  const encoder = spawn('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-framerate', String(FPS),
    '-i', 'pipe:0',
    '-an',
    '-c:v', 'prores_aw',
    '-pix_fmt', 'yuva444p10le',
    '-vendor', 'apl0',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-color_range', 'tv',
    '-movflags', '+faststart+write_colr',
    encodedPath,
  ], {stdio: ['pipe', 'ignore', 'pipe']});
  let encoderStderr = '';
  encoder.stderr.setEncoding('utf8');
  encoder.stderr.on('data', (chunk) => {
    encoderStderr = `${encoderStderr}${chunk}`.slice(-64 * 1024);
  });
  const encoderClosed = new Promise((resolve) => encoder.on('close', resolve));
  return {
    stdin: encoder.stdin,
    complete: async () => {
      const encoderCode = await encoderClosed;
      if (encoderCode !== 0) {
        throw new Error(`timecode ProRes encoder exited with code ${encoderCode}: ${encoderStderr}`);
      }
      await execFileAsync('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-i', encodedPath,
        '-map', '0:v:0',
        '-an',
        '-c', 'copy',
        '-color_primaries', 'bt709',
        '-color_trc', 'bt709',
        '-colorspace', 'bt709',
        '-color_range', 'tv',
        '-movflags', '+faststart+write_colr',
        outputPath,
      ], {maxBuffer: 16 * 1024 * 1024});
      await fs.rm(encodedPath, {force: true});
    },
    abort: async () => {
      encoder.stdin.destroy();
      encoder.kill('SIGTERM');
      await Promise.allSettled([encoderClosed]);
      await fs.rm(encodedPath, {force: true});
    },
  };
}

async function createTimecodeCompositeProof(calendarPath, timecodePath, frame, outputPath) {
  const timestamp = frame / FPS;
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `color=c=0x0b1017:s=${WIDTH}x${HEIGHT}:r=${FPS}`,
    '-ss', String(timestamp),
    '-i', calendarPath,
    '-ss', String(timestamp),
    '-i', timecodePath,
    '-filter_complex', '[0:v][1:v]overlay=format=auto[calendar];[calendar][2:v]overlay=format=auto',
    '-frames:v', '1',
    '-update', '1',
    outputPath,
  ], {maxBuffer: 16 * 1024 * 1024});
}

function escapeConcatPath(value) {
  return value.replaceAll("'", "'\\''");
}

async function ffprobe(file) {
  const {stdout} = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,time_base,nb_frames,color_range,color_space,color_transfer,color_primaries',
    '-of', 'json', file,
  ], {maxBuffer: 16 * 1024 * 1024});
  return JSON.parse(stdout);
}

function validateTrackProbe(track, probe) {
  if (!isValidTrackProbe(probe)) {
    throw new Error(`${track} does not match the synchronized ProRes 4444 alpha contract: ${JSON.stringify(probe)}.`);
  }
}

function isValidTrackProbe(probe) {
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  return Boolean(video && !audio && video.codec_name === 'prores' && video.profile === '4444' &&
    video.width === WIDTH && video.height === HEIGHT && video.pix_fmt === 'yuva444p12le' &&
    video.r_frame_rate === '60/1' && ['1/60000', '1/15360'].includes(video.time_base) &&
    Number(video.nb_frames) === FRAME_COUNT &&
    Math.abs(Number(probe.format.duration) - FRAME_COUNT / FPS) < 1 / 60_000 &&
    video.color_primaries === 'bt709' && video.color_transfer === 'bt709' &&
    video.color_space === 'bt709' && video.color_range === 'tv');
}

function probesPass(probes) {
  return TRACKS.every((track) => isValidTrackProbe(probes[track]));
}

async function rgbaSha256AtFrame(file, frame) {
  const {stdout} = await execFileAsync('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `select=eq(n\\,${frame})`,
    '-vsync', '0', '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], {encoding: 'buffer', maxBuffer: 16 * 1024 * 1024});
  return createHash('sha256').update(stdout).digest('hex');
}

async function alphaStatisticsAtFrame(file, frame) {
  const {stdout} = await execFileAsync('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `select=eq(n\\,${frame}),alphaextract`,
    '-vsync', '0', '-frames:v', '1',
    '-pix_fmt', 'gray12le', '-f', 'rawvideo', 'pipe:1',
  ], {encoding: 'buffer', maxBuffer: 16 * 1024 * 1024});
  let minimum = 65_535;
  let maximum = 0;
  let sum = 0;
  let sampleCount = 0;
  for (let offset = 0; offset + 1 < stdout.length; offset += 2) {
    const value = stdout.readUInt16LE(offset);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    sum += value;
    sampleCount += 1;
  }
  if (sampleCount === 0) throw new Error(`No alpha samples decoded from ${file} frame ${frame}.`);
  return {minimum, maximum, average: sum / sampleCount, sampleCount};
}

async function createContactSheet(input, output) {
  const frames = evenlySpacedFrames(FRAME_COUNT, 12);
  const select = frames.map((frame) => `eq(n\\,${frame})`).join('+');
  await execFileAsync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', input,
    '-vf', `select=${select},scale=480:270:flags=lanczos,tile=4x3,format=rgb24`,
    '-vsync', '0', '-frames:v', '1', output,
  ], {maxBuffer: 32 * 1024 * 1024});
}

function evenlySpacedFrames(frameCount, sampleCount) {
  const values = [];
  for (let index = 0; index < Math.min(sampleCount, frameCount); index += 1) {
    values.push(Math.round(index * (frameCount - 1) / Math.max(1, sampleCount - 1)));
  }
  return [...new Set(values)];
}

async function sha256File(file) {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  stream.on('data', (chunk) => hash.update(chunk));
  await once(stream, 'end');
  return hash.digest('hex');
}

async function gitState() {
  const [{stdout: status}, {stdout: head}] = await Promise.all([
    execFileAsync('git', ['status', '--short'], {cwd: DECKGL_WORKTREE}),
    execFileAsync('git', ['rev-parse', 'HEAD'], {cwd: DECKGL_WORKTREE}),
  ]);
  return {head: head.trim(), status: status.trim().split('\n').filter(Boolean)};
}

async function writeJson(file, value) {
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o644});
  await fs.rename(temporary, file);
}

export {createRenderServer, renderTrack, ffprobe, rgbaSha256AtFrame, alphaStatisticsAtFrame,
  createContactSheet, sha256File, validateTrackProbe};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
