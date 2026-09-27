export const slideKey=s=>String(s.number)+(s.part?'.'+s.part:'');
export const slideLabel=s=>String(s.number).padStart(2,'0')+(s.part?'.'+s.part:'');
export const compareSlides=(a,b)=>a.slide.number-b.slide.number||(a.slide.part||1)-(b.slide.part||1);
export function findSlide(entries,reference){const key=String(reference);return entries.find(e=>slideKey(e.slide)===key)||entries.find(e=>e.aliases?.includes(key))||entries.find(e=>String(e.slide.number)===key)}
export function adjacentSlide(entries,id,direction){const current=entries.find(e=>e.slide.id===id),route=entries.filter(e=>!!e.optional===!!current?.optional),index=route.findIndex(e=>e.slide.id===id);return route[Math.max(0,Math.min(route.length-1,index+direction))]}
export function arrangeSlides(entries,plan){
 if(!plan)return entries.sort(compareSlides);
 const route=[...plan.main,...plan.optional],byId=new Map(entries.map(e=>[e.slide.id,e]));
 if(new Set(route).size!==route.length||route.length!==entries.length||route.some(id=>!byId.has(id)))throw Error('Running order must name every active slide exactly once');
 return route.map(id=>({...byId.get(id),optional:plan.optional.includes(id),aliases:plan.aliases?.[id]||[],sourceLinks:plan.sourceLinks?.[id]||[]}));
}
