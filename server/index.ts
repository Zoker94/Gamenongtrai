// Game server: serves the built client (dist/) with gzip/brotli + caching,
// and runs the authoritative farm simulation over WebSocket (/ws).
//
//   npm run build && npm start      -> http://localhost:8080
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as zc } from 'node:zlib';
import { WebSocketServer, type WebSocket } from 'ws';
import { applyAction, growAll, newFarm, type Action, type FarmState } from '../shared/rules.ts';
import { buildFarm, isTillable } from '../shared/maps/farm.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SAVES = join(ROOT, 'data', 'saves');
const PORT = Number(process.env.PORT) || 8080;

const farmMap = buildFarm();
const canTill = (x: number, y: number) => isTillable(farmMap, x, y);

// ------------------------------------------------------------ static files
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest']);
interface Cached { body: Buffer; br?: Buffer; gz?: Buffer; etag: string; type: string; immutable: boolean }
const cache = new Map<string, Cached>();

async function loadFile(path: string): Promise<Cached | null> {
  const hit = cache.get(path);
  if (hit) return hit;
  let st;
  try { st = await stat(path); } catch { return null; }
  if (!st.isFile()) return null;
  const body = await readFile(path);
  const ext = extname(path);
  const c: Cached = {
    body,
    etag: `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`,
    type: MIME[ext] || 'application/octet-stream',
    // Vite puts content-hashed bundles in /assets/*-[hash].ext
    immutable: /[-.][A-Za-z0-9_-]{8,}\.(js|css)$/.test(path),
  };
  if (COMPRESSIBLE.has(ext) && body.length > 512) {
    c.br = brotliCompressSync(body, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } });
    c.gz = gzipSync(body, { level: 9 });
  }
  if (process.env.NODE_ENV !== 'development') cache.set(path, c);
  return c;
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://x');
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (rel.includes('..')) { res.writeHead(400).end(); return; }
  if (!rel) rel = 'index.html';
  let f = await loadFile(join(DIST, rel));
  if (!f && !extname(rel)) f = await loadFile(join(DIST, 'index.html'));
  if (!f) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }

  const headers: Record<string, string> = {
    'content-type': f.type,
    etag: f.etag,
    'cache-control': f.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    vary: 'accept-encoding',
  };
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers).end(); return; }
  const ae = String(req.headers['accept-encoding'] || '');
  let body = f.body;
  if (f.br && /\bbr\b/.test(ae)) { body = f.br; headers['content-encoding'] = 'br'; }
  else if (f.gz && /\bgzip\b/.test(ae)) { body = f.gz; headers['content-encoding'] = 'gzip'; }
  headers['content-length'] = String(body.length);
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ------------------------------------------------------------- farm saves
interface Session { st: FarmState; sockets: Set<WebSocket>; dirty: boolean; timer?: NodeJS.Timeout }
const sessions = new Map<string, Session>();

async function loadFarm(id: string): Promise<FarmState> {
  try {
    const st = JSON.parse(await readFile(join(SAVES, id + '.json'), 'utf8')) as FarmState;
    if (st && st.plots && st.inv) return st;
  } catch { /* new player */ }
  return newFarm();
}

async function saveFarm(id: string, s: Session) {
  if (!s.dirty) return;
  s.dirty = false;
  await mkdir(SAVES, { recursive: true });
  const tmp = join(SAVES, id + '.json.tmp');
  await writeFile(tmp, JSON.stringify(s.st));
  await rename(tmp, join(SAVES, id + '.json')); // atomic replace
}

function scheduleSave(id: string, s: Session) {
  s.dirty = true;
  if (s.timer) return;
  s.timer = setTimeout(() => {
    s.timer = undefined;
    saveFarm(id, s).catch((e) => console.error('save failed', id, e));
  }, 2000);
}

const send = (ws: WebSocket, msg: unknown) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

// ------------------------------------------------------------------- server
const http = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
  serveStatic(req, res).catch((e) => { console.error(e); res.writeHead(500).end(); });
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096, perMessageDeflate: false });

wss.on('connection', async (ws, req) => {
  const id = new URL(req.url || '', 'http://x').searchParams.get('id') || '';
  if (!/^[a-f0-9]{24}$/.test(id)) { ws.close(1008, 'bad id'); return; }

  let s = sessions.get(id);
  if (!s) {
    const st = await loadFarm(id);
    s = sessions.get(id) || { st, sockets: new Set(), dirty: false };
    sessions.set(id, s);
  }
  const sess = s;
  sess.sockets.add(ws);
  growAll(sess.st, Date.now());
  send(ws, { t: 'state', st: sess.st, now: Date.now() });

  // token bucket: 20 actions/s burst 40
  let tokens = 40, lastRefill = Date.now();
  (ws as WebSocket & { alive?: boolean }).alive = true;
  ws.on('pong', () => { (ws as WebSocket & { alive?: boolean }).alive = true; });

  ws.on('message', (raw) => {
    const now = Date.now();
    tokens = Math.min(40, tokens + ((now - lastRefill) / 1000) * 20);
    lastRefill = now;
    if (tokens < 1) return;
    tokens--;
    let msg: { t: string; seq: number; a: Action };
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg?.t !== 'act' || typeof msg.a !== 'object' || !msg.a) return;
    const err = applyAction(sess.st, msg.a, now, canTill);
    if (err) {
      send(ws, { t: 'err', seq: msg.seq, msg: err, st: sess.st, now });
      return;
    }
    send(ws, { t: 'ok', seq: msg.seq, v: sess.st.v });
    for (const other of sess.sockets) if (other !== ws) send(other, { t: 'state', st: sess.st, now });
    scheduleSave(id, sess);
  });

  ws.on('close', () => {
    sess.sockets.delete(ws);
    if (!sess.sockets.size) {
      if (sess.timer) { clearTimeout(sess.timer); sess.timer = undefined; }
      saveFarm(id, sess).catch((e) => console.error('save failed', id, e)).finally(() => {
        if (!sess.sockets.size) sessions.delete(id);
      });
    }
  });
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients as Set<WebSocket & { alive?: boolean }>) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000).unref();

async function shutdown() {
  await Promise.all([...sessions].map(([id, s]) => saveFarm(id, s).catch(() => {})));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

http.listen(PORT, () => {
  console.log(`🌾 Server: http://localhost:${PORT}` + (existsSync(DIST) ? '' : '  (chưa có dist/, hãy chạy npm run build)'));
});
