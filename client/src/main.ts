import './style.css';
import { buildFarm, isTillable } from '../../shared/maps/farm.ts';
import { CROPS, RIPE, key, type Plot } from '../../shared/rules.ts';
import { drawAnchored, drawAt, loadAtlas } from './atlas.ts';
import { Input } from './input.ts';
import { Store } from './net.ts';
import { Player } from './player.ts';
import { UI } from './ui.ts';
import { TILE, World } from './world.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!;

const atlas = await loadAtlas();
const map = buildFarm();
const world = new World(map, atlas);
const store = new Store((x, y) => isTillable(map, x, y), map.starter);
const ui = new UI(atlas);
const input = new Input(canvas, document.getElementById('stick')!, document.getElementById('knob')!, document.getElementById('act')!);
const player = new Player(map.spawn.x * TILE + TILE / 2, map.spawn.y * TILE + TILE - 4);

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
  if (store.act({ t: 'sell', item, n })) ui.toast(`+${k * CROPS[item].sellPrice} 🪙`);
};
ui.update(store.st);
ui.setNet(false);
setInterval(() => store.tick(), 1000);

/** Perform the selected tool on a tile. */
function useTile(tx: number, ty: number) {
  const spot = spots.get(key(tx, ty));
  if (spot === 'ship') return ui.openShip(store.st);
  if (spot === 'shop') return ui.openShop(store.st);
  const p: Plot | undefined = store.st.plots[key(tx, ty)];
  if (p && p.c && p.s >= RIPE) {
    const c = p.c;
    if (store.act({ t: 'harvest', x: tx, y: ty })) { ui.toast(`+1 ${CROPS[c].name}`, 900); player.playAction('pl_harvest'); }
    return;
  }
  const slot = ui.current;
  if (slot.id === 'hoe') { if (store.act({ t: 'till', x: tx, y: ty })) player.playAction('pl_hoe'); }
  else if (slot.id === 'can') { if (store.act({ t: 'water', x: tx, y: ty })) player.playAction('pl_water'); }
  else if (slot.id.startsWith('seed:')) store.act({ t: 'plant', x: tx, y: ty, crop: slot.id.slice(5) });
  else if (p && p.c) ui.toast(`${CROPS[p.c].name}: chưa chín`, 900);
  else ui.toast('Chọn cuốc để xới đất, hạt giống để gieo', 1400);
}

// ------------------------------------------------------------------- view
let zoom = 2, vw = 0, vh = 0, dpr = 1;
// ?z=1 forces a zoom level (handy for map overview screenshots while designing)
const FORCE_ZOOM = Number(new URLSearchParams(location.search).get('z')) || 0;
const cam = { x: 0, y: 0 };

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  canvas.width = w; canvas.height = h;
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  // integer zoom: show at least ~11 tiles on the short side
  zoom = FORCE_ZOOM || Math.max(1, Math.floor(Math.min(w, h) / (11 * TILE)));
  vw = w / zoom; vh = h / zoom;
  ctx.imageSmoothingEnabled = false;
}
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
let target: [number, number] = [0, 0];
let exitCooldown = 0;

function update(dt: number) {
  if (input.slotPressed >= 0) ui.select(input.slotPressed);
  if (input.slotDelta) ui.select(ui.sel + input.slotDelta);

  if (ui.panelOpen) {
    if (input.actionPressed) ui.closePanel();
    input.consume();
    return;
  }

  input.axis(axis);
  player.update(dt, axis.x, axis.y, world);

  // pointer: tap a tile near you to use it, far away to walk there
  if (input.tap) {
    const w = screenToWorld(input.tap.x, input.tap.y);
    const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
    const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
    if (Math.hypot(cx - player.x, cy - (player.y - 6)) <= TILE * 1.7) {
      player.target = null;
      player.faceToward(cx, cy);
      useTile(tx, ty);
    } else {
      player.target = { x: w.x, y: w.y + 4 };
    }
  }

  target = player.facingTile(TILE);
  if (input.hover) {
    const w = screenToWorld(input.hover.x, input.hover.y);
    const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
    if (Math.hypot(tx * TILE + 16 - player.x, ty * TILE + 16 - (player.y - 6)) <= TILE * 1.7) target = [tx, ty];
  }
  if (input.actionPressed) useTile(target[0], target[1]);
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

  // tilled soil + seeds (flat)
  const x0 = Math.floor(camX / TILE) - 1, y0 = Math.floor(camY / TILE) - 1;
  const x1 = Math.ceil((camX + vw) / TILE) + 1, y1 = Math.ceil((camY + vh) / TILE) + 1;
  list.length = 0;
  const plots = store.st.plots;
  for (const k in plots) {
    const i = k.indexOf(',');
    const tx = +k.slice(0, i), ty = +k.slice(i + 1);
    if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
    const p = plots[k];
    drawAt(ctx, atlas, p.w ? 'tile_soil_wet' : 'tile_soil', tx * TILE, ty * TILE);
    if (!p.c) continue;
    if (p.s === 0) drawAt(ctx, atlas, 'seeds', tx * TILE, ty * TILE);
    else push(p.s >= RIPE ? 'crop_' + p.c : p.s === 1 ? 'crop_young' : 'crop_sprout', tx * TILE + 16, ty * TILE + TILE - 1, false);
  }

  // target highlight
  const [hx, hy] = target;
  if (!ui.panelOpen && hx >= 0 && hy >= 0 && hx < map.w && hy < map.h) {
    const pulse = 0.45 + 0.25 * Math.sin(time / 180);
    ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(hx * TILE + 0.5, hy * TILE + 0.5, TILE - 1, TILE - 1);
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
    drawAnchored(ctx, atlas, d.name, d.x, d.y, d.flip);
  }
}

// ------------------------------------------------------------------- loop
let last = performance.now();
updateCamera(0, true);
function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  update(dt);
  render(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
