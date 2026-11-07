// Farm map ("Nông trại"). Built procedurally from fixed numbers + a seeded
// RNG, so it is identical on client and server. Edit the zone coordinates
// below to reshape the map.
//
// Layout (24x20 tiles, about two phone screens; compact and dense on purpose):
//   north: farmhouse, orchard corner, barn, silo, windmill
//   middle: road (east exit -> town), fenced crop field, animal pen
//   south: greenhouse, kitchen garden, beehives, fishing pond
//          road south (exit -> park)

export const G = {
  Grass: 0, Dirt: 1, Water: 2, Stone: 3, Field: 4, Bridge: 5,
  CliffTop: 6, CliffFace: 7, Stairs: 8, TallGrass: 9, Sand: 10, DarkGrass: 11,
} as const;
export type G = (typeof G)[keyof typeof G];

/** ground types the player cannot walk on */
export const SOLID = new Set<number>([G.Water, G.CliffTop, G.CliffFace]);
/** ground types that look like grass (for edge blending) */
export const GRASSY = new Set<number>([G.Grass, G.DarkGrass, G.TallGrass]);

export interface MapObject {
  /** sprite name in the atlas */
  s: string;
  /** anchor = bottom-centre of the sprite. Pixel position: px = x*32+16, py = y*32.
   *  So an object standing in tile row r has y = r + 1. x may be fractional. */
  x: number;
  y: number;
  /** horizontal flip */
  f?: boolean;
}

export interface Exit { x0: number; y0: number; x1: number; y1: number; to: string; label: string }
export interface Rect { x0: number; y0: number; x1: number; y1: number }

import type { StarterPlot } from '../rules.ts';

export interface GameMap {
  id: string;
  name: string;
  w: number;
  h: number;
  ground: Uint8Array;
  objects: MapObject[];
  /** flat sprites baked into the ground layer (no collision, under the player) */
  decals: MapObject[];
  /** sports courts: white lines are painted on the sand */
  courts: Rect[];
  exits: Exit[];
  spawn: { x: number; y: number };
  /** terrain type at a fractional tile position (used for smooth rendering) */
  terrainAt: (x: number, y: number) => number;
  /** plots already growing on a brand-new farm */
  starter: StarterPlot[];
  /** interactive spots: shipping bin, seed shop */
  spots: { id: string; x: number; y: number }[];
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** cheap smooth-ish deterministic noise in [-1, 1] */
const wobble = (x: number, y: number, s = 0): number =>
  (Math.sin(x * 0.83 + y * 0.31 + s) + Math.sin(y * 1.17 - x * 0.57 + s * 2.1)) * 0.5;

function distToPolyline(px: number, py: number, pts: number[][]) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

export function buildFarm(): GameMap {
  const W = 24, H = 20;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // ------------------------------------------------------------ terrain
  // Terrain is a continuous function of position (tile units, fractional),
  // so the client can render smooth organic edges at sub-tile resolution
  // while the server uses the same function per tile for game logic.
  const FIELD: Rect = { x0: 3, y0: 10, x1: 9, y1: 12 };
  const GARDEN: Rect = { x0: 8, y0: 15, x1: 10, y1: 16 };
  const POND = { x: 18.2, y: 16.4, rx: 3.3, ry: 1.9 };
  const ROADS: number[][][] = [
    [[6.5, 6.6], [6.6, 8.4], [11.5, 8.5], [17, 8.6], [24.5, 8.3]], // porch -> road -> town
    [[11.5, 8.5], [11.6, 14], [11.4, 20.5]],                        // south to the park
    [[16, 6], [16.1, 8.4]],                                         // barn door
  ];
  const bbox = (pts: number[][], m: number) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0 - m, y0 - m, x1 + m, y1 + m];
  };
  const roadBoxes = ROADS.map((r) => bbox(r, 2));
  const inRect = (x: number, y: number, r: Rect) => x >= r.x0 && x < r.x1 + 1 && y >= r.y0 && y < r.y1 + 1;
  const fine = (x: number, y: number, s: number) => wobble(x, y, s) + 0.35 * Math.sin(x * 2.9 + y * 2.1 + s);

  const terrainAt = (x: number, y: number): number => {
    let g: number = G.Grass;
    const border = Math.min(x, y, W - x, H - y) + fine(x, y, 11) * 0.6;
    if (border < 2.2) g = G.DarkGrass;
    { const dx = (x - POND.x) / POND.rx, dy = (y - POND.y) / POND.ry;
      if (dx * dx + dy * dy < 1 + fine(x, y, 7) * 0.1) return G.Water; }
    if (inRect(x, y, FIELD) || inRect(x, y, GARDEN)) return G.Field;
    for (let i = 0; i < ROADS.length; i++) {
      const b = roadBoxes[i];
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      const w = i === 2 ? 0.6 : 0.95;
      if (distToPolyline(x, y, ROADS[i]) <= w + fine(x, y, 1) * 0.2) g = G.Dirt;
    }
    if (inRect(x, y, { x0: 5, y0: 6, x1: 7, y1: 6 })) g = G.Stone;   // porch
    return g;
  };

  const ground = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ground[y * W + x] = terrainAt(x + 0.5, y + 0.5);
  const get = (x: number, y: number) => ground[y * W + x];
  const set = (x: number, y: number, g: number) => { if (inb(x, y)) ground[y * W + x] = g; };

  // reserved = no random decoration / trees
  const reserved = new Uint8Array(W * H);
  const reserve = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, y1); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, x1); x++) reserved[y * W + x] = 1;
  };

  // --------------------------------------------------------------- objects
  const objects: MapObject[] = [];
  const decals: MapObject[] = [];
  // o(sprite, column, row): the sprite stands in tile (column,row)
  const o = (s: string, x: number, y: number, f?: boolean) => {
    objects.push(f ? { s, x, y: y + 1, f } : { s, x, y: y + 1 });
  };
  const fence = (x0: number, y0: number, x1: number, y1: number, gaps: [number, number][] = []) => {
    const gap = (x: number, y: number) => gaps.some(([gx, gy]) => gx === x && gy === y);
    for (let x = x0; x <= x1; x++) {
      if (!gap(x, y0)) o('fence_h', x, y0);
      if (!gap(x, y1)) o('fence_h', x, y1);
    }
    for (let y = y0 + 1; y < y1; y++) {
      if (!gap(x0, y)) o('fence_v', x0, y);
      if (!gap(x1, y)) o('fence_v', x1, y);
    }
    reserve(x0, y0 - 1, x1, y1);
  };

  // --- north: farmhouse and yard
  o('house', 6.5, 5);
  o('well', 2.6, 6.2);
  o('bucket', 3.8, 6.5);
  o('firewood', 2.4, 4.4);
  o('logs', 3.6, 3.6);
  o('barrel', 4.2, 4.8);
  o('lamp_post', 4.6, 6.4);
  o('lamp_post', 8.4, 6.4);
  o('flowers_o', 4.2, 5.8);
  o('flowers_y', 8.9, 5.8);
  o('chest_gold', 9, 7);       // shipping bin
  o('seed_bag', 10, 7);        // seed shop
  o('notice', 8, 7.6);
  // orchard corner between house and barn
  o('tree_fruit', 10.4, 4.4);
  o('tree_fruit', 12.6, 3.4);
  o('beehives', 12.8, 5.6);
  o('flower_bush_r', 10.6, 5.8);
  // barn, silo, windmill
  o('barn_red', 16, 5);
  o('silo', 18.8, 5);
  o('windmill', 21, 5.4);
  o('hay_bale', 14, 6.2);
  o('hay_pile', 17.8, 6.6);
  o('cart', 19.8, 7);
  o('sack', 13.6, 7.2);
  o('trough_long', 21.4, 7.2);
  // keep the area under big sprites clear (they are taller than one tile)
  reserve(4, 2, 9, 6); reserve(14, 2, 22, 6); reserve(9, 6, 10, 7);

  // --- middle: crop field (fenced) and animal pen
  fence(2, 9, 10, 13, [[5, 9], [6, 9], [10, 11], [10, 12]]);
  o('scarecrow', 7, 12);
  o('veg_crates', 1.6, 9.4);
  o('lamp_post', 10.6, 9.6);

  fence(13, 9, 20, 13, [[13, 11], [13, 12]]);
  o('coop_small', 17.6, 11.2);
  o('trough_water', 15, 12.4);
  o('trough_feed', 19.2, 12.4);
  o('hay_pile', 19.4, 10.4);
  o('bucket', 14.6, 10.4);
  o('barrel_herb', 21.6, 11.6);
  o('crates', 21.8, 13.2);
  o('hay_bale', 15.4, 10.2);
  o('flowers_y', 14.4, 11.6);
  o('flower_bush_t', 19.6, 11.6);

  // --- south: greenhouse, kitchen garden, beehives, pond
  o('greenhouse', 4.6, 16.4);
  o('planter_sun', 7.2, 14.4);
  o('barrel_herb', 2.2, 15);
  o('tool_rack', 9.6, 13.6);
  o('flower_bush_y', 9, 17.4);
  o('rock_s1', 6.8, 17.6);
  o('beehives', 13.8, 15.6);
  o('flowers_lav', 13.2, 17.4);
  o('table', 15.2, 14.6);       // fishing spot
  o('bucket', 16.4, 14.4);
  o('barrel', 14.2, 14.2);
  o('rock_moss', 21.8, 15);
  o('fern', 20.6, 14.2);
  o('signpost', 22, 7.2);
  o('signpost', 12.8, 18.2);
  reserve(3, 13, 6, 17); reserve(14, 14, 17, 15); reserve(7, 17, 10, 17);

  // keep roads, fields and water free of random stuff
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const g = get(x, y);
      if (g !== G.Grass && g !== G.DarkGrass) reserved[y * W + x] = 1;
    }
  for (const ob of objects) reserve(Math.floor(ob.x) - 1, ob.y - 2, Math.ceil(ob.x) + 1, ob.y - 1);

  const r = rng(20241107);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const free = (x: number, y: number) =>
    inb(x, y) && !reserved[y * W + x] && (get(x, y) === G.Grass || get(x, y) === G.DarkGrass);

  // --- forest border (2 tiles): clumps, then single trees in every gap
  const CLUMPS = ['trees_double', 'trees_cluster', 'tree_round'];
  const TREES = ['tree_round', 'tree_green', 'tree_pine', 'tree_pine2', 'tree_big', 'tree_round', 'tree_green', 'tree_autumn'];
  const placeTree = (name: string, x: number, y: number) => {
    if (!free(x, y)) return;
    o(name, x + (r() - 0.5) * 0.4, y, r() < 0.5);
    reserve(x - 1, y - 1, x + 1, y);
  };
  // trees are ~2.5 tiles tall, so the southern row sits on the very edge to not hide the garden
  const border = (x: number, y: number) => Math.min(x, y, W - 1 - x, H - y);
  for (let y = 1; y < H; y += 2)
    for (let x = 0; x < W; x += 2)
      if (border(x, y) <= 1 && r() < 0.8) placeTree(pick(CLUMPS), x + Math.floor(r() * 2), y + Math.floor(r() * 2));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (border(x, y) <= 1) placeTree(pick(TREES), x, y);

  // --- fill every remaining free tile with something small
  const SMALLS = ['flowers_o', 'flowers_y', 'flowers_lav', 'flower_bush_y', 'flower_bush_r', 'flower_bush_t',
    'bush_a', 'fern', 'plant', 'rock_s1', 'rock_s2', 'stump', 'mushroom', 'mushrooms', 'pebbles', 'stump_moss'];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (free(x, y) && r() < 0.7) { o(pick(SMALLS), x + (r() - 0.5) * 0.4, y, r() < 0.5); reserve(x, y, x, y); }

  // --- tiny ground details (baked into the ground layer, free at runtime)
  const DECALS = ['dec_flower_w0', 'dec_flower_w1', 'dec_flower_y0', 'dec_flower_y1', 'dec_flower_p0', 'dec_flower_b0',
    'dec_flower_r0', 'dec_tuft0', 'dec_tuft1', 'dec_tuft2', 'dec_tuft0', 'dec_tuft1', 'dec_clover', 'dec_pebble'];
  for (let i = 0; i < 650; i++) {
    const x = r() * W, y = r() * H;
    const g = get(Math.floor(x), Math.floor(y));
    if (g !== G.Grass && g !== G.DarkGrass) continue;
    decals.push({ s: pick(DECALS), x: x - 0.5, y: y + 0.3 });
  }

  // objects standing on a field tile make it untillable
  for (const ob of objects) {
    const row = Math.ceil(ob.y) - 1, col = Math.floor(ob.x + 0.5); // tile holding the anchor
    if (inb(col, row) && get(col, row) === G.Field) set(col, row, G.Dirt);
  }

  // a brand-new farm already has something growing
  const starter: StarterPlot[] = [];
  const row = (y: number, x0: number, x1: number, c: string, st: number) => {
    for (let x = x0; x <= x1; x++) if (get(x, y) === G.Field) starter.push({ x, y, c, s: st });
  };
  row(10, 3, 9, 'carrot', 3);
  row(11, 3, 5, 'tomato', 2);
  row(11, 6, 9, 'strawberry', 1);
  row(12, 3, 5, '', 0);
  row(15, 8, 10, 'pumpkin', 3);
  row(16, 8, 10, 'turnip', 1);

  return {
    id: 'farm',
    name: 'Nông trại',
    w: W, h: H, ground, objects, decals, terrainAt, starter,
    courts: [],
    exits: [
      { x0: W - 1, y0: 7, x1: W - 1, y1: 9, to: 'town', label: 'Thành phố' },
      { x0: 10, y0: H - 1, x1: 12, y1: H - 1, to: 'park', label: 'Công viên' },
    ],
    spawn: { x: 6, y: 7 },
    spots: [
      { id: 'ship', x: 9, y: 7 },
      { id: 'shop', x: 10, y: 7 },
    ],
  };
}

export function isTillable(m: GameMap, x: number, y: number) {
  return x >= 0 && y >= 0 && x < m.w && y < m.h && m.ground[y * m.w + x] === G.Field;
}
