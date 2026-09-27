import http from 'node:http';import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {build,root} from './build.mjs';import {createStore} from './store.mjs';
import {startOasisDemo} from './oasis-demo-proxy.mjs';
import {startSpeakerServer} from './speaker-server.mjs';
const oasisDemo=startOasisDemo();
const port=Number(process.argv[2]||8756),store=createStore(root),clients=new Set();
let speaker;
function notify(type){for(const r of clients)r.write(`data: ${JSON.stringify({type})}\n\n`);if(type==='slides')speaker?.reload();}
await build(true,notify);
speaker=await startSpeakerServer({root,listSlides:()=>store.list()});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.ttf':'font/ttf'};
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(data))}
async function body(req){let b='';for await(const c of req){b+=c;if(b.length>256000)throw new Error('Slide is too large')}return JSON.parse(b)}
const server=http.createServer(async(req,res)=>{
 try{
  const host=req.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return send(res,403,{error:'Local editor only'});
  const u=new URL(req.url,'http://'+host);
  if(u.pathname==='/api/phone'&&req.method==='GET')return send(res,200,speaker.connection());
  if(u.pathname==='/phone-qr.svg'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'}).end(await speaker.qr());return;}
  if(u.pathname==='/api/presentation'&&req.method==='POST'){
   if(req.headers.origin!==`http://${host}`||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'Use the local presentation'});
   return send(res,200,speaker.publish(await body(req)));
  }
  if(u.pathname==='/api/slides'&&req.method==='GET')return send(res,200,{slides:await store.list()});
  if(u.pathname.startsWith('/api/slides/')&&req.method==='PUT'){
   if(req.headers.origin!==`http://${host}`||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'Save from the local editor'});
   const id=u.pathname.slice('/api/slides/'.length);if(!/^slide-\d{2}(?:-\d{1,2})?$/.test(id))return send(res,404,{error:'Slide not found'});
   const b=await body(req);const updated=await store.update(id,b.slide,b.revision);send(res,200,updated);notify('slides');return;
  }
  if(u.pathname==='/events'&&req.method==='GET'){
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('retry: 1000\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
  }
  if(!['GET','HEAD'].includes(req.method))return send(res,405,{error:'Method not allowed'});
  let url=decodeURIComponent(u.pathname);
  if(['/', '/NEWHEAT-live-deck.html'].includes(url)||/^\/slides\/\d+(?:\.\d+)?$/.test(url))url='/index.html';
  const aliases={'/app.js':'/.dev/app.js'};const mapped=aliases[url]||url;
  if(!['/index.html','/app.js','/style.css'].includes(url)&&!url.startsWith('/assets/'))return send(res,404,{error:'File not found'});
  const file=path.resolve(root,'.'+mapped);if(!file.startsWith(root+path.sep))return send(res,403,{error:'Invalid path'});
  const stat=await fsp.stat(file);if(!stat.isFile())return send(res,404,{error:'File not found'});
  let start=0,end=stat.size-1,status=200;
  if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return}
   start=m[1]?Number(m[1]):Math.max(0,stat.size-Number(m[2]));if(m[1]&&m[2])end=Math.min(Number(m[2]),end);
   if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return}status=206;
  }
  const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
  if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
  res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return}
  const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 }catch(e){send(res,e.status|| (e.code==='ENOENT'?404:400),{error:e.message||'Unable to complete request'})}
});
const watches=[fs.watch(root+'/slides',()=>notify('slides')),fs.watch(root,(_,name)=>{if(['style.css','index.html'].includes(name))notify('reload');if(name==='RUNNING_ORDER.json')notify('slides')})];
setInterval(()=>{for(const r of clients)r.write(': keepalive\n\n')},15000).unref();
server.listen(port,'127.0.0.1',()=>console.log(`NEWHEAT Slide Studio http://127.0.0.1:${port}/NEWHEAT-live-deck.html#13`));
process.on('SIGTERM',()=>{watches.forEach(w=>w.close());server.close();oasisDemo.close();speaker.close();process.exit(0)});
