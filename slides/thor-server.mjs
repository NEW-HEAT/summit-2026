// Run the live thor.gl source with process ownership and caches in the Summit project.
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
const studio = path.dirname(fileURLToPath(import.meta.url));
const demo = path.join(studio, 'thor-demo');
const require = createRequire(path.resolve(studio, '../package.json'));
const {createServer} = await import(pathToFileURL(require.resolve('vite')).href);
const server = await createServer({
  configFile: demo + '/vite.config.ts',
  cacheDir: studio + '/.dev/thor-vite-cache',
  server: {host: '127.0.0.1', port: 5178, strictPort: true, open: false}
});
await server.listen();
server.printUrls();
process.on('SIGTERM', async () => {await server.close(); process.exit(0)});
