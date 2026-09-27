#!/usr/bin/env node
import {fileURLToPath as archiveFileURLToPath} from 'node:url';

import fs from 'node:fs/promises';
import path from 'node:path';

const HERE = path.dirname(archiveFileURLToPath(import.meta.url));
const CURRENT_HISTORY_POINTER_PATH = path.join(HERE, 'data', 'current.json');
const START_DATE = '2016-01-01';
const PUBLIC_SCHEMA_REVISION = 'ten-year-v2-all-contributors';
const BOT_LOGINS = new Set([
  'dependabot[bot]',
  'github-actions[bot]',
  'renovate[bot]',
  'greenkeeper[bot]',
  'codecov[bot]',
]);

async function main() {
  const currentHistoryPointer = await readJson(CURRENT_HISTORY_POINTER_PATH);
  const historyPath = getArgumentPath('--history') ?? path.join(
    HERE,
    'private',
    currentHistoryPointer.candidateId,
    'repository-history.private.json',
  );
  const avatarPackPath = getArgumentPath('--avatars') ?? path.join(
    HERE,
    'data',
    currentHistoryPointer.candidateId,
    'all-contributors.public.json',
  );
  const [history, avatarPack] = await Promise.all([
    readJson(historyPath),
    readJson(avatarPackPath),
  ]);
  if (history.repository.nameWithOwner !== 'visgl/deck.gl') {
    throw new Error(`Unexpected history repository ${history.repository.nameWithOwner}.`);
  }
  if (avatarPack.repository.nameWithOwner !== history.repository.nameWithOwner) {
    throw new Error('The frozen avatar pack belongs to a different repository.');
  }

  const endDate = history.repository.pinnedHeadCommittedAt.slice(0, 10);
  const candidateId = `${history.repository.pinnedHeadOid.slice(0, 12)}-${PUBLIC_SCHEMA_REVISION}`;
  const candidateDirectory = path.join(HERE, 'data', candidateId);
  const manifestPath = path.join(candidateDirectory, 'render-manifest.public.json');
  await fs.mkdir(candidateDirectory, {recursive: true});

  const identities = avatarPack.contributors.map((contributor) => {
    const avatarDataUrl = contributor.avatarAsset?.dataUrl ?? contributor.avatarDataUrl;
    const avatarSha256 = contributor.avatarAsset?.sha256 ?? contributor.avatarSha256;
    if (!contributor.providerUserId || !contributor.login || !avatarDataUrl || !avatarSha256) {
      throw new Error('Every rendered identity must have a provider ID, username, and frozen profile picture.');
    }
    return {
      id: `gh:database-user:${contributor.providerUserId}`,
      kind: 'public-human',
      providerUserId: contributor.providerUserId,
      login: contributor.login,
      profileUrl: contributor.profileUrl,
      avatarAsset: {
        sha256: avatarSha256,
        dataUrl: avatarDataUrl,
      },
    };
  }).sort(compareProviderIds);
  const picturedProviderIds = new Set(identities.map((identity) => identity.providerUserId));
  if (picturedProviderIds.size !== identities.length) throw new Error('Duplicate provider IDs in frozen avatar pack.');

  const dayBuilders = new Map();
  let publicHumanAuthorEvents = 0;
  const inRangeCommits = history.commits.filter((commit) => {
    const date = commit.committedDate.slice(0, 10);
    return date >= START_DATE && date <= endDate;
  });
  for (const commit of inRangeCommits) {
    const date = commit.committedDate.slice(0, 10);
    const day = dayBuilders.get(date) ?? createDayBuilder(date);
    day.commitCount += 1;
    const commitProviderIds = new Set();
    const commitAnonymousKeys = new Set();
    for (const [authorIndex, actor] of commit.authors.nodes.entries()) {
      if (actor.user?.databaseId && actor.user.login) {
        const providerUserId = String(actor.user.databaseId);
        const normalizedLogin = actor.user.login.toLowerCase();
        const bot = BOT_LOGINS.has(normalizedLogin) || normalizedLogin.endsWith('[bot]');
        if (bot) {
          day.botProviderIds.add(providerUserId);
        } else {
          day.publicHumanProviderIds.add(providerUserId);
          commitProviderIds.add(providerUserId);
        }
      } else {
        const normalizedEmail = actor.email?.normalize('NFKC').trim().toLowerCase();
        commitAnonymousKeys.add(normalizedEmail || `event:${commit.oid}:${authorIndex}`);
      }
    }
    for (const providerUserId of commitProviderIds) {
      if (picturedProviderIds.has(providerUserId)) {
        day.picturedCommitCounts.set(
          providerUserId,
          (day.picturedCommitCounts.get(providerUserId) ?? 0) + 1,
        );
      }
    }
    publicHumanAuthorEvents += commitProviderIds.size;
    for (const anonymousKey of commitAnonymousKeys) day.anonymousKeys.add(anonymousKey);
    dayBuilders.set(date, day);
  }

  const days = [];
  for (let date = START_DATE; date <= endDate; date = addDays(date, 1)) {
    const source = dayBuilders.get(date) ?? createDayBuilder(date);
    const visibleContributors = [...source.picturedCommitCounts.entries()]
      .map(([providerUserId, authoredCommitCount]) => ({providerUserId, authoredCommitCount}))
      .sort(compareContributionCounts);
    const picturedContributorCount = visibleContributors.length;
    const humanContributorCount = source.publicHumanProviderIds.size + source.anonymousKeys.size;
    days.push({
      date,
      weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
      commitCount: source.commitCount,
      humanContributorCount,
      picturedContributorCount,
      unpicturedContributorCount: Math.max(0, humanContributorCount - picturedContributorCount),
      botContributorCount: source.botProviderIds.size,
      visibleContributors,
    });
  }

  const identityParticipation = new Map();
  for (const day of days) {
    for (const contributor of day.visibleContributors) {
      const prior = identityParticipation.get(contributor.providerUserId);
      identityParticipation.set(contributor.providerUserId, {
        firstContributionDate: prior?.firstContributionDate ?? day.date,
        totalAuthoredCommitCount:
          (prior?.totalAuthoredCommitCount ?? 0) + contributor.authoredCommitCount,
      });
    }
  }
  for (const identity of identities) {
    const participation = identityParticipation.get(identity.providerUserId);
    if (!participation) {
      throw new Error(`${identity.login} has no canonical contribution in the requested date range.`);
    }
    Object.assign(identity, participation);
  }
  identities.sort((left, right) => {
    const countDifference = right.totalAuthoredCommitCount - left.totalAuthoredCommitCount;
    return countDifference || compareProviderIds(left, right);
  });

  const weeks = buildWeeks(days, START_DATE, endDate);
  const quarters = buildQuarters(days, identities);
  const activeDays = days.filter((day) => day.commitCount > 0);
  const activeDaysWithPicturedContributor = activeDays.filter((day) => day.picturedContributorCount > 0);
  const picturedAuthorEvents = days.reduce(
    (sum, day) => sum + day.visibleContributors.reduce(
      (daySum, contributor) => daySum + contributor.authoredCommitCount,
      0,
    ),
    0,
  );
  const manifest = {
    schemaVersion: 1,
    candidateId,
    generatedAt: new Date().toISOString(),
    publicationPolicy: 'public-repository-only-frozen-avatars',
    repository: history.repository,
    sourceBoundary: {
      requestedStartDate: START_DATE,
      firstInRangeCommitOid: inRangeCommits[0].oid,
      firstInRangeCommitCommittedAt: inRangeCommits[0].committedDate,
      lastInRangeCommitOid: inRangeCommits.at(-1).oid,
      lastInRangeCommitCommittedAt: inRangeCommits.at(-1).committedDate,
      endDate,
    },
    renderContract: {
      width: 1920,
      height: 1080,
      fps: 60,
      frameCount: 3060,
      durationSeconds: 51,
      openingFrames: 60,
      traversalFrames: 2880,
      holdFrames: 120,
    },
    provenance: {
      canonicalHistory: 'frozen GitHub GraphQL default-branch commit history',
      canonicalHistoryAcquiredAt: history.acquiredAt,
      pinnedHeadOid: history.repository.pinnedHeadOid,
      avatarPack: 'frozen top-24 public GitHub repository contributor accounts',
      avatarPackGeneratedAt: avatarPack.generatedAt,
      attributionUnit: 'distinct canonical commit authors per UTC committed date',
      omittedIdentityPolicy: 'contributors without frozen public profile pictures remain aggregate counts only',
    },
    coverage: {
      dayCount: days.length,
      weekCount: weeks.length,
      quarterCount: quarters.length,
      canonicalCommitCount: inRangeCommits.length,
      activeDayCount: activeDays.length,
      activeDaysWithPicturedContributor: activeDaysWithPicturedContributor.length,
      activeDayPicturedCoverage: activeDaysWithPicturedContributor.length / activeDays.length,
      picturedAuthorEvents,
      publicHumanAuthorEvents,
      picturedIdentityCount: identities.length,
      weeklyPortraitAssignmentCount: weeks.reduce(
        (sum, week) => sum + week.portraitAssignments.length,
        0,
      ),
    },
    identities,
    weeks,
    quarters,
  };

  await writeJson(manifestPath, manifest);
  await writeJson(path.join(HERE, 'data', 'ten-year-current.json'), {
    schemaVersion: 1,
    candidateId,
    manifestPath: `./${candidateId}/render-manifest.public.json`,
  });
  process.stdout.write(
    `TEN_YEAR_MANIFEST_COMPLETE candidate=${candidateId} days=${days.length} weeks=${weeks.length} ` +
    `commits=${inRangeCommits.length} activeDays=${activeDays.length} picturedActiveDays=${activeDaysWithPicturedContributor.length}\n`,
  );
}

function getArgumentPath(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a file path.`);
  return path.resolve(value);
}

function createDayBuilder(date) {
  return {
    date,
    commitCount: 0,
    publicHumanProviderIds: new Set(),
    anonymousKeys: new Set(),
    botProviderIds: new Set(),
    picturedCommitCounts: new Map(),
  };
}

function buildWeeks(days, startDate, endDate) {
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const weeks = [];
  for (let weekStart = startOfWeek(startDate); weekStart <= endDate; weekStart = addDays(weekStart, 7)) {
    const weekDays = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = addDays(weekStart, weekday);
      const day = dayByDate.get(date);
      weekDays.push(day ?? {
        date,
        weekday,
        inRange: false,
        commitCount: 0,
        humanContributorCount: 0,
        picturedContributorCount: 0,
        unpicturedContributorCount: 0,
        botContributorCount: 0,
        visibleContributors: [],
      });
    }
    const normalizedDays = weekDays.map((day) => ({
      ...day,
      inRange: day.date >= startDate && day.date <= endDate,
    }));
    weeks.push({
      weekStart,
      portraitAssignments: buildWeeklyPortraitAssignments(normalizedDays),
      days: normalizedDays,
    });
  }
  return weeks;
}

function buildWeeklyPortraitAssignments(days) {
  const assignments = new Map();
  for (const day of days) {
    if (!day.inRange) continue;
    for (const contributor of day.visibleContributors) {
      const prior = assignments.get(contributor.providerUserId);
      const strongerDay = !prior ||
        contributor.authoredCommitCount > prior.anchorDayAuthoredCommitCount ||
        (
          contributor.authoredCommitCount === prior.anchorDayAuthoredCommitCount &&
          day.date < prior.date
        );
      assignments.set(contributor.providerUserId, {
        providerUserId: contributor.providerUserId,
        date: strongerDay ? day.date : prior.date,
        anchorDayAuthoredCommitCount: strongerDay
          ? contributor.authoredCommitCount
          : prior.anchorDayAuthoredCommitCount,
        authoredCommitCount: (prior?.authoredCommitCount ?? 0) + contributor.authoredCommitCount,
      });
    }
  }
  return [...assignments.values()]
    .map(({anchorDayAuthoredCommitCount, ...assignment}) => assignment)
    .sort(compareContributionCounts);
}

function buildQuarters(days, identities) {
  const identityByProviderId = new Map(identities.map((identity) => [identity.providerUserId, identity]));
  const quarterBuilders = new Map();
  for (const day of days) {
    const quarterId = getQuarterId(day.date);
    const quarter = quarterBuilders.get(quarterId) ?? {
      id: quarterId,
      startDate: getQuarterStart(day.date),
      endDate: getQuarterEnd(day.date),
      contributorCounts: new Map(),
    };
    for (const contributor of day.visibleContributors) {
      quarter.contributorCounts.set(
        contributor.providerUserId,
        (quarter.contributorCounts.get(contributor.providerUserId) ?? 0) + contributor.authoredCommitCount,
      );
    }
    quarterBuilders.set(quarterId, quarter);
  }
  return [...quarterBuilders.values()].map((quarter) => ({
    id: quarter.id,
    startDate: quarter.startDate,
    endDate: quarter.endDate,
    roster: [...quarter.contributorCounts.entries()]
      .map(([providerUserId, authoredCommitCount]) => ({
        providerUserId,
        login: identityByProviderId.get(providerUserId).login,
        authoredCommitCount,
      }))
      .sort(compareContributionCounts)
      .slice(0, 8),
  }));
}

function getQuarterId(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function getQuarterStart(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${year}-${String(quarterMonth).padStart(2, '0')}-01`;
}

function getQuarterEnd(date) {
  const start = getQuarterStart(date);
  const value = new Date(`${start}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + 3);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function startOfWeek(date) {
  return addDays(date, -new Date(`${date}T00:00:00Z`).getUTCDay());
}

function addDays(date, count) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function compareProviderIds(left, right) {
  return BigInt(left.providerUserId) < BigInt(right.providerUserId) ? -1 : 1;
}

function compareContributionCounts(left, right) {
  const countDifference = right.authoredCommitCount - left.authoredCommitCount;
  if (countDifference !== 0) return countDifference;
  if (left.providerUserId === right.providerUserId) return 0;
  return BigInt(left.providerUserId) < BigInt(right.providerUserId) ? -1 : 1;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o644});
  await fs.rename(temporaryPath, filePath);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
