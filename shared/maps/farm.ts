// Farm map ("Nông trại"). Built procedurally from fixed numbers + a seeded
// RNG, so it is identical on client and server. Edit the zone coordinates
// below to reshape the map.
//
// Layout (24x17 tiles, built from the user's sheet-4 ground tiles):
//   north: farmhouse + yard, barn, silo, windmill, orchard
//   middle: dirt road west-east (exit -> town), crossroads
//   south-west: crop field (dirt area with ploughed beds), greenhouse
//   south-east: fish pond scene; path south (exit -> park)

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
  /** ground tile per cell (atlas name, optional '|h' '|v' '|hv' mirror) — tile-based maps */
  tiles?: string[];
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
  const W = 24, H = 17;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const idx = (x: number, y: number) => y * W + x;

  // ------------------------------------------------------------- ground
  const FIELD: Rect = { x0: 2, y0: 10, x1: 9, y1: 14 };           // dirt area incl. grassy rim
  const BEDS: Rect = { x0: 3, y0: 11, x1: 8, y1: 13 };            // tillable interior
  const ROAD_Y = 8;
  const PATHS_V = [                                               // [x, y0, y1]
    [5, 6, ROAD_Y], [12, 6, H - 1],
  ];
  const r = rng(20241107);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];

  const path = new Uint8Array(W * H);
  for (let x = 2; x < W; x++) path[idx(x, ROAD_Y)] = 1;
  for (const [x, y0, y1] of PATHS_V) for (let y = y0; y <= y1; y++) path[idx(x, y)] = 1;
  const isPath = (x: number, y: number) => inb(x, y) && path[idx(x, y)] === 1;

  const inRect = (x: number, y: number, q: Rect) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1;
  const tiles: string[] = new Array(W * H);
  const ground = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let t = r() < 0.9 ? 'gt_grass0' : r() < 0.6 ? 'gt_grass2' : 'gt_grass3';
      let g: number = G.Grass;
      if (inRect(x, y, FIELD)) {
        g = G.Dirt;
        const L = x === FIELD.x0, R = x === FIELD.x1, T = y === FIELD.y0, B = y === FIELD.y1;
        if (T && L) t = 'gt_dirt_tl';
        else if (T && R) t = 'gt_dirt_tl|h';
        else if (B && L) t = 'gt_dirt_tl|v';
        else if (B && R) t = 'gt_dirt_tl|hv';
        else if (T) t = 'gt_dirt_t';
        else if (B) t = 'gt_dirt_t|v';
        else if (L) t = r() < 0.5 ? 'gt_dirt_l' : 'gt_dirt_l2';
        else if (R) t = (r() < 0.5 ? 'gt_dirt_l' : 'gt_dirt_l2') + '|h';
        else t = 'gt_dirt';
        if (inRect(x, y, BEDS)) g = G.Field;
      } else if (isPath(x, y)) {
        g = G.Dirt;
        const n = isPath(x, y - 1), s = isPath(x, y + 1), e = isPath(x + 1, y), w = isPath(x - 1, y);
        if ((n || s) && (e || w)) t = 'gt_path_x';
        else if (e || w) t = 'gt_path_h';
        else t = r() < 0.5 ? 'gt_path_v' : 'gt_path_v2';
      }
      tiles[idx(x, y)] = t;
      ground[idx(x, y)] = g;
    }
  const terrainAt = (x: number, y: number): number => {
    const tx = Math.floor(x), ty = Math.floor(y);
    return inb(tx, ty) ? ground[idx(tx, ty)] : G.Grass;
  };
  const get = (x: number, y: number) => ground[idx(x, y)];
  const set = (x: number, y: number, g: number) => { if (inb(x, y)) ground[idx(x, y)] = g; };

  const reserved = new Uint8Array(W * H);
  const reserve = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, y1); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, x1); x++) reserved[idx(x, y)] = 1;
  };

  // --------------------------------------------------------------- objects
  const objects: MapObject[] = [];
  const decals: MapObject[] = [];
  // o(sprite, column, row): the sprite stands in tile (column,row)
  const o = (s: string, x: number, y: number, f?: boolean) => {
    objects.push(f ? { s, x, y: y + 1, f } : { s, x, y: y + 1 });
  };

  // --- farmhouse & yard (north-west)
  o('house', 5, 5);
  o('well', 2.6, 6.2);
  o('firewood', 2.6, 4.4);
  o('barrel', 8.2, 5.4);
  o('crate', 9.1, 5.6);
  o('lamp_post', 4.2, 7);
  o('lamp_post', 5.8, 7);
  o('chest_gold', 7.3, 7);        // shipping bin
  o('seed_bag', 8.6, 7);          // seed shop
  o('flower_bush_r', 3.2, 7.3);
  o('flowers_y', 7, 5.9);
  o('tree_fruit', 10.2, 4.4);
  o('bench', 9.8, 6.6);
  reserve(2, 2, 11, 7);

  // --- barn, silo, windmill (north-east)
  o('barn_red', 12, 5);
  o('hay_bale', 14.4, 6.3);
  o('silo', 15.6, 5);
  o('windmill', 19, 5.6);
  o('flowers_lav', 17.4, 6.6);
  reserve(11, 2, 21, 7);

  // --- crop field (south-west)
  o('sign', 5, 9.3);              // field sign (covers the crossing stub)
  o('scarecrow', 9, 11.2);
  o('barrel_herb', 10.6, 12.2);
  o('flower_bush_y', 10.6, 14.2);
  reserve(2, 9, 11, 15);

  // --- fish pond (south-east): painted scene from the user's pond sheet
  const scenes: MapObject[] = [{ s: 'pond_scene', x: 18.6, y: 16.3 }];
  o('bench', 15, 9.4);
  o('beehives', 21.2, 9.4);
  o('signpost', 13.6, 15.4);
  o('signpost', 22.4, 7.2);
  reserve(13, 9, 23, 16);

  // keep paths, field and water free of random stuff
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (get(x, y) !== G.Grass) reserved[idx(x, y)] = 1;
  for (const ob of objects) reserve(Math.floor(ob.x), Math.ceil(ob.y) - 1, Math.ceil(ob.x), Math.ceil(ob.y) - 1);
  const free = (x: number, y: number) => inb(x, y) && !reserved[idx(x, y)] && get(x, y) === G.Grass;

  // --- forest around the farm (exits stay open)
  const CLUMPS = ['trees_double', 'trees_cluster', 'tree_round', 'forest_pines'];
  const TREES = ['tree_round', 'tree_green', 'tree_pine', 'tree_pine2', 'tree_big', 'tree_autumn', 'tree_round', 'tree_green'];
  const exit = (x: number, y: number) => (Math.abs(y - ROAD_Y) <= 1 && x > W - 4) || (Math.abs(x - 12) <= 1 && y > H - 4);
  const border = (x: number, y: number) => Math.min(x, y, W - 1 - x, (H - 1 - y) * 2);
  const placeTree = (name: string, x: number, y: number) => {
    if (!free(x, y) || exit(x, y)) return;
    o(name, x + (r() - 0.5) * 0.4, y, r() < 0.5);
    reserve(x - 1, y - 1, x + 1, y);
  };
  for (let y = 1; y < H; y += 2)
    for (let x = 0; x < W; x += 2)
      if (border(x, y) <= 1 && r() < 0.8) placeTree(pick(CLUMPS), x + Math.floor(r() * 2), y + Math.floor(r() * 2));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (border(x, y) <= 1) placeTree(pick(TREES), x, y);

  // --- small greenery: dense in the forest strip, sparse inside
  const SMALLS = ['flowers_o', 'flowers_y', 'flower_bush_y', 'flower_bush_r', 'bush_a', 'rock_s1', 'stump', 'mushroom'];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (free(x, y) && r() < (border(x, y) <= 2 ? 0.5 : 0.06)) { o(pick(SMALLS), x + (r() - 0.5) * 0.3, y, r() < 0.5); reserve(x, y, x, y); }

  // --- ground details from the user's sheet (flowers, clover, leaves, pebbles)
  const DECALS = ['d_flower_y', 'd_flower_w', 'd_flower_r', 'd_flower_o', 'd_clover', 'd_clover2', 'd_clover3',
    'd_clover_s', 'd_sprouts', 'd_tuft', 'd_tuft2', 'd_leaves_g', 'd_leaves_o', 'd_pebbles', 'd_moss'];
  for (let i = 0; i < 110; i++) {
    const x = r() * W, y = r() * H;
    if (get(Math.floor(x), Math.floor(y)) !== G.Grass) continue;
    decals.push({ s: pick(DECALS), x: x - 0.5, y: y + 0.3 });
  }

  // objects standing on a bed tile make it untillable
  for (const ob of objects) {
    const row = Math.ceil(ob.y) - 1, col = Math.floor(ob.x + 0.5);
    if (inb(col, row) && get(col, row) === G.Field) set(col, row, G.Dirt);
  }

  const starter: StarterPlot[] = [];
  const row = (y: number, x0: number, x1: number, c: string, st: number) => {
    for (let x = x0; x <= x1; x++) if (get(x, y) === G.Field) starter.push({ x, y, c, s: st });
  };
  row(11, 3, 8, 'carrot', 3);
  row(12, 3, 5, 'tomato', 2);
  row(12, 6, 8, 'strawberry', 1);
  row(13, 3, 4, 'pumpkin', 3);
  row(13, 5, 6, '', 0);

  return {
    id: 'farm',
    name: 'Nông trại',
    w: W, h: H, ground, objects, decals, scenes, tiles, terrainAt, starter,
    courts: [],
    exits: [
      { x0: W - 1, y0: ROAD_Y - 1, x1: W - 1, y1: ROAD_Y + 1, to: 'town', label: 'Thành phố' },
      { x0: 11, y0: H - 1, x1: 13, y1: H - 1, to: 'park', label: 'Công viên' },
    ],
    spawn: { x: 5, y: 7 },
    spots: [
      { id: 'ship', x: 7, y: 7 },
      { id: 'shop', x: 9, y: 7 },
    ],
  };
}

export function isTillable(m: GameMap, x: number, y: number) {
  return x >= 0 && y >= 0 && x < m.w && y < m.h && m.ground[y * m.w + x] === G.Field;
}
