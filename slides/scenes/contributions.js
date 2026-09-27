import {PolygonLayer,TextLayer} from '@deck.gl/layers';
import {COORDINATE_SYSTEM} from '@deck.gl/core';
import calendar from '../assets/contribution-calendar.json';
const DAY=86400000;
const colors={NONE:[41,37,31],FIRST_QUARTILE:[103,65,25],SECOND_QUARTILE:[163,96,31],THIRD_QUARTILE:[221,159,73],FOURTH_QUARTILE:[255,211,140]};
export const contributionCells=calendar.years.flatMap(({year,days},row)=>{
 const start=Date.UTC(year,0,1),weekday=new Date(start).getUTCDay();
 return days.map(day=>{const date=new Date(day.date+'T00:00:00Z'),week=Math.floor(((+date-start)/DAY+weekday)/7),x=170+week*18.1,y=165+row*91+date.getUTCDay()*10.5;
  return {...day,row,week,polygon:[[x,y],[x+14.5,y],[x+14.5,y+7.5],[x,y+7.5]]};
 });
});
const text=calendar.years.map(({year},i)=>({text:String(year),position:[100,198+i*91,0]}));
const shared={coordinateSystem:COORDINATE_SYSTEM.CARTESIAN,parameters:{depthWriteEnabled:false,depthCompare:'always'}};
export const contributionsScene={label:'GitHub contribution calendar',description:'Actual daily GitHub contribution counts from 2022 through the capture date. Hover a day for its count.',requires:'OrthographicView',animated:true,duration:8,interactive:false,
 getTooltip:({object})=>object?.date?`${object.date} · ${object.contributionCount} contributions`:null,
 layers:({time})=>[
  new PolygonLayer({...shared,id:'github-calendar-days',data:contributionCells,getPolygon:d=>d.polygon,getFillColor:d=>[...colors[d.contributionLevel],Math.round(255*Math.max(.12,Math.min(1,time*.8-d.row*.17-d.week*.008)))],updateTriggers:{getFillColor:Math.min(time,4)},stroked:false,pickable:true,autoHighlight:true,highlightColor:[255,236,204,110]}),
  new TextLayer({...shared,id:'github-calendar-years',data:text,getText:d=>d.text,getPosition:d=>d.position,getColor:[221,159,73,255],getSize:22,sizeUnits:'pixels',getTextAnchor:'end',fontFamily:'Roboto',fontSettings:{sdf:true}})
 ]};
