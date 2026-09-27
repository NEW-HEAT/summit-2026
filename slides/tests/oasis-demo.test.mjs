import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {startOasisDemo} from '../oasis-demo-proxy.mjs';

test('Oasis adapter hides only its header, preserves resources and rejects writes', async () => {
  const requests = [];
  const source = http.createServer((req, res) => {
    requests.push({path: req.url, headers: req.headers});
    if (req.url === '/oasis') res.writeHead(200, {'content-type': 'text/html'}).end('<html><head></head><body><canvas></canvas></body></html>');
    else res.writeHead(200, {'content-type': 'text/javascript'}).end('export const live = true;');
  }).listen(0, '127.0.0.1');
  await once(source, 'listening');
  const proxy = startOasisDemo({port: 0, upstreamPort: source.address().port});
  await once(proxy, 'listening');
  const base = `http://127.0.0.1:${proxy.address().port}`;
  try {
    const html = await (await fetch(base + '/oasis', {headers: {cookie: 'example=private', authorization: 'example'}})).text();
    assert.match(html, /header\[data-oasis-render-strategies\]\{display:none!important\}/);
    assert.match(html, /<canvas><\/canvas>/);
    assert.equal(requests[0].headers.cookie, undefined);
    assert.equal(requests[0].headers.authorization, undefined);
    assert.equal(await (await fetch(base + '/src/example.js')).text(), 'export const live = true;');
    assert.equal((await fetch(base + '/api/write', {method: 'POST'})).status, 403);
    assert.equal(requests.length, 2);
  } finally {
    proxy.closeAllConnections(); source.closeAllConnections();
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => source.close(resolve))]);
  }
});
