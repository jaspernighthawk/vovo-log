// Local stand-in for the Apps Script backend, for developing the web app
// without touching the real Sheet. Serves /web as static files and answers
// POST / GET on /exec with the same JSON shapes as script/Code.gs.
//
//   node dev/mock-server.mjs            → http://localhost:8787
//   token: "test"   backend URL in the app: http://localhost:8787/exec

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 8787;
const TOKEN = process.env.TOKEN || 'test';
const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const log = []; // {timestamp, type, value, who, note, id}
const seed = process.argv.includes('--seed');
if (seed) {
  const now = Date.now();
  const add = (minsAgo, type, value, who = 'Jasper') =>
    log.push({ timestamp: new Date(now - minsAgo * 60000).toISOString(), type, value, who, note: '', id: 'seed-' + log.length });
  [[1500, 'cath', 17], [1380, 'cath', 37], [1260, 'cath', 19], [1150, 'cath', 50], [1120, 'temp', 98.1], [1000, 'cath', 31],
   [880, 'temp', 99.0], [860, 'cath', 45], [700, 'cath', 30], [690, 'temp', 101.6], [540, 'cath', 50, 'Sam'], [420, 'cath', 31],
   [410, 'temp', 100.3], [300, 'cath', 45], [290, 'temp', 97.7], [120, 'cath', 30], [110, 'med', 'Macrobid'], [30, 'comment', 'Slept well, ate breakfast']]
    .forEach((a) => add(...a));
}

const json = (res, obj, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/exec' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let data;
      try { data = JSON.parse(body); } catch { return json(res, { ok: false, error: 'Request body is not JSON' }); }
      if (data.token !== TOKEN) return json(res, { ok: false, error: 'Unauthorized' });
      const saved = [], rejected = [];
      for (const e of data.entries || [data]) {
        if (log.some((r) => r.id === e.id)) { saved.push(e.id); continue; }
        if (!['cath', 'temp', 'med', 'comment'].includes(e.type)) { rejected.push({ id: e.id, error: 'Unknown type: ' + e.type }); continue; }
        if (['cath', 'temp'].includes(e.type) && !isFinite(Number(e.value))) { rejected.push({ id: e.id, error: 'Value must be a number' }); continue; }
        log.push({ timestamp: e.timestamp, type: e.type, value: e.value, who: e.who || '', note: e.note || '', id: e.id });
        saved.push(e.id);
        console.log('row', e.type, e.value, e.who);
      }
      json(res, { ok: true, saved, rejected });
    });
    return;
  }

  if (url.pathname === '/exec' && req.method === 'GET') {
    if (url.searchParams.get('token') !== TOKEN) return json(res, { ok: false, error: 'Unauthorized' });
    const n = Number(url.searchParams.get('n')) || 300;
    return json(res, { ok: true, rows: log.slice(-n) });
  }

  let file = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Vovo mock backend on http://localhost:${PORT}  (token "${TOKEN}"${seed ? ', seeded' : ''})`));
