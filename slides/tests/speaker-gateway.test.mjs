import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {startSpeakerGateway} from '../speaker-gateway.mjs';

test('public phone gateway requires a valid link and never exposes editor or source routes',async t=>{
  let now=Date.now(),upstreamCalls=0;
  const upstream=http.createServer((req,res)=>{upstreamCalls++;if(req.headers['if-none-match']==='"cue-1"'){res.writeHead(304,{ETag:'"cue-1"'}).end();return;}res.writeHead(200,{'Content-Type':'application/json',ETag:'"cue-1"'}).end(JSON.stringify({cue:'exact poem',path:req.url}));});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>upstream.close());
  const key='a'.repeat(48),gateway=await startSpeakerGateway({accessKey:key,port:0,origin:'http://127.0.0.1:'+upstream.address().port,now:()=>now});t.after(()=>gateway.close());
  const base='http://127.0.0.1:'+gateway.address().port;
  const locked=await (await fetch(base+'/speaker')).text();assert.match(locked,/scan its QR/);assert.ok(!locked.includes('exact poem'));
  assert.equal((await fetch(base+'/api/speaker')).status,401);assert.equal(upstreamCalls,0);
  const login=(body,origin=base)=>fetch(base+'/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
  assert.equal((await login({key:'b'.repeat(48)})).status,401);
  assert.equal((await login({key},'https://unrelated.invalid')).status,403);
  const auth=await login({key});assert.equal(auth.status,204);
  const cookieHeader=auth.headers.get('set-cookie');assert.match(cookieHeader,/HttpOnly; SameSite=Strict; Secure/);const cookie=cookieHeader.split(';')[0];
  const allowed=await fetch(base+'/api/speaker',{headers:{Cookie:cookie}});assert.deepEqual(await allowed.json(),{cue:'exact poem',path:'/api/speaker'});
  assert.equal((await fetch(base+'/api/speaker',{headers:{Cookie:cookie,'If-None-Match':'"cue-1"'}})).status,304);
  const count=upstreamCalls;
  for(const route of ['/api/slides','/api/presentation','/server.mjs','/speaker-events','/assets/film.mp4'])assert.equal((await fetch(base+route,{headers:{Cookie:cookie}})).status,404);
  assert.equal((await fetch(base+'/api/speaker',{method:'POST',headers:{Cookie:cookie}})).status,405);assert.equal(upstreamCalls,count);
  assert.equal((await fetch(base+'/api/speaker',{headers:{Cookie:cookie+'bad'}})).status,401);
  now+=43200001;assert.equal((await fetch(base+'/api/speaker',{headers:{Cookie:cookie}})).status,401);
});
