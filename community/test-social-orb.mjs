import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {FRAME_COUNT, getEventFrame, getTimelineFrame, buildSocialDirector, separatePortraits,
  addSixMonths, buildPresenceWindows, getPresence, getPortraitTarget, getConnectorSegment,
  getConnectorStyle, getDepartureEffect, advancePortraitFocus} from './social-orb-model.mjs';
import {prepareRetentionManifest} from './prepare-social-pr-retention.mjs';
import {createAvatarAtlasLayout} from './social-avatar-atlas.mjs';
import {getVisglSnapshotName} from './visgl-data-scope.mjs';
assert.equal(getVisglSnapshotName('2026-08-31T01:47:35Z'), 'visgl-2026-08-31');
assert.notEqual(getVisglSnapshotName('2026-08-31T01:47:35Z'), getVisglSnapshotName('2026-08-31T23:47:35Z'));
assert.throws(() => getVisglSnapshotName('not-a-date'));
const atlasFixture = Array.from({length: 20000}, (_, index) => ({contributions: index < 2500 ? [{count: 1}] : []}));
const atlasLayout = createAvatarAtlasLayout(atlasFixture);
assert.equal(atlasLayout.tiles.length, atlasFixture.length, 'No identities dropped to fit the texture');
assert.ok(atlasLayout.width <= 8192 && atlasLayout.height <= 16384);
assert.ok(atlasLayout.tiles.every(tile => tile.x + tile.size <= atlasLayout.width && tile.y + tile.size <= atlasLayout.height));
assert.equal(atlasLayout.tiles[2499].size, 128, 'All growing portraits retain full resolution');
assert.equal(atlasLayout.tiles[2500].size, 32, 'Small outer-lane portraits do not inflate texture memory');
assert.deepEqual(createAvatarAtlasLayout(atlasFixture), atlasLayout);
assert.equal(FRAME_COUNT, 3060);
assert.equal(getEventFrame('2016-01-04T01:56:05Z'), 60);
assert.equal(getEventFrame('2026-08-31T01:47:35Z'), 2879);
for (let frame = 0; frame <= 3060; frame += 5) {
  const progress = frame / 3060;
  for (let index = 0; index < 40; index++) {
    const node = {id: String(index), seed: index / 40};
    const point = getPortraitTarget(node, [960, 540], 30, progress);
    assert.ok(Math.hypot((point[0] - 960) / 1.12, (point[1] - 540) / 0.92) >= 374.99,
      'Even a sphere pole projected through the center keeps small portraits in outer lanes');
    const following = getPortraitTarget(node, [960, 540], 30, progress + 1 / 3060);
    assert.ok(Math.hypot(point[0] - following[0], point[1] - following[1]) < 0.5,
      'No angular-speed singularity when a 3D node passes behind the center');
    assert.deepEqual(getPortraitTarget(node, [940, 520], 100, progress), [940, 520]);
  }
}
assert.deepEqual(getConnectorSegment({position: [0, 0], size: 100}, {position: [200, 0], size: 40}),
  {source: [54, 0, 0], target: [176, 0, 0]});
assert.equal(getConnectorSegment({position: [0, 0], size: 100}, {position: [40, 0], size: 40}), null);
assert.ok(getConnectorStyle(0.5, 0, 0.7).opacity > 90);
assert.ok(getConnectorStyle(0.5, 0, 0.7).width >= 1.5);
let focus = 0;
for (let frame = 0; frame < 1000; frame++) {
  const nextFocus = advancePortraitFocus(focus, frame < 500 ? 134 : 18, 900);
  assert.ok(Math.abs(nextFocus - focus) * 900 <= 3.000001, 'Promotion/demotion cannot shoot across the orb');
  focus = nextFocus;
}
assert.ok(focus < 0.001);
assert.equal(getDepartureEffect(0).distance, 0);
assert.equal(getDepartureEffect(0).opacity, 1);
assert.equal(getDepartureEffect(1).opacity, 0);
assert.equal(getDepartureEffect(1).sparkOpacity, 0);
assert.ok(getDepartureEffect(0.77).flash > 0.99);
assert.ok(getDepartureEffect(0.85).sparkOpacity > 0.95);
let previousDeparture = getDepartureEffect(0, 1);
for (let frame = 1; frame <= 42; frame++) {
  const departure = getDepartureEffect(frame / 42, 1);
  assert.ok(departure.distance >= previousDeparture.distance, 'Drift always moves outward');
  assert.ok(departure.distance - previousDeparture.distance < 7.2, 'Departure is a float, not a launch');
  previousDeparture = departure;
}
const fixture = {nodes: [
  {id: '1', firstDate: '2016-01-04', avatar: 'test', contributions: [{date: '2016-01-04', count: 2}]},
  {id: '2', firstDate: '2020-01-01', avatar: 'test', contributions: []},
], events: [{source: '1', target: '2', date: '2020-01-01', type: 'mention'}]};
const director = buildSocialDirector(fixture);
assert.equal(director.edges.size, 1);
assert.equal(director.frames[60].filter(event => event.type === 'contribution')[0].count, 2);
assert.equal(director.frames[60].filter(event => event.edge).length, 0);
const items = [{index: 0, x: 960, y: 540, size: 120}, {index: 1, x: 960, y: 540, size: 40}];
separatePortraits(items);
assert.ok(Math.max(...items.map(item => Math.hypot(item.x - 960, item.y - 540))) <= 1.8,
  'Collision handling must not teleport portraits in a single frame');
const states = new Map();
let lastSpacing;
for (let frame = 0; frame < 300; frame++) {
  const sample = [{index: 0, x: 960, y: 540, size: 120}, {index: 1, x: 960, y: 540, size: 40}];
  lastSpacing = separatePortraits(sample, states);
  assert.ok(lastSpacing.maximumSpeed <= 1.800001);
  assert.ok(lastSpacing.maximumAcceleration <= 0.160001);
  if (frame === 299) assert.ok(Math.hypot(sample[0].x - sample[1].x, sample[0].y - sample[1].y) > 77,
    'Soft spacing converges without forcing an instant separation');
}
assert.equal(new Date(addSixMonths(Date.parse('2023-08-31T12:34:56Z'))).toISOString(), '2024-02-29T12:34:56.000Z');
const outerStates = new Map();
for (let frame = 0; frame < 240; frame++) {
  const outerItems = [
    {index: 1, x: 1380, y: 540, size: 24, protectedCore: {x: 960, y: 540, scaleX: 1.12, scaleY: 0.92, radius: 365}},
    {index: 2, x: 1410, y: 540, size: 134},
  ];
  const motion = separatePortraits(outerItems, outerStates);
  assert.ok((outerItems[0].x - 960) / 1.12 > 320, 'Collision pressure cannot push small portraits through the core');
  assert.ok(motion.maximumSpeed <= 1.800001 && motion.maximumAcceleration <= 0.160001);
}
assert.equal(new Date(addSixMonths(Date.parse('2024-08-31T12:34:56Z'))).toISOString(), '2025-02-28T12:34:56.000Z');
const retentionFixture = {...structuredClone(fixture), cutoff: '2026-08-31T01:47:35Z', nodes: [
  {...structuredClone(fixture.nodes[0]), firstDate: '2020-01-31', contributions: []},
  {...structuredClone(fixture.nodes[1]), firstDate: '2020-01-31', contributions: []},
], events: [{source: '2', target: '1', date: '2020-07-30', type: 'mention'}]};
const enriched = prepareRetentionManifest(retentionFixture, [
  {kind: 'issue', author: {id: 1}, date: '2020-01-31'},
  {kind: 'review', author: {id: 1}, date: '2021-01-01'},
  {kind: 'pull-request', author: {databaseId: 2}, date: '2022-01-01'},
  {kind: 'pull-request', author: {id: 1}, date: '2027-01-01'},
], []);
assert.equal(enriched.nodes[0].retention.firstPullRequestDate, null, 'Reviews and future PRs do not grant permanent presence');
assert.ok(!enriched.nodes[0].retention.ownedActivityDates.some(date => date.startsWith('2020-07-30')),
  'Receiving a mention must not reset inactivity');
for (const node of enriched.nodes) node.presenceWindows = buildPresenceWindows(node);
const at = (node, date) => getPresence(node, getTimelineFrame(Date.parse(date)));
assert.equal(at(enriched.nodes[0], '2020-06-01').visible, true);
assert.equal(at(enriched.nodes[0], '2020-07-31').visible, false, 'Six calendar months exactly');
assert.equal(at(enriched.nodes[0], '2021-02-01').visible, true, 'Own activity re-enters');
assert.equal(at(enriched.nodes[0], '2021-07-01').visible, false);
assert.equal(at(enriched.nodes[1], '2021-06-01').visible, false, 'A future PR cannot retain someone early');
assert.equal(at(enriched.nodes[1], '2022-01-02').permanent, true);
assert.equal(at(enriched.nodes[1], '2026-08-30').visible, true);
assert.equal(at(enriched.nodes[1], '2026-08-30').departure, 0, 'PR authors never fizzle away');
const expiryFrame = getTimelineFrame(Date.parse('2020-07-31'));
assert.ok(getPresence(enriched.nodes[0], expiryFrame - 10).departure > 0.7);
assert.equal(getPresence(enriched.nodes[0], expiryFrame).visible, false, 'Fizzle finishes exactly at expiry');
assert.equal(getPresence(enriched.nodes[1], 3059).visible, true, 'Outro holds source time');
const recent = {...enriched.nodes[0], firstDate: '2026-08-01', retention: {ownedActivityDates: ['2026-08-01']}};
recent.presenceWindows = buildPresenceWindows(recent);
assert.equal(getPresence(recent, 3059).visible, true, 'Do not clamp future expiry to the final frame');
const nearCutoff = {...recent, firstDate: '2026-03-02', retention: {ownedActivityDates: ['2026-03-02']}};
nearCutoff.presenceWindows = buildPresenceWindows(nearCutoff);
assert.equal(getPresence(nearCutoff, 3059).departure, 0, 'No future-expiry flash frozen in the outro');
const beforeRecap = prepareRetentionManifest(retentionFixture, [
  {kind: 'pull-request', author: {id: 1}, date: '2015-12-01'},
], []).nodes[0];
beforeRecap.presenceWindows = buildPresenceWindows(beforeRecap);
assert.equal(getPresence(beforeRecap, 60).permanent, true, 'Lifetime PR authorship survives the recap start boundary');
assert.deepEqual(prepareRetentionManifest(retentionFixture, [], []), prepareRetentionManifest(retentionFixture, [], []));
assert.deepEqual(buildSocialDirector(structuredClone(fixture)).nodes.map(node => node.direction),
  director.nodes.map(node => node.direction));
if (process.env.SOCIAL_CREATE_SMOKE === '1') {
  const current = JSON.parse(await fs.readFile(new URL('./data/ten-year-current.json', import.meta.url)));
  const original = JSON.parse(await fs.readFile(new URL('./data/' + current.manifestPath, import.meta.url)));
  const nodes = original.identities.map(identity => ({id: identity.providerUserId,
    login: identity.login, avatar: identity.avatarAsset.dataUrl, firstDate: identity.firstContributionDate,
    contributions: []}));
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const week of original.weeks) for (const day of week.days) {
    if (!day.inRange) continue;
    for (const contributor of day.visibleContributors) byId.get(contributor.providerUserId)?.contributions.push({
      date: day.date, count: contributor.authoredCommitCount});
  }
  await fs.writeFile(new URL('./data/social-render-smoke.json', import.meta.url),
    JSON.stringify({nodes, events: [], coverage: {mode: 'commit-only renderer smoke test'}}));
}
console.log('PASS: outward drift, single flash, fizzle and exact expiry; protected outer lanes, bounded orbital speed, readable rim connectors; deterministic layout and bounded collision motion; PR authorship, no future leakage, reentry and outro retention.');
