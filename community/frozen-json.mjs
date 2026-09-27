import fs from 'node:fs/promises';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
const decompress = promisify(gunzip);

export async function readFrozenBytes(file) {
  try { return await fs.readFile(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return decompress(await fs.readFile(String(file) + '.gz'));
  }
}
export async function readFrozenJson(file) {
  return JSON.parse((await readFrozenBytes(file)).toString('utf8'));
}
