#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {getVisglSnapshotName} from './visgl-data-scope.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const cutoff = process.env.SOCIAL_FREEZE ?? '2026-08-31T01:47:35Z';
if (cutoff !== '2026-08-31T01:47:35Z' && process.env.SOCIAL_STILLS !== '1') {
  throw new Error('A new cutoff needs matching calendar/timecode tracks. Frozen rerenders keep the locked handoff.');
}
process.env.SOCIAL_MANIFEST ??= path.join(root, 'data', getVisglSnapshotName(cutoff), 'visgl-social-manifest.json');
process.env.SOCIAL_MANIFEST = path.resolve(root, process.env.SOCIAL_MANIFEST);
process.env.SOCIAL_FILE_PREFIX ??= 'visgl-social-constellation';
let frozen = false;
try {
  const manifest = JSON.parse(await fs.readFile(process.env.SOCIAL_MANIFEST, 'utf8'));
  frozen = manifest.repository === 'visgl/*' && manifest.cutoff === cutoff && manifest.coverage.allRepositoriesComplete;
} catch {}
console.log(frozen ? 'Reusing complete frozen vis.gl manifest; no GitHub requests.' : 'Acquiring all current public vis.gl repositories through read-only endpoints.');
for (const script of [...(frozen ? [] : ['acquire-visgl-social.mjs']),
  'verify-visgl-social.mjs', 'test-social-orb.mjs', 'render-social-orb.mjs']) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {cwd: root, env: process.env, stdio: 'inherit'});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(script + ' exited ' + code)));
  });
}
