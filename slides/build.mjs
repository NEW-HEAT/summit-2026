import {createRequire} from 'node:module';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
export const root=path.dirname(fileURLToPath(import.meta.url));
const supplier=path.resolve(root,'../package.json'),r=createRequire(supplier),vr=createRequire(r.resolve('vite'));
const esbuild=vr('esbuild');
export async function build(watch=false,notify=()=>{}){
 await fs.mkdir(root+'/.dev',{recursive:true});
 const opts={entryPoints:[root+'/app.js'],outfile:root+'/.dev/app.js',bundle:true,alias:{'@deck.gl/core':root+'/vendor/recent-controller-core/index.js'},format:'esm',target:['chrome120','safari17'],nodePaths:[path.resolve(path.dirname(r.resolve('@deck.gl/core')),'../../..'),path.dirname(supplier)+'/node_modules'],logLevel:'info',metafile:true,plugins:[{name:'studio-reload',setup(b){b.onEnd(async result=>{
  if(result.errors.length){notify('build-error');return}
  const files=await Promise.all(Object.keys(result.metafile.inputs).map(async p=>({originalPath:path.resolve(p),sha256:createHash('sha256').update(await fs.readFile(p)).digest('hex')})));
  await fs.writeFile(root+'/.dev/BUNDLE_INPUTS.json',JSON.stringify({supplier,inputs:files},null,2)+'\n');notify('reload');
 })}}]};
 if(watch){const ctx=await esbuild.context(opts);await ctx.rebuild();await ctx.watch();return ctx}
 return esbuild.build(opts);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await build();
