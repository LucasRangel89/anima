// ANIMA — servidor estático mínimo para o e2e da oficina.
//
// Só existe para o Playwright poder abrir o site gerado (site/) como se fosse o GitHub Pages.
// Não é parte do produto e não tem dependências.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../site', import.meta.url)));
const PORT = Number(process.env.PORT ?? 3210);
const HOST = process.env.HOST ?? '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? HOST}`);
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = resolve(join(ROOT, pathname));

  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end('fora do site');
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('não é arquivo');
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('não encontrado');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`site em http://${HOST}:${PORT}`);
});
