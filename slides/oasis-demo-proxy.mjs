// Summit presentation styling around a read-only local Oasis runtime.
import http from 'node:http';

export const oasisPresentationStyle = '<style id="summit-oasis-presentation">header[data-oasis-render-strategies]{display:none!important}</style>';
export const adaptOasisHTML = html => html.replace('</head>', oasisPresentationStyle + '</head>');

export function startOasisDemo({port = 8085, upstreamPort = 5173} = {}) {
  const headersFor = req => {
    const headers = {...req.headers, host: `127.0.0.1:${upstreamPort}`, 'accept-encoding': 'identity'};
    delete headers.cookie;
    delete headers.authorization;
    return headers;
  };
  const localRequest = req => {const activePort = server.address()?.port ?? port; return [`127.0.0.1:${activePort}`, `localhost:${activePort}`].includes(req.headers.host);};
  const server = http.createServer((req, res) => {
    if (!localRequest(req) || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(403).end('Local read-only demo');
      return;
    }
    const upstream = http.request({hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers: headersFor(req)}, reply => {
      const html = req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/oasis' && reply.headers['content-type']?.includes('text/html');
      if (!html) {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
        return;
      }
      const chunks = [];
      reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => {
        const body = adaptOasisHTML(Buffer.concat(chunks).toString('utf8'));
        const headers = {...reply.headers, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body)};
        delete headers.etag;
        delete headers['transfer-encoding'];
        res.writeHead(reply.statusCode, headers).end(body);
      });
    });
    upstream.on('error', () => {if (!res.headersSent) res.writeHead(502, {'content-type': 'text/plain'}); res.end('Start the Oasis dev server on port 5173 to resume this demo.');});
    res.on('close', () => upstream.destroy());
    upstream.end();
  });
  // Preserve Vite's native reload channel without modifying the supplier checkout.
  server.on('upgrade', (req, client, initialHead) => {
    if (!localRequest(req)) {client.destroy(); return;}
    const upstream = http.request({hostname: '127.0.0.1', port: upstreamPort, path: req.url, headers: headersFor(req)});
    upstream.on('upgrade', (reply, socket, head) => {
      client.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n` + Object.entries(reply.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('') + '\r\n');
      if (head.length) client.write(head);
      if (initialHead.length) socket.write(initialHead);
      client.on('error', () => socket.destroy());
      socket.on('error', () => client.destroy());
      client.on('close', () => socket.destroy());
      socket.on('close', () => client.destroy());
      socket.pipe(client).pipe(socket);
    });
    upstream.on('error', () => client.destroy());
    upstream.on('response', () => client.destroy());
    upstream.end();
  });
  server.listen(port, '127.0.0.1');
  return server;
}
