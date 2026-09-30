import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../server/application.mjs';
import { localRepository } from '../server/local-repository.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const seed = resolve(root, 'private/seed.json');
if (!existsSync(seed)) throw new Error('Local preview requires private/seed.json; see README.');
const fixture = JSON.parse(readFileSync(seed, 'utf8'));
const rosterPath=resolve(root,'private/b-roster.json');
if (!fixture.roster && existsSync(rosterPath)) fixture.roster=JSON.parse(readFileSync(rosterPath,'utf8')).students.map(row=>({...row,exam_id:fixture.exams[0].id}));
const port = Number(process.env.PORT || 4173);
fixture.settings.allowed_origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
const previewBase=process.env.PREVIEW_CLOCK ? Date.parse(process.env.PREVIEW_CLOCK) : null;
const previewStart=performance.now();
const handler = createHandler(localRepository(resolve(root, 'private/preview.sqlite'), fixture, previewBase ? {now:()=>previewBase+performance.now()-previewStart} : {}));
const files = new Set(['index.html', 'style.css', 'app.js', 'api.js', 'admin.html', 'admin.js', 'favicon.svg']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (path === '/api') {
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 16384) { res.writeHead(413).end(); return; } chunks.push(chunk); }
      const request = new Request(`http://127.0.0.1:${port}/api`, { method: req.method, headers: req.headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (path === '/config.js') {
      res.setHeader('Content-Type', types['.js']);
      res.end(`window.QUIZ_CONFIG = ${JSON.stringify({apiUrl:'/api',examId:fixture.exams[0].id,preview:true})};`); return;
    }
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (!files.has(file)) { res.writeHead(404).end('Not found'); return; }
    res.setHeader('Content-Type', types[extname(file)]); res.end(readFileSync(resolve(root, 'web', file)));
  } catch { res.writeHead(500).end('Preview service error'); }
}).listen(port, '127.0.0.1', () => console.log(`Preview http://127.0.0.1:${port}`));
