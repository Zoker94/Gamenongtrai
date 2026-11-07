import type { World } from './world.ts';

// Animation frames (atlas names, cut by tools/build_assets.py from sheet 5).
// Every frame is aligned on the feet, so switching frames never shifts the
// character. Walk side frames face LEFT, idle/run side frames face RIGHT.
type F = [name: string, flip: boolean];
const IDLE: Record<number, F> = {
  0: ['pl_idle_d', false], 3: ['pl_idle_u', false], 1: ['pl_idle_r', true], 2: ['pl_idle_r', false],
};
const WALK: Record<number, F[]> = {
  0: [['pl_walk_d0', false], ['pl_idle_d', false], ['pl_walk_d1', false], ['pl_idle_d', false]],
  3: [['pl_walk_u0', false], ['pl_idle_u', false], ['pl_walk_u1', false], ['pl_idle_u', false]],
  1: [['pl_walk_l0', false], ['pl_idle_r', true], ['pl_walk_l1', false], ['pl_idle_r', true]],
  2: [['pl_walk_l0', true], ['pl_idle_r', false], ['pl_walk_l1', true], ['pl_idle_r', false]],
};
const RUN_SIDE = ['pl_run_r0', 'pl_run_r1', 'pl_run_r2', 'pl_run_r3'];
/** game px travelled per animation frame (ties leg motion to real movement: no foot sliding) */
const STRIDE_WALK = 9, STRIDE_RUN = 12;
export type Dir = 0 | 1 | 2 | 3;

// Feet collider (world px), relative to the feet point.
const CW = 10, CH = 6;

export class Player {
  x: number;
  y: number;
  dir: Dir = 0;
  moving = false;
  speed = 84; // px / s
  private anim = 0;
  /** optional walk-to target (tap / click to move) */
  target: { x: number; y: number } | null = null;

  constructor(x: number, y: number) {
    this.x = x; this.y = y;
  }

  /** short tool animation (hoe / water / harvest); atlas frames face right */
  action: { name: string; t: number } | null = null;
  running = false;
  private dist = 0;

  playAction(name: string) { this.action = { name, t: 0.35 }; }

  /** sprite to draw + whether to mirror it */
  get frame(): F {
    if (this.action) return [this.action.name, this.dir === 1];
    if (!this.moving) return IDLE[this.dir];
    if (this.running && (this.dir === 1 || this.dir === 2))
      return [RUN_SIDE[Math.floor(this.dist / STRIDE_RUN) % 4], this.dir === 1];
    return WALK[this.dir][Math.floor(this.dist / (this.running ? STRIDE_RUN : STRIDE_WALK)) % 4];
  }

  /** small body bob on the passing frames */
  get bob(): number {
    if (!this.moving || this.action) return 0;
    return Math.floor(this.dist / STRIDE_WALK) % 2 ? 1 : 0;
  }

  /** ix, iy: input vector (-1..1). */
  update(dt: number, ix: number, iy: number, world: World) {
    if (this.action && (this.action.t -= dt) <= 0) this.action = null;
    if (ix || iy) this.target = null;
    else if (this.target) {
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) this.target = null;
      else { ix = dx / d; iy = dy / d; }
    }
    const len = Math.hypot(ix, iy);
    this.moving = len > 0.15;
    if (!this.moving) { this.dist = 0; return; }
    if (len > 1) { ix /= len; iy /= len; }
    // facing with hysteresis: diagonal input keeps the current facing instead
    // of flickering between two directions every frame
    const ax = Math.abs(ix), ay = Math.abs(iy);
    const horiz = this.dir === 1 || this.dir === 2;
    if (horiz ? ay > ax * 1.4 : ax > ay * 1.4) {
      if (ax > ay) this.dir = ix < 0 ? 1 : 2; else this.dir = iy < 0 ? 3 : 0;
    } else if (horiz) this.dir = ix < 0 ? 1 : ix > 0 ? 2 : this.dir;
    else this.dir = iy < 0 ? 3 : iy > 0 ? 0 : this.dir;

    const step = this.speed * (this.running ? 1.65 : 1) * dt;
    const mx = ix * step, my = iy * step;
    const ox = this.x, oy = this.y;
    if (mx && !world.blocked(this.x + mx - CW / 2, this.y - CH, CW, CH)) this.x += mx;
    if (my && !world.blocked(this.x - CW / 2, this.y + my - CH, CW, CH)) this.y += my;
    const moved = Math.hypot(this.x - ox, this.y - oy);
    this.dist += moved;
    // pushing against a wall: stand still instead of moonwalking
    if (moved < step * 0.2) { this.moving = false; this.dist = 0; if (this.target) this.target = null; }
  }

  /** Tile in front of the player. */
  facingTile(tile: number): [number, number] {
    const off = 18;
    const fx = this.x + (this.dir === 1 ? -off : this.dir === 2 ? off : 0);
    const fy = this.y - 4 + (this.dir === 3 ? -off : this.dir === 0 ? off - 4 : 0);
    return [Math.floor(fx / tile), Math.floor(fy / tile)];
  }

  faceToward(px: number, py: number) {
    const dx = px - this.x, dy = py - (this.y - 6);
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx < 0 ? 1 : 2;
    else this.dir = dy < 0 ? 3 : 0;
  }
}
