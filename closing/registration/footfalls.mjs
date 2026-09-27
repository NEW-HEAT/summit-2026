import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const analysisName = process.argv[2] ?? 'bridge-gait';
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(analysisName)) throw new Error('Expected a simple analysis directory name');
const directory = new URL(`../private-inputs/public/analysis/${analysisName}/`, import.meta.url);
const bytes = await readFile(new URL('pose.json', directory));
const pose = JSON.parse(bytes);
const candidates = [];
for (const foot of ['left', 'right']) {
  const values = pose.frames.map(frame => {
    const ankle = frame.joints[`${foot}Ankle`];
    const hip = frame.joints[`${foot}Hip`];
    return ankle && hip && ankle[2] >= 0.25 ? ankle[1] - hip[1] : null;
  });
  // Interpolate short occlusions before differentiating. No synthetic cadence.
  const filled = values.map((value, i) => {
    if (value !== null) return value;
    let a = i - 1, b = i + 1;
    while (a >= 0 && values[a] === null) a--;
    while (b < values.length && values[b] === null) b++;
    if (a < 0) return values[b] ?? 0;
    if (b === values.length) return values[a];
    return values[a] + (values[b] - values[a]) * (i - a) / (b - a);
  });
  const smooth = filled.map((_, i) => filled.slice(Math.max(0, i - 1), i + 2)
    .reduce((sum, value, _, list) => sum + value / list.length, 0));
  for (let i = 4; i < smooth.length - 3; i++) {
    if (smooth[i] < 0.24 || smooth[i] < Math.max(...smooth.slice(Math.max(0, i - 6), i + 7))) continue;
    const nearby = pose.frames.slice(Math.max(0, i - 2), i + 3)
      .filter(f => f.joints[`${foot}Ankle`]?.[2] >= 0.25)
      .sort((a, b) => Math.abs(a.frame - i) - Math.abs(b.frame - i));
    if (!nearby.length) continue;
    const joint = nearby[0].joints[`${foot}Ankle`];
    candidates.push({seconds: i / 30, sourceFrame: i, foot, x: joint[0],
      // Ankle landmarks sit above the sole. Offset stays in source-image space.
      y: Math.min(0.99, joint[1] + 0.032), confidence: joint[2], extension: smooth[i]});
  }
}
candidates.sort((a, b) => a.seconds - b.seconds);
const events = [];
for (const event of candidates) {
  const previous = events.at(-1);
  if (previous && (event.seconds - previous.seconds < 0.18 || event.foot === previous.foot)) {
    if (event.extension > previous.extension) events[events.length - 1] = event;
    continue;
  }
  events.push(event);
}
const result = {schemaVersion: 1, sourceSha256: pose.sourceSha256,
  poseSha256: createHash('sha256').update(bytes).digest('hex'),
  method: 'Local pose-derived alternating maximum leg-extension contact estimates; not force-plate measurements',
  sourceWidth: 1920, sourceHeight: 1080, fps: 30, durationSeconds: pose.durationSeconds,
  maskDirectory: `/analysis/${analysisName}`, maskFrameCount: pose.frames.length,
  coordinateSystem: 'normalized-source-image-top-left-not-geographic', events};
await writeFile(new URL('footfalls.json', directory), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({events: events.length, times: events.map(e => +e.seconds.toFixed(3)),
  maxGap: Math.max(...events.slice(1).map((e, i) => e.seconds - events[i].seconds))}));
