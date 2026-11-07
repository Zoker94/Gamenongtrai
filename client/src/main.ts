import './style.css';
import { buildFarm, isTillable } from '../../shared/maps/farm.ts';
import { CROPS, RIPE, key, type Plot } from '../../shared/rules.ts';
import { drawAnchored, drawAt, loadAtlas } from './atlas.ts';
import { Effects, drawScreenLight, swayFor } from './effects.ts';
import { loadGround, saveGround } from './groundcache.ts';
import { Input } from './input.ts';
import { Store } from './net.ts';
import { Player } from './player.ts';
import { UI } from './ui.ts';
import { TILE, World } from './world.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!;

const lbar = document.getElementById('lbar') as HTMLElement;
const ltext = document.getElementById('ltext') as HTMLElement;
const map = buildFarm();
let atlas: Awaited<ReturnType<typeof loadAtlas>>;
let cachedGround: ImageBitmap[] | null;
try {
  [atlas, cachedGround] = await Promise.all([
    loadAtlas('/assets/', (p) => { lbar.style.width = Math.round(p * 90) + '%'; }),
    loadGround(map.id),
  ]);
} catch {
  ltext.textContent = 'Không tải được dữ liệu game.';
  const b = document.createElement('button');
  b.textContent = 'Thử lại';
  b.onclick = () => location.reload();
  ltext.after(b);
  throw new Error('load failed');
}
ltext.textContent = 'Đang dựng bản đồ…';
lbar.style.width = '95%';
await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // let the text paint
const world = new World(map, atlas, cachedGround);
if (world.rendered) setTimeout(() => { void world.chunkBlobs().then((b) => saveGround(map.id, b)); }, 3000);
const store = new Store((x, y) => isTillable(map, x, y), map.starter);
const ui = new UI(atlas);
const input = new Input(canvas, document.getElementById('stick')!, document.getElementById('knob')!, document.getElementById('act')!);
const player = new Player(map.spawn.x * TILE + TILE / 2, map.spawn.y * TILE + TILE - 4);
const fx = new Effects(world);

document.getElementById('loading')!.remove();

// ---------------------------------------------------------------- state glue
const spots = new Map(map.spots.map((s) => [key(s.x, s.y), s.id]));
store.onChange = () => { ui.update(store.st); ui.refresh(store.st); };
store.onError = (m) => ui.toast(m);
store.onNet = (on) => { ui.setNet(on); if (on) ui.toast('Đã kết nối máy chủ'); };
ui.onBuy = (crop, n) => { if (store.act({ t: 'buy', crop, n })) ui.toast(`Đã mua ${n} hạt ${CROPS[crop].name}`); };
ui.onSell = (item, n) => {
  const have = store.st.inv[item] || 0;
  const k = Math.min(have, n);
  if (store.act({ t: 'sell', item, n })) ui.toast(`+${k * CROPS[item].sellPrice} xu`);
};
ui.update(store.st);
ui.setNet(false);
setInterval(() => store.tick(), 1000);

/** Perform the selected tool on a tile. */
// A target is either a planting plot (plot-grid coords) or a map tile (spots).
type Target = { plot: boolean; x: number; y: number };
const PG = map.plotGrid;
/** plot under a world point, or null */
function plotAt(wx: number, wy: number): [number, number] | null {
  if (!PG) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    return isTillable(map, tx, ty) ? [tx, ty] : null;
  }
  const c = Math.floor((wx - PG.x) / PG.cell), r = Math.floor((wy - PG.y) / PG.cell);
  return c >= 0 && r >= 0 && c < PG.cols && r < PG.rows ? [c, r] : null;
}
/** world rect of a plot */
function plotRect(c: number, r: number): [number, number, number] {
  return PG ? [PG.x + c * PG.cell, PG.y + r * PG.cell, PG.cell] : [c * TILE, r * TILE, TILE];
}
function targetAt(wx: number, wy: number): Target {
  const p = plotAt(wx, wy);
  return p ? { plot: true, x: p[0], y: p[1] } : { plot: false, x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
}
function targetCenter(t: Target): [number, number] {
  if (t.plot) { const [x, y, c] = plotRect(t.x, t.y); return [x + c / 2, y + c / 2]; }
  return [t.x * TILE + TILE / 2, t.y * TILE + TILE / 2];
}

function useTarget(t: Target) {
  if (!t.plot) {
    const spot = spots.get(key(t.x, t.y));
    if (spot === 'ship') return ui.openShip(store.st);
    if (spot === 'shop') return ui.openShop(store.st);
    return ui.toast('Hãy đứng cạnh ô đất trong ruộng', 1200);
  }
  const tx = t.x, ty = t.y;
  const [bx, by, bc] = plotRect(tx, ty);
  const p: Plot | undefined = store.st.plots[key(tx, ty)];
  if (p && p.c && p.s >= RIPE) {
    const c = p.c;
    if (store.act({ t: 'harvest', x: tx, y: ty })) { ui.toast(`+1 ${CROPS[c].name}`, 900); player.playAction('pl_harvest'); fx.burst(bx + bc / 2, by + bc / 2, 'leaf', 8); }
    return;
  }
  const slot = ui.current;
  if (slot.id === 'hoe') { if (store.act({ t: 'till', x: tx, y: ty })) { player.playAction('pl_hoe'); fx.burst(bx + bc / 2, by + bc - 4, 'soil', 8); } }
  else if (slot.id === 'can') { if (store.act({ t: 'water', x: tx, y: ty })) { player.playAction('pl_water'); fx.burst(bx + bc / 2, by + bc / 2, 'water', 12); } }
  else if (slot.id.startsWith('seed:')) store.act({ t: 'plant', x: tx, y: ty, crop: slot.id.slice(5) });
  else if (p && p.c) ui.toast(`${CROPS[p.c].name}: chưa chín`, 900);
  else ui.toast('Chọn cuốc để xới đất, hạt giống để gieo', 1400);
}

// ------------------------------------------------------------------- view
let zoom = 2, vw = 0, vh = 0, dpr = 1;
const cam = { x: 0, y: 0 };
// ?z=1 forces a zoom level (handy for map overview screenshots while designing)
const FORCE_ZOOM = Number(new URLSearchParams(location.search).get('z')) || 0;
// player-chosen zoom, multiplied with the automatic base zoom
const ZOOM_STEPS = [0.75, 0.85, 1, 1.2, 1.45];
let zoomStep = 2;
try { const v = Number(localStorage.getItem('gnt_zoom2')); if (v >= 0 && v < ZOOM_STEPS.length) zoomStep = v; } catch { /* ignore */ }
const zinBtn = document.getElementById('zin') as HTMLButtonElement;
const zoutBtn = document.getElementById('zout') as HTMLButtonElement;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  canvas.width = w; canvas.height = h;
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  // base: show ~11 tiles on the short side; never zoom out past the map edges
  // close-up camera: about 5.5 tiles on the short side of the screen
  const base = Math.max(1, Math.min(w, h) / (5.5 * TILE));
  const fill = Math.max(w / world.pxW, h / world.pxH);
  zoom = FORCE_ZOOM || Math.max(fill, base * ZOOM_STEPS[zoomStep]);
  vw = w / zoom; vh = h / zoom;
  // the atlas holds `res` pixels per game pixel: when that is more than the
  // screen shows (zoomed out), filter smoothly instead of dropping pixels
  ctx.imageSmoothingEnabled = zoom < atlas.res - 0.05;
  ctx.imageSmoothingQuality = 'high';
  zinBtn.disabled = zoomStep >= ZOOM_STEPS.length - 1;
  zoutBtn.disabled = zoomStep <= 0 || zoom <= fill + 1e-6;
}

function setZoom(delta: number) {
  const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, zoomStep + delta));
  if (next === zoomStep) return;
  zoomStep = next;
  try { localStorage.setItem('gnt_zoom2', String(zoomStep)); } catch { /* ignore */ }
  resize();
  updateCamera(0, true);
}
zinBtn.addEventListener('click', () => setZoom(1));
zoutBtn.addEventListener('click', () => setZoom(-1));
addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') setZoom(1);
  else if (e.key === '-' || e.key === '_') setZoom(-1);
});
canvas.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return; // plain wheel switches tools
  e.preventDefault();
  setZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ---- landscape: go fullscreen and lock orientation where the browser allows it
// (Android Chrome). Other phones get the "rotate your phone" screen from CSS.
async function goLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch { /* not supported (iOS Safari...) */ }
}
if (input.touch) addEventListener('pointerdown', () => { void goLandscape(); }, { once: true });
document.getElementById('fs')!.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void goLandscape();
});
if (!document.documentElement.requestFullscreen) document.getElementById('fs')!.hidden = true;

addEventListener('resize', resize);
resize();

function updateCamera(dt: number, snap = false) {
  let tx = player.x - vw / 2, ty = player.y - 12 - vh / 2;
  tx = vw >= world.pxW ? (world.pxW - vw) / 2 : Math.max(0, Math.min(world.pxW - vw, tx));
  ty = vh >= world.pxH ? (world.pxH - vh) / 2 : Math.max(0, Math.min(world.pxH - vh, ty));
  const k = snap ? 1 : 1 - Math.exp(-dt * 10);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
}

const screenToWorld = (sx: number, sy: number) => ({ x: (sx * dpr) / zoom + cam.x, y: (sy * dpr) / zoom + cam.y });

// ----------------------------------------------------------------- update
const axis = { x: 0, y: 0 };
let target: Target = { plot: false, x: -1, y: -1 };
let exitCooldown = 0;
let stepT = 0;

function update(dt: number) {
  if (input.slotPressed >= 0) ui.select(input.slotPressed);
  if (input.slotDelta) ui.select(ui.sel + input.slotDelta);

  if (ui.panelOpen) {
    if (input.actionPressed) ui.closePanel();
    input.consume();
    return;
  }

  input.axis(axis);
  player.running = input.run;
  player.update(dt, axis.x, axis.y, world);
  if (player.moving && (stepT += dt) > (player.running ? 0.18 : 0.3)) { stepT = 0; fx.burst(player.x, player.y - 1, 'dust', player.running ? 3 : 2); }

  // pointer: tap a tile near you to use it, far away to walk there
  if (input.tap) {
    const w = screenToWorld(input.tap.x, input.tap.y);
    const t = targetAt(w.x, w.y);
    const [cx, cy] = targetCenter(t);
    if (Math.hypot(cx - player.x, cy - (player.y - 6)) <= TILE * 1.7) {
      player.target = null;
      player.faceToward(cx, cy);
      useTarget(t);
    } else {
      player.target = { x: w.x, y: w.y + 4 };
    }
  }

  {
    const [fx0, fy0] = player.facingPoint();
    target = targetAt(fx0, fy0);
  }
  if (input.hover) {
    const w = screenToWorld(input.hover.x, input.hover.y);
    const t = targetAt(w.x, w.y);
    const [cx, cy] = targetCenter(t);
    if (Math.hypot(cx - player.x, cy - (player.y - 6)) <= TILE * 1.7) target = t;
  }
  if (input.actionPressed) useTarget(target);
  input.consume();

  // map exits (other maps come next)
  exitCooldown -= dt;
  const ex = player.x < 0 || player.y < 0 || player.x > world.pxW || player.y > world.pxH;
  if (ex) {
    const e = world.exitAt(Math.floor(player.x / TILE), Math.floor(player.y / TILE));
    if (exitCooldown <= 0) { ui.toast(`${e ? e.label : 'Lối ra'} — sắp ra mắt!`); exitCooldown = 2; }
    player.x = Math.max(8, Math.min(world.pxW - 8, player.x));
    player.y = Math.max(10, Math.min(world.pxH - 2, player.y));
    player.target = null;
  }

  updateCamera(dt);
}

// ----------------------------------------------------------------- render
interface Drawable { y: number; name: string; x: number; flip: boolean }
/** Sprite for a plot. Crops with a full asset sheet (cp_<crop>_*) get their own
 *  stages: seed -> sprout (watered) -> growing -> ripe. */
function cropFrame(p: Plot): string {
  const c = p.c;
  if (atlas.frames[`cp_${c}_g4`]) {
    if (p.s === 0) return p.w ? `cp_${c}_sprout` : `cp_${c}_seed`;
    if (p.s === 1) return p.w ? `cp_${c}_g2` : `cp_${c}_g1`;
    if (p.s === 2) return p.w ? `cp_${c}_g4` : `cp_${c}_g3`;
    return `cp_${c}_ripe`;
  }
  if (p.s === 0) return 'pc_sprout:s';
  return p.s >= RIPE ? 'pc_' + c : p.s === 1 ? 'pc_sprout:s' : 'pc_sprout';
}
function roundRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** A planting plot: 0 = barren, 1 = tilled, 2 = watered. Textures come from the
 *  ploughed-soil tile of the user's sheet, clipped to a rounded square. */
function drawPlot(x: number, y: number, c: number, state: number, seed: number, time: number) {
  const g = 1.5, r = 5, w = c - g * 2;
  const rnd = (i: number) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
  // soft shadow under the patch
  ctx.fillStyle = 'rgba(60,35,15,0.35)';
  roundRect(x + g, y + g + 1, w, w, r); ctx.fill();
  ctx.save();
  roundRect(x + g, y + g, w, w, r); ctx.clip();
  if (state === 0) {
    // barren: pale, dusty, cracked
    ctx.fillStyle = '#c0915b';
    ctx.fillRect(x, y, c, c);
    ctx.fillStyle = 'rgba(255,240,200,0.18)';
    ctx.fillRect(x, y, c, c * 0.4);
    ctx.strokeStyle = 'rgba(110,70,35,0.75)';
    ctx.lineWidth = 0.8;
    for (let k = 0; k < 3; k++) {
      let px = x + 4 + rnd(k) * (c - 8), py = y + 4 + rnd(k + 9) * (c - 8);
      ctx.beginPath(); ctx.moveTo(px, py);
      for (let j = 0; j < 3; j++) { px += (rnd(k * 7 + j) - 0.5) * 9; py += (rnd(k * 5 + j + 3) - 0.5) * 9; ctx.lineTo(px, py); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(150,140,125,0.9)';
    for (let k = 0; k < 2; k++) ctx.fillRect(x + 4 + rnd(k + 20) * (c - 8), y + 4 + rnd(k + 30) * (c - 8), 1.5, 1.2);
  } else {
    const f = atlas.frames[state === 2 ? 'gt_furrow_wet' : 'gt_furrow'];
    if (f) ctx.drawImage(atlas.img, f[0], f[1], f[4] * 0.75, f[5] * 0.75, x + g, y + g, w, w);
    if (state === 1) {
      // tilled but dry: dusty, lighter, a couple of hairline cracks
      ctx.fillStyle = 'rgba(235,200,150,0.22)';
      ctx.fillRect(x, y, c, c);
      ctx.strokeStyle = 'rgba(120,75,40,0.55)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      const sx = x + 5 + rnd(1) * (c - 10), sy = y + 5 + rnd(2) * (c - 10);
      ctx.moveTo(sx, sy); ctx.lineTo(sx + 4, sy + 2); ctx.lineTo(sx + 6, sy + 5);
      ctx.stroke();
    } else {
      // watered: dark, glossy, little puddle shine and twinkling droplets
      ctx.fillStyle = 'rgba(40,25,30,0.25)';
      ctx.fillRect(x, y, c, c);
      ctx.fillStyle = 'rgba(170,210,255,0.16)';
      ctx.beginPath(); ctx.ellipse(x + c * 0.36, y + c * 0.32, c * 0.22, c * 0.09, -0.3, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 3; k++) {
        const a = 0.35 + 0.45 * Math.sin(time / 300 + seed + k * 2.1);
        if (a <= 0.1) continue;
        ctx.fillStyle = `rgba(220,240,255,${a})`;
        ctx.fillRect(x + 4 + rnd(k + 40) * (c - 8), y + 4 + rnd(k + 50) * (c - 8), 1.4, 1.4);
      }
    }
  }
  ctx.restore();
  ctx.strokeStyle = state === 2 ? 'rgba(40,22,15,0.8)' : state === 1 ? 'rgba(70,40,20,0.65)' : 'rgba(110,70,35,0.5)';
  ctx.lineWidth = 1;
  roundRect(x + g + 0.5, y + g + 0.5, w - 1, w - 1, r - 0.5); ctx.stroke();
}
const pool: Drawable[] = [];
const list: Drawable[] = [];
const byY = (a: Drawable, b: Drawable) => a.y - b.y;
function push(name: string, x: number, y: number, flip: boolean) {
  const d = pool[list.length] || (pool[list.length] = { y: 0, name: '', x: 0, flip: false });
  d.name = name; d.x = x; d.y = y; d.flip = flip;
  list.push(d);
}

function render(time: number) {
  const ox = Math.round(cam.x * zoom), oy = Math.round(cam.y * zoom);
  const camX = ox / zoom, camY = oy / zoom;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1d2330';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(zoom, 0, 0, zoom, -ox, -oy);

  world.drawGround(ctx, camX, camY, vw, vh);
  world.drawWaterGlints(ctx, camX, camY, vw, vh, time);
  const ts = time / 1000;
  fx.drawWater(ctx, ts);

  // tilled soil + seeds (flat)
  const x0 = Math.floor(camX / TILE) - 1, y0 = Math.floor(camY / TILE) - 1;
  const x1 = Math.ceil((camX + vw) / TILE) + 1, y1 = Math.ceil((camY + vh) / TILE) + 1;
  list.length = 0;
  const plots = store.st.plots;
  if (PG) {
    // every plot of the planting grid: rounded patch, small gap in between
    for (let r = 0; r < PG.rows; r++)
      for (let c = 0; c < PG.cols; c++) {
        const p = plots[key(c, r)];
        const [bx, by, bc] = plotRect(c, r);
        drawPlot(bx, by, bc, p ? (p.w ? 2 : 1) : 0, c * 31 + r * 17, time);
        if (p && p.c) {
          // plant sits in the middle of the plot (seeds/sprouts a bit higher)
          const fr = cropFrame(p);
          const small = p.s === 0 || fr.endsWith(':s');
          push(fr + ':p', bx + bc / 2, by + bc * (small ? 0.62 : 0.74), false);
        }
      }
  } else {
    for (const k in plots) {
      const i = k.indexOf(',');
      const tx = +k.slice(0, i), ty = +k.slice(i + 1);
      if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
      const p = plots[k];
      drawAt(ctx, atlas, p.w ? 'gt_furrow_wet' : 'gt_furrow', tx * TILE, ty * TILE);
      if (p.c) push(cropFrame(p), tx * TILE + 16, ty * TILE + TILE - 3, false);
    }
  }

  // target highlight
  if (!ui.panelOpen && (target.plot || spots.has(key(target.x, target.y)))) {
    const [hx, hy, hc] = target.plot ? plotRect(target.x, target.y) : [target.x * TILE, target.y * TILE, TILE];
    const pulse = 0.45 + 0.25 * Math.sin(time / 180);
    ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
    ctx.lineWidth = 1;
    roundRect(hx + 1, hy + 1, hc - 2, hc - 2, 5);
    ctx.stroke();
  }

  // y-sorted sprites
  const vr = camX + vw, vb = camY + vh;
  for (const o of world.objects) {
    if (o.r < camX || o.l > vr || o.b < camY || o.t > vb + 8) continue;
    push(o.name, o.x, o.y, o.flip);
  }
  const px = Math.round(player.x), py = Math.round(player.y);
  const [pf, pflip] = player.frame;
  push(pf, px, py - player.bob, pflip);
  list.sort(byY);

  for (const d of list) {
    if (d.name.startsWith('pl_')) {
      ctx.fillStyle = 'rgba(30,36,10,0.3)';
      ctx.fillRect(d.x - 7, py - 2, 14, 3);
      ctx.fillRect(d.x - 5, py + 1, 10, 1);
    }
    if (d.name.endsWith(':p')) {           // crop on a small plot: scaled to the plot
      let nm = d.name.slice(0, -2), k = PG ? PG.cell / TILE * 1.05 : 1;
      if (nm.endsWith(':s')) { nm = nm.slice(0, -2); k *= 0.6; }
      const sw = swayFor(nm.startsWith('cp_rice') ? 'tallgrass_top' : 'crop_', d.x, d.y, ts);
      ctx.save(); ctx.translate(d.x, d.y); ctx.transform(k, 0, sw * k, k, 0, 0);
      drawAnchored(ctx, atlas, nm, 0, 0, d.flip); ctx.restore();
      continue;
    }
    if (d.name.endsWith(':s')) {           // small variant (young sprout)
      const nm = d.name.slice(0, -2), sw = swayFor('crop_', d.x, d.y, ts);
      ctx.save(); ctx.translate(d.x, d.y); ctx.transform(0.6, 0, sw * 0.6, 0.6, 0, 0);
      drawAnchored(ctx, atlas, nm, 0, 0, d.flip); ctx.restore();
      continue;
    }
    const sw = swayFor(d.name.startsWith('cp_rice') ? 'tallgrass_top' : d.name.startsWith('pc_') || d.name.startsWith('cp_') ? 'crop_' : d.name, d.x, d.y, ts);
    if (sw) {
      // shear around the base: the top moves, the roots stay put
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.transform(1, 0, sw, 1, 0, 0);
      drawAnchored(ctx, atlas, d.name, 0, 0, d.flip);
      ctx.restore();
    } else drawAnchored(ctx, atlas, d.name, d.x, d.y, d.flip);
  }
  // ripe crops: soft golden glow + twinkling sparkles (ready to harvest)
  for (const k in plots) {
    const p = plots[k];
    if (!p.c || p.s < RIPE) continue;
    const i = k.indexOf(',');
    const tx = +k.slice(0, i), ty = +k.slice(i + 1);
    const [bx, by, bc] = plotRect(tx, ty);
    if (bx < camX - 40 || bx > camX + vw + 40 || by < camY - 40 || by > camY + vh + 40) continue;
    const cx = bx + bc / 2, cy = by + bc / 4;
    const ph = ts * 2.2 + tx * 1.7 + ty * 2.9;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18);
    g.addColorStop(0, `rgba(255,230,120,${0.06 + 0.03 * Math.sin(ph)})`);
    g.addColorStop(1, 'rgba(255,230,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 18, cy - 18, 36, 36);
    for (let j = 0; j < 2; j++) {
      const a = Math.sin(ph * 1.3 + j * 2.4);
      if (a <= 0.2) continue;
      const sx = cx + Math.sin(ph * 0.7 + j * 3) * 10, sy = cy - 4 + Math.cos(ph * 0.5 + j * 2) * 8;
      const r = 1 + a * 1.6;
      ctx.fillStyle = `rgba(255,250,210,${a * 0.6})`;
      ctx.fillRect(sx - r, sy - 0.5, r * 2, 1);
      ctx.fillRect(sx - 0.5, sy - r, 1, r * 2);
    }
  }
  fx.drawAir(ctx, ts, camX, camY, vw, vh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawScreenLight(ctx, canvas.width, canvas.height, ts);
}

// ------------------------------------------------------------------- loop
let last = performance.now();
updateCamera(0, true);
function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  update(dt);
  fx.update(dt);
  render(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
