import type { World } from './world.ts';

// Animation frames (atlas names). Side frames face left; right = flipped.
const WALK: Record<number, string[]> = {
  0: ['pl_d1', 'pl_d0', 'pl_d2', 'pl_d0'],
  3: ['pl_u1', 'pl_u0', 'pl_u2', 'pl_u3'],
  1: ['pl_l0', 'pl_l1', 'pl_l0', 'pl_l1'],
  2: ['pl_l0', 'pl_l1', 'pl_l0', 'pl_l1'],
};
const IDLE: Record<number, [string, boolean]> = {
  0: ['pl_d0', false], 3: ['pl_u0', false], 1: ['pl_r_idle', true], 2: ['pl_r_idle', false],
};
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

  /** short tool animation (hoe / water / harvest), faces right in the atlas */
  action: { name: string; t: number } | null = null;

  playAction(name: string) { this.action = { name, t: 0.35 }; }

  /** sprite to draw + whether to mirror it */
  get frame(): [string, boolean] {
    if (this.action) return [this.action.name, this.dir === 1];
    if (!this.moving) return IDLE[this.dir];
    const f = WALK[this.dir][Math.floor(this.anim * 7) % 4];
    return [f, this.dir === 2];
  }

  /** 1px bob while walking makes the 2-frame cycle feel livelier */
  get bob(): number { return this.moving && !this.action && Math.floor(this.anim * 7) % 2 ? 1 : 0; }

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
    if (!this.moving) { this.anim = 0; return; }
    if (len > 1) { ix /= len; iy /= len; }
    // facing: dominant axis
    if (Math.abs(ix) > Math.abs(iy)) this.dir = ix < 0 ? 1 : 2;
    else this.dir = iy < 0 ? 3 : 0;
    this.anim += dt;

    const step = this.speed * dt;
    const mx = ix * step, my = iy * step;
    let movedX = false, movedY = false;
    if (mx && !world.blocked(this.x + mx - CW / 2, this.y - CH, CW, CH)) { this.x += mx; movedX = true; }
    if (my && !world.blocked(this.x - CW / 2, this.y + my - CH, CW, CH)) { this.y += my; movedY = true; }
    // slide around corners: nudge sideways if completely stuck on one axis
    if (!movedX && !movedY && this.target) this.target = null;
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
