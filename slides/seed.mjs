import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {identity,treatment} from './identity.mjs';import {viewDefaults,clone,validateSlide} from './model.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));const source=JSON.parse(await fs.readFile(root+'/source-show.json'));
for(const [i,d] of source.slides.entries()){
 const n=i+1,t=treatment(d),a=[];
 const text=(id,value,x,y,width,size,font='Roboto Black',color=t.fg,align='left')=>a.push({id,text:value,x,y,width,size,font,color,align});
 if(d.type==='cue'){const multi=d.lines.includes('\n');text('heading',d.lines,88,multi?242:270,1104,multi?78:104);if(d.sub)text('context',d.sub,93,431,1090,31,'Roboto',t.secondary)}
 if(d.type==='media'||d.type==='numbers'){text('heading',d.title,88,52,800,50);if(d.verb)text('role',d.verb,860,68,334,30,'Roboto',t.secondary)}
 if(d.type==='numbers')d.values.forEach(([v,l],j)=>{text('value-'+j,v,88+j*602,245,540,116);text('label-'+j,l,95+j*602,416,530,31,'Roboto',t.secondary)});
 if(d.type==='sequence')d.words.forEach((w,j)=>text('renderer-'+j,w,88,147+j*150,1104,84,'Roboto Black',j===2?identity.palette.orange:t.fg));
 if(d.type==='film')text('heading','Closing film',88,294,1104,70);
 const slide={schemaVersion:1,id:'slide-'+String(n).padStart(2,'0'),number:n,title:d.title,kind:d.type,notes:d.notes,duration:d.duration,background:t.bg,
 view:{type:'GlobeView',state:clone(viewDefaults.GlobeView),frame:d.type==='media'?{x:160,y:156,width:960,height:540}:{x:0,y:0,width:1280,height:720}},
 scene:{preset:n===13?'globe':d.type==='media'?'placeholder':'empty',slot:d.slot||null,label:d.label||'',media:d.media||null},overlays:a};
 validateSlide(slide);
 const name=String(n).padStart(3,'0')+'-'+d.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'.json';
 await fs.writeFile(root+'/slides/'+name,JSON.stringify(slide,null,2)+'\n',{flag:'wx'});
}
console.log('Migrated 26 stable slide numbers. Slide 13 uses a public GlobeView reference; original slots remain.');
