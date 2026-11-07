// Farm map ("Nông trại"). Built procedurally from fixed numbers + a seeded
// RNG, so it is identical on client and server. Edit the zone coordinates
// below to reshape the map.
//
// Layout (40x30 tiles, forest all around):
//   north: farmhouse, barn, silo, windmill, orchard + beehives, creek
//   middle: main road (east exit -> town), fenced crop fields, animal pasture
//   south: greenhouse, kitchen garden, tool shed, pond fed by the creek,
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
  const W = 40, H = 30;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // ------------------------------------------------------------ terrain
  // Terrain is a continuous function of position (tile units, fractional),
  // so the client can render smooth organic edges at sub-tile resolution
  // while the server uses the same function per tile for game logic.
  const FIELDS: Rect[] = [
    { x0: 3, y0: 16, x1: 10, y1: 21 },
    { x0: 12, y0: 16, x1: 19, y1: 21 },
  ];
  const GARDEN: Rect = { x0: 10, y0: 26, x1: 15, y1: 27 };          // small kitchen-garden bed
  const CREEK = [[35.5, -0.5], [35, 4], [34, 8.5], [34.6, 13], [33.2, 18], [33.6, 23.5]];
  const POND = { x: 33.8, y: 25.6, rx: 4.0, ry: 2.7 };
  const ROADS: number[][][] = [
    [[9.5, 9.6], [9.5, 12], [12, 13.2], [21.5, 13.2], [29, 13.6], [40.5, 13.2]], // porch -> main road -> town
    [[21.5, 13.2], [21.2, 20], [21.8, 25], [21.5, 30.5]],                     // south to the park
    [[17.5, 8.6], [18, 12.8]],                                                // barn door
    [[25.5, 9], [25.2, 12.8]],                                                // windmill
    [[21.4, 25.5], [16, 25.6], [9, 25.4], [6.5, 26.8]],                       // south lane: garden, shed, greenhouse
    [[11, 14], [11, 22.6]],                                                   // lane between the two fields
  ];
  const bbox = (pts: number[][], m: number) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0 - m, y0 - m, x1 + m, y1 + m];
  };
  const roadBoxes = ROADS.map((r) => bbox(r, 2));
  const creekBox = bbox(CREEK, 2);
  const inRect = (x: number, y: number, r: Rect) => x >= r.x0 && x < r.x1 + 1 && y >= r.y0 && y < r.y1 + 1;
  const fine = (x: number, y: number, s: number) => wobble(x, y, s) + 0.35 * Math.sin(x * 2.9 + y * 2.1 + s);

  const terrainAt = (x: number, y: number): number => {
    let g: number = G.Grass;
    const border = Math.min(x, y, W - x, H - y) + fine(x, y, 11) * 0.7;
    if (border < 3.2) g = G.DarkGrass;
    let water = false;
    { const dx = (x - POND.x) / POND.rx, dy = (y - POND.y) / POND.ry;
      if (dx * dx + dy * dy < 1 + fine(x, y, 7) * 0.1) water = true; }
    if (!water && x >= creekBox[0] && x <= creekBox[2] && y >= creekBox[1] && y <= creekBox[3])
      water = distToPolyline(x, y, CREEK) <= 0.95 + fine(x, y, 5) * 0.2;
    if (water) g = G.Water;
    for (const f of FIELDS) if (inRect(x, y, f)) g = G.Field;
    if (inRect(x, y, GARDEN)) g = G.Field;
    for (let i = 0; i < ROADS.length; i++) {
      const b = roadBoxes[i];
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      const d = distToPolyline(x, y, ROADS[i]);
      const w = i >= 2 ? 0.75 : 1.15; // side lanes are narrower
      if (water) { if (d <= 1.1 && i === 0) return G.Bridge; }
      else if (d <= w + fine(x, y, 1) * 0.25 && g !== G.Field) g = G.Dirt;
    }
    if (inRect(x, y, { x0: 8, y0: 8, x1: 10, y1: 9 })) g = G.Stone;   // porch
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

  // --- farmhouse & yard
  o('house', 9.5, 7);
  o('well', 4.5, 9);
  o('bucket', 6, 9.2);
  o('lamp_post', 7.2, 9);
  o('lamp_post', 11.8, 9);
  o('chest_gold', 13, 9);    // shipping bin
  o('seed_bag', 14.5, 9);    // seed shop
  o('notice', 15.8, 9.2);
  o('barrel', 6.2, 6.6);
  o('barrel2', 5.4, 7.2);
  o('firewood', 3.6, 6.8);
  o('logs', 3.4, 8);
  o('bench', 12.8, 7.3);
  o('flowers_o', 6.8, 7.8);
  o('flowers_y', 12.4, 8);
  o('flower_bush_r', 7.4, 4.6);
  o('flower_bush_y', 11.8, 4.6);
  reserve(3, 3, 16, 10);

  // --- barn, silo, windmill
  o('barn_red', 17.5, 7);
  o('silo', 20.6, 7);
  o('hay_bale', 15.6, 7.4);
  o('hay_pile', 19.6, 8.6);
  o('cart', 22.2, 8.8);
  o('crates', 14.8, 11.4);
  o('trough_long', 19.6, 11);
  o('windmill', 25.5, 8);
  o('sack', 23.8, 8.6);
  o('veg_crates', 27.2, 8.8);
  o('tool_rack', 23.6, 11.2);
  reserve(15, 3, 28, 12);

  // --- orchard + beehives (north-east, along the creek)
  for (const [x, y] of [[28.5, 4], [31, 3.4], [29.6, 6.4], [32.2, 6.2], [30.8, 9.2]]) o('tree_fruit', x, y);
  o('beehives', 27.6, 10.6);
  o('beehives', 32.4, 10.8, true);
  o('flowers_lav', 28.6, 11.4);
  o('flowers_y', 31.2, 11.6);
  reserve(27, 2, 33, 12);

  // --- crop fields (one fence, two fields, lane in the middle)
  fence(2, 15, 20, 22, [[6, 15], [7, 15], [11, 15], [16, 15], [20, 18], [20, 19], [11, 22]]);
  o('scarecrow', 6.5, 20.3);
  o('scarecrow2', 15.5, 20.3);
  o('lamp_post', 11.6, 14.6);
  o('veg_crates', 1.4, 14.4);
  o('sack', 2.6, 14.4);

  // --- animal pasture (pets later), east of the south road
  fence(23, 15, 30, 23, [[23, 19], [23, 20], [26, 15], [27, 15]]);
  o('coop_pen', 27, 18);
  o('trough_water', 25, 21.6);
  o('trough_feed', 28.4, 21.6);
  o('hay_pile', 24.4, 16.6);
  o('hay_bale', 28.8, 16.8);
  o('bucket', 26.4, 22.2);
  o('barrel', 24, 22.2);
  o('flowers_y', 29.2, 19.4);
  o('fern', 24.2, 18.4);

  // --- south: greenhouse, kitchen garden, tool shed, pond
  o('greenhouse', 5.5, 28);
  o('planter_sun', 9, 27.6);
  o('coop_small', 18, 28.2);          // tool shed
  o('logs', 16.2, 28.6);
  o('crate', 19.8, 28.6);
  o('barrel_herb', 2.6, 27.8);
  o('lamp_post', 21.2 - 1.3, 24.6);
  o('table', 27.4, 26.6);             // fishing spot by the pond
  o('bucket', 28.6, 27);
  o('barrel', 26.2, 26.2);
  o('planter_sun', 9, 25.9);
  o('planter_sun', 16.8, 26.4);
  o('rock_moss', 36.8, 22.4);
  o('flowers_lav', 35.4, 27.6);
  o('fern', 28.4, 27.8);
  reserve(2, 24, 29, 29);

  // --- signposts at the exits
  o('signpost', 37.6, 11.6);
  o('signpost', 23.2, 28.6);

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

  // --- dense forest border: big clumps on a loose grid, then single trees
  const CLUMPS = ['trees_double', 'trees_cluster', 'forest_pines', 'tree_round'];
  const TREES = ['tree_round', 'tree_green', 'tree_pine', 'tree_pine2', 'tree_big', 'tree_autumn', 'tree_round'];
  const placeTree = (name: string, x: number, y: number) => {
    if (!free(x, y)) return;
    o(name, x + (r() - 0.5) * 0.5, y, r() < 0.5);
    reserve(x - 1, y - 1, x + 1, y);
  };
  const border = (x: number, y: number) => Math.min(x, y, W - 1 - x, H - 1 - y);
  for (let y = 1; y < H; y += 2)
    for (let x = 0; x < W; x += 2)
      if (border(x, y) <= 2 && r() < 0.85) placeTree(pick(CLUMPS), x + Math.floor(r() * 2), y + Math.floor(r() * 2));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (border(x, y) <= 2 && r() < 0.75) placeTree(pick(TREES), x, y);

  // --- flower patches and greenery filling every free spot near the farm
  const PATCH = ['flowers_o', 'flowers_y', 'flowers_lav', 'flower_bush_r', 'flower_bush_y', 'flower_bush_t'];
  for (let i = 0; i < 40; i++) {
    const cx = Math.floor(r() * W), cy = Math.floor(r() * H), kind = pick(PATCH);
    for (let k = 0; k < 4; k++) {
      const x = cx + Math.floor(r() * 3) - 1, y = cy + Math.floor(r() * 3) - 1;
      if (free(x, y)) { o(kind, x + (r() - 0.5) * 0.4, y, r() < 0.5); reserve(x, y, x, y); }
    }
  }
  const SMALLS = ['bush_a', 'bush_b', 'flower_bush_y', 'flower_bush_r', 'flower_bush_t', 'fern', 'plant',
    'rock_s1', 'rock_s2', 'stump', 'mushroom', 'mushrooms', 'rock_moss', 'stump_moss', 'pebbles'];
  for (let i = 0; i < 1500; i++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    if (!free(x, y)) continue;
    o(pick(SMALLS), x, y, r() < 0.5);
    reserve(x, y, x, y);
  }

  // --- tiny ground details (baked into the ground layer, free at runtime)
  const DECALS = ['dec_flower_w0', 'dec_flower_w1', 'dec_flower_y0', 'dec_flower_y1', 'dec_flower_p0', 'dec_flower_b0',
    'dec_flower_r0', 'dec_tuft0', 'dec_tuft1', 'dec_tuft2', 'dec_tuft0', 'dec_tuft1', 'dec_clover', 'dec_pebble'];
  for (let i = 0; i < 1100; i++) {
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

  return {
    id: 'farm',
    name: 'Nông trại',
    w: W, h: H, ground, objects, decals, terrainAt,
    courts: [],
    exits: [
      { x0: W - 1, y0: 12, x1: W - 1, y1: 14, to: 'town', label: 'Thành phố' },
      { x0: 20, y0: H - 1, x1: 22, y1: H - 1, to: 'park', label: 'Công viên' },
    ],
    spawn: { x: 9, y: 10 },
    spots: [
      { id: 'ship', x: 13, y: 9 },
      { id: 'shop', x: 14, y: 9 },
    ],
  };
}

export function isTillable(m: GameMap, x: number, y: number) {
  return x >= 0 && y >= 0 && x < m.w && y < m.h && m.ground[y * m.w + x] === G.Field;
}
