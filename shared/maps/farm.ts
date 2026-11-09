// Farm map ("Nông trại"). Built procedurally from fixed numbers + a seeded
// RNG, so it is identical on client and server. Edit the zone coordinates
// below to reshape the map.
//
// Layout (24x17 tiles, built from the user's sheet-4 ground tiles):
//   north-west: farmhouse + yard, orchard   north-east: fenced livestock pen (cows, pigs)
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
  /** fine planting grid (world px origin, cell size in px). Plot keys are
   *  "col,row" in this grid; without it plots use map tiles. */
  plotGrid?: { x: number; y: number; cell: number; cols: number; rows: number };
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
    [5, 6, ROAD_Y], [12, 8, H - 1], [16, 7, ROAD_Y],   // house, south lane, pen gate
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
  o('flower_bush_r', 3.2, 7.3);
  o('flowers_y', 7, 5.9);
  o('flowers_o', 3.2, 5.6);
  o('flowers_lav', 6.8, 4.9);
  o('tree_fruit', 10.2, 4.4);
  o('bench', 9.8, 6.6);
  reserve(2, 2, 11, 7);

  // --- livestock pen (north-east): open grass inside a fence, gate onto the road
  const PEN: Rect = { x0: 12, y0: 1, x1: 21, y1: 7 };   // top fence right under the tree line
  const gate = (x: number, y: number) => y === PEN.y1 && (x === 16);
  for (let x = PEN.x0; x <= PEN.x1; x++) {
    o('fence_h', x, PEN.y0);
    if (!gate(x, PEN.y1)) o('fence_h', x, PEN.y1);
  }
  // side rails run all the way to the bottom fence: no gap at the corners
  for (let y = PEN.y0 + 1; y <= PEN.y1; y++) { o('fence_v', PEN.x0, y); o('fence_v', PEN.x1, y); }
  reserve(11, 1, 22, 7);

  // --- crop field (south-west)
  o('sign', 5, 9.3);              // field sign (covers the crossing stub)
  o('scarecrow', 9, 11.2);
  o('barrel_herb', 10.6, 12.2);
  o('flower_bush_y', 10.6, 14.2);
  reserve(2, 9, 11, 15);

  // --- fish pond (south-east): painted scene from the user's pond sheet
  const scenes: MapObject[] = [{ s: 'pond_scene', x: 18.6, y: 16.3 }];
  o('bench', 15, 9.4);
  o('flowers_lav', 14, 10.4);
  o('flowers_o', 16.4, 9.6);
  o('flower_bush_t', 22.2, 10.6);
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
  // dense forest: big clumps on the outer ring, then single big trees fill a
  // 3-tile deep belt, plus a few groves inside the farm
  for (let y = 1; y < H; y += 2)
    for (let x = 0; x < W; x += 2)
      if (border(x, y) <= 2 && r() < 0.9) placeTree(pick(CLUMPS), x + Math.floor(r() * 2), y + Math.floor(r() * 2));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (border(x, y) <= 2) placeTree(pick(TREES), x, y);
  // trees standing above the top edge: their canopies frame the top of the map
  for (let x = 0; x < W; x += 2) o(pick(TREES), x + 0.5, -1, r() < 0.5);
  // close the pen's back side: a dense double row of big trees behind its fence
  for (let x = 11; x <= 22; x += 1.5) o(pick(TREES), x + (r() - 0.5) * 0.3, 0, r() < 0.5);
  for (let x = 11.75; x <= 22; x += 1.5) o(pick(CLUMPS), x, -1.6, r() < 0.5);
  for (let y = 1; y < H; y += 2) { o(pick(TREES), -1, y, r() < 0.5); if (y < 9) o(pick(TREES), W, y, r() < 0.5); }
  for (let x = 1; x < 11; x += 2) o(pick(TREES), x, H, r() < 0.5);
  for (const [gx, gy] of [[10, 15], [11, 9], [22, 15], [2, 9], [10, 2], [8, 15]] as [number, number][])
    placeTree(pick(TREES), gx, gy);

  // --- small greenery: dense in the forest strip, sparse inside
  const SMALLS = ['flower_bush_y', 'flower_bush_r', 'flower_bush_t', 'bush_a'];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (free(x, y) && border(x, y) <= 1 && r() < 0.35) { o(pick(SMALLS), x + (r() - 0.5) * 0.3, y, r() < 0.5); reserve(x, y, x, y); }

  // objects standing on a bed tile make it untillable
  for (const ob of objects) {
    const row = Math.ceil(ob.y) - 1, col = Math.floor(ob.x + 0.5);
    if (inb(col, row) && get(col, row) === G.Field) set(col, row, G.Dirt);
  }

  // planting grid: 24px plots (rounded, spaced) inside the bed area
  const CELL = 24;
  const plotGrid = {
    x: BEDS.x0 * 32, y: BEDS.y0 * 32, cell: CELL,
    cols: Math.floor(((BEDS.x1 - BEDS.x0 + 1) * 32) / CELL), rows: Math.floor(((BEDS.y1 - BEDS.y0 + 1) * 32) / CELL),
  };
  const starter: StarterPlot[] = [];
  const row = (r: number, c0: number, c1: number, c: string, st: number) => {
    for (let x = c0; x <= c1; x++) starter.push({ x, y: r, c, s: st });
  };
  row(0, 0, 7, 'carrot', 3);
  row(1, 0, 3, 'tomato', 2);
  row(1, 4, 7, 'strawberry', 1);
  row(2, 0, 4, 'rice', 3);
  row(2, 5, 7, 'rice', 2);
  row(3, 0, 2, '', 0);

  return {
    id: 'farm',
    name: 'Nông trại',
    w: W, h: H, ground, objects, decals, scenes, tiles, terrainAt, starter, plotGrid,
    courts: [],
    exits: [
      { x0: W - 1, y0: ROAD_Y - 1, x1: W - 1, y1: ROAD_Y + 1, to: 'town', label: 'Thành phố' },
      { x0: 11, y0: H - 1, x1: 13, y1: H - 1, to: 'park', label: 'Công viên' },
    ],
    spawn: { x: 5, y: 7 },
    spots: [
      { id: 'ship', x: 7, y: 7 },
      // the farmhouse is the storehouse: its door and front wall
      { id: 'store', x: 4, y: 5 }, { id: 'store', x: 5, y: 5 }, { id: 'store', x: 6, y: 5 },
      { id: 'store', x: 5, y: 6 },
    ],
  };
}

export function isTillable(m: GameMap, x: number, y: number) {
  if (m.plotGrid) return x >= 0 && y >= 0 && x < m.plotGrid.cols && y < m.plotGrid.rows;
  return x >= 0 && y >= 0 && x < m.w && y < m.h && m.ground[y * m.w + x] === G.Field;
}
