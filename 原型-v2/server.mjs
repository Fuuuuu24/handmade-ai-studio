import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4174);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, name);
    const inside = file.startsWith(root + path.sep);
    const hidden = name.split('/').some(part => part.startsWith('.'));
    if (!inside || hidden || !types[path.extname(file)] || file.endsWith('server.mjs')) { res.writeHead(404); res.end('Not found'); return; }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 500;
    res.writeHead(status); res.end(status === 404 ? 'Not found' : 'Unable to load file');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`一间 v2 原型：http://127.0.0.1:${port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
