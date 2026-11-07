// Collision boxes per sprite, relative to the anchor (bottom-centre).
// [dx, dy, w, h] in world pixels; dy is the box top (negative = above anchor).
export type Box = [dx: number, dy: number, w: number, h: number];

const NONE: Box[] = [];

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
  lamp_post: [[-3, -4, 6, 4]],
  lamp_tall: [[-3, -4, 6, 4]],
  signpost: [[-4, -5, 8, 5]],
  sign: [[-5, -5, 10, 5]],
  well: [[-14, -14, 28, 12]],
  cart: [[-20, -10, 40, 9]],
  // no collision
  flowers_o: NONE, flowers_y: NONE, flowers_lav: NONE, fern: NONE, plant: NONE,
  mushroom: NONE, mushrooms: NONE, leaves: NONE, pebbles: NONE,
};

export function footprintFor(name: string, w: number, h: number): Box[] {
  const fp = FOOTPRINTS[name];
  if (fp) return fp;
  if (name.startsWith('tree_')) return [[-7, -7, 14, 6]]; // trunk only
  const bw = Math.max(6, Math.round(w * 0.7));
  const bh = Math.max(4, Math.min(12, Math.round(h * 0.35)));
  return [[-(bw >> 1), -bh - 1, bw, bh]];
}
