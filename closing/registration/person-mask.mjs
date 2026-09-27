import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const input=join(root,'private-inputs/public/analysis/bridge-gait');
const output=join(root,'private-inputs/public/analysis/bridge-occlusion');
if(existsSync(output)&&readdirSync(output).length)throw new Error('Occlusion revision exists; preserve it');
mkdirSync(output,{recursive:true});
// The soft segmentation was letting the orange ribbon bleed through motion-
// blurred shoes. Harden the person interior but retain a narrow soft edge.
const filter="scale=1920:1080,format=gray,lut=y='clip((val-235)*255/15,0,255)',gblur=sigma=0.35";
const result=spawnSync('ffmpeg',['-v','error','-framerate','30','-i',join(input,'mask-%05d.png'),
  '-vf',filter,'-frames:v','420','-start_number','0',join(output,'mask-%05d.png')],{encoding:'utf8'});
if(result.status!==0)throw new Error(result.stderr);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const masks=readdirSync(output).filter(f=>/^mask-\d{5}\.png$/.test(f)).sort();
if(masks.length!==420)throw new Error('Expected all 420 source-local masks');
const evidence={sourceVideoSha256:'c615e8c7eedae264dd034153a4755c23b03234691cc58d46d60e2da7e83b1eaa',
  sourceMaskManifestSha256:hash(join(input,'mask-hashes.json')),sourceFps:30,sourceFrameRange:[0,419],
  width:1920,height:1080,filter,convention:'white-keeps-trail-black-occludes-person',
  method:'Source-matched local person-matte contrast refinement; no generated body imagery or private location data.',
  masks:masks.map(file=>({file,sha256:hash(join(output,file))}))};
writeFileSync(join(output,'mask-hashes.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({frames:masks.length,manifestSha256:hash(join(output,'mask-hashes.json'))}));
