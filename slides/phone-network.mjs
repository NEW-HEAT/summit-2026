import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {startSpeakerGateway} from './speaker-gateway.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),runtime=path.join(root,'.dev/phone-tunnel');
fs.mkdirSync(runtime,{recursive:true,mode:0o700});
const keyFile=path.join(runtime,'access.key');
if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,randomBytes(24).toString('hex'),{mode:0o600,flag:'wx'});
const accessKey=fs.readFileSync(keyFile,'utf8').trim();
const gateway=await startSpeakerGateway({accessKey});
const publicState=path.join(runtime,'public.json');
function writeState(value){fs.writeFileSync(publicState+'.tmp',JSON.stringify({...value,pid:process.pid,updatedAt:new Date().toISOString()}),{mode:0o600});fs.renameSync(publicState+'.tmp',publicState)}
writeState({connected:false});
// Explicit empty config avoids reading or changing the user's Cloudflare configuration.
const config=path.join(runtime,'config.yml');fs.writeFileSync(config,'{}\n');
const child=spawn(path.join(runtime,'cloudflared'),['tunnel','--config',config,'--no-autoupdate','--url','http://127.0.0.1:8761','--protocol','http2','--edge-ip-version','4'],{cwd:runtime,stdio:['ignore','pipe','pipe']});
let publicOrigin=null,buffer='',connected=false;
function consume(chunk){
  buffer+=chunk.toString();const lines=buffer.split('\n');buffer=lines.pop();
  for(const line of lines){
    const match=line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if(match){publicOrigin=match[0];console.log('Phone HTTPS hostname allocated');}
    if(line.includes('Registered tunnel connection')){connected=true;console.log('Phone HTTPS connection registered');}
    if(publicOrigin&&connected)writeState({connected:true,origin:publicOrigin});
    // Store event summaries, not connector IDs, traces, cookies or the access key.
    if(/\bERR\b/.test(line))console.error('Phone tunnel connection error; connector is retrying');
  }
}
child.stdout.on('data',consume);child.stderr.on('data',consume);
child.on('error',()=>{writeState({connected:false});gateway.close();process.exit(1)});
child.on('exit',()=>{writeState({connected:false});gateway.close();process.exit(1)});
process.on('SIGTERM',()=>{writeState({connected:false});child.kill('SIGTERM');gateway.close();setTimeout(()=>process.exit(0),1000).unref()});
