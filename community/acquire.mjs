#!/usr/bin/env node
import {fileURLToPath as archiveFileURLToPath} from 'node:url';

import {createHash, createHmac, randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(archiveFileURLToPath(import.meta.url));
const PRIVATE_DIR = path.join(HERE, 'private');
const DATA_DIR = path.join(HERE, 'data');
const OWNER = 'visgl';
const REPOSITORY = 'deck.gl';
const SAMPLE_WEEK_COUNT = 20;
const BUFFER_WEEKS_BEFORE = 19;
const BUFFER_WEEKS_AFTER = 3;
const PUBLIC_SCHEMA_REVISION = 'v2';
const BOT_LOGINS = new Set([
  'dependabot[bot]',
  'github-actions[bot]',
  'renovate[bot]',
  'greenkeeper[bot]',
  'codecov[bot]',
]);

const METADATA_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    databaseId
    nameWithOwner
    defaultBranchRef {
      name
      target {
        ... on Commit {
          oid
          committedDate
        }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`;

const HISTORY_QUERY = `
query($owner: String!, $name: String!, $expression: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    object(expression: $expression) {
      ... on Commit {
        oid
        history(first: 100, after: $cursor) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            oid
            authoredDate
            committedDate
            messageHeadline
            authors(first: 10) {
              totalCount
              pageInfo { hasNextPage endCursor }
              nodes {
                name
                email
                user { id databaseId login avatarUrl url }
              }
            }
          }
        }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`;

const COMPLETE_AUTHORS_QUERY = `
query($owner: String!, $name: String!, $expression: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    object(expression: $expression) {
      ... on Commit {
        authors(first: 100, after: $cursor) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            name
            email
            user { id databaseId login avatarUrl url }
          }
        }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`;

async function main() {
  await fs.mkdir(PRIVATE_DIR, {recursive: true, mode: 0o700});
  await fs.mkdir(DATA_DIR, {recursive: true, mode: 0o755});
  await fs.chmod(PRIVATE_DIR, 0o700);
  const dedupeKeyPath = path.join(PRIVATE_DIR, 'anonymous-dedupe.key');
  const dedupeKey = await loadOrCreateDedupeKey(dedupeKeyPath);

  const metadataResponse = await graphql(METADATA_QUERY, {owner: OWNER, name: REPOSITORY});
  const repository = metadataResponse.data?.repository;
  const branch = repository?.defaultBranchRef;
  const head = branch?.target;
  if (!repository || !branch || !head?.oid) throw new Error('Unable to pin the canonical default-branch head.');
  const candidateId = `${head.oid.slice(0, 12)}-${PUBLIC_SCHEMA_REVISION}`;
  const candidatePrivateDir = path.join(PRIVATE_DIR, candidateId);
  const candidateDataDir = path.join(DATA_DIR, candidateId);
  const rawPath = path.join(candidatePrivateDir, 'repository-history.private.json');
  const manifestPath = path.join(candidateDataDir, 'render-manifest.public.json');

  if (await exists(manifestPath)) {
    await writeJson(path.join(DATA_DIR, 'current.json'), {
      schemaVersion: 1,
      candidateId,
      manifestPath: `./${candidateId}/render-manifest.public.json`,
    }, 0o644);
    process.stdout.write(`ACQUISITION_REUSED candidate=${candidateId} head=${head.oid}\n`);
    return;
  }

  await fs.mkdir(candidatePrivateDir, {recursive: true, mode: 0o700});
  await fs.mkdir(candidateDataDir, {recursive: true, mode: 0o755});
  const commitsNewestFirst = [];
  let cursor;
  let expectedHistoryCount;
  let pageNumber = 0;
  do {
    const response = await graphql(HISTORY_QUERY, {
      owner: OWNER,
      name: REPOSITORY,
      expression: head.oid,
      ...(cursor ? {cursor} : {}),
    });
    const history = response.data?.repository?.object?.history;
    if (!history) throw new Error(`Missing history page ${pageNumber + 1}.`);
    expectedHistoryCount ??= history.totalCount;
    if (history.totalCount !== expectedHistoryCount) throw new Error('History count changed while paging pinned commit.');
    for (const commit of history.nodes) {
      if (commit.authors.pageInfo.hasNextPage) {
        commit.authors.nodes = await fetchAllAuthors(commit.oid, commit.authors.nodes, commit.authors.pageInfo.endCursor);
      }
      if (commit.authors.nodes.length !== commit.authors.totalCount) {
        throw new Error(`Incomplete author connection for ${commit.oid}.`);
      }
      commitsNewestFirst.push(commit);
    }
    cursor = history.pageInfo.endCursor;
    pageNumber += 1;
    process.stdout.write(
      `HISTORY_PAGE page=${pageNumber} commits=${commitsNewestFirst.length}/${expectedHistoryCount} remaining=${response.data.rateLimit.remaining}\n`,
    );
    if (!history.pageInfo.hasNextPage) break;
  } while (cursor);

  if (commitsNewestFirst.length !== expectedHistoryCount) {
    throw new Error(`Commit count mismatch: received ${commitsNewestFirst.length}, expected ${expectedHistoryCount}.`);
  }
  const commitOids = new Set(commitsNewestFirst.map((commit) => commit.oid));
  if (commitOids.size !== commitsNewestFirst.length) throw new Error('Duplicate commit OIDs in pinned history.');

  const commits = commitsNewestFirst.sort(compareCommits);
  const normalized = normalizeHistory(commits, dedupeKey);
  const selection = selectDensestWindow(normalized.days);
  const sample = buildSample(normalized, selection);
  const publicWeeks = sanitizeWeeksForPublic(sample.weeks, normalized.identities);
  const referencedIdentityIds = new Set(publicWeeks.flatMap((week) => week.days.flatMap((day) => [
    ...day.publicHumanContributorIds,
    ...day.botIds,
  ])));
  const identities = [];
  for (const identity of normalized.identities.filter((entry) => referencedIdentityIds.has(entry.id))) {
    if (identity.kind === 'public-human') {
      const avatar = await fetchAvatar(identity);
      identities.push({...identity.public, ...avatar});
      process.stdout.write(`AVATAR login=${identity.public.login}\n`);
    } else if (identity.kind === 'bot') {
      identities.push(identity.public);
    }
  }
  identities.sort((left, right) => left.id.localeCompare(right.id));

  const acquiredAt = new Date().toISOString();
  const rawSnapshot = {
    schemaVersion: 1,
    acquiredAt,
    viewer: await currentViewer(),
    repository: {
      nameWithOwner: repository.nameWithOwner,
      nodeId: repository.id,
      databaseId: repository.databaseId,
      defaultBranch: branch.name,
      pinnedHeadOid: head.oid,
      pinnedHeadCommittedAt: head.committedDate,
      historyCount: expectedHistoryCount,
    },
    graphql: {
      metadataQuerySha256: sha256(METADATA_QUERY),
      historyQuerySha256: sha256(HISTORY_QUERY),
      completeAuthorsQuerySha256: sha256(COMPLETE_AUTHORS_QUERY),
      pageCount: pageNumber,
    },
    commits,
    normalizedPrivateIdentities: normalized.identities.map((identity) => ({
      id: identity.id,
      kind: identity.kind,
      firstAppearance: identity.firstAppearance,
    })),
  };
  await writeJsonExclusive(rawPath, rawSnapshot, 0o600);

  const publicManifest = {
    schemaVersion: 1,
    candidateId,
    acquiredAt,
    publicationPolicy: 'public-repository-only',
    personalIntensityLane: {
      status: 'BLOCKED',
      reason: 'Film subject login and immutable provider ID are not independently verified through a public-only viewer.',
      renderBehavior: 'empty low-contrast cell interiors',
    },
    repository: rawSnapshot.repository,
    sourceBoundary: {
      firstCommitOid: commits[0].oid,
      firstCommitCommittedAt: commits[0].committedDate,
      lastCommitOid: commits.at(-1).oid,
      lastCommitCommittedAt: commits.at(-1).committedDate,
    },
    sample: {
      frameCount: 600,
      fps: 60,
      durationSeconds: 10,
      collisionWeekCount: SAMPLE_WEEK_COUNT,
      selectedWeekStart: selection.startWeek,
      selectedWeekEnd: selection.endWeek,
      densestDay: selection.densestDay,
      densestIdentityCount: selection.densestIdentityCount,
      visibleBufferStart: sample.weeks[0].weekStart,
      visibleBufferEnd: sample.weeks.at(-1).weekStart,
    },
    limits: {
      maximumDailyIdentityCount: normalized.maximumDailyIdentityCount,
      maximumFirstArrivalWeekCount: normalized.maximumFirstArrivalWeekCount,
      dailyCapacity: 12,
      firstArrivalWeekCapacity: 12,
    },
    identities,
    weeks: publicWeeks,
  };
  await writeJsonExclusive(manifestPath, publicManifest, 0o644);
  await writeJson(path.join(DATA_DIR, 'current.json'), {
    schemaVersion: 1,
    candidateId,
    manifestPath: `./${candidateId}/render-manifest.public.json`,
  }, 0o644);
  process.stdout.write(
    `ACQUISITION_COMPLETE candidate=${candidateId} commits=${commits.length} identities=${identities.length} ` +
    `sample=${selection.startWeek}..${selection.endWeek} densest=${selection.densestDay}:${selection.densestIdentityCount}\n`,
  );
}

async function fetchAllAuthors(oid, initial, initialCursor) {
  const authors = [...initial];
  let cursor = initialCursor;
  while (cursor) {
    const response = await graphql(COMPLETE_AUTHORS_QUERY, {
      owner: OWNER,
      name: REPOSITORY,
      expression: oid,
      cursor,
    });
    const connection = response.data?.repository?.object?.authors;
    if (!connection) throw new Error(`Missing author continuation for ${oid}.`);
    authors.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  return authors;
}

function normalizeHistory(commits, dedupeKey) {
  const identitiesById = new Map();
  const daysByDate = new Map();
  for (const commit of commits) {
    const date = commit.committedDate.slice(0, 10);
    const day = daysByDate.get(date) || {date, commitOids: [], identityIds: new Set()};
    day.commitOids.push(commit.oid);
    commit.authors.nodes.forEach((actor, authorIndex) => {
      const identity = normalizeActor(actor, commit.oid, authorIndex, dedupeKey);
      const existing = identitiesById.get(identity.id);
      if (!existing) identitiesById.set(identity.id, {...identity, firstAppearance: {date, oid: commit.oid}});
      day.identityIds.add(identity.id);
    });
    daysByDate.set(date, day);
  }
  const identities = [...identitiesById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const identityLookup = new Map(identities.map((identity) => [identity.id, identity]));
  const days = [...daysByDate.values()].sort((left, right) => left.date.localeCompare(right.date)).map((day) => {
    const ids = [...day.identityIds].sort();
    const publicHumanContributorIds = ids.filter((id) => identityLookup.get(id).kind === 'public-human');
    const anonymousIdentityIds = ids.filter((id) => identityLookup.get(id).kind === 'anonymous');
    const botIds = ids.filter((id) => identityLookup.get(id).kind === 'bot');
    return {
      date: day.date,
      commitOids: day.commitOids.sort(),
      publicHumanContributorIds,
      anonymousIdentityIds,
      botIds,
      contributorIdentityCount: publicHumanContributorIds.length + anonymousIdentityIds.length,
    };
  });
  const maximumDailyIdentityCount = Math.max(...days.map((day) => day.contributorIdentityCount));
  if (maximumDailyIdentityCount > 12) throw new Error(`Daily identity capacity exceeded: ${maximumDailyIdentityCount}.`);
  const firstArrivalWeeks = new Map();
  for (const identity of identities.filter((entry) => entry.kind !== 'bot')) {
    const week = weekStart(identity.firstAppearance.date);
    firstArrivalWeeks.set(week, (firstArrivalWeeks.get(week) || 0) + 1);
  }
  const maximumFirstArrivalWeekCount = Math.max(...firstArrivalWeeks.values());
  if (maximumFirstArrivalWeekCount > 12) {
    throw new Error(`Weekly first-arrival capacity exceeded: ${maximumFirstArrivalWeekCount}.`);
  }
  return {identities, days, maximumDailyIdentityCount, maximumFirstArrivalWeekCount};
}

function normalizeActor(actor, oid, authorIndex, dedupeKey) {
  if (actor.user?.id && actor.user.login) {
    const login = actor.user.login;
    const bot = BOT_LOGINS.has(login.toLowerCase()) || login.toLowerCase().endsWith('[bot]');
    return {
      id: `gh:user:${actor.user.id}`,
      kind: bot ? 'bot' : 'public-human',
      public: {
        id: `gh:user:${actor.user.id}`,
        kind: bot ? 'bot' : 'public-human',
        providerUserId: String(actor.user.databaseId),
        login,
        profileUrl: actor.user.url,
        avatarUrl: actor.user.avatarUrl,
      },
    };
  }
  const normalizedEmail = actor.email?.normalize('NFKC').trim().toLowerCase();
  const suffix = normalizedEmail
    ? createHmac('sha256', dedupeKey).update(normalizedEmail).digest('hex')
    : `event:${oid}:${authorIndex}`;
  return {id: `gh:anonymous:${suffix}`, kind: 'anonymous'};
}

function selectDensestWindow(days) {
  const densestIdentityCount = Math.max(...days.map((day) => day.contributorIdentityCount));
  const densestDays = days.filter((day) => day.contributorIdentityCount === densestIdentityCount);
  const daysByWeek = new Map();
  for (const day of days) {
    const week = weekStart(day.date);
    const entries = daysByWeek.get(week) || [];
    entries.push(day);
    daysByWeek.set(week, entries);
  }
  let winner;
  for (const densestDay of densestDays) {
    const denseWeek = weekStart(densestDay.date);
    for (let offset = 0; offset < SAMPLE_WEEK_COUNT; offset += 1) {
      const startWeek = addDays(denseWeek, -7 * offset);
      const endWeek = addDays(startWeek, 7 * (SAMPLE_WEEK_COUNT - 1));
      const windowDays = days.filter((day) => day.date >= startWeek && day.date <= addDays(endWeek, 6));
      const score = windowDays.reduce(
        (sum, day) => sum + day.contributorIdentityCount + (day.contributorIdentityCount >= 2 ? 8 : 0) +
          (day.contributorIdentityCount >= 4 ? 18 : 0),
        0,
      );
      const candidate = {startWeek, endWeek, densestDay: densestDay.date, densestIdentityCount, score};
      if (!winner || candidate.score > winner.score || (candidate.score === winner.score && startWeek < winner.startWeek)) {
        winner = candidate;
      }
    }
  }
  return winner;
}

function buildSample(normalized, selection) {
  const start = addDays(selection.startWeek, -7 * BUFFER_WEEKS_BEFORE);
  const end = addDays(selection.endWeek, 7 * BUFFER_WEEKS_AFTER);
  const daysByDate = new Map(normalized.days.map((day) => [day.date, day]));
  const identityById = new Map(normalized.identities.map((identity) => [identity.id, identity]));
  const weeks = [];
  for (let week = start; week <= end; week = addDays(week, 7)) {
    const days = [];
    const firstArrivalIds = new Set();
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = addDays(week, weekday);
      const source = daysByDate.get(date) || {
        date,
        commitOids: [],
        publicHumanContributorIds: [],
        anonymousIdentityIds: [],
        botIds: [],
        contributorIdentityCount: 0,
      };
      for (const id of [...source.publicHumanContributorIds, ...source.anonymousIdentityIds]) {
        if (identityById.get(id).firstAppearance.date === date) firstArrivalIds.add(id);
      }
      days.push({...source, weekday});
    }
    weeks.push({weekStart: week, firstArrivalIds: [...firstArrivalIds].sort(), days});
  }
  return {weeks};
}

function sanitizeWeeksForPublic(weeks, identities) {
  const identityById = new Map(identities.map((identity) => [identity.id, identity]));
  return weeks.map((week) => {
    const anonymousFirstArrivalCounts = new Map();
    const publicFirstArrivalIds = [];
    for (const id of week.firstArrivalIds) {
      const identity = identityById.get(id);
      if (identity?.kind === 'public-human') {
        publicFirstArrivalIds.push(id);
      } else if (identity?.kind === 'anonymous') {
        const targetDay = week.days.find((day) => day.anonymousIdentityIds.includes(id));
        if (!targetDay) throw new Error(`Anonymous first arrival ${id} is absent from ${week.weekStart}.`);
        anonymousFirstArrivalCounts.set(
          targetDay.weekday,
          (anonymousFirstArrivalCounts.get(targetDay.weekday) || 0) + 1,
        );
      }
    }
    return {
      weekStart: week.weekStart,
      firstArrivalIds: publicFirstArrivalIds.sort(),
      anonymousFirstArrivals: [...anonymousFirstArrivalCounts.entries()]
        .sort(([left], [right]) => left - right)
        .map(([weekday, count]) => ({weekday, count})),
      days: week.days.map(({anonymousIdentityIds, ...day}) => ({
        ...day,
        anonymousIdentityCount: anonymousIdentityIds.length,
      })),
    };
  });
}

async function fetchAvatar(identity) {
  const avatarUrl = new URL(identity.public.avatarUrl);
  avatarUrl.searchParams.set('s', '128');
  const response = await fetch(avatarUrl, {headers: {'User-Agent': 'codex-deckgl-contributor-film'}});
  if (!response.ok) throw new Error(`Avatar fetch failed for ${identity.public.login}: ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'image/png';
  return {
    avatarAsset: {
      sha256: sha256(bytes),
      contentType,
      etag: response.headers.get('etag'),
      dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
    },
  };
}

async function currentViewer() {
  const {stdout} = await execFileAsync('gh', ['api', 'user'], {maxBuffer: 4 * 1024 * 1024});
  const viewer = JSON.parse(stdout);
  return {login: viewer.login, providerUserId: String(viewer.id), nodeId: viewer.node_id};
}

async function graphql(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) args.push('-F', `${key}=${value}`);
  const {stdout} = await execFileAsync('gh', args, {maxBuffer: 64 * 1024 * 1024});
  const response = JSON.parse(stdout);
  if (response.errors?.length) throw new Error(`GraphQL error: ${JSON.stringify(response.errors)}`);
  return response;
}

async function loadOrCreateDedupeKey(file) {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const key = randomBytes(32);
    await fs.writeFile(file, key, {mode: 0o600, flag: 'wx'});
    return key;
  }
}

function compareCommits(left, right) {
  return left.committedDate.localeCompare(right.committedDate) || left.oid.localeCompare(right.oid);
}

function weekStart(date) {
  return addDays(date, -new Date(`${date}T00:00:00Z`).getUTCDay());
}

function addDays(date, count) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(file, value, mode) {
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode});
  await fs.chmod(temporary, mode);
  await fs.rename(temporary, file);
}

async function writeJsonExclusive(file, value, mode) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {mode, flag: 'wx'});
  await fs.chmod(file, mode);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
