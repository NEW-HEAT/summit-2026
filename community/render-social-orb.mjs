#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile, spawn} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const {chromium} = require('playwright');
const execute = promisify(execFile);
process.env.DECKGL_SYNC_OUTPUT_NAME = process.env.SOCIAL_OUTPUT ?? 'community-constellation';
process.env.DECKGL_SYNC_SCENE = 'social-orb-scene.html';
process.env.DECKGL_SYNC_CONTRIBUTOR_BITS = process.env.SOCIAL_PRORES_BITS ?? '1200';
assert.ok(Number(process.env.DECKGL_SYNC_CONTRIBUTOR_BITS) >= 600 && Number(process.env.DECKGL_SYNC_CONTRIBUTOR_BITS) <= 1350);
process.env.DECKGL_SYNC_REVIEW_FRAMES = '1';
const {createRenderServer, renderTrack, ffprobe, rgbaSha256AtFrame, alphaStatisticsAtFrame,
  createContactSheet, sha256File, validateTrackProbe} = await import('./render-synchronized-alpha-tracks.mjs');
const outputDirectory = path.join(root, 'output', process.env.DECKGL_SYNC_OUTPUT_NAME);
const manifestPath = path.resolve(root, process.env.SOCIAL_MANIFEST ?? 'data/social-2026-08-31/social-manifest.json');
const filePrefix = process.env.SOCIAL_FILE_PREFIX ?? 'deckgl-social-constellation';
assert.match(filePrefix, /^[a-z0-9-]+$/);
const movie = path.join(outputDirectory, filePrefix + '-alpha-51s.mov');
const previewOnly = process.env.SOCIAL_PREVIEW_ONLY === '1';
const preview = path.join(outputDirectory, filePrefix + '-preview-51s.mp4');
if (process.env.SOCIAL_STILLS !== '1' && !previewOnly) {
  const storage = await fs.statfs(root);
  const availableBytes = storage.bavail * storage.bsize;
  if (availableBytes < 4 * 1024 ** 3) {
    throw new Error('Full alpha export needs at least 4 GiB free before encoding; found ' +
      (availableBytes / 1024 ** 3).toFixed(2) + ' GiB. Frozen data is ready and no render has started.');
  }
  let exists = false;
  try { await fs.access(movie); exists = true; } catch {}
  if (exists) throw new Error('Choose a fresh SOCIAL_OUTPUT name; an existing MOV will not be overwritten.');
}
const frozenManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
assert.equal(new Set(frozenManifest.nodes.map(node => node.id)).size, frozenManifest.nodes.length);
assert.ok(frozenManifest.nodes.every(node => node.avatar && node.login !== 'ghost' && !node.login.endsWith('[bot]')));
if (frozenManifest.cutoff) {
  const identifiers = new Set(frozenManifest.nodes.map(node => node.id));
  assert.ok(frozenManifest.events.every(event => identifiers.has(event.source) && identifiers.has(event.target) &&
    Date.parse(event.date) <= Date.parse(frozenManifest.cutoff)));
  assert.equal(new Set(frozenManifest.events.map(event =>
    [event.id, event.type, event.source, event.target].join('|'))).size, frozenManifest.events.length);
}
if (process.env.SOCIAL_STILLS !== '1' && frozenManifest.cutoff !== '2026-08-31T01:47:35Z') {
  throw new Error('New cutoff requires a coordinated calendar/timecode refresh; this export keeps the locked 51-second timeline.');
}
await fs.mkdir(path.join(outputDirectory, 'samples'), {recursive: true});
const server = await createRenderServer();
const browser = await chromium.launch({headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']});
const baseUrl = server.resolvedUrls.local[0];
let result;
try {
  if (process.env.SOCIAL_STILLS === '1' || previewOnly) {
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1});
    const errors = [];
    let externalRequestCount = 0;
    page.on('console', message => console.log(message.text()));
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
      externalRequestCount++;
      return route.abort();
    });
    const url = new URL('social-orb-scene.html', baseUrl);
    url.searchParams.set('manifest', '/@fs' + manifestPath);
    url.searchParams.set('handoff', './reference-frames/personal-handoff.png');
    await page.goto(url.href);
    await page.evaluate(() => window.__DECKGL_LIVING_LADDER__.ready);
    for (const frame of [0, 30, 59, 300, 900, 1500, 2200, 2879, 3059]) {
      await page.evaluate(async frame => {
        await window.__DECKGL_LIVING_LADDER__.setFrame(frame);
        await new Promise(resolve => requestAnimationFrame(resolve));
      }, frame);
      await page.screenshot({path: path.join(outputDirectory, 'samples', 'review-' + frame + '.png'),
        omitBackground: true});
    }
    result = await page.evaluate(() => window.__DECKGL_LIVING_LADDER__.getDiagnostics());
    await fs.writeFile(path.join(outputDirectory, 'still-diagnostics.json'), JSON.stringify(result, null, 2));
    assert.equal(errors.length, 0, errors.join('; '));
    assert.equal(externalRequestCount, 0);
    if (frozenManifest.retentionPolicy) {
      assert.ok(result.maximumCollisionSpeed <= 1.80001);
      assert.ok(result.maximumCollisionAcceleration <= 0.16001);
      assert.ok(result.maximumStep < 12);
      assert.equal(result.finalPermanent, frozenManifest.retentionPolicy.pullRequestAuthorCount);
      assert.equal(result.smallPortraitCoreIntrusions, 0);
      assert.equal(result.permanentDepartureFrames, 0);
      assert.ok(result.departingPortraitFrames > 0);
    }
    console.log(JSON.stringify({...result, coverage: undefined}, null, 2));
    if (previewOnly) {
      // Low-space review route: same baked frames, no intermediary MOV or frame directory.
      const encoder = spawn('ffmpeg', ['-n', '-v', 'error', '-f', 'image2pipe', '-vcodec', 'png',
        '-framerate', '60', '-i', 'pipe:0', '-filter_complex',
        'color=c=0x0d1117:s=1920x1080:r=60[background];[background][0:v]overlay=shortest=1,format=yuv420p',
        '-frames:v', '3060', '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast',
        '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', preview],
      {stdio: ['pipe', 'ignore', 'pipe']});
      let encoderError = '';
      encoder.stderr.on('data', chunk => {encoderError += chunk;});
      const completion = once(encoder, 'close');
      const opening = await fs.readFile(path.join(root, 'reference-frames/personal-handoff.png'));
      try {
        for (let frame = 0; frame < 3060; frame++) {
          await page.evaluate(async frame => {
            await window.__DECKGL_LIVING_LADDER__.setFrame(frame);
            await new Promise(resolve => requestAnimationFrame(resolve));
          }, frame);
          const png = frame < 3 ? opening : await page.screenshot({omitBackground: true});
          if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
          if (frame % 120 === 0) console.log('SOCIAL_PREVIEW ' + frame + '/3060');
        }
        encoder.stdin.end();
        const [code] = await completion;
        assert.equal(code, 0, encoderError);
      } catch (error) {
        encoder.kill('SIGTERM');
        throw error;
      }
      const probe = await ffprobe(preview);
      assert.equal(Number(probe.streams[0].nb_frames), 3060);
      assert.equal(probe.streams[0].r_frame_rate, '60/1');
      assert.equal(Number(probe.format.duration), 51);
      assert.equal(errors.length, 0, errors.join('; '));
      assert.equal(externalRequestCount, 0);
      await fs.writeFile(path.join(outputDirectory, 'preview-evidence.json'), JSON.stringify({
        status: 'PREVIEW-PASS', preview, probe, diagnostics: result, externalRequestCount,
        sha256: await sha256File(preview), manifestSha256: await sha256File(manifestPath),
        sceneSha256: await sha256File(path.join(root, 'social-orb-scene.mjs')),
        modelSha256: await sha256File(path.join(root, 'social-orb-model.mjs')),
        atlasSha256: await sha256File(path.join(root, 'social-avatar-atlas.mjs')),
        backing: 'Dark review composite; production MOV remains transparent',
        calendarAndTimecode: 'UNCHANGED', productionMov: 'NOT_RENDERED_LOW_DISK_SPACE',
      }, null, 2));
      console.log('PREVIEW_COMPLETE ' + preview);
    }
  } else {
    result = await renderTrack({browser, baseUrl, manifestPath, track: 'contributors',
      outputPath: movie, startFrame: 3, endFrame: 3059});
  }
} finally {
  await browser.close();
  await server.close();
}
if (process.env.SOCIAL_STILLS !== '1' && !previewOnly) {
  const probe = await ffprobe(movie);
  validateTrackProbe('contributors', probe);
  const sourceBoundaryHash = '2b5ec889edd79d78c16127925a6b3728d4623b0165c918eaf3fbbdc7977b2115';
  const boundaryHashes = [];
  for (const frame of [0, 1, 2]) boundaryHashes.push(await rgbaSha256AtFrame(movie, frame));
  const alpha = await alphaStatisticsAtFrame(movie, 1500);
  const evidence = {movie, ...result, probe, alpha, boundaryHashes,
    sourceBoundaryHash, exactOpening: boundaryHashes.every(value => value === sourceBoundaryHash),
    transparent: alpha.minimum === 0 && alpha.maximum > 0,
    sha256: await sha256File(movie), manifestSha256: await sha256File(manifestPath),
    sceneSha256: await sha256File(path.join(root, 'social-orb-scene.mjs')),
    modelSha256: await sha256File(path.join(root, 'social-orb-model.mjs')),
    atlasSha256: await sha256File(path.join(root, 'social-avatar-atlas.mjs')),
    encoderBitsPerMacroblock: Number(process.env.DECKGL_SYNC_CONTRIBUTOR_BITS),
    editorImport: 'UNVERIFIED', calendarAndTimecode: 'UNCHANGED'};
  await fs.writeFile(path.join(outputDirectory, 'evidence.json'), JSON.stringify(evidence, null, 2));
  if (!evidence.exactOpening || !evidence.transparent || result.externalRequestCount) {
    throw new Error('Output verification failed');
  }
  await createContactSheet(movie, path.join(outputDirectory, 'contact-sheet.png'));
  await execute('ffmpeg', ['-y', '-v', 'error', '-i', movie,
    '-filter_complex', 'color=c=0x0d1117:s=1920x1080:r=60[background];[background][0:v]overlay=shortest=1,format=yuv420p',
    '-frames:v', '3060', '-an', '-c:v', 'libx264',
    '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    preview]);
  console.log('COMPLETE ' + movie);
}
