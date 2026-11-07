// Game rules shared by client (prediction / offline mode) and server (authority).
// Keep this file free of DOM / Node APIs.

export interface CropDef {
  id: string;
  name: string;
  seedPrice: number;
  sellPrice: number;
  /** seconds per growth stage once watered */
  stageSecs: number;
}

export const CROPS: Record<string, CropDef> = {
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
}

export interface FarmState {
  v: number; // bumps on every change
  coins: number;
  inv: Record<string, number>; // 'seed:carrot', 'carrot', ...
  plots: Record<string, Plot>; // key "x,y"
}

export type Action =
  | { t: 'till'; x: number; y: number }
  | { t: 'plant'; x: number; y: number; crop: string }
  | { t: 'water'; x: number; y: number }
  | { t: 'harvest'; x: number; y: number }
  | { t: 'clear'; x: number; y: number }
  | { t: 'sell'; item: string; n: number }
  | { t: 'buy'; crop: string; n: number };

export const key = (x: number, y: number) => x + ',' + y;

/** A new farm starts with a few rows already growing so it never looks bare. */
export function newFarm(): FarmState {
  const plots: Record<string, Plot> = {};
  const row = (y: number, x0: number, x1: number, c: string, st: number) => {
    for (let x = x0; x <= x1; x++) plots[key(x, y)] = { c, s: st, w: 0 };
  };
  row(16, 3, 10, 'carrot', RIPE);
  row(17, 3, 10, 'turnip', 2);
  row(18, 3, 10, 'eggplant', 1);
  row(19, 3, 6, '', 0); // tilled, waiting for seeds
  row(16, 12, 19, 'tomato', 2);
  row(17, 12, 15, 'strawberry', 1);
  row(17, 16, 19, 'pumpkin', RIPE);
  row(18, 12, 19, 'carrot', 0);
  row(26, 10, 15, 'turnip', 1); // kitchen garden
  return { v: 1, coins: 100, inv: { 'seed:carrot': 6, 'seed:turnip': 3 }, plots };
}

/** Advance growth lazily from timestamps. Returns true when the plot changed. */
export function growPlot(p: Plot, now: number): boolean {
  if (!p.c || p.s >= RIPE || !p.w) return false;
  const def = CROPS[p.c];
  if (!def) return false;
  if (now - p.w < def.stageSecs * 1000) return false;
  p.s++;
  p.w = 0; // each stage needs fresh water
  return true;
}

export function growAll(st: FarmState, now: number): boolean {
  let changed = false;
  for (const k in st.plots) if (growPlot(st.plots[k], now)) changed = true;
  return changed;
}

/** Progress (0..1) of the current stage, for UI. */
export function stageProgress(p: Plot, now: number): number {
  if (!p.c || !p.w || p.s >= RIPE) return 0;
  return Math.min(1, (now - p.w) / (CROPS[p.c].stageSecs * 1000));
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
    if (p) growPlot(p, now);
    switch (a.t) {
      case 'till':
        if (p) return 'Đất đã được xới';
        if (!canTill(a.x, a.y)) return 'Không thể xới ở đây';
        st.plots[k] = { c: '', s: 0, w: 0 };
        break;
      case 'plant': {
        if (!p) return 'Cần xới đất trước';
        if (p.c) return 'Ô này đã có cây';
        if (!CROPS[a.crop]) return 'Hạt giống lạ';
        const seed = 'seed:' + a.crop;
        if (!st.inv[seed]) return 'Hết hạt giống';
        add(st.inv, seed, -1);
        p.c = a.crop; p.s = 0; p.w = 0;
        break;
      }
      case 'water':
        if (!p) return 'Chưa có đất xới';
        if (p.w) return 'Đã tưới rồi';
        if (p.c && p.s >= RIPE) return 'Cây đã chín, hãy thu hoạch';
        p.w = now;
        break;
      case 'harvest':
        if (!p || !p.c) return 'Không có gì để thu hoạch';
        if (p.s < RIPE) return 'Cây chưa chín';
        add(st.inv, p.c, 1);
        p.c = ''; p.s = 0; p.w = 0;
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
  } else {
    return 'Hành động lạ';
  }
  st.v++;
  return null;
}
