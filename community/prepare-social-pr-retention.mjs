#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFrozenBytes} from './frozen-json.mjs';

/** Derive authorship from frozen records. Receiving a mention/reaction is not the user's activity. */
export function prepareRetentionManifest(source, records, reactions) {
  const manifest = structuredClone(source);
  const cutoff = Date.parse(manifest.cutoff);
  const nodes = new Map(manifest.nodes.map(node => [node.id, node]));
  const activity = new Map(manifest.nodes.map(node => [node.id, new Set()]));
  for (const node of manifest.nodes) node.retention = {firstPullRequestDate: null, ownedActivityDates: []};
  const actorId = actor => String(actor?.databaseId ?? (typeof actor?.id === 'number' ? actor.id : ''));
  const addActivity = (id, date) => {
    if (activity.has(id) && Number.isFinite(Date.parse(date)) && Date.parse(date) <= cutoff) {
      activity.get(id).add(new Date(date).toISOString());
    }
  };
  for (const record of records) {
    const id = actorId(record.author);
    const node = nodes.get(id);
    if (!node || !Number.isFinite(Date.parse(record.date)) || Date.parse(record.date) > cutoff) continue;
    addActivity(id, record.date);
    if (record.kind === 'pull-request') {
      const prior = node.retention.firstPullRequestDate;
      if (!prior || Date.parse(record.date) < Date.parse(prior)) {
        node.retention.firstPullRequestDate = new Date(record.date).toISOString();
      }
    }
  }
  for (const reaction of reactions) addActivity(actorId(reaction.user), reaction.createdAt);
  for (const event of manifest.events) {
    addActivity(event.source, event.date);
    if (event.type === 'coauthor') addActivity(event.target, event.date);
  }
  for (const node of manifest.nodes) {
    for (const contribution of node.contributions) addActivity(node.id, contribution.date);
    node.retention.ownedActivityDates = [...activity.get(node.id)].sort();
  }
  manifest.retentionPolicy = {
    version: 1, permanent: 'From first authored PR, regardless of merge/close state',
    temporary: 'Six UTC calendar months after own activity; discovery establishes initial presence',
    incomingReferencesExtendPresence: false, returnOnOwnActivity: true,
    pullRequestAuthorCount: manifest.nodes.filter(node => node.retention.firstPullRequestDate).length,
  };
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const sourcePath = process.env.SOCIAL_SOURCE_MANIFEST ?? path.join(root, 'data/social-2026-08-31/social-manifest.json');
  const recordsPath = path.join(path.dirname(sourcePath), 'records.private.json');
  const sourceBytes = await readFrozenBytes(sourcePath);
  const recordsBytes = await readFrozenBytes(recordsPath);
  const {records, reactions} = JSON.parse(recordsBytes);
  const manifest = prepareRetentionManifest(JSON.parse(sourceBytes), records, reactions);
  manifest.retentionPolicy.sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  manifest.retentionPolicy.recordsSha256 = createHash('sha256').update(recordsBytes).digest('hex');
  const destination = path.join(path.dirname(sourcePath), 'social-manifest.json');
  const encoded = JSON.stringify(manifest);
  try { await fs.writeFile(destination, encoded, {flag: 'wx', mode: 0o600}); }
  catch (error) {
    if (error.code !== 'EEXIST' || await fs.readFile(destination, 'utf8') !== encoded) throw error;
  }
  console.log(JSON.stringify({manifest: destination, nodes: manifest.nodes.length,
    ...manifest.retentionPolicy, githubRequests: 0}, null, 2));
  if (process.argv.includes('--render')) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['produce-social-orb.mjs'], {cwd: root, stdio: 'inherit',
        env: {...process.env, SOCIAL_MANIFEST: destination}});
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('Render exited ' + code)));
    });
  }
}
