// Farm map ("Nông trại"). Built procedurally from fixed numbers + a seeded
// RNG, so it is identical on client and server. Edit the zone coordinates
// below to reshape the map.
//
// Layout (26x23 tiles). The whole farm is fenced; a cross of dirt roads
// splits it into four clear zones:
//
//   +----------------------+----------------------+
//   |  house yard          |  animal pen (fenced) |
//   |  well, shipping bin  |  barn, silo, coop    |
//   +------- road ---------+------ road --> town  |
//   |  garden (fenced)     |  fish pond (painted  |
//   |  field, greenhouse   |  scene: docks, lilies)|
//   +--------- road to the park (south gate) -----+

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
  /** large painted ground scenes (e.g. the pond); their atlas mask marks water */
  scenes: MapObject[];
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
  const W = 26, H = 23;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // ------------------------------------------------------------ zones
  const FARM: Rect = { x0: 2, y0: 2, x1: 23, y1: 19 };          // perimeter fence
  const PEN: Rect = { x0: 14, y0: 2, x1: 23, y1: 8 };           // animal pen (shares the perimeter)
  const GARDEN: Rect = { x0: 2, y0: 11, x1: 11, y1: 19 };       // garden fence (shares the perimeter)
  const FIELD: Rect = { x0: 4, y0: 12, x1: 10, y1: 14 };        // tillable soil
  const HERBS: Rect = { x0: 8, y0: 16, x1: 10, y1: 17 };        // small herb/veg beds
  const ROADS: number[][][] = [
    [[6.5, 7.6], [6.5, 9.6], [12.5, 9.7], [26.5, 9.6]],         // porch -> road -> east gate (town)
    [[12.5, 9.7], [12.6, 15], [12.5, 23.5]],                    // south gate (park)
    [[17.8, 8.4], [17.8, 9.6], [18.1, 12.9]],                   // pen gate -> across the road -> pond dock
    [[7.5, 10], [7.5, 11.4]],                                   // garden gate
  ];

  // ------------------------------------------------------------ terrain
  // Continuous terrain function (tile units): the client renders it at
  // sub-tile resolution for smooth edges, the server samples it per tile.
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
    // forest floor outside the fence
    if (x < FARM.x0 + 0.3 || y < FARM.y0 + 0.3 || x > FARM.x1 + 0.7 || y > FARM.y1 + 0.7) g = G.DarkGrass;
    if (inRect(x, y, FIELD) || inRect(x, y, HERBS)) return G.Field;
    for (let i = 0; i < ROADS.length; i++) {
      const b = roadBoxes[i];
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      const w = i >= 2 ? 0.6 : 0.95;
      if (distToPolyline(x, y, ROADS[i]) <= w + fine(x, y, 1) * 0.18) g = G.Dirt;
    }
    if (inRect(x, y, { x0: 5, y0: 7, x1: 7, y1: 7 })) g = G.Stone;   // porch
    return g;
  };

  const ground = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ground[y * W + x] = terrainAt(x + 0.5, y + 0.5);
  const get = (x: number, y: number) => ground[y * W + x];
  const set = (x: number, y: number, g: number) => { if (inb(x, y)) ground[y * W + x] = g; };

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
  /** fence segments; `sides` limits which sides are drawn (shared sides are drawn once) */
  const fence = (r: Rect, gaps: [number, number][] = [], sides = 'nswe') => {
    const gap = (x: number, y: number) => gaps.some(([gx, gy]) => gx === x && gy === y);
    for (let x = r.x0; x <= r.x1; x++) {
      if (sides.includes('n') && !gap(x, r.y0)) o('fence_h', x, r.y0);
      if (sides.includes('s') && !gap(x, r.y1)) o('fence_h', x, r.y1);
    }
    for (let y = r.y0 + 1; y < r.y1; y++) {
      if (sides.includes('w') && !gap(r.x0, y)) o('fence_v', r.x0, y);
      if (sides.includes('e') && !gap(r.x1, y)) o('fence_v', r.x1, y);
    }
  };

  // --- fences: farm perimeter (gates east + south), pen, garden
  fence(FARM, [[23, 9], [23, 10], [12, 19], [13, 19]]);
  fence(PEN, [[17, 8], [18, 8]], 'sw');
  fence(GARDEN, [[7, 11], [8, 11]], 'ne');
  o('lamp_post', 23.4, 8.2);
  o('lamp_post', 23.4, 11.2);
  o('lamp_post', 11.4, 19.4);
  o('lamp_post', 14.6, 19.4);
  o('signpost', 24.6, 8.6);
  o('signpost', 15.2, 20.6);

  // --- house yard (north-west)
  o('house', 6.5, 6);
  o('well', 3.4, 7.4);
  o('bucket', 4.5, 7.6);
  o('firewood', 3.4, 4.2);
  o('logs', 3.6, 5.6);
  o('barrel', 9.5, 5.2);
  o('barrel2', 10.3, 5.6);
  o('crate', 11.4, 5.4);
  o('lamp_post', 4.6, 7.4);
  o('lamp_post', 8.4, 7.4);
  o('chest_gold', 9, 8);        // shipping bin
  o('seed_bag', 10, 8);         // seed shop
  o('notice', 11.2, 8.2);
  o('tree_fruit', 10.8, 3.6);
  o('flower_bush_r', 4.2, 6.2);
  o('flowers_y', 8.8, 6.6);
  o('flowers_o', 5.2, 8.4);
  o('bench', 12.4, 6.8);
  reserve(3, 2, 13, 8);

  // --- animal pen (north-east)
  o('barn_red', 16.4, 5.6);
  o('silo', 19.2, 5.6);
  o('coop_small', 21.6, 6.4);
  o('trough_water', 15.6, 7.4);
  o('trough_feed', 20.4, 7.6);
  o('hay_pile', 22.4, 4.4);
  o('hay_bale', 21.4, 3.6);
  o('bucket', 19.4, 7.6);
  reserve(14, 2, 23, 8);

  // --- garden (south-west)
  o('scarecrow', 7, 13);
  o('greenhouse', 5, 18.2);
  o('planter_sun', 8.6, 18.4);
  o('planter_sun', 10.4, 18.4);
  o('tool_rack', 9.8, 15);
  o('hay_pile', 3.4, 15.4);       // compost heap
  o('bucket', 7.4, 15.4);
  o('veg_crates', 3.6, 16.6);
  o('barrel_herb', 3.2, 11.8);
  reserve(3, 11, 11, 19);

  // --- fish pond (south-east): a painted scene with bank, lily pads, reeds,
  // three wooden docks, posts, a boat and a fishing spot. Its water mask
  // (from the atlas) makes the water solid; docks and banks stay walkable.
  const scenes: MapObject[] = [{ s: 'pond_scene', x: 17.75, y: 19 }];
  o('sign', 15.4, 11.3);           // "Ao cá"
  o('sack', 14.4, 11.5);
  o('bucket', 19.6, 11.6);
  o('barrel', 20.6, 11.3);
  o('bench', 22, 11.6);
  o('flowers_y', 16.6, 11.2);
  o('fern', 13.7, 17.6);
  o('mushrooms', 13.7, 15.4);
  o('flower_bush_t', 22.6, 14.6);
  o('flowers_lav', 22.6, 17.4);
  reserve(14, 11, 23, 19);

  // keep roads, fields and water free of random stuff
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const g = get(x, y);
      if (g !== G.Grass && g !== G.DarkGrass) reserved[y * W + x] = 1;
    }
  for (const ob of objects) reserve(Math.floor(ob.x), ob.y - 1, Math.ceil(ob.x), ob.y - 1);

  const r = rng(20241107);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const free = (x: number, y: number) =>
    inb(x, y) && !reserved[y * W + x] && (get(x, y) === G.Grass || get(x, y) === G.DarkGrass);

  // --- forest outside the fence (the southern row sits on the very edge)
  const CLUMPS = ['trees_double', 'trees_cluster', 'tree_round'];
  const TREES = ['tree_round', 'tree_green', 'tree_pine', 'tree_pine2', 'tree_big', 'tree_round', 'tree_green', 'tree_autumn'];
  const outside = (x: number, y: number) => x < FARM.x0 || x > FARM.x1 || y < FARM.y0 || y > FARM.y1 + 1;
  const placeTree = (name: string, x: number, y: number) => {
    if (!free(x, y) || !outside(x, y)) return;
    o(name, x + (r() - 0.5) * 0.4, y, r() < 0.5);
    reserve(x - 1, y - 1, x + 1, y);
  };
  for (let y = 1; y < H; y += 2)
    for (let x = 0; x < W; x += 2)
      if (y < FARM.y1 && r() < 0.8) placeTree(pick(CLUMPS), x + Math.floor(r() * 2), y + Math.floor(r() * 2));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (y <= FARM.y1 || y === H - 1) placeTree(pick(TREES), x, y);

  // --- small greenery on the remaining free grass (fills the gaps between zones)
  const SMALLS = ['flowers_o', 'flowers_y', 'flower_bush_y', 'flower_bush_r', 'bush_a', 'fern', 'rock_s1', 'stump', 'mushroom', 'pebbles'];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (free(x, y) && r() < 0.6) { o(pick(SMALLS), x + (r() - 0.5) * 0.3, y, r() < 0.5); reserve(x, y, x, y); }

  // --- tiny ground details (baked into the ground layer, free at runtime)
  const DECALS = ['d_flower_y', 'd_flower_w', 'd_flower_r', 'd_flower_o', 'd_clover_s', 'd_clover', 'd_clover2',
    'd_clover3', 'd_sprouts', 'd_sprouts', 'd_tuft', 'd_tuft2', 'd_tuft', 'd_leaves_g', 'd_leaves_o', 'd_pebbles',
    'd_moss', 'd_moss2', 'd_mushroom', 'dec_tuft0', 'dec_tuft1', 'dec_tuft2'];
  for (let i = 0; i < 260; i++) {
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
  row(12, 4, 10, 'carrot', 3);
  row(13, 4, 6, 'tomato', 2);
  row(13, 8, 10, 'strawberry', 1);
  row(14, 4, 6, '', 0);
  row(16, 8, 10, 'pumpkin', 3);
  row(17, 8, 10, 'turnip', 1);

  return {
    id: 'farm',
    name: 'Nông trại',
    w: W, h: H, ground, objects, decals, scenes, terrainAt, starter,
    courts: [],
    exits: [
      { x0: W - 1, y0: 8, x1: W - 1, y1: 11, to: 'town', label: 'Thành phố' },
      { x0: 11, y0: H - 1, x1: 14, y1: H - 1, to: 'park', label: 'Công viên' },
    ],
    spawn: { x: 6, y: 9 },
    spots: [
      { id: 'ship', x: 9, y: 8 },
      { id: 'shop', x: 10, y: 8 },
    ],
  };
}

export function isTillable(m: GameMap, x: number, y: number) {
  return x >= 0 && y >= 0 && x < m.w && y < m.h && m.ground[y * m.w + x] === G.Field;
}
