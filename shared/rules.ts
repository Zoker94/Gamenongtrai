// Game rules shared by client (prediction / offline mode) and server (authority).
// Keep this file free of DOM / Node APIs.
import { firstRainBetween } from './weather.ts';

export interface CropDef {
  id: string;
  name: string;
  seedPrice: number;
  sellPrice: number;
  /** seconds per growth stage once watered */
  stageSecs: number;
}

export const CROPS: Record<string, CropDef> = {
  rice:       { id: 'rice',       name: 'Lúa',      seedPrice: 8,  sellPrice: 22,  stageSecs: 20 },
  carrot:     { id: 'carrot',     name: 'Cà rốt',   seedPrice: 10, sellPrice: 25,  stageSecs: 20 },
  turnip:     { id: 'turnip',     name: 'Củ cải',   seedPrice: 12, sellPrice: 30,  stageSecs: 25 },
  tomato:     { id: 'tomato',     name: 'Cà chua',  seedPrice: 20, sellPrice: 55,  stageSecs: 35 },
  strawberry: { id: 'strawberry', name: 'Dâu tây',  seedPrice: 30, sellPrice: 85,  stageSecs: 45 },
  eggplant:   { id: 'eggplant',   name: 'Cà tím',   seedPrice: 25, sellPrice: 70,  stageSecs: 40 },
  pumpkin:    { id: 'pumpkin',    name: 'Bí ngô',   seedPrice: 40, sellPrice: 120, stageSecs: 60 },
};
export const CROP_IDS = Object.keys(CROPS);

/** 0 seed, 1 sprout, 2 young, 3 ripe */
export const RIPE = 3;

export interface Plot {
  /** crop id or '' when only tilled */
  c: string;
  /** growth stage */
  s: number;
  /** ms timestamp when last watered for the current stage, 0 = dry */
  w: number;
  /** ms timestamp the plot became dry (planted / last stage finished): rain after it waters the plot */
  d?: number;
  /** fertilized: stages grow 40% faster, +1 crop at harvest */
  f?: number;
  /** pests: ms timestamp they show up during the current stage (0/absent = none). Growth is
   *  frozen from that moment until the plot is sprayed. */
  q?: number;
}

/** Shop items besides seeds */
export const SUPPLIES: Record<string, { name: string; price: number }> = {
  fert: { name: 'Phân bón', price: 15 },
  spray: { name: 'Thuốc trừ sâu', price: 20 },
};
/** Clothing slots of the character (wardrobe opened from the avatar). */
export const WEAR_SLOTS: { id: string; name: string }[] = [
  { id: 'hat', name: 'Mũ' },
  { id: 'shirt', name: 'Áo' },
  { id: 'pants', name: 'Quần' },
  { id: 'shoes', name: 'Giày' },
  { id: 'acc', name: 'Phụ kiện' },
];
/** Clothing catalog. Empty until the clothing assets arrive: add an entry per
 *  item (icon = atlas frame name), players own them as inv['wear:<id>']. */
export const WEARABLES: Record<string, { name: string; slot: string; icon: string; gender?: 'm' | 'f'; price?: number }> = {};
const PEST_CHANCE = 0.22;

export interface FarmState {
  v: number; // bumps on every change
  coins: number;
  inv: Record<string, number>; // 'seed:carrot', 'carrot', ...
  plots: Record<string, Plot>; // key "x,y"
  wear?: Record<string, string>; // equipped clothing: slot -> item id (owned as inv['wear:<id>'])
}

export type Action =
  | { t: 'till'; x: number; y: number }
  | { t: 'plant'; x: number; y: number; crop: string }
  | { t: 'water'; x: number; y: number }
  | { t: 'harvest'; x: number; y: number }
  | { t: 'clear'; x: number; y: number }
  | { t: 'sell'; item: string; n: number }
  | { t: 'fertilize'; x: number; y: number }
  | { t: 'spray'; x: number; y: number }
  | { t: 'buy'; crop: string; n: number }
  | { t: 'buyItem'; item: string; n: number }
  | { t: 'equip'; item: string }
  | { t: 'unequip'; slot: string };

export const key = (x: number, y: number) => x + ',' + y;

export interface StarterPlot { x: number; y: number; c: string; s: number }

/** A new farm. The map provides a few plots already growing so it never looks bare. */
export function newFarm(starter: StarterPlot[] = []): FarmState {
  const plots: Record<string, Plot> = {};
  for (const p of starter) plots[key(p.x, p.y)] = { c: p.c, s: p.s, w: 0, d: 0 };
  return { v: 1, coins: 100, inv: { 'seed:rice': 6, 'seed:carrot': 6, 'seed:tomato': 3, fert: 3, spray: 2 }, plots };
}

/** ms one growth stage takes for this plot */
export const stageMs = (p: Plot) => CROPS[p.c].stageSecs * 1000 * (p.f ? 0.6 : 1);

/** deterministic 0..1 from a plot key and a timestamp */
function rnd(k: string, t: number) {
  let h = (t / 1000) | 0;
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Start a stage: the plot is watered at `t`; maybe pests show up later in it. */
function startStage(p: Plot, k: string, t: number) {
  p.w = t;
  p.q = rnd(k, t) < PEST_CHANCE ? t + stageMs(p) * (0.3 + rnd(k + '!', t) * 0.4) : 0;
}

export const hasPests = (p: Plot, now: number) => !!p.q && p.q <= now && p.s < RIPE;

/** Advance growth lazily from timestamps (rain waters dry crops, pests freeze growth).
 *  Deterministic, so client and server reach the same state. Returns true when changed. */
export function growPlot(p: Plot, now: number, k = ''): boolean {
  if (!p.c || p.s >= RIPE || !CROPS[p.c]) return false;
  let changed = false;
  for (let guard = 0; guard < 8 && p.s < RIPE; guard++) {
    if (!p.w) {
      if (!p.d) { p.d = now; changed = true; break; }   // legacy / starter plot: dry from now on
      const r = firstRainBetween(p.d, now);
      if (!r) break;                                    // no rain since it dried
      startStage(p, k, r);
      changed = true;
    }
    if (p.q && p.q <= now) break;          // pests: frozen until sprayed
    const end = p.w + stageMs(p);
    if (now < end) break;
    p.s++; p.w = 0; p.q = 0; p.d = end;    // each stage needs fresh water
    changed = true;
  }
  return changed;
}

export function growAll(st: FarmState, now: number): boolean {
  let changed = false;
  for (const k in st.plots) if (growPlot(st.plots[k], now, k)) changed = true;
  return changed;
}

/** Progress (0..1) of the current stage, for UI (frozen while pests are on it). */
export function stageProgress(p: Plot, now: number): number {
  if (!p.c || !p.w || p.s >= RIPE) return 0;
  const t = p.q && p.q <= now ? p.q : now;
  return Math.min(1, (t - p.w) / stageMs(p));
}

/** Whole-crop progress 0..1 (for the status bar). */
export function totalProgress(p: Plot, now: number): number {
  if (!p.c) return 0;
  if (p.s >= RIPE) return 1;
  return (p.s + stageProgress(p, now)) / RIPE;
}

/** Seconds of growing left until ripe (assuming it is watered every stage). */
export function secsToRipe(p: Plot, now: number): number {
  if (!p.c || p.s >= RIPE) return 0;
  const ms = stageMs(p);
  return Math.ceil(((1 - stageProgress(p, now)) * ms + (RIPE - 1 - p.s) * ms) / 1000);
}

const add = (inv: Record<string, number>, item: string, n: number) => {
  const v = (inv[item] || 0) + n;
  if (v <= 0) delete inv[item];
  else inv[item] = v;
};

/**
 * Apply an action. `canTill(x,y)` comes from the map. Mutates state and
 * returns null on success or an error message (Vietnamese, shown to player).
 */
export function applyAction(
  st: FarmState,
  a: Action,
  now: number,
  canTill: (x: number, y: number) => boolean,
): string | null {
  if ('x' in a) {
    if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return 'Ô không hợp lệ';
    const k = key(a.x, a.y);
    const p = st.plots[k];
    if (p) growPlot(p, now, k);
    switch (a.t) {
      case 'till':
        if (p) return 'Đất đã được xới';
        if (!canTill(a.x, a.y)) return 'Không thể xới ở đây';
        st.plots[k] = { c: '', s: 0, w: 0, d: 0 };
        break;
      case 'plant': {
        if (!p) return 'Cần xới đất trước';
        if (p.c) return 'Ô này đã có cây';
        if (!CROPS[a.crop]) return 'Hạt giống lạ';
        const seed = 'seed:' + a.crop;
        if (!st.inv[seed]) return 'Hết hạt giống';
        add(st.inv, seed, -1);
        const wasWet = p.w;
        p.c = a.crop; p.s = 0; p.w = 0; p.f = 0; p.q = 0; p.d = now;
        if (wasWet) startStage(p, k, now);   // seeds sown into already watered soil
        growPlot(p, now, k);
        break;
      }
      case 'water':
        if (!p) return 'Chưa có đất xới';
        if (p.w) return 'Đã tưới rồi';
        if (p.c && p.s >= RIPE) return 'Cây đã chín, hãy thu hoạch';
        if (p.c) startStage(p, k, now); else p.w = now;
        break;
      case 'fertilize':
        if (!p || !p.c) return 'Chỉ bón phân cho ô đang có cây';
        if (p.s >= RIPE) return 'Cây đã chín, hãy thu hoạch';
        if (p.f) return 'Cây đã được bón phân';
        if (!st.inv.fert) return 'Hết phân bón';
        add(st.inv, 'fert', -1);
        // keep the progress of the running stage, then grow faster
        if (p.w) { const pr = stageProgress(p, now); const q = p.q && p.q > now ? (p.q - p.w) / stageMs(p) : -1;
          p.f = 1; p.w = now - pr * stageMs(p); if (q >= 0) p.q = p.w + q * stageMs(p); }
        else p.f = 1;
        break;
      case 'spray':
        if (!p || !p.c) return 'Không có cây để phun thuốc';
        if (!hasPests(p, now)) return 'Cây không bị sâu';
        if (!st.inv.spray) return 'Hết thuốc trừ sâu';
        add(st.inv, 'spray', -1);
        p.w += now - (p.q as number);        // time lost to pests does not count
        p.q = 0;
        break;
      case 'harvest':
        if (!p || !p.c) return 'Không có gì để thu hoạch';
        if (p.s < RIPE) return 'Cây chưa chín';
        add(st.inv, p.c, p.f ? 2 : 1);
        delete st.plots[k];   // harvested soil turns barren: hoe it again before sowing
        break;
      case 'clear':
        if (!p) return 'Không có gì để dọn';
        delete st.plots[k];
        break;
    }
  } else if (a.t === 'sell') {
    const have = st.inv[a.item] || 0;
    const def = CROPS[a.item];
    if (!def) return 'Không bán được';
    const n = Math.min(have, Math.max(0, a.n | 0));
    if (!n) return 'Không có hàng để bán';
    add(st.inv, a.item, -n);
    st.coins += n * def.sellPrice;
  } else if (a.t === 'buy') {
    const def = CROPS[a.crop];
    const n = Math.max(0, a.n | 0);
    if (!def || !n) return 'Không mua được';
    if (st.coins < def.seedPrice * n) return 'Không đủ tiền';
    st.coins -= def.seedPrice * n;
    add(st.inv, 'seed:' + a.crop, n);
  } else if (a.t === 'buyItem') {
    const def = SUPPLIES[a.item];
    const n = Math.max(0, a.n | 0);
    if (!def || !n) return 'Không mua được';
    if (st.coins < def.price * n) return 'Không đủ tiền';
    st.coins -= def.price * n;
    add(st.inv, a.item, n);
  } else if (a.t === 'equip') {
    const def = WEARABLES[a.item];
    if (!def) return 'Không có món đồ này';
    if (!st.inv['wear:' + a.item]) return 'Bạn chưa có món đồ này';
    (st.wear ||= {})[def.slot] = a.item;
  } else if (a.t === 'unequip') {
    if (!st.wear || !st.wear[a.slot]) return 'Ô này đang trống';
    delete st.wear[a.slot];
  } else {
    return 'Hành động lạ';
  }
  st.v++;
  return null;
}
