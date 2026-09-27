import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await fs.readFile(path.join(root,'SOURCE_MANIFEST.json'),'utf8'));
let checked=0;
for(const row of manifest.files){
 const data=await fs.readFile(path.join(root,row.path));
 if(createHash('sha256').update(data).digest('hex')!==row.sha256)throw Error(`Source checksum mismatch: ${row.path}`);
 checked++;
}
const screenshots=JSON.parse(await fs.readFile(path.join(root,'SCREENSHOTS.json'),'utf8'));
for(const row of screenshots.files){
 const bytes=await fs.readFile(path.join(root,row.path));
 if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error(`Screenshot checksum mismatch: ${row.path}`);
}
console.log(`PASS: ${checked} source hashes and ${screenshots.files.length} screenshots`);
