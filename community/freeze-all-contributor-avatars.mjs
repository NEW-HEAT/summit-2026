#!/usr/bin/env node
import {fileURLToPath as archiveFileURLToPath} from 'node:url';

import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const HERE = path.dirname(archiveFileURLToPath(import.meta.url));
const CURRENT_PATH = path.join(HERE, 'data', 'current.json');
const LEGACY_AVATAR_PACK_PATH = path.join(
  path.dirname(HERE),
  'deckgl-contribution-video',
  'public',
  'contributors.json',
);
const START_DATE = '2016-01-01';
const CONCURRENCY = 8;
const BOT_LOGINS = new Set([
  'dependabot[bot]',
  'github-actions[bot]',
  'renovate[bot]',
  'greenkeeper[bot]',
  'codecov[bot]',
]);

async function main() {
  const current = await readJson(CURRENT_PATH);
  const historyPath = getArgumentPath('--history') ?? path.join(
    HERE,
    'private',
    current.candidateId,
    'repository-history.private.json',
  );
  const history = await readJson(historyPath);
  const candidateDirectory = path.join(HERE, 'data', current.candidateId);
  const outputPath = getArgumentPath('--output') ?? path.join(
    candidateDirectory,
    'all-contributors.public.json',
  );
  if (!process.argv.includes('--force') && await exists(outputPath)) {
    const existing = await readJson(outputPath);
    if (existing.repository.pinnedHeadOid === history.repository.pinnedHeadOid) {
      process.stdout.write(
        `ALL_CONTRIBUTOR_AVATARS_REUSED candidate=${current.candidateId} contributors=${existing.contributors.length}\n`,
      );
      return;
    }
  }

  const contributorsByProviderId = new Map();
  for (const commit of history.commits) {
    const date = commit.committedDate.slice(0, 10);
    if (date < START_DATE) continue;
    const commitProviderIds = new Set();
    for (const actor of commit.authors.nodes) {
      if (!actor.user?.databaseId || !actor.user.login || !actor.user.avatarUrl) continue;
      const login = actor.user.login;
      const normalizedLogin = login.toLowerCase();
      if (BOT_LOGINS.has(normalizedLogin) || normalizedLogin.endsWith('[bot]')) continue;
      const providerUserId = String(actor.user.databaseId);
      const prior = contributorsByProviderId.get(providerUserId);
      contributorsByProviderId.set(providerUserId, {
        providerUserId,
        nodeId: actor.user.id,
        login,
        profileUrl: actor.user.url,
        avatarUrl: actor.user.avatarUrl,
        firstContributionDate: prior?.firstContributionDate ?? date,
        totalAuthoredCommitCount: prior?.totalAuthoredCommitCount ?? 0,
      });
      commitProviderIds.add(providerUserId);
    }
    for (const providerUserId of commitProviderIds) {
      contributorsByProviderId.get(providerUserId).totalAuthoredCommitCount += 1;
    }
  }

  const contributors = [...contributorsByProviderId.values()].sort(compareContributionRank);
  const legacyPack = await readJson(LEGACY_AVATAR_PACK_PATH);
  const reusableAvatars = new Map(
    legacyPack.contributors.map((contributor) => [contributor.providerUserId, {
      sha256: contributor.avatarSha256,
      dataUrl: contributor.avatarDataUrl,
    }]),
  );
  let completed = 0;
  await mapWithConcurrency(contributors, CONCURRENCY, async (contributor) => {
    const reusable = reusableAvatars.get(contributor.providerUserId);
    contributor.avatarAsset = reusable ?? await fetchAvatar(contributor);
    delete contributor.avatarUrl;
    completed += 1;
    if (completed % 20 === 0 || completed === contributors.length) {
      process.stdout.write(`ALL_CONTRIBUTOR_AVATAR_PROGRESS ${completed}/${contributors.length}\n`);
    }
  });

  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await writeJson(outputPath, {
    schemaVersion: 1,
    candidateId: current.candidateId,
    frozenAt: new Date().toISOString(),
    publicationPolicy: 'public-github-identities-only',
    repository: history.repository,
    sourceBoundary: {
      startDate: START_DATE,
      endDate: history.repository.pinnedHeadCommittedAt.slice(0, 10),
      pinnedHeadOid: history.repository.pinnedHeadOid,
    },
    contributionRank: 'canonical authored commits descending, provider user ID ascending on ties',
    omittedIdentityPolicy: 'anonymous and bot authors are not rendered as people',
    contributors,
  });
  process.stdout.write(
    `ALL_CONTRIBUTOR_AVATARS_COMPLETE candidate=${current.candidateId} contributors=${contributors.length} output=${outputPath}\n`,
  );
}

async function fetchAvatar(contributor) {
  const avatarUrl = new URL(contributor.avatarUrl);
  avatarUrl.searchParams.set('s', '96');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(avatarUrl, {
      headers: {'User-Agent': 'codex-deckgl-all-contributor-film'},
    });
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/png';
      return {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        contentType,
        etag: response.headers.get('etag'),
        dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
      };
    }
    if (attempt === 2) {
      throw new Error(`Avatar fetch failed for ${contributor.login}: ${response.status}.`);
    }
    await delay(500 * 3 ** attempt);
  }
}

async function mapWithConcurrency(values, concurrency, operation) {
  let nextIndex = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, values.length)}, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      await operation(values[index], index);
    }
  }));
}

function compareContributionRank(left, right) {
  const countDifference = right.totalAuthoredCommitCount - left.totalAuthoredCommitCount;
  if (countDifference !== 0) return countDifference;
  if (left.providerUserId === right.providerUserId) return 0;
  return BigInt(left.providerUserId) < BigInt(right.providerUserId) ? -1 : 1;
}

function getArgumentPath(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a file path.`);
  return path.resolve(value);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
