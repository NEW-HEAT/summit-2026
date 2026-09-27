const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const crypto=require('node:crypto');
const S=require('./scene.cjs');
const OUTPUT=path.resolve(__dirname,'output');
fs.mkdirSync(OUTPUT,{recursive:true});
const samples=[0,10,19,30,40,56,77,104,430,457,486,515,829,841,853,1700,1790,1800,1825,1828,1848,1853,1960,3800,5808,5927,8728,8794,8825];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const mode=process.argv[2]||'proof';
const verify=[];
const pixelsPerMs=(S.RIGHT-S.LEFT)/(S.NOW-S.EARLY);
const openingChecks=S.DATE_LOCK.windows.map((locked,index)=>{
 const first=Math.ceil(index*S.CAMERA.transitionFrameCount/32);
 const last=Math.ceil((index+1)*S.CAMERA.transitionFrameCount/32)-1;
 const all=Array.from({length:last-first+1},(_,i)=>S.stateAt(first+i));
 const forwards=all.filter(v=>v.direction==='forward');
 const rewinds=all.filter(v=>v.direction==='rewind');
 const w=S.windowFor(index),end=all.at(-1);
 if(end.current!==w.end||new Date(end.current).toISOString().slice(0,10)!==locked.endDate)throw new Error('User endpoint date mismatch');
 if(new Date(forwards[0].current).toISOString().slice(0,10)!==locked.startDate)throw new Error('User start date mismatch');
 if(all.some(v=>v.segment!==index||v.place!==locked.place))throw new Error('User place order changed');
 let peakBack=0,peakForward=0;
 for(let i=1;i<rewinds.length;i++){
  const a=rewinds[i-1],b=rewinds[i];
  if(b.current>a.current+.01||b.x>a.x+.001)throw new Error('Relocation must run backward');
  peakBack=Math.max(peakBack,a.x-b.x);
 }
 for(let i=0;i<forwards.length;i++){
  const b=forwards[i];
  if(b.current<w.start||b.current>w.end)throw new Error('Playback escaped exact user date window');
  if(Math.abs(b.x-S.mapDate(b.current,b))>.001)throw new Error('On-rail cursor disagrees with its date');
  const expected=(x=>{x=Math.max(0,Math.min(1,x));return x*x*x*(x*(x*6-15)+10);})((b.beatProgress-.32)/.62);
  if(Math.abs(b.replayProgress-expected)>1e-12)throw new Error('Playback no longer matches source camera curve');
  if(i){const a=forwards[i-1];if(b.current<a.current||b.x<a.x-.001)throw new Error('Local playback must run forward');peakForward=Math.max(peakForward,b.x-a.x);}
 }
 const forwardPixels=S.mapDate(w.end,end)-S.mapDate(w.start,end);
 const expectedWidth=(w.end-w.start)*pixelsPerMs;
 if(Math.abs(forwardPixels-expectedWidth)>.000001)throw new Error('Visit duration is visually stretched');
 const idealMaximumForwardStep=expectedWidth*1.875/((Math.round((index+1)*1828/32)-Math.round(index*1828/32))*.62);
 if(peakForward>idealMaximumForwardStep+.02)throw new Error('Playback exceeds the source curve velocity');
 for(const state of forwards){
  const expected=S.VISITS.windows[index].startMs+(S.VISITS.windows[index].endMs-S.VISITS.windows[index].startMs)*state.replayProgress;
  if(Math.abs(state.current-expected)>.001)throw new Error('Date is not the exact source timestamp');
  const matching=w.visits.filter(v=>state.current>=v.startMs&&state.current<=v.endMs);
  if((state.context.visit?.index??null)!==(matching[0]?.index??null))throw new Error('False or missing active stay');
  if(state.context.gap&&state.context.visit)throw new Error('A gap must never be shown as presence');
 }
 for(const state of [all[0],forwards[0],end]){
  let prior=-Infinity;
  for(let i=0;i<=200;i++){const x=S.mapDate(state.axisStart+(S.NOW-state.axisStart)*i/200,state);if(x<prior)throw new Error('Calendar mapping inverted time');prior=x;}
  if(Math.abs(S.mapDate(state.axisStart,state)-80)>.001||Math.abs(S.mapDate(S.NOW,state)-1840)>.001)throw new Error('Calendar endpoint drift');
 }
 return {...locked,index,sourceFrameStart:first,sourceFrameEndExclusive:last+1,forwardFirstFrame:forwards[0].frame,forwardCompleteFrame:forwards.find(v=>v.replayProgress===1).frame,
  cameraBeatFractions:[.32,.94],firstVisibleForwardDate:forwards[0].displayDate,lastVisibleForwardDate:end.displayDate,
  forwardPixels,actualDurationDays:(w.end-w.start)/S.DAY,expectedWidthPixels:expectedWidth,peakBackPixelsPerFrame:peakBack,peakForwardPixelsPerFrame:peakForward,observedVisitCount:w.visits.length,gapFrames:forwards.filter(s=>s.context.gap).map(s=>s.frame),
  exactUserDateRange:'PASS',sourceCameraPlaybackCurve:'PASS',backwardRelocation:'PASS',forwardWithinWindow:'PASS',linearCalendarGeometry:'PASS'};
});
const dateRows=['# Locked place/date table','', 'Exact user table in supplied order. Local frame ranges use the source camera beat rules at 60 fps; date endpoints are inclusive. Forward playback uses the source camera curve from 32% to 94% of each beat.','', '| # | Place | Start date | End date | Local frames | Forward frames |','|---:|---|---|---|---|---|',...openingChecks.map(w=>`| ${w.number} | ${w.place} | ${w.startDate} | ${w.endDate} | ${w.sourceFrameStart}–${w.sourceFrameEndExclusive-1} | ${w.forwardFirstFrame}–${w.forwardCompleteFrame} |`),'', 'The 26-frame source tail follows Durham. The existing Jan 01 2023 handoff is reached on frame 1848; the 2022–2023 range state follows. Overlaps and the Palm Beach range extending across 2024–2025 are preserved. Actual live CapCut alignment remains UNVERIFIED.',''];
fs.writeFileSync(path.join(OUTPUT,'DATE_LOCK.md'),dateRows.join('\n'));
const visitRows=['# Observed visit ranges','','These are first/last observed activity bounds, not verified travel arrival and departure times. Missing activity alone does not create a new visit. Source inferred timestamps remain inferred.','','| Place | Window | First observation | Last observation | Activity dates |','|---|---:|---|---|---:|',...S.WINDOWS.flatMap(w=>w.visits.map(v=>`| ${w.place} | ${v.index+1}/${w.visits.length} | ${v.startDate} | ${v.endDate} | ${v.observedDays} |`)),'','Source: private-inputs/observed-visits.json. The separation rule requires an intervening activity farther than both 120 km and twice the scene collection radius. This generated report is private.',''];
fs.writeFileSync(path.join(OUTPUT,'VISIT_RANGES.md'),visitRows.join('\n'));
let maxRewindStep=0;
for(let f=5749;f<5928;f++)maxRewindStep=Math.max(maxRewindStep,Math.abs(S.stateAt(f).x-S.stateAt(f-1).x));
if(maxRewindStep>19)throw new Error('Decade rewind is too abrupt');
console.log('Three-second rewind max step',maxRewindStep.toFixed(3),'px/frame');
// Invariance is checked against calendar duration, independent of selected beat.
let maxAnchorDrift=0,maxTemporalPixelError=0,maxBoundaryStep=0;
const anchors=S.WINDOWS.flatMap(w=>w.visits.flatMap(v=>[v.startMs,v.endMs]));
for(let f=0;f<5730;f++){
 const state=S.stateAt(f);
 for(const stamp of anchors){
  const expected=S.LEFT+(stamp-S.EARLY)*pixelsPerMs;
  maxAnchorDrift=Math.max(maxAnchorDrift,Math.abs(S.mapDate(stamp,state)-expected));
 }
 if(f){const before=S.stateAt(f-1);maxTemporalPixelError=Math.max(maxTemporalPixelError,Math.abs((state.x-before.x)-(state.current-before.current)*pixelsPerMs));
  if(f<1828&&state.segment!==before.segment)maxBoundaryStep=Math.max(maxBoundaryStep,Math.abs(state.x-before.x));
 }
}
if(maxAnchorDrift>1e-6||maxTemporalPixelError>1e-6||maxBoundaryStep>0.5)throw new Error('A date or cursor moved independently of calendar time');
const scaleVerification={status:'PASS',pixelsPerDay:pixelsPerMs*S.DAY,anchorCount:anchors.length,checkedFrames:5730,maxAnchorDriftPixels:maxAnchorDrift,maxTemporalPixelError,maxBeatBoundaryStepPixels:maxBoundaryStep,rangeBarGeometry:'Exact temporal width, butt ends, no minimum width, no colored blur',movieLabels:'Dates and ranges only'};
let prior;
for(let f=0;f<S.FRAME_COUNT;f++) {
 const s=S.stateAt(f);
 if(!Number.isFinite(s.x)||s.x<80-.001||s.x>1840+.001)throw new Error('Scrubber outside rail');
 if(s.current<s.axisStart-.001||s.current>S.NOW+.001)throw new Error('Invalid calendar state');
 if(prior&&s.phase===prior.phase) {
  if([5].includes(s.phase)&&s.current>prior.current+.001)throw new Error('Rewind reverses direction');
  if([3,6].includes(s.phase)&&s.current<prior.current-.001)throw new Error('Forward traversal reverses');
 }
 prior=s;
}
for(const [f,expected] of [[0,S.NOW],[1853,S.JAN23],[2130,S.JAN23],[5729,S.NOW],[5748,S.NOW],[5927,S.DECADE],[5928,S.DECADE],[8679,S.NOW],[8825,S.NOW]]) {
 if(S.stateAt(f).current!==expected)throw new Error('Locked date boundary failed');
 verify.push({frame:f,date:S.stateAt(f).displayDate,pass:true});
}
fs.writeFileSync(path.join(OUTPUT,'model-checks.json'),JSON.stringify({status:'PASS',linearCalendarScale:scaleVerification,framesChecked:S.FRAME_COUNT,boundaries:verify,openingSegments:openingChecks,dateAuthoritySha256:hash(fs.readFileSync(path.join(__dirname,'place-date-lock.json'))),cameraTimingSha256:hash(fs.readFileSync(path.join(__dirname,'camera-playback-timing.json'))),decadeRewind:{seconds:3,axisExpansionSeconds:2.6,maxPixelsPerFrame:maxRewindStep},finale:{growFrames:[8680,8728],typeSizePixels:76,fadeFrames:[8760,8826],lastFrameOpacity:S.stateAt(8825).opacity},renderClock:'frame / 60, no wall-clock dependency'},null,2));
for(const f of samples) {
 fs.writeFileSync(path.join(OUTPUT,`proof-${String(f).padStart(5,'0')}.png`),S.preview(f).toBuffer('image/png'));
}
for(const [name,f] of [['first-frame',0],['last-frame',S.FRAME_COUNT-1]]) {
 const full=S.createCanvas(S.WIDTH,S.HEIGHT);full.getContext('2d').drawImage(S.renderBand(f),0,S.BAND_TOP);
 fs.writeFileSync(path.join(OUTPUT,name+'.png'),full.toBuffer('image/png'));
}
const sheetFrames=[0,10,19,30,40,56,77,104,430,486,829,841,853,1790,1800,1825,1848,1960,5808,8728];
const sheet=S.createCanvas(S.WIDTH,sheetFrames.length*270),c=sheet.getContext('2d');
c.fillStyle='#11151b';c.fillRect(0,0,sheet.width,sheet.height);
sheetFrames.forEach((f,i)=>{
 c.fillStyle='#82909f';c.font='500 24px "Summit Mono"';c.fillText(`${(f/60).toFixed(3)}s · ${S.TIMING.phases[S.stateAt(f).phase].phase}${f<1828?' · '+S.stateAt(f).place+' · '+S.stateAt(f).direction.toUpperCase():''}`,80,i*270+31);
 c.drawImage(S.renderBand(f),0,i*270+42);
});
fs.writeFileSync(path.join(OUTPUT,'timeline-contact-sheet.png'),sheet.toBuffer('image/png'));
fs.writeFileSync(path.join(OUTPUT,'preview-on-light.png'),S.preview(3800,'#d9dde3').toBuffer('image/png'));
console.log(`Proofs and all ${S.FRAME_COUNT} state checks complete.`);
if(mode==='proof')process.exit(0);

const short=mode==='motion';
const name=short?'2016-transition':'unified-timecode-alpha';
const mov=path.join(OUTPUT,name+'.partial.mov');
const preview=path.join(OUTPUT,name+'-preview.partial.mp4');
const finalMov=path.join(OUTPUT,name+'.mov'),finalPreview=path.join(OUTPUT,name+'-preview.mp4');
for(const output of [mov,preview,finalMov,finalPreview]){
 if(fs.existsSync(output))throw new Error(`Output already exists; use a new version: ${output}`);
}
const space=fs.statfsSync(OUTPUT);
if(space.bavail*space.bsize<500*1024*1024)throw new Error('Less than 500 MiB of storage headroom for the lossless MOV; renderer will not start');
const count=short?720:S.FRAME_COUNT;
const graph=`[0:v]pad=${S.WIDTH}:${S.HEIGHT}:0:${S.BAND_TOP}:color=black@0,split=2[alpha][over];color=c=0x11151b:s=${S.WIDTH}x${S.HEIGHT}:r=${S.FPS}[bg];[bg][over]overlay=shortest=1:format=auto,scale=1280:720:flags=lanczos,format=yuv420p[review]`;
const args=['-hide_banner','-loglevel','warning','-f','rawvideo','-pixel_format','rgba','-video_size',`${S.WIDTH}x${S.BAND_HEIGHT}`,'-framerate',String(S.FPS),'-i','pipe:0',
 '-filter_complex',graph,
 '-map','[alpha]','-an','-c:v','qtrle','-pix_fmt','argb','-g','60','-threads','2','-video_track_timescale','60000','-frames:v',String(count),'-n',mov,
 '-map','[review]','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-threads','3','-movflags','+faststart','-frames:v',String(count),'-n',preview];
fs.writeFileSync(path.join(OUTPUT,short?'motion-encode-command.json':'encode-command.json'),JSON.stringify({executable:'ffmpeg',args,rawInput:'straight RGBA from native Skia Canvas getImageData',fps:S.FPS,frames:count},null,2));
async function main(){
 const ff=spawn('ffmpeg',args,{stdio:['pipe','ignore','pipe']});let errors='';
 ff.stderr.on('data',b=>{errors+=b.toString();if(errors.length>12000)errors=errors.slice(-12000);});
 const done=new Promise((resolve,reject)=>{ff.on('error',reject);ff.on('close',code=>code===0?resolve():reject(new Error(`FFmpeg ${code}: ${errors}`)));});
 done.catch(()=>{});
 ff.stdin.on('error',()=>{});
 const start=Date.now();
 for(let i=0;i<count;i++) {
  // One continuous twelve-second excerpt; includes the full three-second rewind.
  const frame=short?5520+i:i;
  const canvas=S.renderBand(frame);
  const rgba=canvas.getContext('2d').getImageData(0,0,S.WIDTH,S.BAND_HEIGHT).data;
  if(!ff.stdin.write(Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength)))await once(ff.stdin,'drain');
  if(i%300===0)console.log(`RENDER ${i}/${count} ${((Date.now()-start)/1000).toFixed(1)}s`);
 }
 ff.stdin.end();await done;
 const completed=finalMov,completedPreview=finalPreview;
 fs.renameSync(mov,completed);fs.renameSync(preview,completedPreview);
 fs.writeFileSync(path.join(OUTPUT,short?'motion-writer-closed.json':'writer-closed.json'),JSON.stringify({writerExited:true,exitCode:0,frames:count,mov:completed,preview:completedPreview,elapsedSeconds:(Date.now()-start)/1000},null,2));
 fs.writeFileSync(path.join(OUTPUT,'text-audit.json'),JSON.stringify(S.textAudit(),null,2));
 console.log(JSON.stringify({status:'WRITER_CLOSED',mov:completed,preview:completedPreview,frames:count,elapsedSeconds:(Date.now()-start)/1000}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
