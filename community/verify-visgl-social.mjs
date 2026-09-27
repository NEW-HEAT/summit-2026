#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFrozenJson} from './frozen-json.mjs';

const root = new URL('.', import.meta.url);
const filename = process.env.SOCIAL_MANIFEST ?? new URL('./data/visgl-2026-08-31/visgl-social-manifest.json', root);
const bytes = await fs.readFile(filename);
const manifest = JSON.parse(bytes);
const directory = path.dirname(filename instanceof URL ? filename.pathname : filename);
const readJson = readFrozenJson;
const scope = await readJson(path.join(directory, 'repository-scope.json'));
const cutoff = Date.parse(manifest.cutoff);
const start = Date.parse('2016-01-01');
const nodes = new Map(manifest.nodes.map(node => [node.id, node]));
const providerBotIds = new Set(manifest.coverage.excludedProviderBotIds ?? []);
assert.ok([...providerBotIds].every(id => !nodes.has(id)));
assert.equal(nodes.size, manifest.nodes.length);
assert.equal(manifest.repository, 'visgl/*');
assert.deepEqual(manifest.repositoryIds.toSorted(), scope.repositories.map(row => row.id).toSorted());
assert.ok(manifest.repositories.every(row => row.status === 'complete'));
const commitIds = new Set();
const expectedCredits = new Map();
const authoredPullRequests = new Map();
const firstPullRequests = new Map();
const repositoryStatistics = [];
for (const repository of manifest.repositories) {
  const repositoryDirectory = path.join(directory, 'repositories', String(repository.id));
  const history = await readJson(path.join(repositoryDirectory, 'commit-history.private.json'));
  assert.equal(history.repository.id, repository.id);
  assert.equal(history.repository.pinnedHeadOid, repository.pinnedHeadOid);
  const {records} = await readJson(path.join(repositoryDirectory, 'records.private.json'));
  let charlieCommits = 0;
  let charliePullRequests = 0;
  for (const commit of history.commits) {
    assert.ok(!commitIds.has(commit.oid), 'Copied commit credited twice: ' + commit.oid);
    commitIds.add(commit.oid);
    assert.ok(Date.parse(commit.committedDate) >= start && Date.parse(commit.committedDate) <= cutoff);
    const authors = new Set(commit.authors.nodes.filter(({user}) => user?.databaseId && user.login &&
      user.login !== 'ghost' && !user.login.endsWith('[bot]') &&
      !['greenkeeper', 'codecov', 'dependabot', 'renovate'].includes(user.login.toLowerCase()))
      .map(({user}) => String(user.databaseId)));
    for (const id of authors) {
      if (providerBotIds.has(id)) continue;
      const key = [id, repository.id, commit.committedDate.slice(0, 10)].join('|');
      expectedCredits.set(key, (expectedCredits.get(key) ?? 0) + 1);
      if (id === '62311337') charlieCommits++;
    }
  }
  for (const record of records) {
    if (record.kind !== 'pull-request' || !Number.isFinite(Date.parse(record.date)) || Date.parse(record.date) > cutoff) continue;
    const id = String(record.author?.databaseId ?? record.author?.id);
    if (!nodes.has(id)) continue;
    if (!authoredPullRequests.has(id)) authoredPullRequests.set(id, new Set());
    authoredPullRequests.get(id).add(record.id);
    const timestamp = Date.parse(record.date);
    firstPullRequests.set(id, Math.min(firstPullRequests.get(id) ?? Infinity, timestamp));
    if (id === '62311337') charliePullRequests++;
  }
  repositoryStatistics.push({repository: repository.name, uniqueCommits: history.commits.length,
    charlieCommits, charliePullRequests});
}
const actualCredits = new Map();
for (const node of nodes.values()) {
  assert.ok(node.avatar?.startsWith('data:image/'), 'Missing frozen profile picture: ' + node.id);
  assert.ok(Date.parse(node.firstDate) <= cutoff);
  for (const event of node.contributions) {
    const key = [node.id, event.repositoryId, event.date].join('|');
    actualCredits.set(key, (actualCredits.get(key) ?? 0) + event.count);
  }
  assert.equal(node.retention.firstPullRequestDate ? Date.parse(node.retention.firstPullRequestDate) : null,
    firstPullRequests.get(node.id) ?? null, 'PR permanence must use own first PR: ' + node.id);
}
assert.deepEqual([...actualCredits].sort(), [...expectedCredits].sort());
const eventIds = new Set();
for (const event of manifest.events) {
  const key = [event.id, event.type, event.source, event.target].join('|');
  assert.ok(!eventIds.has(key));
  eventIds.add(key);
  assert.ok(nodes.has(event.source) && nodes.has(event.target));
  assert.ok(Date.parse(event.date) >= start && Date.parse(event.date) <= cutoff);
}
assert.equal(commitIds.size, manifest.coverage.uniqueCommits);
assert.equal(firstPullRequests.size, manifest.retentionPolicy.pullRequestAuthorCount);
const charlie = nodes.get('62311337');
const report = {status: 'PASS', repositoryCount: manifest.repositories.length, nodeCount: nodes.size,
  uniqueCommits: commitIds.size, interactions: eventIds.size, permanentPrAuthors: firstPullRequests.size,
  charlieforward9: {id: charlie.id, authoredCommitCredits: charlie.contributions.reduce((sum, event) => sum + event.count, 0),
    authoredPullRequests: authoredPullRequests.get(charlie.id)?.size ?? 0,
    firstPullRequestDate: charlie.retention.firstPullRequestDate}, repositories: repositoryStatistics,
  manifestSha256: createHash('sha256').update(bytes).digest('hex'),
  privateData: 'EXCLUDED', externalWrites: 'NONE', historicalOrganizationMembership: 'NOT_CLAIMED'};
await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2), {mode: 0o600});
console.log(JSON.stringify(report, null, 2));
