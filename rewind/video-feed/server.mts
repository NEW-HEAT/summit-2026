#!/usr/bin/env tsx
import {createReadStream} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {IncomingMessage, ServerResponse} from "node:http";
import {createServer as createViteServer, type ViteDevServer} from "vite";
import type {FitnessArchiveBundle} from "../scene/geographic-memory-model";
import {
  ALBUM_SOURCES,
  TARGET_LOCATION_OVERRIDES,
  VIDEO_FEED_CONTRACT,
  defaultTrimForBeat,
  lockTrimWindow,
  sourceForBeat,
  type FeedManifest,
  type FeedTrim,
} from "./contract";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const CACHE_ROOT = path.join(REPO_ROOT, ".cache/around-the-world");
const MEDIA_ROOT = path.join(CACHE_ROOT, "originals");
const PREPARED_ROOT = path.join(CACHE_ROOT, "prepared");
const DESKTOP_IMPORT_ROOT = process.env.SUMMIT_VIDEO_INPUTS ?? path.join(REPO_ROOT, "private-inputs/videos");
const TRIMS_PATH = path.join(CACHE_ROOT, "trims.json");
const ARCHIVE_PATH = path.join(REPO_ROOT, ".cache/fitness-archive/scene.json");
const PHOTOS_EXPORT_ERROR =
  "Apple Photos returned Unknown error (1,005) for original and rendered 1080p exports.";

type TrimFile = {version: 1; updatedAt: string; trims: Record<string, FeedTrim>};

export async function startVideoFeedServer(options: {
  port?: number;
  host?: string;
} = {}): Promise<{server: ViteDevServer; url: string}> {
  await ensureCache();
  const host = options.host ?? "127.0.0.1";
  const server = await createViteServer({
    root: HERE,
    appType: "spa",
    logLevel: "warn",
    server: {
      host,
      port: options.port ?? 0,
      strictPort: false,
      fs: {allow: [HERE]},
    },
    plugins: [
      {
        name: "around-the-world-private-media",
        configureServer(vite) {
          vite.middlewares.use(async (request, response, next) => {
            try {
              if (!request.url) return next();
              const url = new URL(request.url, "http://localhost");
              if (request.method === "GET" && url.pathname === "/api/feed") {
                return sendJson(
                  response,
                  200,
                  await buildManifest({prepared: url.searchParams.get("prepared") === "1"})
                );
              }
              if (request.method === "POST" && url.pathname === "/api/trims") {
                const body = JSON.parse((await readBody(request)).toString("utf8")) as {
                  beat: number;
                  trim: FeedTrim;
                };
                await saveTrim(body.beat, body.trim);
                return sendJson(response, 200, {ok: true});
              }
              if (
                request.method === "POST" &&
                url.pathname.startsWith("/api/media/")
              ) {
                const fileName = safeExpectedFileName(
                  decodeURIComponent(url.pathname.slice("/api/media/".length))
                );
                const bytes = await readBody(request, 1_500_000_000);
                if (bytes.length === 0) throw new Error("The uploaded video was empty.");
                await fs.writeFile(path.join(MEDIA_ROOT, fileName), bytes);
                return sendJson(response, 201, {ok: true, fileName, bytes: bytes.length});
              }
              if (request.method === "GET" && url.pathname.startsWith("/media/")) {
                const fileName = safeExpectedFileName(
                  decodeURIComponent(url.pathname.slice("/media/".length))
                );
                const mediaPath = await resolveMediaPath(fileName);
                if (!mediaPath) throw new Error(`${fileName} is not ready yet.`);
                return serveMedia(request, response, mediaPath);
              }
              if (request.method === "GET" && url.pathname.startsWith("/prepared/")) {
                const match = /^\/(?:prepared)\/(\d+)\.mp4$/.exec(url.pathname);
                const beat = match ? Number(match[1]) : 0;
                if (!Number.isInteger(beat) || beat < 1 || beat > 32) {
                  throw new Error("Prepared media beat must be from 1 through 32.");
                }
                return serveMedia(
                  request,
                  response,
                  path.join(PREPARED_ROOT, `${beat}.mp4`)
                );
              }
              next();
            } catch (error) {
              sendJson(response, 400, {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine the video-feed server address.");
  }
  return {server, url: `http://${host}:${address.port}/scene.html?ui=1`};
}

export async function buildManifest(
  options: {prepared?: boolean} = {}
): Promise<FeedManifest> {
  const archive = JSON.parse(await fs.readFile(ARCHIVE_PATH, "utf8")) as FitnessArchiveBundle;
  if (archive.sequence.beats.length !== VIDEO_FEED_CONTRACT.beatCount) {
    throw new Error("The fitness archive does not contain the locked 32-beat sequence.");
  }
  const trimFile = await readTrimFile();
  const readyMedia = await scanReadyMedia();
  const preparedMedia = options.prepared ? await scanPreparedMedia() : new Set<number>();
  const beats = archive.sequence.beats.map((timelineBeat, index) => {
    const beat = index + 1;
    const source = sourceForBeat(beat);
    const timing = timingForBeat(index);
    const sourceReady = readyMedia.has(source.fileName.toLocaleLowerCase());
    const preparedReady = preparedMedia.has(beat);
    const location = TARGET_LOCATION_OVERRIDES[beat] ?? timelineBeat.zone.location;
    if (!location) throw new Error(`Timeline beat ${beat} has no target location.`);
    const dates = [timelineBeat.targetDate, timelineBeat.sourceDate].sort();
    const lockedTrim = lockTrimWindow(
      beat,
      trimFile.trims[String(beat)] ?? defaultTrimForBeat(beat)
    );
    return {
      beat,
      intervalStartFrame: timing.intervalStartFrame,
      markerFrame: timing.markerFrame,
      globalStartSeconds: timing.globalStartSeconds,
      targetDateStart: dates[0],
      targetDateEnd: dates[1],
      targetPlace: location.cityOrRegion,
      targetRegion: location.state,
      targetCountry: location.country,
      source,
      sourceReady: options.prepared ? sourceReady && preparedReady : sourceReady,
      mediaUrl:
        options.prepared && preparedReady
          ? `/prepared/${beat}.mp4`
          : sourceReady
            ? `/media/${encodeURIComponent(source.fileName)}`
            : null,
      trim: options.prepared
        ? {...lockedTrim, trimInSeconds: 0, trimOutSeconds: 0.9}
        : lockedTrim,
      mappingNote:
        beat === 32
          ? "LOCKED OVERRIDE: Gainesville replaces the North Carolina timeline label."
          : "Curated album-to-timeline match",
    };
  });
  const readyCount = beats.filter((beat) => beat.sourceReady).length;
  return {
    contract: VIDEO_FEED_CONTRACT,
    beats,
    media: {
      readyCount,
      expectedCount: ALBUM_SOURCES.length,
      status: readyCount === ALBUM_SOURCES.length ? "ready" : "missing",
      cachePath: MEDIA_ROOT,
      watchedPath: DESKTOP_IMPORT_ROOT,
      photosExportError: readyCount === ALBUM_SOURCES.length ? null : PHOTOS_EXPORT_ERROR,
    },
  };
}

async function scanReadyMedia(): Promise<Map<string, string>> {
  const candidates = new Map<string, string>();
  // The private cache wins when both locations contain the same asset.
  for (const directory of [DESKTOP_IMPORT_ROOT, MEDIA_ROOT]) {
    const entries = await fs.readdir(directory, {withFileTypes: true}).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const source = ALBUM_SOURCES.find(
        (item) => item.fileName.toLocaleLowerCase() === entry.name.toLocaleLowerCase()
      );
      if (!source) continue;
      const mediaPath = path.join(directory, entry.name);
      const stat = await fs.stat(mediaPath);
      // Avoid files that Photos is still writing and reject Git LFS pointers.
      if (stat.size <= 64 * 1_024 || Date.now() - stat.mtimeMs < 1_500) continue;
      candidates.set(source.fileName.toLocaleLowerCase(), mediaPath);
    }
  }
  return candidates;
}

async function scanPreparedMedia(): Promise<Set<number>> {
  const ready = new Set<number>();
  const entries = await fs.readdir(PREPARED_ROOT, {withFileTypes: true}).catch(() => []);
  for (const entry of entries) {
    const match = /^(\d+)\.mp4$/.exec(entry.name);
    if (!entry.isFile() || !match) continue;
    const beat = Number(match[1]);
    const stat = await fs.stat(path.join(PREPARED_ROOT, entry.name));
    if (beat >= 1 && beat <= 32 && stat.size > 64 * 1_024) ready.add(beat);
  }
  return ready;
}

async function resolveMediaPath(fileName: string): Promise<string | null> {
  return (await scanReadyMedia()).get(fileName.toLocaleLowerCase()) ?? null;
}

function timingForBeat(index: number) {
  const transitionFrames = VIDEO_FEED_CONTRACT.transitionFrameCount;
  return {
    intervalStartFrame: Math.round((index * transitionFrames) / 32),
    markerFrame: Math.round(((index + 1) * transitionFrames) / 32),
    globalStartSeconds: 14.1 + Math.round((index * transitionFrames) / 32) / 60,
  };
}

async function ensureCache(): Promise<void> {
  await fs.mkdir(MEDIA_ROOT, {recursive: true});
  try {
    await fs.access(TRIMS_PATH);
  } catch {
    const trims = Object.fromEntries(
      Array.from({length: VIDEO_FEED_CONTRACT.beatCount}, (_, index) => [
        String(index + 1),
        defaultTrimForBeat(index + 1),
      ])
    );
    await fs.writeFile(
      TRIMS_PATH,
      `${JSON.stringify({version: 1, updatedAt: new Date().toISOString(), trims}, null, 2)}\n`
    );
  }
}

async function readTrimFile(): Promise<TrimFile> {
  return JSON.parse(await fs.readFile(TRIMS_PATH, "utf8")) as TrimFile;
}

async function saveTrim(beat: number, trim: FeedTrim): Promise<void> {
  if (!Number.isInteger(beat) || beat < 1 || beat > 32) {
    throw new Error("Beat must be an integer from 1 through 32.");
  }
  const lockedTrim = lockTrimWindow(beat, trim);
  validateTrim(beat, lockedTrim);
  const file = await readTrimFile();
  file.trims[String(beat)] = lockedTrim;
  file.updatedAt = new Date().toISOString();
  await fs.writeFile(TRIMS_PATH, `${JSON.stringify(file, null, 2)}\n`);
}

function validateTrim(beat: number, trim: FeedTrim): void {
  const duration = sourceForBeat(beat).durationSeconds;
  const trimWindowSeconds = trim.trimOutSeconds - trim.trimInSeconds;
  if (
    !Number.isFinite(trim.trimInSeconds) ||
    !Number.isFinite(trim.trimOutSeconds) ||
    trim.trimInSeconds < 0 ||
    trim.trimOutSeconds <= trim.trimInSeconds ||
    trim.trimOutSeconds > duration + 0.01 ||
    Math.abs(trimWindowSeconds - VIDEO_FEED_CONTRACT.feed.trimWindowSeconds) > 0.001
  ) {
    throw new Error(`Beat ${beat} must use the locked 0.9-second trim window.`);
  }
  if (
    trim.cropXPercent < 0 ||
    trim.cropXPercent > 100 ||
    trim.cropYPercent < 0 ||
    trim.cropYPercent > 100 ||
    trim.scale < 1 ||
    trim.scale > 2
  ) {
    throw new Error(`Invalid crop for beat ${beat}.`);
  }
}

function safeExpectedFileName(requested: string): string {
  const match = ALBUM_SOURCES.find(
    (source) => source.fileName.toLocaleLowerCase() === requested.toLocaleLowerCase()
  );
  if (!match || path.basename(requested) !== requested) {
    throw new Error("That filename is not part of the locked Photos album manifest.");
  }
  return match.fileName;
}

async function serveMedia(
  request: IncomingMessage,
  response: ServerResponse,
  mediaPath: string
): Promise<void> {
  const stat = await fs.stat(mediaPath);
  const range = request.headers.range;
  const extension = path.extname(mediaPath).toLocaleLowerCase();
  const contentType = extension === ".mp4" ? "video/mp4" : "video/quicktime";
  if (!range) {
    response.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    createReadStream(mediaPath).pipe(response);
    return;
  }
  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) {
    response.writeHead(416).end();
    return;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : stat.size - 1;
  if (start > end || end >= stat.size) {
    response.writeHead(416, {"Content-Range": `bytes */${stat.size}`}).end();
    return;
  }
  response.writeHead(206, {
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  createReadStream(mediaPath, {start, end}).pipe(response);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {"Content-Type": "application/json; charset=utf-8"});
  response.end(`${JSON.stringify(value)}\n`);
}

async function readBody(
  request: IncomingMessage,
  limitBytes = 1_000_000
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limitBytes) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function parsePort(argv: string[]): number {
  const index = argv.indexOf("--port");
  if (index === -1) return 0;
  const port = Number(argv[index + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port must be an integer from 0 through 65535.");
  }
  return port;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {url} = await startVideoFeedServer({port: parsePort(process.argv.slice(2))});
  process.stdout.write(`AROUND_THE_WORLD_VIDEO_FEED ${url}\n`);
}
