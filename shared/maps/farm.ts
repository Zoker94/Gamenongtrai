// Farm map ("Nông trại"). Built procedurally from fixed numbers + a seeded
// RNG, so it is identical on client and server. Edit the zone coordinates
// below to reshape the map.

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
  const W = 64, H = 44;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // ------------------------------------------------------------ terrain
  // Terrain is a continuous function of position (tile units, fractional),
  // so the client can render smooth organic edges at sub-tile resolution
  // while the server uses the same function per tile for game logic.
  const CLIFF_X0 = 31, CLIFF_Y = 6;                      // cliff rows 6 (top) and 7 (face)
  const STAIRS: Rect = { x0: 46, y0: 6, x1: 47, y1: 7 };
  const RIVER = [[41.5, 7.9], [42.5, 13], [41, 19], [39.5, 24], [37, 30], [35.5, 36], [33.5, 44.5]];
  const FIELDS: Rect[] = [
    { x0: 3, y0: 20, x1: 11, y1: 28 },
    { x0: 15, y0: 20, x1: 23, y1: 28 },
  ];
  const COURT: Rect = { x0: 48, y0: 28, x1: 60, y1: 35 };
  const ROADS: number[][][] = [
    [[9.5, 10.5], [9.5, 15], [13, 18], [20, 18.5], [27, 19], [34, 20], [40, 21], [47, 20.5], [55, 21], [64.5, 20.5]], // main E-W
    [[27, 19], [27.5, 25], [26, 31], [29, 36], [30.5, 44.5]],   // south to the park
    [[50, 3.5], [47, 4.5], [47, 8], [46.5, 12], [47.5, 16], [47, 20.5]], // plateau, stairs, road
    [[47, 20.5], [45.8, 25], [45.5, 31.5], [48, 31.5]],         // to the arena gate
    [[27.5, 24], [32, 26.5]],                                   // camp spur
    [[13, 18], [13, 30.5], [7.5, 30.5]],                        // between the fields, on to the coop
    [[17, 9.8], [17, 11.5]],                                    // barn door
  ];
  // bounding boxes so most points skip most strokes
  const bbox = (pts: number[][], m: number) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0 - m, y0 - m, x1 + m, y1 + m];
  };
  const roadBoxes = ROADS.map((r) => bbox(r, 2));
  const riverBox = bbox(RIVER, 2.5);
  const inRect = (x: number, y: number, r: Rect) => x >= r.x0 && x < r.x1 + 1 && y >= r.y0 && y < r.y1 + 1;
  const fine = (x: number, y: number, s: number) => wobble(x, y, s) + 0.35 * Math.sin(x * 2.9 + y * 2.1 + s);

  const terrainAt = (x: number, y: number): number => {
    if (x >= CLIFF_X0 && y >= CLIFF_Y && y < CLIFF_Y + 2) {
      if (inRect(x, y, STAIRS)) return G.Stairs;
      return y < CLIFF_Y + 1 ? G.CliffTop : G.CliffFace;
    }
    let g: number = G.Grass;
    const border = Math.min(x, y, W - x, H - y) + fine(x, y, 11) * 0.8;
    if (border < 3) g = G.DarkGrass;
    // tall grass meadow
    { const dx = (x - 33.5) / 5.6, dy = (y - 14) / 4.7;
      if (dx * dx + dy * dy < 1 + fine(x, y, 3) * 0.12) g = G.TallGrass; }
    // pond
    let water = false;
    { const dx = (x - 20.5) / 4.6, dy = (y - 37.5) / 3.1;
      if (dx * dx + dy * dy < 1 + fine(x, y, 7) * 0.1) water = true; }
    // river (only below the cliff)
    if (!water && y >= CLIFF_Y + 1.9 && x >= riverBox[0] && x <= riverBox[2] && y >= riverBox[1] && y <= riverBox[3])
      water = distToPolyline(x, y, RIVER) <= 1.3 + fine(x, y, 5) * 0.3;
    if (water) g = G.Water;
    for (const f of FIELDS) if (inRect(x, y, f)) g = G.Field;
    if (inRect(x, y, COURT)) g = G.Sand;
    { const dx = (x - 54.5) / 6.2, dy = (y - 14.6) / 3.2;   // training yard
      if (dx * dx + dy * dy < 1 + fine(x, y, 9) * 0.1) g = G.Sand; }
    for (let i = 0; i < ROADS.length; i++) {
      const b = roadBoxes[i];
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      const d = distToPolyline(x, y, ROADS[i]);
      if (water) { if (d <= 1.1) return G.Bridge; }
      else if (d <= 1.2 + fine(x, y, 1) * 0.3 && g !== G.Field && g !== G.Sand) g = G.Dirt;
    }
    if (inRect(x, y, { x0: 8, y0: 9, x1: 10, y1: 10 })) g = G.Stone;   // porch
    return g;
  };

  const ground = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ground[y * W + x] = terrainAt(x + 0.5, y + 0.5);
  const get = (x: number, y: number) => ground[y * W + x];
  const set = (x: number, y: number, g: number) => { if (inb(x, y)) ground[y * W + x] = g; };

  // reserved = no random decoration / trees (paths, zones, buildings)
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

  // --- farmstead (north-west)
  o('house', 9, 8);
  o('barn_red', 17, 8);
  o('silo', 21, 8);
  o('windmill', 25, 9);
  o('well', 4, 10);
  o('bucket', 5.6, 10);
  o('lamp_post', 7, 10);
  o('lamp_post', 11, 10);
  o('chest_gold', 12, 10);   // shipping bin
  o('seed_bag', 14, 10);       // seed shop
  o('barrel', 6, 7.4);
  o('firewood', 2.5, 8);
  o('crate', 13, 7.5);
  o('tool_rack', 23, 10.4);
  o('cart', 20, 10.2);
  o('hay_bale', 14.5, 8);
  o('planter_sun', 3, 12);
  // orchard + beehives behind the farmstead
  for (const [x, y] of [[13, 4], [16, 3.4], [19, 4.2], [22, 3.6]]) o('tree_fruit', x, y);
  o('beehives', 25.5, 5.6);
  o('beehives', 27.4, 6.2, true);
  o('planter_sun', 13.5, 6.4);
  o('flower_bush_r', 4.5, 5);
  o('flowers_y', 5.6, 5.4);
  o('notice', 5.8, 11.4);
  o('logs', 2.8, 9.6);
  o('trough_long', 22.6, 10.6);
  o('planter_sun', 14.2, 12.2);
  reserve(2, 3, 26, 11);

  // --- pet pasture (fenced, east of the farmstead)
  fence(16, 12, 26, 17, [[20, 12], [21, 12], [26, 15]]);
  o('trough_water', 18, 13);
  o('trough_feed', 24, 13);
  o('hay_pile', 25, 16);
  o('table', 18.5, 16);
  o('crates', 22.5, 16);
  o('barrel_herb', 17, 15.6);
  o('hay_bale', 24.4, 14.2);
  o('bucket', 19.8, 13.5);
  o('hay_pile', 20.5, 15.2);

  // --- crop fields with fences and scarecrows
  fence(2, 19, 12, 29, [[7, 19], [12, 23], [12, 24]]);
  fence(14, 19, 24, 29, [[19, 19], [14, 23], [14, 24]]);
  o('scarecrow', 7, 24);
  o('scarecrow2', 19, 24);
  o('veg_crates', 1.2, 18.4);
  o('sack', 25.2, 18.6);

  // --- chicken coop (south-west)
  fence(2, 31, 12, 39, [[7, 31], [8, 31]]);
  o('coop_pen', 6, 34);
  o('coop_small', 10.5, 37);
  o('hay_pile', 3.5, 38);
  o('trough_feed', 5, 38);
  o('bucket', 10.5, 33);
  o('hay_bale', 9, 38.6);
  o('barrel', 11.5, 32.4);

  // --- greenhouse & pond (south)
  o('greenhouse', 18.5, 31);
  reserve(15, 28, 22, 31);
  o('log', 24.5, 33.2);
  o('rock_moss', 15.5, 35);
  o('flowers_lav', 26.8, 36);
  o('fern', 16, 40.6);

  // --- meadow surroundings
  o('signpost', 28.8, 17.6);
  o('rock_big', 29, 9.6);
  o('stump_moss', 38.6, 10.5);

  // --- campsite (centre)
  o('tent_beige', 29.5, 25);
  o('tent_green', 35.5, 25.5);
  o('tent_orange', 32.5, 30.2);
  o('campfire', 32.5, 27.4);
  o('logs', 30.6, 28.2);
  o('logs', 34.4, 28.2, true);
  o('firewood', 36.6, 28.3);
  o('table', 28.6, 29.5);
  o('lamp_tall', 31, 23.2);
  o('barrel2', 36.4, 30.5);
  o('sack', 28, 27.2);
  reserve(27, 22, 37, 31);

  // --- training ground (east, below the cliff)
  o('crown_gate', 54, 11);
  o('dummy', 51, 14);
  o('dummy2', 53.5, 14.3);
  o('dummy3', 56, 14);
  o('target', 58.5, 13);
  o('target_arrow', 61, 15.5);
  o('notice_board', 50, 18.6);
  o('banner_blue', 49, 11.5);
  o('banner_gold', 59, 11.5);
  o('bench', 56, 17.8);
  o('tool_rack', 50.2, 12.4);
  o('barrel', 49.2, 14.6);
  o('barrel2', 49.8, 15.6);
  o('flag_green', 52.2, 10.2);
  o('lamp_post', 51.4, 18.6);
  o('lamp_post', 58.6, 18.6);
  o('canopy_white', 60.2, 10.6);
  o('table', 60.2, 12.8);
  o('hay_bale', 57.6, 16.2);
  o('crates', 61.4, 17.4);
  o('target', 61, 13.6);
  reserve(48, 9, 62, 18);

  // --- arena (south-east)
  o('grandstand', 54, 26);
  o('flag_red', 46.6, 25.6);
  o('flag_purple', 61.5, 25.6);
  fence(47, 27, 61, 36, [[54, 36], [53, 36], [47, 31], [47, 32]]);
  o('scoreboard', 50.5, 38.4);
  o('podium', 58.5, 39.5);
  o('trophy', 58.5, 37.8);
  o('bunting_a', 50, 39);
  o('bunting_b', 43.6, 35);
  o('arena_arch', 45.6, 27.4);
  o('stall_red', 44, 38.5);
  o('bench', 61.5, 40.6);
  o('bleachers', 49.4, 26.4);
  o('bleachers', 58.6, 26.4);
  o('banner_blue', 47.4, 38.2);
  o('banner_gold', 60.6, 38.2);
  o('canopy_purple', 56.4, 40.4);
  o('crates', 45.4, 40.2);
  o('lamp_tall', 46.2, 35.8);
  reserve(43, 23, 62, 41);

  // --- plateau (north-east, above the cliff)
  o('waterfall', 41.5, 9.2);
  o('cave', 57, 7);
  o('lamp_tall', 45, 8.3);
  o('lamp_tall', 48.8, 8.3);
  o('signpost', 49.8, 4.6);
  o('campfire', 54.2, 4.6);
  o('logs', 52.8, 4.8);
  o('tent_green', 57.6, 4.4);
  o('bench', 34.5, 4.2);
  o('flowers_lav', 36.6, 4.6);
  reserve(39, 3, 44, 10);
  reserve(54, 4, 60, 8);
  reserve(44, 3, 50, 9);
  reserve(51, 2, 59, 5);
  reserve(33, 3, 37, 5);

  // keep roads, bridges, fields, court, cliff free of random stuff
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const g = get(x, y);
      if (g !== G.Grass && g !== G.DarkGrass) reserved[y * W + x] = 1;
    }
  for (const ob of objects) reserve(Math.floor(ob.x) - 1, ob.y - 2, Math.ceil(ob.x) + 1, ob.y - 1);

  const r = rng(20241107);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  /** free for a tree: tile + a margin are grassy and unreserved */
  const free = (x: number, y: number, m = 1) => {
    for (let yy = y - m; yy <= y + m; yy++)
      for (let xx = x - m; xx <= x + m; xx++) {
        if (!inb(xx, yy)) continue;
        if (reserved[yy * W + xx]) return false;
        const g = get(xx, yy);
        if (g !== G.Grass && g !== G.DarkGrass) return false;
      }
    return inb(x, y);
  };

  // --- dense forest border: big clumps first, then single trees fill gaps
  const CLUMPS = ['trees_double', 'trees_cluster', 'forest_pines', 'tree_round'];
  const TREES = ['tree_round', 'tree_green', 'tree_pine', 'tree_pine2', 'tree_big', 'tree_autumn', 'tree_round', 'tree_fruit'];
  const placeTree = (name: string, x: number, y: number, margin: number) => {
    if (!free(x, y, margin)) return false;
    o(name, x + (r() - 0.5) * 0.5, y, r() < 0.5);
    reserve(x - margin - 1, y - margin - 1, x + margin + 1, y);
    return true;
  };
  const border = (x: number, y: number) => Math.min(x, y, W - 1 - x, H - 1 - y);
  // two passes: big clumps on a loose grid, then single trees fill every gap
  for (let pass = 0; pass < 2; pass++) {
    const step = pass === 0 ? 2 : 1;
    for (let y = 1; y < H; y += step)
      for (let x = 0; x < W; x += step) {
        if (border(x, y) > 3) continue;
        const jx = x + (pass === 0 ? Math.floor(r() * 2) : 0), jy = y + (pass === 0 ? Math.floor(r() * 2) : 0);
        if (pass === 0) { if (r() < 0.8) placeTree(pick(CLUMPS), jx, jy, 0); }
        else if (r() < 0.7) placeTree(pick(TREES), jx, jy, 0);
      }
  }
  // inner groves and single trees between zones
  const GROVES: [number, number][] = [[27, 4], [30, 3], [24, 13], [38, 21], [41, 27], [44, 15], [39, 36], [21, 4], [5, 4],
    [36, 3], [40, 3], [55, 25], [43, 41], [22, 31], [6, 17], [31, 33], [38, 33], [44, 11], [60, 16],
    [14, 32], [27, 40], [36, 41], [33, 4], [57, 2], [52, 3], [61, 6], [44, 2], [6, 14], [1, 15], [62, 24]];
  for (const [gx, gy] of GROVES)
    for (let i = 0; i < 9; i++) placeTree(pick(TREES), gx + Math.floor(r() * 4) - 2, gy + Math.floor(r() * 4) - 2, 0);

  // --- flower patches (clusters look more natural than uniform noise)
  const PATCH = ['flowers_o', 'flowers_y', 'flowers_lav', 'flower_bush_r', 'flower_bush_y', 'flower_bush_t'];
  for (let i = 0; i < 40; i++) {
    const cx = Math.floor(r() * W), cy = Math.floor(r() * H), kind = pick(PATCH);
    for (let k = 0; k < 4; k++) {
      const x = cx + Math.floor(r() * 3) - 1, y = cy + Math.floor(r() * 3) - 1;
      if (free(x, y, 0)) { o(kind, x + (r() - 0.5) * 0.4, y, r() < 0.5); reserve(x, y, x, y); }
    }
  }

  // --- bushes, flowers, rocks, mushrooms
  const SMALLS = ['flowers_o', 'flowers_y', 'flowers_lav', 'flower_bush_y', 'flower_bush_r', 'flower_bush_t',
    'rock_s1', 'rock_s2', 'rock_s3', 'stump', 'stump2', 'mushroom', 'mushrooms', 'fern', 'plant', 'bush_a', 'bush_b',
    'rock_moss', 'stump_moss', 'log', 'rock_tall', 'pebbles'];
  for (let i = 0; i < 2500; i++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    if (!free(x, y, 0)) continue;
    o(pick(SMALLS), x, y, r() < 0.5);
    reserve(x, y, x, y);
  }

  // --- tiny ground details (baked into the ground layer, free at runtime)
  const DECALS = ['dec_flower_w0', 'dec_flower_w1', 'dec_flower_y0', 'dec_flower_y1', 'dec_flower_p0', 'dec_flower_b0',
    'dec_flower_r0', 'dec_tuft0', 'dec_tuft1', 'dec_tuft2', 'dec_tuft0', 'dec_tuft1', 'dec_clover', 'dec_pebble'];
  for (let i = 0; i < 2200; i++) {
    const x = r() * W, y = r() * H;
    const g = get(Math.floor(x), Math.floor(y));
    if (g !== G.Grass && g !== G.DarkGrass) continue;
    decals.push({ s: pick(DECALS), x: x - 0.5, y: y + 0.3 });
  }
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    if (get(x, y) === G.Grass && !reserved[y * W + x]) decals.push({ s: pick(['leaves', 'tile_grass_f1', 'tile_grass_f3']), x, y: y + 1 });
  }

  // objects standing on a field tile make it untillable
  for (const ob of objects) {
    const row = ob.y - 1, col = Math.round(ob.x);
    if (inb(col, row) && get(col, row) === G.Field) set(col, row, G.Dirt);
  }

  return {
    id: 'farm',
    name: 'Nông trại',
    w: W, h: H, ground, objects, decals, terrainAt,
    courts: [COURT],
    exits: [
      { x0: W - 1, y0: 19, x1: W - 1, y1: 22, to: 'town', label: 'Thành phố' },
      { x0: 28, y0: H - 1, x1: 32, y1: H - 1, to: 'park', label: 'Công viên' },
    ],
    spawn: { x: 9, y: 11 },
    spots: [
      { id: 'ship', x: 12, y: 10 },
      { id: 'shop', x: 14, y: 10 },
    ],
  };
}

export function isTillable(m: GameMap, x: number, y: number) {
  return x >= 0 && y >= 0 && x < m.w && y < m.h && m.ground[y * m.w + x] === G.Field;
}
