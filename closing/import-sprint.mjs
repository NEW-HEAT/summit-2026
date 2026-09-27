import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const input = process.argv[2];
if (!input) throw new Error('Usage: node closing/import-sprint.mjs /path/to/original-sprint.mov');
const expected = 'b9db96af312fadd138d1382beed7cb65e619bbe28a2ca70648f3d492289f2396';
const actual = createHash('sha256').update(readFileSync(input)).digest('hex');
// The original identity is intentionally strict: registration was measured against this clip.
if (actual !== expected) throw new Error('Original clip differs from the archived source identity');
const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'private-inputs/public/media');
mkdirSync(directory, {recursive: true});
const output = path.join(directory, 'sprint-seekable.mp4');
if (existsSync(output)) throw new Error('Playback clip already exists; refusing overwrite');
const result = spawnSync('ffmpeg', ['-v', 'error', '-n', '-i', input, '-ss', '5', '-t', '14',
  '-map', '0:v:0', '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast',
  '-crf', '14', '-g', '1', '-keyint_min', '1', '-sc_threshold', '0', '-an', '-dn',
  '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', output], {stdio: 'inherit'});
if (result.error || result.status !== 0) throw new Error('FFmpeg import failed');
console.log('Created closing/private-inputs/public/media/sprint-seekable.mp4');
