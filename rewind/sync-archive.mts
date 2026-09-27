#!/usr/bin/env tsx

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  applyGeographicMemorySelectionOverride,
  buildGeographicMemorySequence,
  focusZoomForMemory,
  type FitnessArchiveBundle,
  type GeographicMemorySequence,
} from "./scene/geographic-memory-model";
import {
  parseMapboxMemoryLocation,
  type GeographicMemoryLocation,
} from "./scene/geographic-memory-caption";
import type { ArchiveRoute, ArchiveRoutePath, LonLat } from "./scene/rewind-model";

type JsonObject = Record<string, unknown>;

type StacRow = {
  id: string;
  geometry: unknown;
  bbox: unknown;
  datetime: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
  properties: JsonObject;
  assets: JsonObject;
  updated_at: string | null;
};

type RouteCandidate = {
  geometry: { type: "LineString" | "MultiLineString"; coordinates: unknown };
  properties: JsonObject;
  pointCount: number;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const ARCHIVE_ROOT = path.join(REPO_ROOT, ".cache/fitness-archive");
const OBJECT_ROOT = path.join(ARCHIVE_ROOT, "objects");
const DATABASE_PATH = path.join(ARCHIVE_ROOT, "fitness.sqlite");
const SCENE_BUNDLE_PATH = path.join(ARCHIVE_ROOT, "scene.json");
const MANIFEST_PATH = path.join(ARCHIVE_ROOT, "manifest.json");
const PLACE_CACHE_PATH = path.join(ARCHIVE_ROOT, "memory-places-v2.json");
const ZONE_REVIEW_PATH = path.join(HERE, "ZONE-REVIEW.md");
const OWNER_USERNAME = readOption("--owner") ?? "crich";
const STAMP_ONLY = process.argv.includes("--stamp-only");
const SEQUENCE_ONLY = process.argv.includes("--sequence-only");
const START_DATE = "2022-01-01";
const END_DATE_EXCLUSIVE = "2028-01-01";
const PAGE_SIZE = 500;
const RENDER_MAX_POINTS = 1_200;

// Importing the bounded read helpers must never refresh the old production.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await loadLocalEnv(path.join(REPO_ROOT, ".env"));
  await main();
}

async function main(): Promise<void> {
  if (SEQUENCE_ONLY) {
    await refreshSequenceFromLocalArchive();
    return;
  }
  const baseUrl =
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!baseUrl || !serviceRole) {
    throw new Error("Archive sync requires Supabase URL and service-role key.");
  }
  const headers = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
  };
  const ownerId = await resolveOwnerId(baseUrl, headers, OWNER_USERNAME);
  const ownerFingerprint = fingerprint(ownerId);
  process.stdout.write(
    `FITNESS_ARCHIVE_OWNER ${OWNER_USERNAME} ${ownerFingerprint}\n`
  );

  const byId = new Map<string, StacRow>();
  for (let year = 2022; year < 2028; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const start = new Date(Date.UTC(year, month, 1)).toISOString();
      const end = new Date(Date.UTC(year, month + 1, 1)).toISOString();
      const rows = await fetchStacWindow(baseUrl, headers, ownerId, start, end);
      for (const row of rows) byId.set(row.id, row);
    }
    process.stdout.write(
      `FITNESS_ARCHIVE_INDEX ${year} ${byId.size} candidate items\n`
    );
  }

  const rows = [...byId.values()].sort(
    (a, b) => temporalStart(a) - temporalStart(b)
  );
  if (STAMP_ONLY) {
    stampSourceIndex(rows);
    process.stdout.write(
      `FITNESS_ARCHIVE_STAMPED ${rows.length} indexed items for incremental refresh\n`
    );
    return;
  }

  await fs.mkdir(OBJECT_ROOT, { recursive: true });
  const existingCache = await loadExistingCache();
  const crashObjectCache = await loadCrashObjectCache();
  const routes: ArchiveRoute[] = [];
  const objectHashes = new Set<string>();
  const routeObjectHashes = new Map<string, string>();
  let cursor = 0;
  await runPool(rows, 2, async (row) => {
    const routeId = fingerprint(row.id);
    const cached = existingCache.get(routeId);
    let route: {
      route: ArchiveRoute;
      sha256: string;
      objectJson: string | null;
    } | null;
    if (cached?.sourceRevision === sourceRevision(row)) {
      route = cached.route
        ? { route: cached.route, sha256: cached.sha256 ?? "", objectJson: null }
        : null;
    } else if (crashObjectCache.has(routeId)) {
      route =
        routeFromCachedObject(row, crashObjectCache.get(routeId)!) ??
        (await buildArchiveRoute(baseUrl, headers, row));
    } else {
      route = await buildArchiveRoute(baseUrl, headers, row);
    }
    cursor += 1;
    if (route) {
      routes.push(route.route);
      objectHashes.add(route.sha256);
      routeObjectHashes.set(route.route.id, route.sha256);
      if (route.objectJson) {
        await fs
          .writeFile(
            path.join(OBJECT_ROOT, `${route.sha256}.json`),
            route.objectJson,
            { flag: "wx" }
          )
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          });
      }
    }
    if (cursor % 100 === 0 || cursor === rows.length) {
      process.stdout.write(
        `FITNESS_ARCHIVE_GEOMETRY ${cursor}/${rows.length} ${routes.length} routes\n`
      );
    }
  });
  routes.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));

  const sequenceRoutes = routes.filter(
    (route) =>
      route.startMs >= Date.parse("2023-01-01T00:00:00.000Z") &&
      route.startMs < Date.parse("2026-09-06T00:00:00.000Z")
  );
  const sequence = applyEditorialMemorySelections(
    await enrichMemoryLocations(buildGeographicMemorySequence(sequenceRoutes))
  );
  const generatedAt = new Date().toISOString();
  const bundle: FitnessArchiveBundle = {
    status: "ready",
    schemaVersion: 2,
    generatedAt,
    ownerFingerprint,
    range: { start: START_DATE, endExclusive: END_DATE_EXCLUSIVE },
    routeCount: routes.length,
    timedRouteCount: routes.filter((route) => route.timing === "recorded")
      .length,
    inferredRouteCount: routes.filter((route) => route.timing === "inferred")
      .length,
    objectCount: objectHashes.size,
    routes,
    sequence,
  };

  writeSqlite(bundle, routes, routeObjectHashes, rows);
  await Promise.all([
    fs.writeFile(SCENE_BUNDLE_PATH, `${JSON.stringify(bundle)}\n`, "utf8"),
    fs.writeFile(
      MANIFEST_PATH,
      `${JSON.stringify(
        {
          schemaVersion: bundle.schemaVersion,
          generatedAt,
          ownerFingerprint,
          range: bundle.range,
          routeCount: bundle.routeCount,
          timedRouteCount: bundle.timedRouteCount,
          inferredRouteCount: bundle.inferredRouteCount,
          objectCount: bundle.objectCount,
          sequence: {
            boundaries: sequence.boundaries,
            beatCount: sequence.beats.length,
            alternateCount: sequence.alternates.length,
            selectorVersion: sequence.selectorVersion,
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    ),
    fs.writeFile(ZONE_REVIEW_PATH, renderZoneReview(sequence, routes), "utf8"),
  ]);
  process.stdout.write(
    `FITNESS_ARCHIVE_READY ${routes.length} routes ${bundle.timedRouteCount} timed ${DATABASE_PATH}\n`
  );
}

async function refreshSequenceFromLocalArchive(): Promise<void> {
  const bundle = JSON.parse(
    await fs.readFile(SCENE_BUNDLE_PATH, "utf8")
  ) as FitnessArchiveBundle;
  if (bundle.status !== "ready" || !Array.isArray(bundle.routes)) {
    throw new Error("The local fitness scene archive is invalid.");
  }
  const sequenceRoutes = bundle.routes.filter(
    (route) =>
      route.startMs >= Date.parse("2023-01-01T00:00:00.000Z") &&
      route.startMs < Date.parse("2026-09-06T00:00:00.000Z")
  );
  const sequence = applyEditorialMemorySelections(
    await enrichMemoryLocations(buildGeographicMemorySequence(sequenceRoutes))
  );
  const updatedBundle: FitnessArchiveBundle = {
    ...bundle,
    schemaVersion: 2,
    sequence,
  };
  const manifest = JSON.parse(
    await fs.readFile(MANIFEST_PATH, "utf8")
  ) as Record<string, unknown>;
  await Promise.all([
    fs.writeFile(
      SCENE_BUNDLE_PATH,
      `${JSON.stringify(updatedBundle)}\n`,
      "utf8"
    ),
    fs.writeFile(
      MANIFEST_PATH,
      `${JSON.stringify(
        {
          ...manifest,
          sequence: {
            boundaries: sequence.boundaries,
            beatCount: sequence.beats.length,
            alternateCount: sequence.alternates.length,
            selectorVersion: sequence.selectorVersion,
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    ),
    fs.writeFile(
      ZONE_REVIEW_PATH,
      renderZoneReview(sequence, bundle.routes),
      "utf8"
    ),
  ]);
  process.stdout.write(
    `FITNESS_ARCHIVE_SEQUENCE_READY ${sequence.beats.length} geographic memories plus ${sequence.alternates.length} alternates from ${sequenceRoutes.length} routes\n`
  );
}

async function enrichMemoryLocations(
  sequence: GeographicMemorySequence
): Promise<GeographicMemorySequence> {
  const accessToken = process.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
  const cache = await readMemoryPlaceCache();
  const entries = [...sequence.beats, ...sequence.alternates];
  await runPool(entries, 4, async (entry) => {
    const cacheKey = fingerprint(
      `${entry.zone.longitude.toFixed(5)},${entry.zone.latitude.toFixed(5)}`
    );
    let location: GeographicMemoryLocation | null = cache[cacheKey] ?? null;
    if (!location && accessToken) {
      location = await requestMemoryLocation(
        entry.zone.longitude,
        entry.zone.latitude,
        accessToken
      );
      if (location) cache[cacheKey] = location;
    }
    entry.zone.location = location;
  });
  const missingSelected = sequence.beats.filter((beat) => !beat.zone.location);
  if (missingSelected.length > 0) {
    throw new Error(
      `Location captions are missing for ${missingSelected.length} selected memories.`
    );
  }
  await fs.writeFile(
    PLACE_CACHE_PATH,
    `${JSON.stringify(cache, null, 2)}\n`,
    "utf8"
  );
  return sequence;
}

function applyEditorialMemorySelections(
  sequence: GeographicMemorySequence
): GeographicMemorySequence {
  const updated = applyGeographicMemorySelectionOverride(sequence, {
    replace: { cityOrRegion: "Gunnison", state: "Colorado" },
    promote: { cityOrRegion: "Westminster", state: "Colorado" },
  });
  const hasDenverAreaMemory = updated.beats.some(
    (beat) =>
      beat.zone.location?.cityOrRegion === "Westminster" &&
      beat.zone.location.state === "Colorado"
  );
  if (!hasDenverAreaMemory) {
    throw new Error("The approved Denver-area memory is unavailable.");
  }
  return updated;
}

async function readMemoryPlaceCache(): Promise<
  Record<string, GeographicMemoryLocation>
> {
  try {
    const value = JSON.parse(
      await fs.readFile(PLACE_CACHE_PATH, "utf8")
    ) as Record<string, GeographicMemoryLocation>;
    return value && typeof value === "object" ? value : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function requestMemoryLocation(
  longitude: number,
  latitude: number,
  accessToken: string
): Promise<GeographicMemoryLocation | null> {
  const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("types", "place,locality,district,region,country");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  if (!response.ok) return null;
  return parseMapboxMemoryLocation(await response.json());
}

function renderZoneReview(
  sequence: GeographicMemorySequence,
  routes: readonly ArchiveRoute[]
): string {
  const routesById = new Map(routes.map((route) => [route.id, route]));
  const rows = sequence.beats.map((beat) => {
    const zone = beat.zone;
    const peakZoom = focusZoomForMemory(zone).toFixed(2);
    const regions = summarizeRegions(
      zone.routeIds
        .map((id) => routesById.get(id))
        .filter((route): route is ArchiveRoute => Boolean(route))
    );
    return `| ${String(beat.beat).padStart(2, "0")} | ${beat.representativeDate} | ${regions} | ${zone.routeCount} / ${zone.totalRouteCount} | ${zone.activeDays} | ${zone.collectionRadiusKm.toFixed(0)} km | ${zone.focusRadiusKm.toFixed(0)} km | ${zone.radiusKm.toFixed(0)} km | ${beat.nearestSelectedKm.toFixed(0)} km | ${peakZoom} | ${beat.selectionRank} |`;
  });
  return `# 32 geographic-memory review

This is the privacy-safe geographic-memory manifest generated from the local fitness
archive. Region names are deliberately broad; precise route coordinates and
route IDs remain only in the ignored local scene cache.

- The 32 selected memories are ordered in strict reverse chronology after a
  geography-first max-min selection pass. The private manifest retains 16
  deterministic alternates.
- **Emphasized / memory** is the full-strength route subset versus every route
  in the selected visit. Dense memories cap emphasis at 48 routes.
- **Visible frame radius** fits the emphasized routes that actually render at
  full strength. **Visit radius** preserves the complete visit extent for review.
  **Nearest selected** records geographic spread.
- The camera flies directly between successive memories; no beat performs a
  required orbit or returns to a canonical center.

| Hit | Representative date | Privacy-safe region | Emphasized / memory | Active days | Collection radius | Visible frame radius | Visit radius | Nearest selected | Peak zoom | Geographic rank |
|---:|:---|:---|---:|---:|---:|---:|---:|---:|---:|---:|
${rows.join("\n")}
`;
}

function summarizeRegions(routes: readonly ArchiveRoute[]): string {
  const counts = new Map<string, number>();
  for (const route of routes) {
    const region = broadRouteRegion(route);
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([region, count]) => `${region} (${count})`)
    .join(" + ");
}

function broadRouteRegion(route: ArchiveRoute): string {
  const [west, south, east, north] = route.bbox;
  if (east >= -92.4 && west <= -88.1 && north >= 13.5 && south <= 18) {
    return "Guatemala";
  }
  return broadRegion(route.center[0], route.center[1]);
}

function broadRegion(longitude: number, latitude: number): string {
  if (
    latitude >= 25.5 &&
    latitude < 27.8 &&
    longitude >= -81.5 &&
    longitude < -79
  ) {
    return "South Florida";
  }
  if (
    latitude >= 27.5 &&
    latitude < 29.2 &&
    longitude >= -82.5 &&
    longitude < -80
  ) {
    return "Central Florida";
  }
  if (
    latitude >= 28.5 &&
    latitude < 31.5 &&
    longitude >= -84.5 &&
    longitude < -80.5
  ) {
    return "North Florida";
  }
  if (latitude >= 40 && latitude < 44 && longitude >= -11 && longitude < -7) {
    return "Galicia";
  }
  if (latitude >= 56 && latitude < 60 && longitude >= 10 && longitude < 14) {
    return "West Sweden";
  }
  if (latitude >= 28 && latitude < 32 && longitude >= -100 && longitude < -96) {
    return "Central Texas";
  }
  if (
    latitude >= 44 &&
    latitude < 48 &&
    longitude >= -114 &&
    longitude < -108
  ) {
    return "Southwest Montana";
  }
  if (latitude >= 8 && latitude < 13 && longitude >= -87 && longitude < -82) {
    return "Central America";
  }
  if (latitude >= 10 && latitude < 26 && longitude >= -90 && longitude < -60) {
    return "Caribbean";
  }
  if (latitude >= 37 && latitude < 46 && longitude >= -82 && longitude < -66) {
    return "Northeast US";
  }
  if (
    latitude >= 30 &&
    latitude < 50 &&
    longitude >= -125 &&
    longitude < -100
  ) {
    return "Western US";
  }
  if (latitude >= 25 && latitude < 38 && longitude >= -100 && longitude < -75) {
    return "Southeast US";
  }
  if (latitude >= 35 && latitude < 61 && longitude >= -12 && longitude < 32) {
    return "Europe";
  }
  return "Additional travel";
}

export async function resolveOwnerId(
  baseUrl: string,
  headers: Record<string, string>,
  username: string
): Promise<string> {
  const url = new URL(`${baseUrl}/rest/v1/users`);
  url.searchParams.set("select", "id");
  url.searchParams.set("username", `eq.${username}`);
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Owner lookup failed (${response.status}).`);
  }
  const users = (await response.json()) as Array<{ id: string }>;
  if (users.length !== 1 || !users[0]?.id) {
    throw new Error(
      `Expected exactly one archive owner for ${username}; found ${users.length}.`
    );
  }
  return users[0].id;
}

export async function fetchStacWindow(
  baseUrl: string,
  headers: Record<string, string>,
  ownerId: string,
  start: string,
  end: string
): Promise<StacRow[]> {
  const byId = new Map<string, StacRow>();
  for (const temporalColumn of ["start_datetime", "datetime"] as const) {
    let offset = 0;
    for (;;) {
      const url = new URL(`${baseUrl}/rest/v1/stac_items`);
      url.searchParams.set(
        "select",
        "id,geometry,bbox,datetime,start_datetime,end_datetime,properties,assets,updated_at"
      );
      url.searchParams.set("owner_id", `eq.${ownerId}`);
      url.searchParams.append(temporalColumn, `gte.${start}`);
      url.searchParams.append(temporalColumn, `lt.${end}`);
      url.searchParams.set("properties->>item_kind", "eq.motion");
      const response = await fetch(url, {
        headers: {
          ...headers,
          Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        },
      });
      if (!response.ok) {
        throw new Error(
          `STAC ${temporalColumn} window failed (${response.status}).`
        );
      }
      const rows = (await response.json()) as StacRow[];
      for (const row of rows) byId.set(row.id, row);
      if (rows.length < PAGE_SIZE) break;
      offset += rows.length;
      if (offset > 20_000) {
        throw new Error("STAC monthly page bound exceeded.");
      }
    }
  }
  return [...byId.values()];
}

export async function buildArchiveRoute(
  baseUrl: string,
  headers: Record<string, string>,
  row: StacRow
): Promise<{ route: ArchiveRoute; sha256: string; objectJson: string } | null> {
  const embedded = bestRouteCandidate({
    type: "Feature",
    geometry: row.geometry,
    properties: row.properties,
  });
  const storageKey = routeStorageKey(row);
  const asset = storageKey
    ? await downloadStorageJson(baseUrl, headers, storageKey).catch(() => null)
    : null;
  const assetCandidate = asset ? bestRouteCandidate(asset) : null;
  const candidate =
    assetCandidate &&
    (!embedded || assetCandidate.pointCount >= embedded.pointCount)
      ? assetCandidate
      : embedded;
  if (!candidate || candidate.pointCount < 2) return null;

  const fullPaths = geometryPaths(candidate.geometry.coordinates);
  if (fullPaths.length === 0) return null;
  const times = routeTimes(candidate.properties, fullPaths);
  const routePaths = downsamplePaths(fullPaths, times, RENDER_MAX_POINTS);
  const allPositions = routePaths.flatMap((routePath) => routePath.positions);
  if (allPositions.length < 2) return null;
  const bbox = bboxForPositions(allPositions);
  const startMs = firstFiniteTime(
    times.flat(),
    candidate.properties.start_datetime,
    row.start_datetime,
    row.datetime
  );
  const endMs = lastFiniteTime(
    times.flat(),
    candidate.properties.end_datetime,
    row.end_datetime,
    row.datetime,
    startMs + 60_000
  );
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const timing = times.some((pathTimes) => pathTimes.length > 1)
    ? "recorded"
    : "inferred";
  const object = {
    schemaVersion: 1,
    sourceItemFingerprint: fingerprint(row.id),
    sourceRevision: sourceRevision(row),
    startMs,
    endMs: Math.max(endMs, startMs + 1),
    timing,
    geometry: candidate.geometry,
    coordinateProperties: candidate.properties.coordinateProperties ?? null,
    lods: {
      overview: downsamplePaths(fullPaths, times, 64),
      preview: downsamplePaths(fullPaths, times, 256),
      render: routePaths,
    },
  };
  const objectJson = `${JSON.stringify(object)}\n`;
  const sha256 = createHash("sha256").update(objectJson).digest("hex");
  const route: ArchiveRoute = {
    id: fingerprint(row.id),
    startMs,
    endMs: Math.max(endMs, startMs + 1),
    activityType: stringValue(
      row.properties.activity_type,
      candidate.properties.activity_type,
      "activity"
    ),
    provider: stringValue(row.properties.provider, "unknown"),
    timing,
    bbox,
    center: bboxCenter(bbox),
    pointCount: candidate.pointCount,
    paths: routePaths,
  };
  return { route, sha256, objectJson };
}

async function loadCrashObjectCache(): Promise<
  Map<string, { sha256: string; object: JsonObject }>
> {
  const result = new Map<string, { sha256: string; object: JsonObject }>();
  const filenames = await fs.readdir(OBJECT_ROOT).catch(() => [] as string[]);
  const cutoffMs = Date.now() - 6 * 60 * 60 * 1000;
  for (const filename of filenames) {
    if (!/^[a-f0-9]{64}\.json$/u.test(filename)) continue;
    const objectPath = path.join(OBJECT_ROOT, filename);
    const stats = await fs.stat(objectPath).catch(() => null);
    if (!stats || stats.mtimeMs < cutoffMs) continue;
    const object = await fs
      .readFile(objectPath, "utf8")
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null);
    if (!isObject(object)) continue;
    const lods = isObject(object.lods) ? object.lods : null;
    if (!Array.isArray(lods?.render)) continue;
    const itemFingerprint = object.sourceItemFingerprint;
    if (typeof itemFingerprint !== "string") continue;
    result.set(itemFingerprint, {
      sha256: filename.slice(0, -5),
      object,
    });
  }
  if (result.size > 0) {
    process.stdout.write(
      `FITNESS_ARCHIVE_RECOVERY ${result.size} recent route objects\n`
    );
  }
  return result;
}

function routeFromCachedObject(
  row: StacRow,
  cached: { sha256: string; object: JsonObject }
): { route: ArchiveRoute; sha256: string; objectJson: null } | null {
  const lods = isObject(cached.object.lods) ? cached.object.lods : null;
  const render = Array.isArray(lods?.render) ? lods.render : null;
  const paths: ArchiveRoutePath[] = [];
  for (const value of render ?? []) {
    if (!isObject(value) || !Array.isArray(value.positions)) continue;
    const positions = value.positions
      .filter(isPosition)
      .map((position) => [Number(position[0]), Number(position[1])] as LonLat)
      .filter(validPosition);
    if (positions.length < 2) continue;
    const timesMs = Array.isArray(value.timesMs)
      ? value.timesMs.map(Number).filter(Number.isFinite)
      : [];
    paths.push({
      positions,
      ...(timesMs.length === positions.length ? { timesMs } : {}),
    });
  }
  if (paths.length === 0) return null;
  const positions = paths.flatMap((routePath) => routePath.positions);
  const bbox = bboxForPositions(positions);
  const startMs = Number(cached.object.startMs);
  const endMs = Number(cached.object.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const geometry = isObject(cached.object.geometry)
    ? cached.object.geometry
    : null;
  const pointCount = geometry
    ? geometryPaths(geometry.coordinates).reduce(
        (sum, routePath) => sum + routePath.length,
        0
      )
    : positions.length;
  return {
    route: {
      id: fingerprint(row.id),
      startMs,
      endMs,
      activityType: stringValue(row.properties.activity_type, "activity"),
      provider: stringValue(row.properties.provider, "unknown"),
      timing: cached.object.timing === "recorded" ? "recorded" : "inferred",
      bbox,
      center: bboxCenter(bbox),
      pointCount,
      paths,
    },
    sha256: cached.sha256,
    objectJson: null,
  };
}

async function downloadStorageJson(
  baseUrl: string,
  headers: Record<string, string>,
  storageKey: string
): Promise<unknown> {
  const encoded = storageKey
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const response = await fetch(
    `${baseUrl}/storage/v1/object/authenticated/stac-assets/${encoded}`,
    { headers }
  );
  if (!response.ok) {
    throw new Error(`Route asset download failed (${response.status}).`);
  }
  return response.json() as Promise<unknown>;
}

function bestRouteCandidate(value: unknown): RouteCandidate | null {
  const candidates: RouteCandidate[] = [];
  collectCandidates(value, candidates);
  candidates.sort((a, b) => b.pointCount - a.pointCount);
  return candidates[0] ?? null;
}

function collectCandidates(value: unknown, out: RouteCandidate[]): void {
  if (Array.isArray(value)) {
    for (const child of value) collectCandidates(child, out);
    return;
  }
  if (!isObject(value)) return;
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    collectCandidates(value.features, out);
    return;
  }
  if (value.type === "Feature") {
    const geometry = isObject(value.geometry) ? value.geometry : null;
    const properties = isObject(value.properties) ? value.properties : {};
    if (
      geometry &&
      (geometry.type === "LineString" || geometry.type === "MultiLineString")
    ) {
      const paths = geometryPaths(geometry.coordinates);
      const pointCount = paths.reduce((sum, path) => sum + path.length, 0);
      if (pointCount >= 2) {
        out.push({
          geometry: {
            type: geometry.type,
            coordinates: geometry.coordinates,
          } as RouteCandidate["geometry"],
          properties,
          pointCount,
        });
      }
    }
    collectCandidates(properties.features_lod ?? properties.featuresLod, out);
    return;
  }
  if (value.type === "LineString" || value.type === "MultiLineString") {
    const paths = geometryPaths(value.coordinates);
    const pointCount = paths.reduce((sum, path) => sum + path.length, 0);
    if (pointCount >= 2) {
      out.push({
        geometry: {
          type: value.type,
          coordinates: value.coordinates,
        } as RouteCandidate["geometry"],
        properties: {},
        pointCount,
      });
    }
  }
}

function geometryPaths(value: unknown): LonLat[][] {
  if (!Array.isArray(value)) return [];
  if (isPosition(value)) {
    return [];
  }
  if (value.every(isPosition)) {
    const path = value
      .map((position) => [Number(position[0]), Number(position[1])] as LonLat)
      .filter(validPosition);
    return path.length >= 2 ? [path] : [];
  }
  return value.flatMap(geometryPaths);
}

function routeTimes(properties: JsonObject, paths: LonLat[][]): number[][] {
  const coordinateProperties = isObject(properties.coordinateProperties)
    ? properties.coordinateProperties
    : {};
  const raw = coordinateProperties.times;
  if (paths.length === 1 && Array.isArray(raw)) {
    const parsed = raw.map(parseTime);
    if (parsed.length === paths[0].length && parsed.every(Number.isFinite)) {
      return [parsed];
    }
  }
  if (
    paths.length > 1 &&
    Array.isArray(raw) &&
    raw.length === paths.length &&
    raw.every(Array.isArray)
  ) {
    const parsed = raw.map((values) => (values as unknown[]).map(parseTime));
    if (
      parsed.every(
        (values, index) =>
          values.length === paths[index].length && values.every(Number.isFinite)
      )
    ) {
      return parsed;
    }
  }
  return paths.map(() => []);
}

function downsamplePaths(
  paths: LonLat[][],
  times: number[][],
  maximum: number
): ArchiveRoutePath[] {
  const total = paths.reduce((sum, routePath) => sum + routePath.length, 0);
  return paths.map((routePath, pathIndex) => {
    const allowance = Math.max(
      2,
      Math.floor((routePath.length / total) * maximum)
    );
    if (routePath.length <= allowance) {
      return {
        positions: routePath,
        ...(times[pathIndex]?.length === routePath.length
          ? { timesMs: times[pathIndex] }
          : {}),
      };
    }
    const indices = Array.from({ length: allowance }, (_, index) =>
      Math.round((index / (allowance - 1)) * (routePath.length - 1))
    );
    return {
      positions: indices.map((index) => routePath[index]),
      ...(times[pathIndex]?.length === routePath.length
        ? { timesMs: indices.map((index) => times[pathIndex][index]) }
        : {}),
    };
  });
}

function routeStorageKey(row: StacRow): string | null {
  const assets = row.assets ?? {};
  for (const key of ["route", "data", "geojson", "original"]) {
    const asset = isObject(assets[key]) ? assets[key] : null;
    const value = asset?.storage_key ?? asset?.href;
    if (typeof value === "string" && value && !/^https?:/i.test(value)) {
      return value.replace(/^\/+/, "");
    }
  }
  for (const asset of Object.values(assets)) {
    if (!isObject(asset)) continue;
    const value = asset.storage_key ?? asset.href;
    if (typeof value === "string" && value && !/^https?:/i.test(value)) {
      return value.replace(/^\/+/, "");
    }
  }
  const propertyKey = row.properties.storage_key;
  return typeof propertyKey === "string" && propertyKey
    ? propertyKey.replace(/^\/+/, "")
    : null;
}

function writeSqlite(
  bundle: FitnessArchiveBundle,
  routes: ArchiveRoute[],
  routeObjectHashes: Map<string, string>,
  sourceRows: StacRow[]
): void {
  const database = new DatabaseSync(DATABASE_PATH);
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS routes (
        id TEXT PRIMARY KEY,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        activity_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        timing TEXT NOT NULL,
        bbox_json TEXT NOT NULL,
        point_count INTEGER NOT NULL,
        object_sha256 TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS route_objects (sha256 TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS source_items (
        id TEXT PRIMARY KEY,
        source_revision TEXT NOT NULL,
        object_sha256 TEXT,
        is_route INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS routes_start_ms ON routes(start_ms);
      DELETE FROM metadata;
      DELETE FROM routes;
      DELETE FROM route_objects;
      DELETE FROM source_items;
    `);
    const putMetadata = database.prepare(
      "INSERT INTO metadata(key, value) VALUES (?, ?)"
    );
    for (const [key, value] of Object.entries({
      schemaVersion: bundle.schemaVersion,
      generatedAt: bundle.generatedAt,
      ownerFingerprint: bundle.ownerFingerprint,
      start: bundle.range.start,
      endExclusive: bundle.range.endExclusive,
      routeCount: bundle.routeCount,
      timedRouteCount: bundle.timedRouteCount,
      inferredRouteCount: bundle.inferredRouteCount,
    })) {
      putMetadata.run(key, String(value));
    }
    const putRoute = database.prepare(
      "INSERT INTO routes(id,start_ms,end_ms,activity_type,provider,timing,bbox_json,point_count,object_sha256) VALUES (?,?,?,?,?,?,?,?,?)"
    );
    for (const route of routes) {
      putRoute.run(
        route.id,
        route.startMs,
        route.endMs,
        route.activityType,
        route.provider,
        route.timing,
        JSON.stringify(route.bbox),
        route.pointCount,
        routeObjectHashes.get(route.id) ?? ""
      );
    }
    const putObject = database.prepare(
      "INSERT INTO route_objects(sha256) VALUES (?)"
    );
    for (const sha256 of new Set(routeObjectHashes.values())) {
      putObject.run(sha256);
    }
    const putSource = database.prepare(
      "INSERT INTO source_items(id,source_revision,object_sha256,is_route) VALUES (?,?,?,?)"
    );
    for (const row of sourceRows) {
      const id = fingerprint(row.id);
      const objectSha256 = routeObjectHashes.get(id) ?? null;
      putSource.run(
        id,
        sourceRevision(row),
        objectSha256,
        objectSha256 ? 1 : 0
      );
    }
  } finally {
    database.close();
  }
}

async function loadExistingCache(): Promise<
  Map<
    string,
    {
      sourceRevision: string;
      sha256: string | null;
      route: ArchiveRoute | null;
    }
  >
> {
  const bundle = await fs
    .readFile(SCENE_BUNDLE_PATH, "utf8")
    .then((text) => JSON.parse(text) as FitnessArchiveBundle)
    .catch(() => null);
  const routes = new Map<string, ArchiveRoute>(
    (bundle?.routes ?? []).map((route) => [route.id, route] as const)
  );
  try {
    const database = new DatabaseSync(DATABASE_PATH, { readOnly: true });
    try {
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='source_items'"
        )
        .get();
      if (!table) return new Map();
      const rows = database
        .prepare(
          "SELECT id,source_revision,object_sha256,is_route FROM source_items"
        )
        .all() as Array<{
        id: string;
        source_revision: string;
        object_sha256: string | null;
        is_route: number;
      }>;
      return new Map<
        string,
        {
          sourceRevision: string;
          sha256: string | null;
          route: ArchiveRoute | null;
        }
      >(
        rows.map((row) => [
          row.id,
          {
            sourceRevision: row.source_revision,
            sha256: row.object_sha256,
            route: row.is_route ? (routes.get(row.id) ?? null) : null,
          },
        ])
      );
    } finally {
      database.close();
    }
  } catch {
    return new Map();
  }
}

function stampSourceIndex(sourceRows: StacRow[]): void {
  const database = new DatabaseSync(DATABASE_PATH);
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS source_items (
        id TEXT PRIMARY KEY,
        source_revision TEXT NOT NULL,
        object_sha256 TEXT,
        is_route INTEGER NOT NULL
      );
      DELETE FROM source_items;
    `);
    const routeRows = database
      .prepare("SELECT id,object_sha256 FROM routes")
      .all() as Array<{ id: string; object_sha256: string }>;
    const routeObjects = new Map(
      routeRows.map((row) => [row.id, row.object_sha256] as const)
    );
    const putSource = database.prepare(
      "INSERT INTO source_items(id,source_revision,object_sha256,is_route) VALUES (?,?,?,?)"
    );
    for (const row of sourceRows) {
      const id = fingerprint(row.id);
      const objectSha256 = routeObjects.get(id) ?? null;
      putSource.run(
        id,
        sourceRevision(row),
        objectSha256,
        objectSha256 ? 1 : 0
      );
    }
  } finally {
    database.close();
  }
}

function sourceRevision(row: StacRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        updatedAt: row.updated_at,
        start: row.start_datetime,
        end: row.end_datetime,
        datetime: row.datetime,
        storageKey: routeStorageKey(row),
        geometry: row.geometry,
      })
    )
    .digest("hex")
    .slice(0, 20);
}

async function runPool<T>(
  values: readonly T[],
  concurrency: number,
  work: (value: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= values.length) return;
        await work(values[index]);
      }
    })
  );
}

export async function loadLocalEnv(filename: string): Promise<void> {
  const text = await fs.readFile(filename, "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

function temporalStart(row: StacRow): number {
  return parseTime(row.start_datetime ?? row.datetime ?? 0);
}

function bboxForPositions(
  positions: LonLat[]
): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [longitude, latitude] of positions) {
    west = Math.min(west, longitude);
    south = Math.min(south, latitude);
    east = Math.max(east, longitude);
    north = Math.max(north, latitude);
  }
  return [west, south, east, north];
}

function bboxCenter(bbox: [number, number, number, number]): LonLat {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function firstFiniteTime(times: number[], ...fallbacks: unknown[]): number {
  let minimum = Infinity;
  for (const time of times) {
    if (Number.isFinite(time)) minimum = Math.min(minimum, time);
  }
  if (Number.isFinite(minimum)) return minimum;
  for (const value of fallbacks) {
    const parsed = parseTime(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

function lastFiniteTime(times: number[], ...fallbacks: unknown[]): number {
  let maximum = -Infinity;
  for (const time of times) {
    if (Number.isFinite(time)) maximum = Math.max(maximum, time);
  }
  if (Number.isFinite(maximum)) return maximum;
  for (const value of fallbacks) {
    const parsed = parseTime(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

function parseTime(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return Number.NaN;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "unknown";
}

function isPosition(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

function validPosition(position: LonLat): boolean {
  return (
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    position[0] >= -180 &&
    position[0] <= 180 &&
    position[1] >= -90 &&
    position[1] <= 90
  );
}

function isObject(value: unknown): value is JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readOption(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}
