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
import { Auth } from './auth.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SAVES = join(ROOT, 'data', 'saves');
const PORT = Number(process.env.PORT) || 8080;
const auth = new Auth(join(ROOT, 'data'));
await auth.init();

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
  return newFarm(farmMap.starter);
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
// ------------------------------------------------------------- account API
function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let size = 0; const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > 4096) req.destroy(); else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8')) || {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const bearer = (req: IncomingMessage) => auth.verify(String(req.headers.authorization || '').replace(/^Bearer /, ''));

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (req.method === 'POST' && (path === 'register' || path === 'login')) {
    const lim = auth.limit(ip);
    if (lim) return json(res, 429, { error: lim });
    const b = await readJson(req);
    const r = path === 'register'
      ? await auth.register(String(b.username || ''), String(b.password || ''))
      : await auth.login(String(b.username || ''), String(b.password || ''));
    if (typeof r === 'string') return json(res, 400, { error: r });
    return json(res, 200, { token: r.token, profile: auth.profile(r.user) });
  }
  const u = bearer(req);
  if (!u) return json(res, 401, { error: 'Phiên đăng nhập đã hết hạn' });
  if (req.method === 'GET' && path === 'me') {
    const user = await auth.getUser(u);
    return user ? json(res, 200, { profile: auth.profile(user) }) : json(res, 401, { error: 'Tài khoản không tồn tại' });
  }
  if (req.method === 'POST' && path === 'character') {
    const b = await readJson(req);
    const r = await auth.setCharacter(u, String(b.name || ''), String(b.gender || ''));
    if (typeof r === 'string') return json(res, 400, { error: r });
    return json(res, 200, { profile: auth.profile(r) });
  }
  json(res, 404, { error: 'not found' });
}

const http = createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api/')) {
    api(req, res, url.slice(5).split('?')[0]).catch((e) => { console.error(e); json(res, 500, { error: 'Lỗi máy chủ' }); });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
  serveStatic(req, res).catch((e) => { console.error(e); res.writeHead(500).end(); });
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096, perMessageDeflate: false });

wss.on('connection', async (ws, req) => {
  const uname = auth.verify(new URL(req.url || '', 'http://x').searchParams.get('token') || '');
  const user = uname ? await auth.getUser(uname) : null;
  if (!user || !user.name) { ws.close(4001, 'auth'); return; }
  const id = user.pid;

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
