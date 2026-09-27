// Launch the Summit-owned, metre-scale adaptation of the imported TreeLayer demo.
// Config loading and Vite's dependency cache stay inside the Summit workspace.
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
const studio=path.dirname(fileURLToPath(import.meta.url));
const supplier=path.resolve(studio,'..');
const require=createRequire(supplier+'/package.json');
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const server=await createServer({
 configFile:false,envFile:false,root:studio+'/tree-demo',
 cacheDir:studio+'/.dev/tree-vite-cache',
 resolve:{alias:{'@deck.gl-community/three':studio+'/vendor/tree-layer/index.ts'}},
 server:{host:'127.0.0.1',port:8084,strictPort:true,open:false,fs:{allow:[studio,supplier]}},
 optimizeDeps:{esbuildOptions:{target:'es2022'}}
});
await server.listen();server.printUrls();
process.on('SIGTERM',async()=>{await server.close();process.exit(0)});
