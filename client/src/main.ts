import './style.css';
import { buildFarm, isTillable } from '../../shared/maps/farm.ts';
import { CROPS, RIPE, SUPPLIES, WEARABLES, hasPests, needsAt, key, secsToRipe, totalProgress, type Plot } from '../../shared/rules.ts';
import { isRainingAt } from '../../shared/weather.ts';
import { drawAnchored, drawAt, loadAtlas } from './atlas.ts';
import { Effects, drawScreenLight, swayFor } from './effects.ts';
import { loadGround, saveGround } from './groundcache.ts';
import { Input } from './input.ts';
import { WEATHER_NAME, Weather } from './weather.ts';
import { updateOrientation } from './orient.ts';
import { Store } from './net.ts';
import { enterGame, logout } from './login.ts';
import { onWearLoaded, preloadWear, wearFrame } from './wear.ts';
import { Player } from './player.ts';
import { FARM_NPCS, Npc } from './npc.ts';
import { UI, vnd } from './ui.ts';
import { dprCap, saveSettings, settings } from './settings.ts';
import { TILE, World } from './world.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const mainCtx = ctx;

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
// login / register / character creation
document.getElementById('loading')!.style.display = 'none';
const session = await enterGame(atlas);
document.getElementById('loading')!.style.display = '';
ltext.textContent = 'Đang dựng bản đồ…';
lbar.style.width = '95%';
await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // let the text paint
const world = new World(map, atlas, cachedGround);
if (world.rendered) setTimeout(() => { void world.chunkBlobs().then((b) => saveGround(map.id, b)); }, 3000);
const store = new Store((x, y) => isTillable(map, x, y), map.starter, session.token, session.profile.username);
store.onAuthFail = () => logout();
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __store: store });
const playerName = session.profile.name;
(document.getElementById('pname') as HTMLElement).textContent = playerName;
const ui = new UI(atlas, session.profile.gender === 'f' && atlas.frames['portrait_f'] ? 'portrait_f' : 'portrait');
const input = new Input(canvas, document.getElementById('stick')!, document.getElementById('knob')!, document.getElementById('act')!);
const player = new Player(map.spawn.x * TILE + TILE / 2, map.spawn.y * TILE + TILE - 4);
const fx = new Effects(world);
const npcs = FARM_NPCS.filter((d) => atlas.frames[`${d.sprite}_0`]).map((d) => new Npc(d));
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __npcs: npcs, __player: player });
const weather = new Weather();
const weatherEl = document.getElementById('weather') as HTMLElement;
weather.onChange = (k) => {
  weatherEl.textContent = WEATHER_NAME[k]; weatherEl.dataset.k = k;
  if (document.getElementById('loading') !== null) return;
  ui.toast(isRainingAt(store.now()) ? `${WEATHER_NAME[k]} · cây được tưới tự động` : WEATHER_NAME[k], 2200);
};
player.turnaround = !!atlas.frames['pl2_0'];
player.walkCycles = !!atlas.frames['pl3_0_8'];
// female: the chibi test character (pl6) when its sprites are in the atlas
player.sprite = session.profile.gender === 'f' ? (atlas.frames['pl6_0_w0'] ? 'pl6' : atlas.frames['pl5_0_w0'] ? 'pl5' : 'pl4') : 'pl4';
if (atlas.frames[`${player.sprite}_0_w0`]) {
  const count = (d: number, k: string) => { let n = 0; while (atlas.frames[`${player.sprite}_${d}_${k}${n}`]) n++; return n; };
  player.idleN = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => count(d, 'i'));
  player.walkN = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => count(d, 'w'));
  player.harvestN = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => count(d, 'h'));
  player.hoeN = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => count(d, 'g'));
  player.waterN = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => count(d, 'u'));
}

document.getElementById('loading')!.remove();

// ---------------------------------------------------------------- state glue
const spots = new Map(map.spots.map((s) => [key(s.x, s.y), s.id]));
store.onChange = () => { ui.update(store.st); ui.refresh(store.st); preloadWear(Object.values(store.st.wear || {})); };
// clothing atlases arrive on demand: fetch what is worn now, redraw previews when one lands
preloadWear(Object.values(store.st.wear || {}));
onWearLoaded(() => { if (ui.panel.dataset.kind === 'wear') ui.refresh(store.st); });
store.onError = (m) => ui.toast(m);
store.onNet = (on) => { ui.setNet(on); if (on) ui.toast('Đã kết nối máy chủ'); };
// avatar -> character tab (clothing slots + wardrobe, logout)
ui.me = { name: playerName, username: session.profile.username, sprite: player.sprite, gender: session.profile.gender === 'f' ? 'f' : 'm' };
document.getElementById('card')!.addEventListener('click', () => ui.openWardrobe(store.st));
ui.onEquip = (item) => { if (store.act({ t: 'equip', item })) ui.toast(`Đã mặc ${WEARABLES[item].name}`); };
ui.onBuyWear = (item) => { if (store.act({ t: 'buyWear', item })) ui.toast(`Đã mua ${WEARABLES[item].name}`); };
ui.onUnequip = (slot) => { store.act({ t: 'unequip', slot }); };
document.getElementById('gear')!.addEventListener('click', () => ui.openSettings());
const fpsEl = document.getElementById('fpsc') as HTMLElement;
ui.onSetting = (k, v) => {
  (settings as unknown as Record<string, unknown>)[k] = v;
  saveSettings();
  if (k === 'quality') resize();
  if (k === 'showFps') fpsEl.hidden = !settings.showFps;
};
fpsEl.hidden = !settings.showFps;
ui.onLogout = () => { if (confirm(`Đăng xuất tài khoản ${session.profile.username}?`)) logout(); };
ui.onBuy = (crop, n) => { if (store.act({ t: 'buy', crop, n })) ui.toast(`Đã mua ${n} hạt ${CROPS[crop].name}`); };
ui.onBuyItem = (item, n) => { if (store.act({ t: 'buyItem', item, n })) ui.toast(`Đã mua ${n} ${SUPPLIES[item].name}`); };
ui.onSell = (item, n) => {
  const have = store.st.inv[item] || 0;
  const k = Math.min(have, n);
  if (store.act({ t: 'sell', item, n })) ui.toast(`+${vnd(k * CROPS[item].sellPrice)}`);
};
ui.update(store.st);
ui.setNet(false);
setInterval(() => store.tick(), 1000);

/** Talk to an NPC: shopkeepers greet the player and open their shop. */
function talkTo(n: Npc) {
  if (n.def.shop) {
    const tips = n.def.lines;
    n.talk(Math.random() < 0.6 ? tips[0] : tips[1 + Math.floor(Math.random() * (tips.length - 1))]);
    ui.openShop(store.st, `Cửa hàng ${n.def.name}`);
  } else n.talk();
}

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
    if (spot === 'store') return ui.openStore(store.st);
    return ui.toast('Hãy đứng cạnh ô đất trong ruộng', 1200);
  }
  const tx = t.x, ty = t.y;
  const [bx, by, bc] = plotRect(tx, ty);
  const p: Plot | undefined = store.st.plots[key(tx, ty)];
  if (p && p.c && p.s >= RIPE) {
    const c = p.c;
    if (store.act({ t: 'harvest', x: tx, y: ty })) { ui.toast(`+1 ${CROPS[c].name}`, 900); if (!player.playHarvest()) player.playAction('pl_harvest'); fx.burst(bx + bc / 2, by + bc / 2, 'leaf', 8); }
    return;
  }
  const slot = ui.current;
  const wasTired = !!needsAt(store.st, store.now()).x;
  queueMicrotask(() => {
    if (!wasTired && needsAt(store.st, store.now()).x) ui.toast('Bạn đã kiệt sức! Hãy nghỉ ngơi trước khi cuốc đất, chăm cây', 2600);
  });
  if (slot.id === 'hoe') { if (store.act({ t: 'till', x: tx, y: ty })) { if (!player.playHoe()) player.playAction('pl_hoe'); setTimeout(() => fx.burst(bx + bc / 2, by + bc - 4, 'soil', 10), 420); } }
  else if (slot.id === 'can') { if (store.act({ t: 'water', x: tx, y: ty })) { if (!player.playWater()) player.playAction('pl_water'); setTimeout(() => fx.burst(bx + bc / 2, by + bc / 2, 'water', 12), 550); } }
  else if (slot.id.startsWith('seed:')) store.act({ t: 'plant', x: tx, y: ty, crop: slot.id.slice(5) });
  else if (slot.id === 'fert') { if (store.act({ t: 'fertilize', x: tx, y: ty })) { ui.toast('Đã bón phân', 900); fx.burst(bx + bc / 2, by + bc / 2, 'soil', 10); } }
  else if (slot.id === 'spray') { if (store.act({ t: 'spray', x: tx, y: ty })) { ui.toast('Đã diệt sâu', 900); fx.burst(bx + bc / 2, by + bc / 2, 'water', 16); } }
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
// (no zoom buttons any more: only keyboard +/- and Ctrl+wheel on PC; the old
//  'gnt_zoom2' choice is dropped so phones are not stuck at an old zoom)
try { const v = Number(localStorage.getItem('gnt_zoom3')); if (v >= 0 && v < ZOOM_STEPS.length) zoomStep = v; } catch { /* ignore */ }

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, dprCap());
  const [lw, lh] = updateOrientation();
  const w = Math.round(lw * dpr), h = Math.round(lh * dpr);
  canvas.width = w; canvas.height = h;
  canvas.style.width = lw + 'px';
  canvas.style.height = lh + 'px';
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
}

function setZoom(delta: number) {
  const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, zoomStep + delta));
  if (next === zoomStep) return;
  zoomStep = next;
  try { localStorage.setItem('gnt_zoom3', String(zoomStep)); } catch { /* ignore */ }
  resize();
  updateCamera(0, true);
}
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
// (Android Chrome). Elsewhere the game is rotated with CSS (orient.ts).
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
// one button: enter full screen / leave it (icon and tooltip follow the state)
const FS_IN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const FS_OUT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
document.getElementById('fs')!.innerHTML = FS_IN;
document.addEventListener('fullscreenchange', () => {
  const b = document.getElementById('fs')!, on = !!document.fullscreenElement;
  b.innerHTML = on ? FS_OUT : FS_IN;
  b.title = on ? 'Thu nhỏ màn hình' : 'Phóng to toàn màn hình';
  b.setAttribute('aria-label', b.title);
});

addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 150));
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
  for (const n of npcs) n.update(dt, world, player.x, player.y);
  if (player.moving && (stepT += dt) > (player.running ? 0.18 : 0.3)) { stepT = 0; fx.burst(player.x, player.y - 1, 'dust', player.running ? 3 : 2); }

  // pointer: tap a tile near you to use it, far away to walk there
  if (input.tap) {
    const w0 = screenToWorld(input.tap.x, input.tap.y);
    const tapped = npcs.find((m) => Math.abs(w0.x - m.x) < 14 && w0.y < m.y + 4 && w0.y > m.y - 44);
    if (tapped && Math.hypot(tapped.x - player.x, tapped.y - player.y) < 60) { talkTo(tapped); input.tap = null; }
  }
  if (input.tap) {
    const w = screenToWorld(input.tap.x, input.tap.y);
    const t = targetAt(w.x, w.y);
    const [cx, cy] = targetCenter(t);
    if (Math.hypot(cx - player.x, cy - (player.y - 6)) <= TILE * 1.7) {
      player.target = null;
      player.faceToward(cx, cy);
      useTarget(t);
    } else if (!input.tapTouch) {
      // mouse: click far away to walk there. On phones moving is joystick only.
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
  if (input.actionPressed && !player.busy) {
    const n = npcs.find((m) => Math.hypot(m.x - player.x, m.y - player.y) < 40);
    if (n) { player.faceToward(n.x, n.y - 10); talkTo(n); }
    else useTarget(target);
  }
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
function roundRect(x: number, y: number, w: number, h: number, r: number, ctx: CanvasRenderingContext2D = mainCtx) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const plotRnd = (seed: number, i: number) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
/** The whole planting grid is pre-rendered into one offscreen canvas and only
 *  redrawn when a plot changes state (or the zoom changes): drawing 32 clipped
 *  rounded patches every frame was the main cost near the garden. */
let plotLayer: HTMLCanvasElement | null = null, plotScale = 0;
let plotCells: number[] = [];               // state of each cell as last drawn into the layer
const PL_PAD = 2;
function plotLayerFor(plots: Record<string, { w?: number; c?: string }>, scale: number): HTMLCanvasElement {
  const W = PG!.cols * PG!.cell + PL_PAD * 2, H = PG!.rows * PG!.cell + PL_PAD * 2;
  if (!plotLayer || scale !== plotScale) {
    plotLayer = document.createElement('canvas');
    plotLayer.width = Math.ceil(W * scale); plotLayer.height = Math.ceil(H * scale);
    plotScale = scale; plotCells = [];
  }
  const g = plotLayer.getContext('2d')!;
  g.setTransform(scale, 0, 0, scale, (PL_PAD - PG!.x) * scale, (PL_PAD - PG!.y) * scale);
  g.imageSmoothingEnabled = false;
  // only the cells whose state changed are cleared and redrawn (each patch
  // stays inside its own cell, so neighbours are untouched)
  let i = 0;
  for (let r = 0; r < PG!.rows; r++) for (let c = 0; c < PG!.cols; c++, i++) {
    const p = plots[key(c, r)], st = p ? (p.w ? 2 : 1) : 0;
    if (plotCells[i] === st) continue;
    const [bx, by, bc] = plotRect(c, r);
    g.clearRect(bx, by, bc, bc);
    drawPlot(g, bx, by, bc, st, c * 31 + r * 17);
    plotCells[i] = st;
  }
  return plotLayer;
}
/** soft golden glow behind ripe crops, made once */
let glowImg: HTMLCanvasElement | null = null;
function ripeGlow(): HTMLCanvasElement {
  if (glowImg) return glowImg;
  glowImg = document.createElement('canvas'); glowImg.width = glowImg.height = 72;
  const g = glowImg.getContext('2d')!, gr = g.createRadialGradient(36, 36, 0, 36, 36, 36);
  gr.addColorStop(0, 'rgba(255,230,120,1)'); gr.addColorStop(1, 'rgba(255,230,120,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 72, 72);
  return glowImg;
}
/** A planting plot: 0 = barren, 1 = tilled, 2 = watered. Textures come from the
 *  ploughed-soil tile of the user's sheet, clipped to a rounded square. */
function drawPlot(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, state: number, seed: number) {
  const g = 1.5, r = 5, w = c - g * 2;
  const rnd = (i: number) => plotRnd(seed, i);
  // soft shadow under the patch
  ctx.fillStyle = 'rgba(60,35,15,0.35)';
  roundRect(x + g, y + g + 1, w, w, r, ctx); ctx.fill();
  ctx.save();
  roundRect(x + g, y + g, w, w, r, ctx); ctx.clip();
  if (state === 0) {
    // barren: cracked dry soil (user asset)
    const f = atlas.frames['tex_dry'];
    if (f) ctx.drawImage(atlas.img, f[0], f[1], f[4], f[5], x + g, y + g, w, w);
    else { ctx.fillStyle = '#c0915b'; ctx.fillRect(x, y, c, c); }
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
      // watered: dark, glossy, little puddle shine and (droplets are animated per frame)
      ctx.fillStyle = 'rgba(40,25,30,0.25)';
      ctx.fillRect(x, y, c, c);
      ctx.fillStyle = 'rgba(170,210,255,0.16)';
      ctx.beginPath(); ctx.ellipse(x + c * 0.36, y + c * 0.32, c * 0.22, c * 0.09, -0.3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  ctx.strokeStyle = state === 2 ? 'rgba(40,22,15,0.8)' : state === 1 ? 'rgba(70,40,20,0.65)' : 'rgba(110,70,35,0.5)';
  ctx.lineWidth = 1;
  roundRect(x + g + 0.5, y + g + 0.5, w - 1, w - 1, r - 0.5, ctx); ctx.stroke();
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
    const gw = PG.cols * PG.cell, gh = PG.rows * PG.cell;
    const gridVisible = PG.x + gw + 20 > camX && PG.x - 20 < camX + vw && PG.y + gh + 20 > camY && PG.y - 30 < camY + vh;
    if (gridVisible) {
      const scale = Math.min(6, Math.max(2, Math.ceil(zoom)));
      const layer = plotLayerFor(plots, scale);
      ctx.drawImage(layer, PG.x - PL_PAD, PG.y - PL_PAD, layer.width / scale, layer.height / scale);
    }
    for (let r = 0; r < PG.rows && gridVisible; r++)
      for (let c = 0; c < PG.cols; c++) {
        const p = plots[key(c, r)];
        const [bx, by, bc] = plotRect(c, r);
        if (p && p.w) {
          // watered: twinkling droplets on the wet soil
          const seed = c * 31 + r * 17;
          for (let k = 0; k < 3; k++) {
            const a = 0.35 + 0.45 * Math.sin(time / 300 + seed + k * 2.1);
            if (a <= 0.1) continue;
            ctx.fillStyle = `rgba(220,240,255,${a.toFixed(2)})`;
            ctx.fillRect(bx + 4 + plotRnd(seed, k + 40) * (bc - 8), by + 4 + plotRnd(seed, k + 50) * (bc - 8), 1.4, 1.4);
          }
        }
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
  for (const n of npcs) push(n.frame + ':n', n.x, n.y, false);
  const px = Math.round(player.x), py = Math.round(player.y);
  const [pf, pflip] = player.frame;
  push(pf, px, py, pflip);
  list.sort(byY);

  for (const d of list) {
    if (d.name.startsWith(player.sprite + '_')) {
      // protagonist, dressed as two halves split at the waist: the shirt item
      // replaces the upper half, pants the lower half, in every frame (stand,
      // walk, harvest, hoe, water; see wear.ts). A half without an item (or
      // whose atlas is still loading) is the bare body, clipped at the waist.
      const wear = store.st.wear || {};
      const up = wearFrame(wear.shirt, d.name), lo = wearFrame(wear.pants, d.name);
      const f = atlas.frames[d.name], wf = atlas.waist[d.name];
      if ((!up && !lo) || !f || wf == null) drawAnchored(ctx, atlas, d.name, d.x, d.y, d.flip);
      else {
        // the lower half (drawn first) reaches one art pixel above the waist,
        // under the upper half, so smoothing at a fractional zoom never shows
        // the ground through the seam
        const LAP = 2 / atlas.res;
        // every layer is drawn unrounded from the same integer feet point, so the
        // halves share one pixel grid and meet exactly at the waist line (cut is
        // on that grid too: the waist is a whole pixel row of the frame)
        const cut = d.y + (f[6] || 0) - wf * f[3];
        const bare = (top: boolean) => {
          ctx.save(); ctx.beginPath();
          if (top) ctx.rect(d.x - 40, cut - 80, 80, 80); else ctx.rect(d.x - 40, cut - LAP, 80, 80);
          ctx.clip(); drawAnchored(ctx, atlas, d.name, d.x, d.y, d.flip, true); ctx.restore();
        };
        if (lo) drawAnchored(ctx, lo[0], lo[1], d.x, d.y, d.flip, true); else bare(false);
        if (up) drawAnchored(ctx, up[0], up[1], d.x, d.y, d.flip, true); else bare(true);
      }
      continue;
    }
    if (d.name.startsWith('pl_')) {
      const [dy, sx, sy, lean] = player.pose;
      // shadow shrinks a little while the body is in the air
      const shk = 1 + dy * 0.05;
      ctx.fillStyle = 'rgba(30,36,10,0.3)';
      ctx.beginPath(); ctx.ellipse(player.x, player.y - 0.5, 7 * shk, 2.4 * shk, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.imageSmoothingEnabled = true;          // sub-pixel motion: glide, don't pop
      ctx.translate(player.x, player.y + dy);
      ctx.transform(sx, 0, -lean * sy, sy, 0, 0);
      drawAnchored(ctx, atlas, d.name, 0, 0, d.flip);
      ctx.restore();
      continue;
    }
    if (d.name.endsWith(':n')) {            // NPC: same scale as the player, step bounce
      const n = npcs.find((m) => m.x === d.x && m.y === d.y)!;
      ctx.fillStyle = 'rgba(30,36,10,0.3)';
      ctx.beginPath(); ctx.ellipse(d.x, d.y - 0.5, 7, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.imageSmoothingEnabled = true;
      const k = n ? n.def.scale : 1.25;
      ctx.translate(d.x, d.y - (n ? n.bob : 0)); ctx.scale(k, k);
      drawAnchored(ctx, atlas, d.name.slice(0, -2), 0, 0, false); ctx.restore();
      continue;
    }
    if (d.name.endsWith(':p')) {           // crop on a small plot: scaled to the plot
      let nm = d.name.slice(0, -2), k = PG ? PG.cell / TILE * 1.05 : 1;
      if (nm.endsWith(':s')) { nm = nm.slice(0, -2); k *= 0.6; }
      const sw = swayFor(nm.startsWith('cp_rice') ? 'tallgrass_top' : 'crop_', d.x, d.y, ts);
      // direct matrix instead of save/restore: 32 crops per frame near the garden
      ctx.imageSmoothingEnabled = true;
      ctx.setTransform(zoom * k, 0, zoom * sw * k, zoom * k, zoom * d.x - ox, zoom * d.y - oy);
      drawAnchored(ctx, atlas, nm, 0, 0, d.flip);
      ctx.setTransform(zoom, 0, 0, zoom, -ox, -oy); ctx.imageSmoothingEnabled = zoom < atlas.res - 0.05;
      continue;
    }
    if (d.name.endsWith(':s')) {           // small variant (young sprout)
      const nm = d.name.slice(0, -2), sw = swayFor('crop_', d.x, d.y, ts);
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.translate(d.x, d.y); ctx.transform(0.6, 0, sw * 0.6, 0.6, 0, 0);
      drawAnchored(ctx, atlas, nm, 0, 0, d.flip); ctx.restore();
      continue;
    }
    const sw = swayFor(d.name.startsWith('cp_rice') ? 'tallgrass_top' : d.name.startsWith('pc_') || d.name.startsWith('cp_') ? 'crop_' : d.name, d.x, d.y, ts);
    if (sw) {
      // shear around the base: the top moves, the roots stay put
      ctx.save();
      ctx.imageSmoothingEnabled = true;   // sub-pixel sway: filtered, no pixel popping
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
    ctx.globalAlpha = 0.06 + 0.03 * Math.sin(ph);
    ctx.drawImage(ripeGlow(), cx - 18, cy - 18, 36, 36);
    ctx.globalAlpha = 1;
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
  // crop status: a status bar above every plant (+ water / pest / fertilizer
  // markers), crawling bugs on infested plants, info bubble on the targeted one
  {
    const now = store.now();
    for (const k in plots) {
      const p = plots[k];
      if (!p.c) continue;
      const i = k.indexOf(',');
      const [bx, by, bc] = plotRect(+k.slice(0, i), +k.slice(i + 1));
      if (bx < camX - 40 || bx > camX + vw + 40 || by < camY - 40 || by > camY + vh + 40) continue;
      if (!settings.cropBars && !hasPests(p, now)) continue;
      const ripe = p.s >= RIPE, pest = hasPests(p, now), dry = !p.w && !ripe;
      // status bar above the plant
      if (settings.cropBars) {
      const bw = bc - 6, bxx = bx + 3, byy = by - 6;
      ctx.fillStyle = 'rgba(30,18,8,0.65)';
      roundRect(bxx - 0.5, byy - 0.5, bw + 1, 3.5, 1.5); ctx.fill();
      ctx.fillStyle = ripe ? '#ffd54a' : pest ? '#e0513f' : dry ? '#5aa9e6' : '#8fd14f';
      const pr = totalProgress(p, now);
      if (pr > 0) { roundRect(bxx, byy, Math.max(2.5, bw * pr), 2.5, 1.2); ctx.fill(); }
      // markers on the left of the bar
      let mx = bxx + 1;
      const my = byy - 4 + Math.sin(ts * 4 + bx) * 0.8;
      if (dry) {
        ctx.fillStyle = '#3f8fd1';
        ctx.beginPath(); ctx.moveTo(mx, my - 3); ctx.quadraticCurveTo(mx + 2.6, my + 0.5, mx, my + 2.2);
        ctx.quadraticCurveTo(mx - 2.6, my + 0.5, mx, my - 3); ctx.fill();
        mx += 6;
      }
      if (pest) {
        ctx.fillStyle = '#e0513f';
        ctx.beginPath(); ctx.arc(mx, my, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(mx - 0.5, my - 1.6, 1, 2); ctx.fillRect(mx - 0.5, my + 0.9, 1, 0.8);
        mx += 6;
      }
      if (p.f) {
        ctx.fillStyle = '#6fbf3f';
        ctx.beginPath(); ctx.ellipse(mx, my, 2.4, 1.4, -0.6, 0, Math.PI * 2); ctx.fill();
      }
      }
      // bugs crawling on infested plants
      if (pest) {
        for (let b = 0; b < 3; b++) {
          const a = ts * (1.3 + b * 0.4) + b * 2.1 + bx;
          const ux = bx + bc / 2 + Math.cos(a) * (5 + b * 2), uy = by + bc * 0.45 + Math.sin(a * 1.3) * 5;
          ctx.fillStyle = b === 1 ? '#6b3b16' : '#3d2b12';
          ctx.beginPath(); ctx.ellipse(ux, uy, 1.6, 1.1, a, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#a7d34a';
          ctx.fillRect(ux + Math.cos(a) * 1.4 - 0.4, uy + Math.sin(a) * 1.4 - 0.4, 0.8, 0.8);
        }
      }
    }
    if (!ui.panelOpen && target.plot) {
      const p = plots[key(target.x, target.y)];
      const [bx, by, bc] = plotRect(target.x, target.y);
      let title = '', line = '', color = '#fff6dc';
      if (!p) { title = 'Đất trống'; line = 'Dùng cuốc để xới đất'; }
      else if (!p.c) { title = 'Đất đã xới'; line = p.w ? 'Đã tưới · chọn hạt để gieo' : 'Chọn hạt giống để gieo'; }
      else {
        const def = CROPS[p.c];
        title = def.name;
        if (p.s >= RIPE) { line = 'Đã chín · thu hoạch ngay!'; color = '#ffd54a'; }
        else {
          const left = secsToRipe(p, now);
          const mm = Math.floor(left / 60), ss = left % 60;
          const tStr = mm ? `${mm} phút ${ss}s` : `${ss}s`;
          const stage = ['Hạt', 'Mầm', 'Đang lớn'][p.s] || '';
          if (hasPests(p, now)) { line = 'Bị sâu phá! Dùng thuốc trừ sâu'; color = '#ff8a7a'; }
          else if (p.w) line = `${stage} · chín sau ${tStr}`;
          else { line = `${stage} · cần tưới nước (còn ${tStr})`; color = '#bfe3ff'; }
        }
        if (p.f && p.s < RIPE) title += ' · đã bón phân';
      }
      ctx.font = 'bold 6px system-ui, sans-serif';
      const w1 = ctx.measureText(title).width;
      ctx.font = '5px system-ui, sans-serif';
      const w2 = ctx.measureText(line).width;
      const bw = Math.max(w1, w2) + 8, bh = 16;
      const cx = bx + bc / 2;
      let tx = cx - bw / 2;
      tx = Math.max(camX + 2, Math.min(camX + vw - bw - 2, tx));
      const ty = by - bh - 6;
      ctx.fillStyle = 'rgba(40,24,10,0.82)';
      roundRect(tx, ty, bw, bh, 3); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 3, ty + bh); ctx.lineTo(cx + 3, ty + bh); ctx.lineTo(cx, ty + bh + 3); ctx.fill();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = 'bold 6px system-ui, sans-serif';
      ctx.fillStyle = '#fff6dc';
      ctx.fillText(title, tx + bw / 2, ty + 7);
      ctx.font = '5px system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.fillText(line, tx + bw / 2, ty + 13.5);
    }
  }
  // NPC names and speech bubbles
  for (const n of npcs) {
    ctx.font = 'bold 6px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const nw = ctx.measureText(n.def.name).width + 6;
    ctx.fillStyle = 'rgba(120,70,10,0.7)';
    roundRect(n.x - nw / 2, n.y - 49, nw, 9, 3); ctx.fill();
    ctx.fillStyle = '#ffe9a8'; ctx.fillText(n.def.name, n.x, n.y - 41);
    if (n.sayT > 0) {
      ctx.font = '5.5px system-ui, sans-serif';
      // wrap to ~110px
      const words = n.say.split(' '), lines: string[] = [];
      let cur = '';
      for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (ctx.measureText(t).width > 110 && cur) { lines.push(cur); cur = wd; } else cur = t; }
      if (cur) lines.push(cur);
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10, bh = lines.length * 7 + 6;
      let bx = n.x - bw / 2; bx = Math.max(camX + 2, Math.min(camX + vw - bw - 2, bx));
      const by = n.y - 55 - bh;
      ctx.globalAlpha = Math.min(1, n.sayT * 3);
      ctx.fillStyle = 'rgba(255,248,228,0.97)'; ctx.strokeStyle = '#4a2c17'; ctx.lineWidth = 1;
      roundRect(bx, by, bw, bh, 4); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(n.x - 3, by + bh); ctx.lineTo(n.x + 3, by + bh); ctx.lineTo(n.x, by + bh + 4); ctx.closePath();
      ctx.fillStyle = 'rgba(255,248,228,0.97)'; ctx.fill();
      ctx.fillStyle = '#4a2c17'; ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, bx + bw / 2, by + 3.5 + i * 7));
      ctx.globalAlpha = 1;
    }
  }
  // name tag above the player's head
  if (settings.nameTag) {
    ctx.font = 'bold 6px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(playerName).width + 6;
    const tx = player.x, ty = player.y - 40;
    ctx.fillStyle = 'rgba(40,24,10,0.55)';
    roundRect(tx - tw / 2, ty - 8, tw, 9, 3); ctx.fill();
    ctx.fillStyle = '#fff6dc';
    ctx.fillText(playerName, tx, ty);
  }
  if (settings.ambientFx) fx.drawAir(ctx, ts, camX, camY, vw, vh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (settings.weatherFx) weather.draw(ctx, canvas.width, canvas.height, frameDt, dpr);
  drawScreenLight(ctx, canvas.width, canvas.height, ts, weather.sun);
}

// ------------------------------------------------------------------- loop
let last = performance.now();
let frameDt = 0;
updateCamera(0, true);
let fpsN = 0, fpsT = 0;
function frame(t: number) {
  requestAnimationFrame(frame);
  // 30 FPS mode: skip every other display refresh
  if (settings.fps === 30 && t - last < 1000 / 30 - 4) return;
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  if (settings.showFps && (fpsN++, fpsT || (fpsT = t), t - fpsT > 500)) { fpsEl.textContent = Math.round(fpsN * 1000 / (t - fpsT)) + ' FPS'; fpsN = 0; fpsT = t; }
  update(dt);
  fx.update(dt);
  weather.update(dt, store.now());
  fx.rainK = weather.rain;
  frameDt = dt;
  render(t);
}
requestAnimationFrame(frame);
