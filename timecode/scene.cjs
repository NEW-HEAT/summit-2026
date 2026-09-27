const {createCanvas,GlobalFonts}=require('@napi-rs/canvas');
const fs=require('node:fs'),path=require('node:path');
GlobalFonts.registerFromPath(process.env.SUMMIT_MONO_FONT || '/System/Library/Fonts/SFNSMono.ttf','Summit Mono');
const TIMING=JSON.parse(fs.readFileSync(path.join(__dirname,'approved-timing.json')));
const WIDTH=1920,HEIGHT=1080,BAND_HEIGHT=224,BAND_TOP=HEIGHT-BAND_HEIGHT;
const FPS=60,FRAME_COUNT=8826,LEFT=80,RIGHT=1840,RAIL_Y=1008-BAND_TOP;
const DAY=86400000,date=s=>Date.parse(s+'T00:00:00Z');
const NOW=date('2026-09-03'),EARLY=date('2022-01-01'),JAN23=date('2023-01-01'),DECADE=date('2016-01-04');
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const mix=(a,b,p)=>a+(b-a)*p;
const smooth=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10);};
const interval=(f,a,z)=>clamp((f-a)/Math.max(1,z-a-1));
function cruise(p,edge){
 p=clamp(p);const integral=x=>x*x*x-.5*x*x*x*x;
 if(p<edge)return edge*integral(p/edge)/(1-edge);
 if(p>1-edge)return 1-edge*integral((1-p)/edge)/(1-edge);
 return (p-edge/2)/(1-edge);
}
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDate(ms){const d=new Date(ms);return `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2,'0')} ${d.getUTCFullYear()}`;}
const DATE_LOCK=JSON.parse(fs.readFileSync(path.join(__dirname,'place-date-lock.json')));
const CAMERA=JSON.parse(fs.readFileSync(path.join(__dirname,'camera-playback-timing.json')));
const visitsPath=path.join(__dirname,'private-inputs/observed-visits.json');
if(!fs.existsSync(visitsPath))throw new Error('Missing private visit input. Restore scene.json and run python3 timecode/extract-visits.py; see RECOVERY.md.');
const VISITS=JSON.parse(fs.readFileSync(visitsPath));
const STYLE=JSON.parse(fs.readFileSync(path.join(__dirname,'style-contract.json')));
const COLORS={gold:'#ffd16a',aqua:'#68e1ca',blue:'#89bcff',violet:'#b7a4ff',rose:'#f29cb5',return:'#b7a4ff'};
const WINDOWS=VISITS.windows.map((w,i)=>({...w,start:w.startMs,end:w.endMs,
 color:i===14?COLORS.gold:[COLORS.aqua,COLORS.violet,COLORS.violet,COLORS.violet,COLORS.violet,COLORS.blue,COLORS.blue,COLORS.violet,COLORS.aqua,COLORS.aqua,COLORS.rose,COLORS.aqua,COLORS.blue,COLORS.rose,COLORS.gold,COLORS.blue,COLORS.rose,COLORS.blue,COLORS.aqua,COLORS.aqua,COLORS.rose,COLORS.aqua,COLORS.aqua,COLORS.blue,COLORS.blue,COLORS.blue,COLORS.violet,COLORS.violet,COLORS.violet,COLORS.violet,COLORS.violet,COLORS.blue][i]}));
function windowFor(index){return index<0?{start:NOW-DAY,end:NOW,place:'Today'}:WINDOWS[index];}
// A single affine calendar scale. No selected interval can resize the rail.
function mapDate(ms,s){return LEFT+clamp((ms-s.axisStart)/(NOW-s.axisStart))*(RIGHT-LEFT);}
function presenceAt(w,ms){
 const visit=w.visits.find(v=>ms>=v.startMs&&ms<=v.endMs)||null;
 const gap=visit?null:w.gaps.find(g=>ms>g.startMs&&ms<g.endMs)||null;
 return {visit,gap};
}
function recapPresence(ms){
 const matches=WINDOWS.map(w=>({w,...presenceAt(w,ms)})).filter(p=>p.visit);
 // Prefer the shortest contemporaneous observed window where clusters overlap.
 return matches.sort((a,b)=>(a.visit.endMs-a.visit.startMs)-(b.visit.endMs-b.visit.startMs))[0]||null;
}
function shortRange(v){
 const a=new Date(v.startMs),b=new Date(v.endMs),da=a.getUTCDate(),db=b.getUTCDate();
 const ma=months[a.getUTCMonth()],mb=months[b.getUTCMonth()];
 if(a.getUTCFullYear()!==b.getUTCFullYear())return `${ma} ${da}, ${a.getUTCFullYear()} – ${mb} ${db}, ${b.getUTCFullYear()}`;
 if(a.getUTCMonth()===b.getUTCMonth())return da===db?`${ma} ${da}`:`${ma} ${da}–${db}`;
 return `${ma} ${da} – ${mb} ${db}`;
}
function stateAt(frame){
 if(!Number.isInteger(frame)||frame<0||frame>=FRAME_COUNT)throw new Error('Frame outside contract');
 let current=NOW,range=0,segment=31,direction='forward',replayProgress=1,relocateProgress=1,beatProgress=1;
 let place=windowFor(31).place,playStart=windowFor(31).start,playEnd=windowFor(31).end,jumpFrom=windowFor(30).end;
 const expansion=smooth(interval(frame,5748,5904));
 const cursorRewind=smooth(interval(frame,5748,5928));
 const expansionNotice=smooth(interval(frame,5748,5766))*(1-smooth(interval(frame,5886,5928)));
 const finale=smooth(interval(frame,8680,8728)),opacity=1-smooth(interval(frame,8760,8826));
 const axisStart=mix(EARLY,DECADE,expansion);
 if(frame<CAMERA.transitionFrameCount){
  segment=Math.min(31,Math.floor(frame*32/CAMERA.transitionFrameCount));
  const start=Math.round(segment*CAMERA.transitionFrameCount/32),end=Math.round((segment+1)*CAMERA.transitionFrameCount/32);
  beatProgress=clamp((frame-start)/(end-start));
  const active=windowFor(segment),previous=windowFor(segment-1);
  playStart=active.start;playEnd=active.end;jumpFrom=previous.end;place=active.place;
  if(beatProgress<CAMERA.incomingPlaybackStartFraction){
   direction='rewind';replayProgress=0;relocateProgress=smooth(beatProgress/CAMERA.incomingPlaybackStartFraction);
   current=mix(previous.end,active.start,relocateProgress);
  }else{
   replayProgress=smooth((beatProgress-CAMERA.incomingPlaybackStartFraction)/(CAMERA.incomingPlaybackEndFraction-CAMERA.incomingPlaybackStartFraction));
   current=mix(active.start,active.end,replayProgress);
  }
 }else if(frame<1854){
  direction='rewind';relocateProgress=smooth(interval(frame,1828,1849));jumpFrom=windowFor(31).end;playStart=JAN23;
  current=mix(jumpFrom,JAN23,relocateProgress);
 }else if(frame<2070){current=JAN23;range=smooth(interval(frame,1854,1950));}
 else if(frame<2130){current=JAN23;range=1-smooth(interval(frame,2070,2130));}
 else if(frame<5730)current=mix(JAN23,NOW,cruise(interval(frame,2130,5730),.025));
 else if(frame<5748)current=NOW;
 else if(frame<5928)current=mix(NOW,axisStart,cursorRewind);
 else if(frame<8680)current=mix(DECADE,NOW,cruise(interval(frame,5928,8680),.04));
 const x=mapDate(current,{axisStart});
 let context=null;
 if(frame<1828){const w=windowFor(segment);context={w,...presenceAt(w,current)};if(direction==='rewind')context={w,visit:null,gap:null};}
 else if(frame>=2130&&frame<5730)context=recapPresence(current);
 const gapProgress=context?.gap?clamp((current-context.gap.startMs)/(context.gap.endMs-context.gap.startMs)):0;
 const jumpPixels=Math.abs(mapDate(jumpFrom,{axisStart})-mapDate(playStart,{axisStart}));
 const gapPixels=context?.gap?mapDate(context.gap.endMs,{axisStart})-mapDate(context.gap.startMs,{axisStart}):0;
 // The subtle off-rail arc also scales with elapsed time. A one-day step cannot bounce like a year.
 const markerY=RAIL_Y+(direction==='rewind'?Math.sin(Math.PI*relocateProgress)*Math.min(8,jumpPixels*.08):context?.gap?Math.sin(Math.PI*gapProgress)*Math.min(8,gapPixels*.08):0);
 return {frame,seconds:frame/FPS,current,displayDate:formatDate(current),axisStart,displayStartDate:formatDate(axisStart),expansion,cursorRewind,expansionNotice,finale,opacity,range,segment,x,markerY,
  direction,replayProgress,relocateProgress,playStart,playEnd,jumpFrom,beatProgress,place,context,gapProgress,
  phase:TIMING.phases.findIndex(p=>frame>=p.localFrames60[0]&&frame<p.localFrames60[1])};
}
const band=createCanvas(WIDTH,BAND_HEIGHT),ctx=band.getContext('2d');
const faded=createCanvas(WIDTH,BAND_HEIGHT),fadeCtx=faded.getContext('2d');
const renderedFrames=new Set(),renderedLabels=new Set();
function line(x1,y1,x2,y2,color,width){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.stroke();}
function rangeBar(x0,x1,color,width){if(x1<=x0)return;ctx.fillStyle=color;ctx.fillRect(x0,RAIL_Y-width/2,x1-x0,width);}
function text(value,x,y,size,color,align='center',weight=STYLE.fontWeight){
 // This assertion runs on every encoded frame. The MOV can contain dates only.
 if(String(value).replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g,'').replace(/[0-9\s,–→-]/g,''))throw new Error('Non-date movie label rejected');
 renderedLabels.add(value);ctx.font=`${weight} ${size}px "Summit Mono"`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.lineJoin='round';ctx.strokeStyle='rgba(5,8,12,.82)';ctx.lineWidth=STYLE.textKeylinePixels;ctx.strokeText(value,x,y);ctx.fillStyle=color;ctx.fillText(value,x,y);
}
function textAudit(){return {datesOnly:true,uniqueDateLabels:renderedLabels.size,renderedFrameCount:renderedFrames.size};}
function renderBand(frame){
 renderedFrames.add(frame);
 const s=stateAt(frame);ctx.clearRect(0,0,WIDTH,BAND_HEIGHT);ctx.save();
 if(s.opacity===0){ctx.restore();return band;}
 // Date-only transparent row. Geographic identities remain in the data, never in the movie.
 ctx.shadowColor='rgba(0,0,0,.85)';ctx.shadowBlur=STYLE.textShadowBlurPixels;ctx.shadowOffsetY=1;
 if(frame>=8680){
  // The two existing year endpoints join to become the whole-decade recap.
  // Preserve their original positions at the first frame, then gather and grow.
  const g=s.finale,finalFont=STYLE.finaleSizePixels,y=mix(975,928,g)-BAND_TOP;
  ctx.font=`${STYLE.fontWeight} ${finalFont}px "Summit Mono"`;
  const fullWidth=ctx.measureText('2016–2026').width;
  const targetLeft=(WIDTH-fullWidth)/2,targetRight=(WIDTH+fullWidth)/2;
  const railY=mix(RAIL_Y,1000-BAND_TOP,g);
  line(LEFT,railY,RIGHT,railY,'rgba(241,240,235,.38)',mix(STYLE.baselinePixels,5,g));
  line(LEFT,railY,RIGHT,railY,'rgba(249,246,236,.85)',mix(STYLE.baselinePixels,5,g));
  text('2016',mix(LEFT,targetLeft,g),y,mix(STYLE.endpointYearSizePixels,finalFont,g),`rgb(${Math.round(mix(192,246,g))},${Math.round(mix(198,245,g))},${Math.round(mix(203,240,g))})`,'left');
  text('2026',mix(RIGHT,targetRight,g),y,mix(STYLE.dateSizePixels,finalFont,g),'#f6f5f0','right');
  const prefixAlpha=1-smooth(interval(frame,8680,8698));
  if(prefixAlpha>.005){
   ctx.globalAlpha=prefixAlpha;ctx.font=`${STYLE.fontWeight} ${STYLE.dateSizePixels}px "Summit Mono"`;
   const left=RIGHT-ctx.measureText('Sep 03 2026').width;
   text('Sep 03 ',left,y,STYLE.dateSizePixels,'#f6f5f0','left');
  }
  const dashAlpha=smooth(interval(frame,8692,8724));
  if(dashAlpha>.005){ctx.globalAlpha=dashAlpha;text('–',WIDTH/2,y,mix(STYLE.dateSizePixels,finalFont,g),'#f6f5f0');}
  const cursorAlpha=1-smooth(interval(frame,8680,8720));
  if(cursorAlpha>.005){
   ctx.globalAlpha=cursorAlpha;line(RIGHT,railY-18,RIGHT,railY-7,'rgba(247,245,238,.78)',STYLE.cursorStrokePixels);
   ctx.beginPath();ctx.arc(RIGHT,railY,STYLE.cursorRadiusPixels,0,Math.PI*2);ctx.fillStyle='#ff8c70';ctx.fill();
  }
  ctx.restore();
  // Fade the entire already-composited row, so overlapping strokes and their
  // shadows fade together and the last frame is exactly transparent.
  if(s.opacity<1){fadeCtx.clearRect(0,0,WIDTH,BAND_HEIGHT);fadeCtx.globalAlpha=s.opacity;fadeCtx.drawImage(band,0,0);fadeCtx.globalAlpha=1;return faded;}
  return band;
 }
 line(LEFT,RAIL_Y,RIGHT,RAIL_Y,'rgba(241,240,235,.52)',STYLE.baselinePixels);
 // Quiet quarter ticks give the fixed calendar scale a stable visual reference.
 if(frame<5730){
  for(let year=2022;year<=2026;year++)for(const month of [0,3,6,9]){
   const stamp=Date.UTC(year,month,1);if(stamp<=EARLY||stamp>=NOW)continue;
   const x=mapDate(stamp,s),h=month===0?6:4;
   line(x,RAIL_Y-h,x,RAIL_Y+h,month===0?'rgba(241,240,235,.48)':'rgba(241,240,235,.25)',month===0?2:1.5);
  }
 }
 const segmentAlpha=1-smooth(interval(frame,1828,1914));
 const historyAlpha=smooth(interval(frame,2130,2178))*(1-smooth(interval(frame,5690,5730)));
 const calendarAlpha=Math.max(segmentAlpha,historyAlpha);
 if(calendarAlpha>.001){
  const map=ms=>mapDate(ms,s);
  // Butt-ended bars use their actual temporal width, including subpixel spans.
  ctx.shadowBlur=0;
  // All return windows share one continuous rail. Blank gaps stay blank.
  for(const w of WINDOWS){
   const selected=s.context?.w.number===w.number;
   const palm=w.number===15;
   const baseOpacity=selected?.62:palm?.55:.26;
   for(const v of w.visits){
    const x0=map(v.startMs),x1=map(v.endMs);
    ctx.globalAlpha=calendarAlpha*baseOpacity;
    rangeBar(x0,x1,w.color,selected?STYLE.highlightRangePixels:palm?STYLE.palmRangePixels:STYLE.inactiveRangePixels);
   }
  }
  const w=s.context?.w;
  if(w){
   const emphasis=frame<1828?(s.direction==='rewind'?s.relocateProgress:1):1;
   for(const v of w.visits){
    const a=map(v.startMs),b=map(v.endMs);
    ctx.globalAlpha=calendarAlpha*emphasis;
    // Distinct endpoints and observed-day ticks reveal duration and density.
    line(a,RAIL_Y-6,a,RAIL_Y+6,w.color,STYLE.rangeEndpointPixels);
    line(b,RAIL_Y-6,b,RAIL_Y+6,w.color,STYLE.rangeEndpointPixels);
    if(b-a>14){
     ctx.globalAlpha*=.55;
     for(const day of v.observedDates){
      const x=map(clamp(date(day)+DAY/2,v.startMs,v.endMs));
      line(x,RAIL_Y-3,x,RAIL_Y+3,w.color,1.75);
     }
    }
    if(s.direction==='forward'&&s.current>=v.startMs){
     ctx.globalAlpha=calendarAlpha*emphasis;
     rangeBar(a,map(Math.min(s.current,v.endMs)),w.color,STYLE.highlightRangePixels);
    }
   }
   if(s.context.gap){
    const g=s.context.gap,a=map(g.startMs),b=map(g.endMs);
    ctx.globalAlpha=.5*calendarAlpha;ctx.setLineDash([2,6]);
    ctx.beginPath();ctx.moveTo(a,RAIL_Y);const lift=Math.min(8,(b-a)*.08);ctx.bezierCurveTo(a+(b-a)/3,RAIL_Y+lift,b-(b-a)/3,RAIL_Y+lift,b,RAIL_Y);
    ctx.strokeStyle=COLORS.return;ctx.lineWidth=2.25;ctx.stroke();ctx.setLineDash([]);
   }
  }
  if(s.direction==='rewind'){
   for(let k=7;k>=1;k--){
    const before=stateAt(Math.max(0,frame-k)),after=stateAt(Math.max(0,frame-k+1));
    if(before.segment===s.segment&&after.direction==='rewind'){
     ctx.globalAlpha=calendarAlpha*(8-k)/12;
     line(before.x,before.markerY,after.x,after.markerY,COLORS.return,2.5);
    }
   }
  }
  ctx.globalAlpha=1;ctx.shadowBlur=STYLE.textShadowBlurPixels;
 }
 if(segmentAlpha<.999)line(LEFT,RAIL_Y,s.x,RAIL_Y,`rgba(249,246,236,${.78*(1-segmentAlpha)})`,2.75);
 if(s.expansionNotice>.005){
  // The old 2022 boundary visibly slides right as earlier time opens on the
  // left. A few unlabelled ticks make this scale change legible without clutter.
  const map=ms=>LEFT+(RIGHT-LEFT)*(ms-s.axisStart)/(NOW-s.axisStart);
  const oldStart=map(EARLY);
  line(LEFT,RAIL_Y,oldStart,RAIL_Y,`rgba(255,174,147,${s.expansionNotice*.72})`,3.5);
  line(oldStart,RAIL_Y-5,oldStart,RAIL_Y+5,`rgba(249,246,236,${s.expansionNotice*.75})`,2.5);
  for(const year of [2016,2018,2020]){
   const stamp=date(`${year}-01-01`),x=map(stamp);
   if(x>LEFT+6&&x<oldStart-6)line(x,RAIL_Y-3,x,RAIL_Y+3,`rgba(249,246,236,${s.expansionNotice*.48})`,1.75);
  }
  ctx.globalAlpha=s.expansionNotice;
  text(s.displayStartDate,LEFT,1044-BAND_TOP,31,'#ffc2aa','left');
  ctx.globalAlpha=1;
 }
 const FONT=STYLE.dateSizePixels,DATE_Y=975-BAND_TOP;
 ctx.font=`${STYLE.fontWeight} ${FONT}px "Summit Mono"`;
 const labelWidth=ctx.measureText('Sep 03 2026').width;
 const center=clamp(s.x,LEFT+labelWidth/2,RIGHT-labelWidth/2);
 // End labels yield gracefully to the approaching date, avoiding duplicates.
 const leftOpacity=smooth(clamp((center-labelWidth/2-(LEFT+88))/95))*(1-s.expansionNotice);
 const rightOpacity=smooth(clamp(((RIGHT-88)-(center+labelWidth/2))/95));
 const startYear=new Date(Math.round(s.axisStart/DAY)*DAY).getUTCFullYear();
 if(leftOpacity>.005){ctx.globalAlpha=leftOpacity;text(String(startYear),LEFT,DATE_Y,STYLE.endpointYearSizePixels,'#c0c6cb','left');}
 if(rightOpacity>.005){ctx.globalAlpha=rightOpacity;text('2026',RIGHT,DATE_Y,STYLE.endpointYearSizePixels,'#c0c6cb','right');}
 ctx.globalAlpha=1;
 const context=s.context,activeColor=context?.w.color||COLORS.aqua;
 const traveling=s.direction==='rewind'||!!context?.gap;
 const ink=traveling?COLORS.return:activeColor;
 line(s.x,s.markerY-18,s.x,s.markerY-7,ink,STYLE.cursorStrokePixels);
 text(s.range>.5?'2022–2023':s.displayDate,center,DATE_Y,FONT,traveling?'#d1c8ff':'#f6f5f0');
 if(context&&frame<5730){
  const w=context.w,v=context.visit,g=context.gap;
  const opacity=frame<1828&&s.direction==='rewind'?smooth(s.relocateProgress):1;
  ctx.globalAlpha=opacity;
  let rangeLabel=v?shortRange(v):g?`${shortRange({startMs:g.startMs,endMs:g.startMs})} → ${shortRange({startMs:g.endMs,endMs:g.endMs})}`:'';
  if(rangeLabel){
   ctx.font=`${STYLE.fontWeight} ${STYLE.rangeSizePixels}px "Summit Mono"`;const rangeWidth=ctx.measureText(rangeLabel).width;
   text(rangeLabel,clamp(s.x,LEFT+rangeWidth/2,RIGHT-rangeWidth/2),1048-BAND_TOP,STYLE.rangeSizePixels,g?COLORS.return:w.color);
  }
  ctx.globalAlpha=1;
 }
 ctx.shadowBlur=STYLE.textShadowBlurPixels;ctx.beginPath();ctx.arc(s.x,s.markerY,STYLE.cursorRadiusPixels,0,Math.PI*2);
 if(traveling){ctx.strokeStyle=ink;ctx.lineWidth=STYLE.cursorStrokePixels;ctx.stroke();}
 else{ctx.fillStyle=ink;ctx.fill();}
 if(frame>0&&frame<1854){
  const sign=s.direction==='rewind'?-1:1;
  line(s.x+sign*9,s.markerY-4,s.x+sign*13,s.markerY,ink,STYLE.directionStrokePixels);
  line(s.x+sign*13,s.markerY,s.x+sign*9,s.markerY+4,ink,STYLE.directionStrokePixels);
 }
 ctx.restore();return band;
}
function preview(frame,background='#11151b'){const c=createCanvas(WIDTH,HEIGHT),p=c.getContext('2d');p.fillStyle=background;p.fillRect(0,0,WIDTH,HEIGHT);p.drawImage(renderBand(frame),0,BAND_TOP);return c;}
module.exports={renderBand,preview,stateAt,mapDate,windowFor,presenceAt,recapPresence,shortRange,textAudit,STYLE,VISITS,WINDOWS,COLORS,DATE_LOCK,CAMERA,TIMING,WIDTH,HEIGHT,BAND_HEIGHT,BAND_TOP,FPS,FRAME_COUNT,NOW,EARLY,DAY,LEFT,RIGHT,JAN23,DECADE,createCanvas};
