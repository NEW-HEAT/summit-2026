#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {prepareRetentionManifest} from './prepare-social-pr-retention.mjs';
import {getVisglSnapshotName, LOCKED_VISGL_CUTOFF} from './visgl-data-scope.mjs';
import {readFrozenJson, readFrozenBytes} from './frozen-json.mjs';

const execute = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const cutoff = process.env.SOCIAL_FREEZE ?? '2026-08-31T01:47:35Z';
const start = '2016-01-01T00:00:00Z';
const directory = path.join(root, 'data', getVisglSnapshotName(cutoff));
const pageDirectory = path.join(directory, 'source-pages');
const avatarDirectory = path.join(directory, 'avatars');
const readJson = readFrozenJson;
const writeJson = async (file, value) => fs.writeFile(file, JSON.stringify(value), {mode: 0o600});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(pageDirectory, {recursive: true, mode: 0o700});
await fs.mkdir(avatarDirectory, {recursive: true, mode: 0o700});
let requestCount = 0;
async function request(argumentsList) {
  const file = path.join(pageDirectory, hash(JSON.stringify(argumentsList)) + '.json');
  try { return await readJson(file); } catch {}
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const {stdout} = await execute('gh', ['api', ...argumentsList], {maxBuffer: 64 * 1024 * 1024});
      const result = JSON.parse(stdout);
      if (result.errors) throw new Error(JSON.stringify(result.errors));
      if (result.data?.rateLimit?.remaining < 300) throw new Error('GraphQL reserve reached; acquisition is resumable.');
      await writeJson(file, result);
      requestCount++;
      return result;
    } catch (error) {
      if (attempt === 3 || /reserve|NOT_FOUND|undefinedField|cannotSpread/.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 1500 * 2 ** attempt));
    }
  }
}
async function graphql(body) {
  return (await request(['graphql', '-f', 'query=query {' + body + ' rateLimit {remaining cost resetAt}}'])).data;
}
const actorFields = 'databaseId id login avatarUrl url';
const commitFields = 'oid committedDate authoredDate message url authors(first:100) {nodes {user {' + actorFields +
  '}} pageInfo {hasNextPage endCursor}}';
async function acquireHistory(repository) {
  const queryRoot = 'repository(owner:' + JSON.stringify(repository.owner.login) + ',name:' + JSON.stringify(repository.name) + ')';
  const head = (await graphql(queryRoot + ' {id isPrivate defaultBranchRef {target {... on Commit {' +
    'history(first:1,until:' + JSON.stringify(cutoff) + ') {nodes {oid committedDate}}}}}}')).repository;
  assert.equal(head.isPrivate, false);
  const pinned = head.defaultBranchRef?.target.history.nodes[0] ?? null;
  const commits = [];
  if (!pinned) return {repository: {nameWithOwner: repository.full_name, pinnedHeadOid: null, id: repository.id}, commits};
  let cursor = null;
  while (true) {
    const connection = (await graphql(queryRoot + ' {object(expression:' + JSON.stringify(pinned.oid) + ') {... on Commit {' +
      'history(first:100,since:' + JSON.stringify(start) + ',until:' + JSON.stringify(cutoff) +
      (cursor ? ',after:' + JSON.stringify(cursor) : '') + ') {nodes {' + commitFields +
      '} pageInfo {hasNextPage endCursor}}}}}')).repository.object.history;
    for (const commit of connection.nodes) {
      let authors = commit.authors;
      while (authors.pageInfo.hasNextPage) {
        authors = (await graphql(queryRoot + ' {object(expression:' + JSON.stringify(commit.oid) + ') {... on Commit {' +
          'authors(first:100,after:' + JSON.stringify(authors.pageInfo.endCursor) + ') {nodes {user {' + actorFields +
          '}} pageInfo {hasNextPage endCursor}}}}}')).repository.object.authors;
        commit.authors.nodes.push(...authors.nodes);
      }
      commits.push(commit);
    }
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  console.log('VISGL_HISTORY ' + repository.full_name + ' commits=' + commits.length);
  return {repository: {nameWithOwner: repository.full_name, pinnedHeadOid: pinned.oid,
    pinnedHeadCommittedAt: pinned.committedDate, id: repository.id}, commits};
}
const validActor = user => user?.databaseId && user.login && user.login !== 'ghost' &&
  !user.login.endsWith('[bot]') && !['greenkeeper', 'codecov', 'dependabot', 'renovate'].includes(user.login.toLowerCase());
function createCommitSeed(history) {
  const identities = new Map();
  const days = new Map();
  for (const commit of history.commits) {
    const day = commit.committedDate.slice(0, 10);
    const counts = days.get(day) ?? new Map();
    const actors = new Map(commit.authors.nodes.filter(author => validActor(author.user)).map(author => [String(author.user.databaseId), author.user]));
    for (const [id, user] of actors) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!identities.has(id)) identities.set(id, {providerUserId: id, login: user.login,
        firstContributionDate: day, avatarAsset: {}});
      const identity = identities.get(id);
      if (day < identity.firstContributionDate) identity.firstContributionDate = day;
    }
    days.set(day, counts);
  }
  return {repository: history.repository, identities: [...identities.values()], weeks: [{days: [...days].map(([date, counts]) => ({
    date, inRange: true, visibleContributors: [...counts].map(([providerUserId, authoredCommitCount]) => ({providerUserId, authoredCommitCount}))}))}]};
}
async function runAcquisition(repository, repositoryDirectory) {
  const env = {...process.env, SOCIAL_REPOSITORY: repository.full_name, SOCIAL_REPOSITORY_ID: String(repository.id),
    SOCIAL_DIRECTORY: repositoryDirectory, SOCIAL_AVATAR_DIRECTORY: avatarDirectory,
    SOCIAL_READ_CACHE_DIRECTORY: cutoff === LOCKED_VISGL_CUTOFF ? path.join(root, 'data/social-2026-08-31/source-pages') : '',
    SOCIAL_COMMIT_HISTORY: path.join(repositoryDirectory, 'commit-history.private.json'),
    SOCIAL_COMMIT_MANIFEST: path.join(repositoryDirectory, 'commit-seed.json'), SOCIAL_COMMIT_MESSAGES_FROZEN: '1'};
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['acquire-social-graph.mjs'], {cwd: root, env, stdio: 'inherit'});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(repository.full_name + ' exited ' + code)));
  });
}

const repositories = [];
for (let page = 1; ; page++) {
  const rows = await request(['-X', 'GET', 'orgs/visgl/repos?type=public&per_page=100&sort=full_name&page=' + page]);
  repositories.push(...rows.filter(repository => !repository.private && Date.parse(repository.created_at) <= Date.parse(cutoff)));
  if (rows.length < 100) break;
}
assert.equal(new Set(repositories.map(repository => repository.id)).size, repositories.length);
// Non-forks own canonical shared-commit credit before archived mirrors and external forks.
repositories.sort((left, right) => Number(left.fork) - Number(right.fork) || left.full_name.localeCompare(right.full_name));
const registry = repositories.map(repository => ({id: repository.id, name: repository.full_name, fork: repository.fork,
  archived: repository.archived, createdAt: repository.created_at, defaultBranch: repository.default_branch, status: 'pending'}));
await writeJson(path.join(directory, 'repository-scope.json'), {observedAt: new Date().toISOString(), cutoff,
  boundary: 'All current public visgl organization repositories created by the cutoff; historical membership is not inferred.', repositories: registry});
const previous = await readJson(path.join(root, 'data/social-2026-08-31/social-manifest.json'));
for (const node of previous.nodes) {
  const file = path.join(avatarDirectory, 'avatar-' + node.id + '.json');
  try { await fs.access(file); } catch { await writeJson(file, {dataUrl: node.avatar}); }
}
const manifests = [];
const seenCommits = new Set();
const inheritedHistories = new Map();
let sharedCommitCopies = 0;
let externalAncestryCommits = 0;
for (const repository of repositories) {
  const row = registry.find(entry => entry.id === repository.id);
  const repositoryDirectory = path.join(directory, 'repositories', String(repository.id));
  await fs.mkdir(repositoryDirectory, {recursive: true, mode: 0o700});
  const allHistory = await acquireHistory(repository);
  let inherited = new Set();
  if (repository.fork) {
    const detail = await request(['-X', 'GET', 'repos/' + repository.full_name]);
    row.parent = detail.parent?.full_name;
    row.parentId = detail.parent?.id;
    row.source = detail.source?.full_name;
    if (detail.source && !repositories.some(candidate => candidate.id === detail.source.id)) {
      if (!inheritedHistories.has(detail.source.id)) inheritedHistories.set(detail.source.id, await acquireHistory(detail.source));
      inherited = new Set(inheritedHistories.get(detail.source.id).commits.map(commit => commit.oid));
    }
  }
  row.defaultBranchCommits = allHistory.commits.length;
  row.excludedSharedCommitCopies = 0;
  row.excludedExternalAncestry = 0;
  const commits = allHistory.commits.filter(commit => {
    if (seenCommits.has(commit.oid)) { sharedCommitCopies++; row.excludedSharedCommitCopies++; return false; }
    if (inherited.has(commit.oid)) { externalAncestryCommits++; row.excludedExternalAncestry++; return false; }
    seenCommits.add(commit.oid);
    return true;
  });
  const history = {...allHistory, commits};
  row.pinnedHeadOid = history.repository.pinnedHeadOid;
  row.uniqueCommits = commits.length;
  await writeJson(path.join(repositoryDirectory, 'commit-history.private.json'), history);
  await writeJson(path.join(repositoryDirectory, 'commit-seed.json'), createCommitSeed(history));
  const preparedPath = path.join(repositoryDirectory, 'social-manifest-pr-retention.json');
  let prepared;
  try {
    prepared = await readJson(preparedPath);
    assert.equal(prepared.cutoff, cutoff);
    assert.equal(prepared.commitHead, history.repository.pinnedHeadOid);
    assert.equal(prepared.repositoryId, repository.id);
  } catch {
    await runAcquisition(repository, repositoryDirectory);
    const source = await readJson(path.join(repositoryDirectory, 'social-manifest.json'));
    const {records, reactions} = await readJson(path.join(repositoryDirectory, 'records.private.json'));
    prepared = prepareRetentionManifest(source, records, reactions);
    await writeJson(preparedPath, prepared);
  }
  row.status = 'complete';
  row.nodes = prepared.nodes.length;
  row.events = prepared.events.length;
  row.coverage = prepared.coverage;
  row.manifestSha256 = hash(await readFrozenBytes(preparedPath));
  manifests.push(prepared);
  await writeJson(path.join(directory, 'acquisition-status.json'), {cutoff, repositories: registry, requestCount,
    complete: manifests.length === repositories.length});
  console.log('VISGL_REPOSITORY_COMPLETE ' + manifests.length + '/' + repositories.length + ' ' + repository.full_name);
}
const users = new Map();
const events = new Map();
for (const manifest of manifests) {
  for (const node of manifest.nodes) {
    let target = users.get(node.id);
    if (!target) {
      target = {...node, contributions: [], activity: [], repositories: [], retention: {firstPullRequestDate: null, ownedActivityDates: []}};
      users.set(node.id, target);
    }
    target.avatar ||= node.avatar;
    target.firstDate = target.firstDate < node.firstDate ? target.firstDate : node.firstDate;
    target.contributions.push(...node.contributions.map(event => ({...event, repositoryId: manifest.repositoryId})));
    target.activity.push(...node.activity);
    target.repositories.push(manifest.repositoryId);
    target.retention.ownedActivityDates.push(...node.retention.ownedActivityDates);
    const firstPullRequest = node.retention.firstPullRequestDate;
    if (firstPullRequest && (!target.retention.firstPullRequestDate || firstPullRequest < target.retention.firstPullRequestDate)) {
      target.retention.firstPullRequestDate = firstPullRequest;
    }
  }
  for (const event of manifest.events) {
    const key = [event.id, event.type, event.source, event.target].join('|');
    if (!events.has(key)) events.set(key, {...event, repositoryId: manifest.repositoryId});
  }
}
// A PR in another repository before the clip began still establishes lifetime authorship,
// even if that repository alone did not keep the actor in its in-period node list.
const providerBotIds = new Set();
for (const repository of registry) {
  const {records, reactions} = await readJson(path.join(directory, 'repositories', String(repository.id), 'records.private.json'));
  for (const actor of [...records.map(record => record.author), ...reactions.map(reaction => reaction.user)]) {
    if (actor?.type === 'Bot' || actor?.__typename === 'Bot') {
      providerBotIds.add(String(actor.databaseId ?? actor.id));
    }
  }
  for (const record of records) {
    if (record.kind !== 'pull-request' || !Number.isFinite(Date.parse(record.date)) || Date.parse(record.date) > Date.parse(cutoff)) continue;
    const id = String(record.author?.databaseId ?? (typeof record.author?.id === 'number' ? record.author.id : ''));
    const node = users.get(id);
    if (!node) continue;
    const date = new Date(record.date).toISOString();
    if (!node.retention.firstPullRequestDate || date < node.retention.firstPullRequestDate) {
      node.retention.firstPullRequestDate = date;
    }
  }
}
const excludedProviderBotIds = [...providerBotIds].filter(id => users.has(id));
for (const id of excludedProviderBotIds) users.delete(id);
for (const [key, event] of events) {
  if (!users.has(event.source) || !users.has(event.target)) events.delete(key);
}
for (const node of users.values()) {
  node.activity = [...new Set(node.activity)].sort();
  node.retention.ownedActivityDates = [...new Set(node.retention.ownedActivityDates)].sort();
}
const nodes = [...users.values()].sort((left, right) => left.id.localeCompare(right.id));
assert.ok(nodes.every(node => node.avatar), 'Every included user requires a real frozen avatar');
assert.ok(registry.every(repository => repository.status === 'complete'));
const manifest = {schemaVersion: 2, repository: 'visgl/*', repositoryIds: registry.map(repository => repository.id),
  observedAt: new Date().toISOString(), cutoff, start: '2016-01-01', end: cutoff.slice(0, 10),
  nodes, events: [...events.values()], repositories: registry,
  retentionPolicy: {...previous.retentionPolicy, sourceSha256: undefined, recordsSha256: undefined,
    pullRequestAuthorCount: nodes.filter(node => node.retention.firstPullRequestDate).length},
  coverage: {repositoryCount: registry.length, allRepositoriesComplete: true, uniqueCommits: seenCommits.size,
    excludedProviderBotIds,
    excludedSharedCommitCopies: sharedCommitCopies, excludedExternalForkAncestry: externalAncestryCommits,
    omissions: ['Deleted/inaccessible content', 'Unavailable historical body revisions', 'Administrative events',
      'Private repositories', 'Former organization repositories not present in the current public inventory'],
    temporalBoundary: 'The existing synchronized clip date axis remains locked; Jan 1–3 activity joins the opening cohort.'},
  provenance: {readOnly: true, publicRepositoryOnly: true, rawContentIsLocalOnly: true,
    weights: 'Authored commit credits deduplicated by OID and user; social events remain separate.'}};
const manifestPath = path.join(directory, 'visgl-social-manifest.json');
await writeJson(manifestPath, manifest);
const charlie = nodes.find(node => node.id === '62311337');
const summary = {manifestPath, repositoryCount: registry.length, nodeCount: nodes.length, events: manifest.events.length,
  uniqueCommits: seenCommits.size, charlieforward9: charlie && {id: charlie.id,
    authoredCommitCredits: charlie.contributions.reduce((sum, event) => sum + event.count, 0),
    firstPullRequestDate: charlie.retention.firstPullRequestDate, repositories: charlie.repositories.map(id => registry.find(row => row.id === id).name)},
  sha256: hash(await fs.readFile(manifestPath))};
await writeJson(path.join(directory, 'acquisition-summary.json'), summary);
console.log('VISGL_COMPLETE ' + JSON.stringify(summary));
