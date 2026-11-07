// Farm map ("Nông trại"). Built procedurally from a fixed seed so it is
// deterministic on client and server, and easy to tweak by editing numbers.

export const G = { Grass: 0, Dirt: 1, Water: 2, Stone: 3, Field: 4, Bridge: 5 } as const;
export type G = (typeof G)[keyof typeof G];

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

export interface GameMap {
  id: string;
  name: string;
  w: number;
  h: number;
  ground: Uint8Array;
  objects: MapObject[];
  /** flat sprites drawn into the ground layer (no collision, under the player) */
  decals: MapObject[];
  exits: Exit[];
  spawn: { x: number; y: number };
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

export function buildFarm(): GameMap {
  const W = 48, H = 36;
  const ground = new Uint8Array(W * H); // all grass
  const set = (x: number, y: number, g: G) => {
    if (x >= 0 && y >= 0 && x < W && y < H) ground[y * W + x] = g;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, g: G) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, g);
  };
  const get = (x: number, y: number) => ground[y * W + x];

  // --- river on the east side, gently meandering
  for (let y = 0; y < H; y++) {
    const cx = 41 + Math.round(Math.sin(y / 4.5) * 1.2);
    rect(cx - 1, y, cx + 1, y, G.Water);
  }
  // --- pond bottom-left
  for (let y = 27; y < 35; y++)
    for (let x = 1; x < 11; x++) {
      const dx = (x - 5.5) / 4.2, dy = (y - 30.8) / 3.0;
      if (dx * dx + dy * dy < 1) set(x, y, G.Water);
    }

  // --- paths
  for (let x = 0; x < W; x++) for (let y = 12; y <= 13; y++) if (get(x, y) === G.Water) set(x, y, G.Bridge);
  for (let x = 5; x < W; x++) for (let y = 12; y <= 13; y++) if (get(x, y) !== G.Bridge) set(x, y, G.Dirt); // main road (to town)
  rect(22, 14, 23, H - 1, G.Dirt);    // south road (to park)
  rect(11, 10, 13, 11, G.Stone);       // porch in front of the house
  rect(26, 10, 29, 11, G.Dirt);        // yard in front of the barn

  // --- fields (tillable)
  rect(9, 16, 20, 25, G.Field);
  rect(25, 16, 35, 23, G.Field);

  const objects: MapObject[] = [];
  const decals: MapObject[] = [];
  // o(sprite, column, row): places the sprite standing in tile (column,row)
  const o = (s: string, x: number, y: number, f?: boolean) => objects.push(f ? { s, x, y: y + 1, f } : { s, x, y: y + 1 });

  // --- buildings
  o('house', 12, 9);
  o('barn_red', 27.5, 9);
  o('silo', 31, 9);
  o('windmill', 35, 10);
  o('greenhouse', 4.5, 22);
  o('coop_pen', 31, 31);
  o('gate_arch', 22.5, 35);

  // --- farm props
  o('well', 8, 11);
  o('chest_gold', 15, 11);          // shipping bin
  o('seed_bag', 17, 11);            // seed shop
  o('barrel', 9.5, 9);
  o('crate', 16, 9);
  o('hay_bale', 25, 9);
  o('cart', 30, 11);
  o('trough_water', 26, 31);
  o('hay_pile', 35, 32);
  o('scarecrow', 14, 21);
  o('scarecrow', 30, 20);
  o('beehives', 37, 18);
  o('planter_sun', 6, 14);
  o('tool_rack', 18.5, 9);
  o('lamp_post', 10, 11);
  o('lamp_post', 14, 11);
  o('lamp_tall', 21, 14);
  o('lamp_tall', 24, 14);
  o('signpost', 38, 11);
  o('sign', 21, 33);
  o('logs', 33, 10);
  o('firewood', 7, 9);
  o('veg_crates', 26, 14);
  o('table', 37, 26);
  o('campfire', 36, 28);

  // fences along the top of the fields (gaps for entrances)
  for (let x = 9; x <= 20; x++) if (x !== 14 && x !== 15) o('fence_h', x, 15);
  for (let x = 25; x <= 35; x++) if (x !== 29 && x !== 30) o('fence_h', x, 15);

  // --- decorative scatter on free grass, seeded
  const used = new Uint8Array(W * H);
  const mark = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) used[y * W + x] = 1;
  };
  for (const ob of objects) mark(Math.floor(ob.x) - 2, ob.y - 4, Math.ceil(ob.x) + 2, ob.y);
  mark(16, 26, 26, 26); // keep the area below the field free
  mark(3, 13, 24, 15);  // free strip south of the road
  const free = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H || used[y * W + x]) return false;
    for (let yy = y - 1; yy <= y + 1; yy++)
      for (let xx = x - 1; xx <= x + 1; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if (ground[yy * W + xx] !== G.Grass) return false;
      }
    return true;
  };
  const r = rng(1337);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];

  // tree border (north, west, south) + east bank
  const trees = ['tree_round', 'tree_pine', 'tree_pine2', 'tree_green', 'tree_big', 'tree_autumn', 'tree_pine'];
  const tryTree = (x: number, y: number) => {
    if (!free(x, y) && !(y <= 2 || x <= 1 || y >= H - 1)) return;
    if (ground[y * W + x] !== G.Grass || used[y * W + x]) return;
    o(pick(trees), x + (r() - 0.5) * 0.6, y, r() < 0.5);
    mark(x - 1, y - 1, x + 1, y);
  };
  for (let x = 0; x < W; x += 2) { tryTree(x, 1 + (r() < 0.5 ? 1 : 0)); }
  for (let x = 1; x < W; x += 3) { tryTree(x, 3 + Math.floor(r() * 2)); }
  for (let y = 4; y < H; y += 2) { tryTree(0, y); if (r() < 0.6) tryTree(2, y + 1); }
  for (let x = 12; x < W; x += 2) { if (x < 20 || x > 25) tryTree(x, H - 1); }
  for (let y = 2; y < H; y += 2) { tryTree(45 + Math.floor(r() * 2), y); }

  const smalls = ['flowers_o', 'flowers_y', 'flowers_lav', 'flower_bush_y', 'flower_bush_r', 'flower_bush_t',
    'rock_s1', 'rock_s2', 'stump', 'mushroom', 'fern', 'plant', 'bush_a', 'rock_moss', 'mushrooms', 'stump_moss', 'log'];
  for (let i = 0; i < 260 && objects.length < 260; i++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    if (!free(x, y)) continue;
    o(pick(smalls), x, y, r() < 0.5);
    mark(x - 1, y - 1, x + 1, y + 1);
  }
  for (let i = 0; i < 400 && decals.length < 45; i++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    if (ground[y * W + x] !== G.Grass || used[y * W + x]) continue;
    decals.push({ s: pick(['leaves', 'pebbles', 'tile_grass_f1', 'tile_grass_f2', 'tile_grass_f3']), x, y: y + 1 });
  }

  // objects standing on a field tile make it untillable
  for (const ob of objects) {
    const row = ob.y - 1, col = Math.round(ob.x);
    if (row >= 0 && row < H && ground[row * W + col] === G.Field) ground[row * W + col] = G.Dirt;
  }

  return {
    id: 'farm',
    name: 'Nông trại',
    w: W, h: H, ground, objects, decals,
    exits: [
      { x0: W - 1, y0: 12, x1: W - 1, y1: 13, to: 'town', label: 'Thành phố' },
      { x0: 22, y0: H - 1, x1: 23, y1: H - 1, to: 'park', label: 'Công viên' },
    ],
    spawn: { x: 12, y: 11 },
    spots: [
      { id: 'ship', x: 15, y: 11 },
      { id: 'shop', x: 17, y: 11 },
    ],
  };
}

export function isTillable(m: GameMap, x: number, y: number) {
  return x >= 0 && y >= 0 && x < m.w && y < m.h && m.ground[y * m.w + x] === G.Field;
}
