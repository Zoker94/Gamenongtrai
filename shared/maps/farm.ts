// Farm map ("Nông trại"). Built procedurally from fixed numbers + a seeded
// RNG, so it is identical on client and server. Edit the zone coordinates
// below to reshape the map.
//
// The farm is a hand-painted map (client/public/assets/farm_bg.webp, built
// from assets/source/farm_mockup.png by tools/build_farm_map.py). Its
// collision mask ships alongside it. This file only describes what game logic
// needs: size, tillable bed tiles, exits, interactive spots and spawn.
//
//   north-west: barn + water tower      north: chicken yard, cow pen, pig pen
//   west: house with patio, well        centre: seven crop beds
//   south: notice board (seed shop), gate (exit -> park), mailbox (shipping)
//   east: fish pond with dock and boat  north road (exit -> town)

export const G = {
  Grass: 0, Dirt: 1, Water: 2, Stone: 3, Field: 4, Bridge: 5,
  CliffTop: 6, CliffFace: 7, Stairs: 8, TallGrass: 9, Sand: 10, DarkGrass: 11,
  /** blocked by something painted on a background map */
  Solid: 12,
} as const;
export type G = (typeof G)[keyof typeof G];

/** ground types the player cannot walk on */
export const SOLID = new Set<number>([G.Water, G.CliffTop, G.CliffFace, G.Solid]);
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
  /** painted background image (assets/<name>.webp + <name>.json mask); replaces terrain art */
  background?: string;
  /** plots already growing on a brand-new farm */
  starter: StarterPlot[];
  /** interactive spots: shipping bin, seed shop */
  spots: { id: string; x: number; y: number }[];
}

/** Crop beds, in tiles (inclusive). Must match BEDS in tools/build_farm_map.py. */
export const FARM_BEDS: Rect[] = [
  { x0: 14, y0: 8, x1: 15, y1: 9 }, { x0: 17, y0: 8, x1: 18, y1: 9 },
  { x0: 20, y0: 8, x1: 21, y1: 9 }, { x0: 22, y0: 8, x1: 22, y1: 9 },
  { x0: 14, y0: 11, x1: 15, y1: 14 }, { x0: 17, y0: 11, x1: 18, y1: 14 }, { x0: 20, y0: 11, x1: 22, y1: 14 },
];

export function buildFarm(): GameMap {
  const W = 38, H = 19;
  const inBed = (x: number, y: number) =>
    FARM_BEDS.some((b) => x >= b.x0 && x < b.x1 + 1 && y >= b.y0 && y < b.y1 + 1);
  const terrainAt = (x: number, y: number): number => (inBed(x, y) ? G.Field : G.Grass);
  const ground = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ground[y * W + x] = terrainAt(x + 0.5, y + 0.5);

  const starter: StarterPlot[] = [];
  const bed = (i: number, rows: [string, number][]) => {
    const b = FARM_BEDS[i];
    rows.forEach(([c, s], k) => { for (let x = b.x0; x <= b.x1; x++) starter.push({ x, y: b.y0 + k, c, s }); });
  };
  // like the reference picture: furrowed beds are sown, the two plain beds
  // top-right are freshly dug and empty
  bed(0, [['carrot', 3], ['carrot', 2]]);
  bed(1, [['strawberry', 2], ['strawberry', 1]]);
  bed(4, [['turnip', 2], ['turnip', 1], ['tomato', 2], ['tomato', 1]]);
  bed(5, [['eggplant', 2], ['eggplant', 1], ['carrot', 1], ['', 0]]);
  bed(6, [['pumpkin', 3], ['pumpkin', 2], ['tomato', 3], ['', 0]]);
  for (const i of [2, 3]) bed(i, [['', 0], ['', 0]]);

  const spots: { id: string; x: number; y: number }[] = [];
  for (let y = 16; y <= 18; y++) {
    for (let x = 15; x <= 17; x++) spots.push({ id: 'shop', x, y });   // notice board
    for (let x = 21; x <= 22; x++) spots.push({ id: 'ship', x, y });   // mailbox
  }

  return {
    id: 'farm',
    name: 'Nông trại',
    w: W, h: H, ground, objects: [], decals: [], scenes: [], terrainAt, starter,
    background: 'farm_bg',
    courts: [],
    exits: [
      { x0: 12, y0: 0, x1: 13, y1: 0, to: 'town', label: 'Thành phố' },
      { x0: 18, y0: H - 1, x1: 20, y1: H - 1, to: 'park', label: 'Công viên' },
    ],
    spawn: { x: 11, y: 15 },
    spots,
  };
}

export function isTillable(m: GameMap, x: number, y: number) {
  return x >= 0 && y >= 0 && x < m.w && y < m.h && m.ground[y * m.w + x] === G.Field;
}
