import http from 'node:http';
import {createHmac,timingSafeEqual} from 'node:crypto';

const unlock=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>NEWHEAT · Phone script</title><style>body{background:#11100e;color:#f4f0e8;font:24px/1.4 system-ui;max-width:500px;margin:12vh auto;padding:24px}h1{color:#dd9f49;font-size:28px}</style><h1>NEW HEAT</h1><p id="status">Open Phone script on your Mac and scan its QR to connect.</p><script>
const key=new URLSearchParams(location.hash.slice(1)).get('key');
if(key){document.querySelector('#status').textContent='Connecting your script…';fetch('/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})}).then(r=>{if(!r.ok)throw Error();history.replaceState(null,'','/speaker');location.reload()}).catch(()=>{document.querySelector('#status').textContent='Connection interrupted. Reload to try again, or scan the current QR on your Mac.'})}
</script></html>`;
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));

export async function startSpeakerGateway({accessKey,port=8761,origin='http://127.0.0.1:8760',now=Date.now,secure=true}) {
  if(!/^[a-f0-9]{48}$/.test(accessKey))throw Error('A 192-bit phone key is required');
  const sign=value=>createHmac('sha256',accessKey).update(value).digest('hex');
  const authenticated=req=>{
    const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('nh-speaker='))?.slice(11);
    if(!cookie)return false;const [expires,signature]=cookie.split('.');
    return /^\d{13}$/.test(expires)&&Number(expires)>now()&&Number(expires)<=now()+43200000&&equal(signature,sign(expires));
  };
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/session'&&req.method==='POST'){
        if(req.headers['content-type']!=='application/json'||!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host){res.writeHead(403).end();return;}
        let body='';for await(const part of req){body+=part;if(body.length>512){res.writeHead(413).end();return;}}
        if(!equal(JSON.parse(body).key,accessKey)){res.writeHead(401).end();return;}
        const expires=String(now()+43200000);
        res.setHeader('Set-Cookie',`nh-speaker=${expires}.${sign(expires)}; Max-Age=43200; Path=/; HttpOnly; SameSite=Strict${secure?'; Secure':''}`);
        res.writeHead(204).end();return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
      const route=url.pathname==='/'?'/speaker':url.pathname;
      if(!['/speaker','/speaker.js','/speaker.css','/api/speaker'].includes(route)){res.writeHead(404).end();return;}
      if(!authenticated(req)){
        if(route==='/speaker'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(req.method==='HEAD'?undefined:unlock);return;}
        res.writeHead(401).end();return;
      }
      const response=await fetch(origin+route,{method:req.method,headers:req.headers['if-none-match']?{'If-None-Match':req.headers['if-none-match']}:{},redirect:'error',signal:AbortSignal.timeout(5000)});
      for(const header of ['Content-Type','ETag'])if(response.headers.has(header))res.setHeader(header,response.headers.get(header));
      res.writeHead(response.status).end(req.method==='HEAD'||response.status===304?undefined:Buffer.from(await response.arrayBuffer()));
    }catch{if(!res.headersSent)res.writeHead(502);res.end('The show is reconnecting. Please reload in a moment.');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  return server;
}
