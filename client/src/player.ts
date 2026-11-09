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
  /** 8-direction turnaround sprite set (pl2_0..7) instead of sheet 5 frames */
  turnaround = false;
  /** full 8-direction walk cycles (pl3_<dir>_0 = standing, _1.._8 = walk loop) */
  walkCycles = false;
  /** char2 set: per direction idle (breathing) + walk frame counts, from the atlas */
  idleN: number[] | null = null;
  walkN: number[] = [];
  /** harvest (crate pick-up) frame counts per direction, 0 = none */
  harvestN: number[] = [];
  private static readonly HARVEST_FRAME = 0.15;

  /** Harvest animation: crouch, lift the crate. Locks movement while it plays. */
  playHarvest(): boolean {
    const d = this.harvestDir();
    const n = this.harvestN[d] || 0;
    if (!n) return false;
    this.action = { name: 'harvest', t: n * Player.HARVEST_FRAME };
    this.harvestTotal = n * Player.HARVEST_FRAME;
    return true;
  }
  private harvestTotal = 0;
  /** diagonals use the side animation */
  private harvestDir() { const d = this.dir8; return d === 1 || d === 3 ? 2 : d === 5 || d === 7 ? 6 : d; }
  get busy() { return !!this.action && this.action.name === 'harvest'; }
  /** 0 down, 1 down-right, 2 right, 3 up-right, 4 up, 5 up-left, 6 left, 7 down-left */
  dir8 = 0;

  playAction(name: string) { this.action = { name, t: 0.35 }; }

  /** sprite to draw + whether to mirror it */
  get frame(): F {
    if (this.idleN && this.action && this.action.name === 'harvest') {
      const d = this.harvestDir(), n = this.harvestN[d];
      const i = Math.min(n - 1, Math.floor((this.harvestTotal - this.action.t) / Player.HARVEST_FRAME));
      return [`pl4_${d}_h${i}`, false];
    }
    if (this.idleN) {
      const d = this.dir8;
      if (!this.moving || this.vel < 0.05) {
        const n = this.idleN[d];
        const per = n <= 2 ? 0.8 : n === 3 ? 0.4 : 0.22;   // gif timing per idle set
        return [`pl4_${d}_i${Math.floor(this.idleT / per) % n}`, false];
      }
      const stride = this.running ? 8 : 5.5;        // px per frame: feet match ground speed
      return [`pl4_${d}_w${Math.floor(this.dist / stride) % this.walkN[d]}`, false];
    }
    if (this.walkCycles) {
      if (!this.moving || this.vel < 0.05) return [`pl3_${this.dir8}_0`, false];
      const stride = this.running ? 9 : 6.5;      // px per frame: legs match ground speed
      return [`pl3_${this.dir8}_${1 + (Math.floor(this.dist / stride) % 8)}`, false];
    }
    if (this.turnaround) return [`pl2_${this.dir8}`, false];
    if (this.action) return [this.action.name, this.dir === 1];
    if (!this.moving) return IDLE[this.dir];
    if (this.running && (this.dir === 1 || this.dir === 2))
      return [RUN_SIDE[Math.floor(this.dist / STRIDE_RUN) % 4], this.dir === 1];
    return WALK[this.dir][Math.floor(this.dist / (this.running ? STRIDE_RUN : STRIDE_WALK)) % 4];
  }

  /** eased speed factor 0..1 (accelerate / decelerate instead of instant start/stop) */
  private vel = 0;
  private vx = 0;
  private vy = 0;
  private idleT = 0;

  /** Continuous body motion layered on the sprite frames, so the 2-frame
   *  walk cycle reads as smooth movement: [dy, scaleX, scaleY, lean]. */
  get pose(): [number, number, number, number] {
    if (this.action && this.idleN && this.action.name === 'harvest') return [0, 1.35, 1.35, 0];
    if (this.action) {
      // little anticipation squash at the start of a tool swing
      const k = Math.max(0, this.action.t - 0.25) / 0.1;
      const b = this.idleN ? 1.35 : 1;
      return [0, b * (1 + 0.06 * k), b * (1 - 0.06 * k), 0];
    }
    if (this.idleN) {
      // real breathing + walk frames: only scale up to the map, tiny lean
      const side = this.dir8 >= 1 && this.dir8 <= 3 ? 1 : this.dir8 >= 5 ? -1 : 0;
      const lean = this.moving ? side * (this.running ? 0.05 : 0.015) * this.vel : 0;
      return [0, 1.35, 1.35, lean];
    }
    if (!this.moving || this.vel < 0.05) {
      // breathing
      const b = Math.sin(this.idleT * 2.4);
      return [0, 1 + b * 0.012, 1 - b * 0.018, 0];
    }
    if (this.walkCycles) {
      const side = this.dir8 >= 1 && this.dir8 <= 3 ? 1 : this.dir8 >= 5 ? -1 : 0;
      return [0, 1, 1, side * (this.running ? 0.06 : 0.02) * this.vel];
    }
    const stride = this.running ? STRIDE_RUN : STRIDE_WALK;
    const ph = (this.dist / stride) * Math.PI;           // one bounce per footstep
    const up = Math.abs(Math.sin(ph));                     // 0 = foot down, 1 = mid-step
    const amp = (this.running ? 2.6 : 1.6) * this.vel;
    const squash = (1 - up) * (this.running ? 0.07 : 0.045) * this.vel; // landing squash
    const side = this.dir === 1 ? -1 : this.dir === 2 ? 1 : 0;
    const lean = side * (this.running ? 0.1 : 0.05) * this.vel;          // lean into the walk
    return [-up * amp, 1 + squash, 1 - squash, lean];
  }

  get bob(): number { return 0; }

  /** ix, iy: input vector (-1..1). */
  update(dt: number, ix: number, iy: number, world: World) {
    if (this.action && (this.action.t -= dt) <= 0) this.action = null;
    this.idleT += dt;
    if (this.busy) { ix = 0; iy = 0; this.target = null; }
    if (ix || iy) this.target = null;
    else if (this.target) {
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) this.target = null;
      else { ix = dx / d; iy = dy / d; }
    }
    const len = Math.hypot(ix, iy);
    const want = len > 0.15;
    // ease in / ease out
    this.vel += ((want ? 1 : 0) - this.vel) * Math.min(1, dt * (want ? 9 : 14));
    if (!want) {
      // glide to a stop over a few frames, keep the feet planted
      if (this.vel > 0.08 && this.moving) {
        const st = this.speed * this.vel * dt;
        const nx = this.x + this.vx * st, ny = this.y + this.vy * st;
        if (!world.blocked(nx - CW / 2, this.y - CH, CW, CH)) this.x = nx;
        if (!world.blocked(this.x - CW / 2, ny - CH, CW, CH)) this.y = ny;
        this.dist += st;
        return;
      }
      this.moving = false; this.dist = 0; this.vel = 0;
      return;
    }
    this.moving = true;
    if (len > 1) { ix /= len; iy /= len; }
    // facing with hysteresis: diagonal input keeps the current facing instead
    // of flickering between two directions every frame
    const ax = Math.abs(ix), ay = Math.abs(iy);
    const horiz = this.dir === 1 || this.dir === 2;
    if (horiz ? ay > ax * 1.4 : ax > ay * 1.4) {
      if (ax > ay) this.dir = ix < 0 ? 1 : 2; else this.dir = iy < 0 ? 3 : 0;
    } else if (horiz) this.dir = ix < 0 ? 1 : ix > 0 ? 2 : this.dir;
    else this.dir = iy < 0 ? 3 : iy > 0 ? 0 : this.dir;

    this.vx = ix; this.vy = iy;
    // 8-way facing from the movement vector (45 deg sectors)
    const ang = Math.atan2(iy, ix);                  // 0 = right, +pi/2 = down
    this.dir8 = ((Math.round((Math.PI / 2 - ang) / (Math.PI / 4)) % 8) + 8) % 8;
    const step = this.speed * (this.running ? 1.65 : 1) * Math.max(0.35, this.vel) * dt;
    const mx = ix * step, my = iy * step;
    const ox = this.x, oy = this.y;
    if (mx && !world.blocked(this.x + mx - CW / 2, this.y - CH, CW, CH)) this.x += mx;
    if (my && !world.blocked(this.x - CW / 2, this.y + my - CH, CW, CH)) this.y += my;
    const moved = Math.hypot(this.x - ox, this.y - oy);
    this.dist += moved;
    // pushing against a wall: stand still instead of moonwalking
    if (moved < step * 0.2) { this.moving = false; this.dist = 0; if (this.target) this.target = null; }
  }

  /** World point just in front of the player's feet. */
  facingPoint(off = 14): [number, number] {
    const fx = this.x + (this.dir === 1 ? -off : this.dir === 2 ? off : 0);
    const fy = this.y - 4 + (this.dir === 3 ? -off : this.dir === 0 ? off - 2 : 0);
    return [fx, fy];
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
    this.dir8 = ((Math.round((Math.PI / 2 - Math.atan2(dy, dx)) / (Math.PI / 4)) % 8) + 8) % 8;
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx < 0 ? 1 : 2;
    else this.dir = dy < 0 ? 3 : 0;
  }
}
