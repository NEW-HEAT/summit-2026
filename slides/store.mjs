import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {validateSlide} from './model.mjs';
import {arrangeSlides,slideKey} from './navigation.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function createStore(root){
 let queue=Promise.resolve();
 async function list(){const files=(await fs.readdir(path.join(root,'slides'))).filter(x=>/^\d{3}-[a-z0-9-]+\.json$/.test(x));const entries=await Promise.all(files.map(async file=>{const bytes=await fs.readFile(path.join(root,'slides',file));return {file,revision:hash(bytes),slide:validateSlide(JSON.parse(bytes))}}));const keys=new Set(),ids=new Set();for(const e of entries){if(keys.has(slideKey(e.slide))||ids.has(e.slide.id))throw Error('Duplicate slide identity');keys.add(slideKey(e.slide));ids.add(e.slide.id)}let plan;try{plan=JSON.parse(await fs.readFile(path.join(root,'RUNNING_ORDER.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}return arrangeSlides(entries,plan);}
 async function update(id,slide,revision){
  const task=queue.then(async()=>{
   validateSlide(slide);const all=await list(),entry=all.find(x=>x.slide.id===id);if(!entry)throw Object.assign(new Error('Slide not found'),{status:404});
   if(entry.revision!==revision)throw Object.assign(new Error('This slide changed on disk. Reload its saved version before saving.'),{status:409});
   if(slide.id!==id||slide.number!==entry.slide.number||slide.part!==entry.slide.part||slide.kind!==entry.slide.kind)throw new Error('Slide identity and kind cannot change through this editor');
   await fs.mkdir(path.join(root,'.history'),{recursive:true});const target=path.join(root,'slides',entry.file),before=await fs.readFile(target);
   await fs.writeFile(path.join(root,'.history',Date.now()+'-'+randomUUID()+'-'+entry.file),before,{flag:'wx'});
   const data=JSON.stringify(slide,null,2)+'\n',tmp=target+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,data);await fs.rename(tmp,target);
   return {...entry,slide,file:entry.file,revision:hash(data)};
  });queue=task.catch(()=>{});return task;
 }
 return {list,update};
}
