import {readFileSync,writeFileSync,mkdirSync,existsSync,appendFileSync,copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
const ws=resolve(fileURLToPath(new URL('.',import.meta.url)));
const stills=process.argv.includes('--stills');
const option=name=>{const i=process.argv.indexOf(name);if(i<0)return undefined;const value=process.argv[i+1];if(!value||value.startsWith('--'))throw Error(`Missing value for ${name}`);return value;};
const id=stills?'closing-stills':'closing-film';
const out=resolve(option('--output')??join(ws,'output',id));
if(existsSync(out))throw Error('Preserve existing capture; choose a new --output directory');
const input=JSON.parse(readFileSync(resolve(option('--heat')??join(ws,'private-inputs/heat.json')),'utf8'));
const evidence=input?.evidence;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
if(!Array.isArray(input?.payload?.routes)||!evidence||
   ['routeCoverage','ownerMatch','allTimeIndexPagination'].some(k=>evidence[k]!=='PASS')||
   input.payload.routes.length!==evidence.drawableRoutes||digest(input.payload)!==evidence.payloadSha256||
   input.payload.routes.reduce((n,r)=>n+r.paths.filter(p=>p.length>=2).length,0)!==evidence.pathCount)
  throw Error('A complete, verified frozen HEAT input is required');
// Only aggregate evidence belongs in a capture receipt; geometry stays private.
const heat={payloadSha256:evidence.payloadSha256,drawableRoutes:evidence.drawableRoutes,pathCount:evidence.pathCount,
  routeCoverage:evidence.routeCoverage,ownerMatch:evidence.ownerMatch,allTimeIndexPagination:evidence.allTimeIndexPagination};
const key=process.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
if(!key)throw Error('Runtime provider credential required');
if(process.argv.includes('--check-inputs')){console.log('PASS: frozen HEAT input and provider credential supplied');process.exit(0);}
mkdirSync(join(out,'frames'),{recursive:true});
const frames=stills?[420,540,900,1260,1320,1680,1860]:Array.from({length:1110},(_,i)=>i===1109?2219:i*2);
const rows=[],errors=[];
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const run=(command,args)=>{const r=spawnSync(command,args,{encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error('Local media process failed');return r.stdout;};
const {chromium}=await import('playwright');
const browser=await chromium.connectOverCDP('http://localhost:9230');
try{
  const pages=browser.contexts().flatMap(c=>c.pages());
  const page=pages.find(p=>p.url().startsWith('http://localhost:5195'))??(pages.length===1?pages[0]:null);
  if(!page)throw Error('Existing project preview required');
  await page.setViewportSize({width:1280,height:720});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  page.on('pageerror',()=>errors.push('page-error'));
  page.on('console',m=>{if(m.type()==='error')errors.push('console-error');});
  await page.addInitScript(({key,input})=>{
    Object.defineProperty(window,'__NEWHEAT_GOOGLE_TILES_KEY__',{value:key});
    window.__NEWHEAT_HEAT_INPUT__=input;
  },{key,input});
  await page.goto('http://localhost:5195/?autoplay=0&tiles=on&calibrate=1&frame=0',{waitUntil:'domcontentloaded'});
  const asset=readFileSync(join(ws,'dist/index.html'),'utf8').match(/src="([^"]+\.js)"/)?.[1];
  if(!asset||await page.locator('script[type="module"]').getAttribute('src')!==asset)throw Error('Loaded build mismatch');
  await page.waitForFunction(()=>window.__NEWHEAT_CLOSING__?.ready,{},{timeout:180000});
  const dataReady=await page.evaluate(expected=>{
    const input=window.__NEWHEAT_HEAT_INPUT__;
    return input?.evidence.payloadSha256===expected&&input.evidence.routeCoverage==='PASS'&&input.payload.routes.length===input.evidence.drawableRoutes;
  },heat.payloadSha256);
  if(!dataReady)throw Error('Complete verified HEAT input is not in browser memory');
  for(const [index,frame]of frames.entries()){
    await page.evaluate(f=>window.__NEWHEAT_SET_FRAME__(f),frame);
    await page.waitForFunction(f=>{
      const s=window.__NEWHEAT_CLOSING__,d=window.__NEWHEAT_DRAW_STATUS__?.();
      return s?.ready&&s.renderedFrame===f&&d?.frame===f&&d.assetsReady&&d.personMaskReady&&d.skyReady&&window.__NEWHEAT_TILE_READINESS__?.().loaded;
    },frame,{timeout:180000});
    const proof=await page.evaluate(async f=>{
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const contexts=[...document.querySelectorAll('.render-viewport canvas, .trail-viewport canvas')].map(c=>c.getContext('webgl2'));
      for(const gl of contexts)gl?.finish();
      const s=window.__NEWHEAT_CLOSING__,d=window.__NEWHEAT_DRAW_STATUS__?.();
      return {frame:f,ready:s?.ready&&s.renderedFrame===f,assetsReady:d?.frame===f&&d.assetsReady,
        personMaskReady:d?.personMaskReady,skyReady:d?.skyReady,tilesLoaded:window.__NEWHEAT_TILE_READINESS__?.().loaded,
        gpuFinished:contexts.length===2&&contexts.every(g=>g&&!g.isContextLost()),gpuSurfaces:contexts.length,
        videoTime:document.querySelector('video')?.currentTime,videoOpacity:s?.diagnostics?.videoOpacity,
        heatRouteCount:s?.diagnostics?.globalHeatRouteCount,heatCoverage:s?.diagnostics?.globalHeatCoverage};
    },frame);
    if(!['ready','assetsReady','personMaskReady','skyReady','tilesLoaded','gpuFinished'].every(k=>proof[k])||proof.heatRouteCount!==heat.drawableRoutes||proof.heatCoverage!=='PASS')throw Error('Frame readiness gate changed');
    const png=join(out,'frames',`frame-${String(index).padStart(5,'0')}.png`);
    await page.screenshot({path:png,scale:'css',animations:'disabled'});
    const row={index,...proof,pngSha256:hash(png)};rows.push(row);
    appendFileSync(join(out,'frame-checkpoints.jsonl'),JSON.stringify(row)+'\n');
    if(stills||index%30===0)console.log(`captured ${index+1}/${frames.length}`);
  }
  const gpu=await page.evaluate(()=>{const gl=document.querySelector('.render-viewport canvas').getContext('webgl2');const e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null,webgl2:true};});
  const providerRequestCount=await page.evaluate(()=>performance.getEntriesByType('resource').filter(e=>new URL(e.name).hostname==='tile.googleapis.com').length);
  let movie=null,probe=null;
  if(!stills){
    movie=join(out,id+'.mp4');
    run('ffmpeg',['-v','error','-framerate','30','-i',join(out,'frames/frame-%05d.png'),'-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart','-force_key_frames','expr:eq(n,1109)','-frames:v','1110',movie]);
    run('ffmpeg',['-v','error','-i',movie,'-f','null','-']);
    probe=JSON.parse(run('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames:format=duration,size','-of','json',movie]));
    run('ffmpeg',['-v','error','-i',movie,'-vf','fps=1,scale=320:-2,tile=8x5:padding=4:margin=4:color=black','-frames:v','1',join(out,'contact-sheet.png')]);
  }
  copyFileSync(join(out,'frames/frame-00000.png'),join(out,'first-frame.png'));
  copyFileSync(join(out,'frames',`frame-${String(frames.length-1).padStart(5,'0')}.png`),join(out,'last-frame.png'));
  const physicalGpu=gpu.renderer&&!/SwiftShader|llvmpipe/i.test(gpu.renderer)?'PASS':'UNVERIFIED';
  const evidence={id,state:'CLOSED_READY_FOR_VISUAL_REVIEW',sourceFps:60,sourceSceneFrameRange:[frames[0],frames.at(-1)],capcutSceneMasterFrameRange:stills?null:[0,1109],reviewFps:30,durationSeconds:stills?null:37,frameCount:rows.length,freshFrames:rows.length,
    everyFrameReady:rows.every(r=>r.ready&&r.assetsReady&&r.personMaskReady&&r.skyReady&&r.tilesLoaded&&r.gpuFinished&&r.heatCoverage==='PASS'),gpu,providerRequestCount,runtimeErrors:errors,heatInput:heat,
    video:movie?{path:movie,sha256:hash(movie),ffprobe:probe}:null,
    verification:{physicalGpu,provider:providerRequestCount>1?'PASS':'UNVERIFIED',runtimeErrors:errors.length?'FAIL':'PASS',allHeatRouteCoverage:'PASS',visualReview:'UNVERIFIED'},
    limitations:['Timing review, not final master.','Selected tiles loaded does not mean maximum provider resolution or seamless meshes.','Known video/tile registration and bridge/horizon mesh seams remain.','HEAT reveal and moving highlights use editorial timing; all drawable account routes participate, with per-path global-view simplification.','Private route geometry is supplied locally and is not stored in capture receipts.']};
  writeFileSync(join(out,'capture-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(out);
}catch{
  writeFileSync(join(out,'incomplete.json'),JSON.stringify({state:'INCOMPLETE_CLOSED_ATTEMPT',capturedFrames:rows.length,reason:'Capture gate failed; no private errors published.'}));
  console.error('Capture incomplete; private runtime details suppressed.');process.exitCode=1;
}finally{await browser.close();}
