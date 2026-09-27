import http from 'node:http';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {speakerCatalog,createStageState} from './speaker-model.mjs';

export function speakerURLs(port) {
  const interfaces=os.networkInterfaces();
  const entries=Object.entries(interfaces).sort(([a],[b])=>(a==='en0'?-1:b==='en0'?1:a.localeCompare(b)));
  const ips=entries.flatMap(([name,list])=>/^(en|eth|wlan)/.test(name)?list.filter(i=>i.family==='IPv4'&&!i.internal&&!i.address.startsWith('169.254.')).map(i=>i.address):[]);
  return [...new Set(ips)].map(ip=>`http://${ip}:${port}/speaker`);
}

export async function startSpeakerServer({root,listSlides,port=8760,host='0.0.0.0'}={}) {
  const state=createStageState(), clients=new Set();
  let catalog=speakerCatalog(await listSlides()), version=1, published='', reloadQueue=Promise.resolve();
  const packet=()=>({catalog,version,stage:state.snapshot()});
  function broadcast(force=false) {
    const value=packet(), signature=JSON.stringify([version,value.stage]);
    if(!force && signature===published)return;
    published=signature;
    for(const response of clients)response.write(`data: ${JSON.stringify(value)}\n\n`);
  }
  const files={'/speaker':'speaker.html','/':'speaker.html','/speaker.css':'speaker.css','/speaker.js':'speaker.js'};
  const server=http.createServer(async(req,res)=>{
    // This listener has no editor, mutation, source-file or asset endpoints.
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end('Read-only speaker view');return;}
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/api/speaker') {const body=JSON.stringify(packet()),etag='"'+createHash('sha256').update(body).digest('hex')+'"';res.setHeader('ETag',etag);if(req.headers['if-none-match']===etag){res.writeHead(304).end();return;}res.writeHead(200,{'Content-Type':'application/json'}).end(body);return;}
      if(url.pathname==='/speaker-events' && req.method==='GET') {
        res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});
        res.write(`retry: 1500\ndata: ${JSON.stringify(packet())}\n\n`);
        clients.add(res);req.on('close',()=>clients.delete(res));return;
      }
      const filename=files[url.pathname];
      if(!filename){res.writeHead(404).end('Speaker page not found');return;}
      const body=await fs.readFile(path.join(root,filename));
      const type=filename.endsWith('.css')?'text/css':filename.endsWith('.js')?'text/javascript':'text/html';
      res.writeHead(200,{'Content-Type':type+'; charset=utf-8'}).end(req.method==='HEAD'?undefined:body);
    } catch {if(!res.headersSent)res.writeHead(503);res.end('Speaker view is reconnecting. Reload in a moment.');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve)});
  const interval=setInterval(()=>{broadcast();for(const r of clients)r.write(': connected\n\n');},3000);interval.unref();
  return {
    server,
    connection(){const activePort=server.address().port;const urls=speakerURLs(activePort);const local=`http://127.0.0.1:${activePort}/speaker`;try{const live=JSON.parse(readFileSync(path.join(root,'.dev/phone-tunnel/public.json'),'utf8'));if(live.connected&&/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(live.origin)){process.kill(live.pid,0);const key=readFileSync(path.join(root,'.dev/phone-tunnel/access.key'),'utf8').trim();if(/^[a-f0-9]{48}$/.test(key))return {url:live.origin+'/speaker#key='+key,mode:'internet',urls,local};}}catch{}return {url:urls[0]||`http://${os.hostname()}:${activePort}/speaker`,mode:'local',urls,local};},
    async qr(){const url=this.connection().url;const {stdout}=await promisify(execFile)(process.env.PYTHON ?? 'python3',[path.join(root,'speaker-qr.py'),url],{maxBuffer:2e6});return stdout;},
    publish(body){const accepted=state.update(body,catalog);broadcast();return {accepted,...state.snapshot()};},
    reload(){reloadQueue=reloadQueue.then(async()=>{catalog=speakerCatalog(await listSlides());version++;broadcast(true)}).catch(()=>{});return reloadQueue;},
    close(){clearInterval(interval);for(const r of clients)r.end();server.close();}
  };
}
