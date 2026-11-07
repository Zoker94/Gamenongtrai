// Collision boxes per sprite, relative to the anchor (bottom-centre).
// [dx, dy, w, h] in world pixels; dy is the box top (negative = above anchor).
export type Box = [dx: number, dy: number, w: number, h: number];

const NONE: Box[] = [];
// the cliff tiles already block; keep the cave walkable-looking but solid
const NONE_SOLID = (): Box[] => [[-30, -10, 60, 10]];

export const FOOTPRINTS: Record<string, Box[]> = {
  house: [[-54, -44, 108, 40]],
  barn_red: [[-40, -38, 80, 36]],
  silo: [[-14, -22, 28, 20]],
  windmill: [[-24, -30, 48, 28]],
  greenhouse: [[-38, -36, 76, 34]],
  coop_pen: [[-44, -30, 88, 28]],
  coop_small: [[-30, -26, 60, 24]],
  gate_arch: [[-42, -12, 22, 12], [20, -12, 22, 12]],
  fence_h: [[-16, -7, 32, 5]],
  fence_v: [[-3, -36, 6, 34]],
  waterfall: [[-46, -40, 92, 40]],
  cave: NONE_SOLID(),
  arena_arch: [[-30, -8, 10, 8], [20, -8, 10, 8]],
  crown_gate: [[-36, -6, 8, 6], [28, -6, 8, 6]],
  grandstand: [[-62, -40, 124, 38]],
  tent_beige: [[-24, -16, 48, 14]],
  tent_green: [[-24, -16, 48, 14]],
  tent_orange: [[-20, -14, 40, 12]],
  bunting_a: [[-27, -4, 4, 4], [23, -4, 4, 4]],
  bunting_b: [[-31, -4, 4, 4], [27, -4, 4, 4]],
  flag_red: [[-8, -4, 6, 4]], flag_green: [[-8, -4, 6, 4]], flag_purple: [[-8, -4, 6, 4]],
  banner_blue: [[-3, -4, 6, 4]], banner_gold: [[-3, -4, 6, 4]],
  trees_double: [[-24, -10, 48, 9]],
  trees_cluster: [[-26, -10, 52, 9]],
  forest_pines: [[-44, -12, 88, 10]],
  tree_round: [[-9, -8, 18, 7]],
  lamp_post: [[-3, -4, 6, 4]],
  lamp_tall: [[-3, -4, 6, 4]],
  signpost: [[-4, -5, 8, 5]],
  sign: [[-5, -5, 10, 5]],
  well: [[-14, -14, 28, 12]],
  cart: [[-20, -10, 40, 9]],
  // no collision
  flowers_o: NONE, flowers_y: NONE, flowers_lav: NONE, fern: NONE, plant: NONE,
  mushroom: NONE, mushrooms: NONE, leaves: NONE, pebbles: NONE,
  tallgrass_top: NONE, arena_floor: NONE, dec_pebble: NONE,
};

export function footprintFor(name: string, w: number, h: number): Box[] {
  const fp = FOOTPRINTS[name];
  if (fp) return fp;
  if (name.startsWith('d_') || name.startsWith('flowers_')) return NONE; // walk-through greenery
  if (name.startsWith('tree_')) return [[-7, -7, 14, 6]]; // trunk only
  const bw = Math.max(6, Math.round(w * 0.7));
  const bh = Math.max(4, Math.min(12, Math.round(h * 0.35)));
  return [[-(bw >> 1), -bh - 1, bw, bh]];
}
