// Farm NPCs: wander between waypoints on the paths, turn to face the player
// when they come close, and say something when the player talks to them.
import type { World } from './world.ts';

const TILE = 32;

export interface NpcDef {
  sprite: string;          // atlas prefix, frames <sprite>_0..7 (8 facing directions)
  name: string;
  waypoints: [number, number][];  // tiles
  lines: string[];
  /** talking opens this shop instead of cycling the lines */
  shop?: boolean;
  /** stays on its first waypoint (only turns to face the player) */
  stationary?: boolean;
  facing?: number;
  /** draw scale relative to the sprite */
  scale: number;
}

export class Npc {
  x: number; y: number;
  dir8 = 0;
  moving = false;
  private dist = 0;
  private target: [number, number] | null = null;
  private wait = 1.5;
  private talkT = 0;
  say = '';
  sayT = 0;
  private lineI = 0;

  readonly def: NpcDef;
  constructor(def: NpcDef) {
    this.def = def;
    const [tx, ty] = def.waypoints[0];
    this.x = tx * TILE + 16; this.y = ty * TILE + 28;
    this.dir8 = def.facing ?? 0;
  }

  get frame() { return `${this.def.sprite}_${this.dir8}`; }
  /** little step bounce while walking (the sprite has no walk frames) */
  get bob() { return this.moving ? Math.abs(Math.sin(this.dist / 5)) * 1.6 : 0; }

  private face(dx: number, dy: number) {
    this.dir8 = ((Math.round((Math.PI / 2 - Math.atan2(dy, dx)) / (Math.PI / 4)) % 8) + 8) % 8;
  }

  update(dt: number, world: World, px: number, py: number) {
    this.sayT = Math.max(0, this.sayT - dt);
    const near = Math.hypot(px - this.x, py - this.y) < 44;
    if (near || this.talkT > 0) {
      // stop and look at the player
      this.talkT = Math.max(0, this.talkT - dt);
      this.moving = false;
      this.face(px - this.x, py - this.y);
      return;
    }
    if (this.def.stationary) { this.moving = false; this.dir8 = this.def.facing ?? 0; return; }
    if (!this.target) {
      if ((this.wait -= dt) > 0) { this.moving = false; return; }
      const wp = this.def.waypoints;
      const [tx, ty] = wp[Math.floor(Math.random() * wp.length)];
      this.target = [tx * TILE + 16 + (Math.random() - 0.5) * 10, ty * TILE + 28];
    }
    const [gx, gy] = this.target;
    const dx = gx - this.x, dy = gy - this.y, d = Math.hypot(dx, dy);
    if (d < 2) { this.target = null; this.wait = 2 + Math.random() * 4; this.moving = false; return; }
    const step = Math.min(d, 32 * dt);
    const nx = this.x + (dx / d) * step, ny = this.y + (dy / d) * step;
    if (world.blocked(nx - 5, ny - 6, 10, 6)) { this.target = null; this.wait = 0.5; this.moving = false; return; }
    this.x = nx; this.y = ny; this.dist += step; this.moving = true;
    this.face(dx, dy);
  }

  /** player talks to the NPC: next line, shown in a speech bubble */
  talk(extra?: string) {
    this.talkT = 4;
    this.say = extra || this.def.lines[this.lineI++ % this.def.lines.length];
    this.sayT = 4.5;
  }
}

export const FARM_NPCS: NpcDef[] = [
  {
    sprite: 'npc_farmer',
    name: 'Bác Ba',
    // stands next to the shipping chest, where the seed sack used to be
    waypoints: [[8.7, 7]],
    stationary: true,
    facing: 0,
    // same height as the player (player idle 88px x1.35 = 104px sprite x1.14)
    scale: 1.14,
    shop: true,
    lines: [
      'Cháu cần gì cứ chọn nhé! Hạt giống, phân bón, thuốc trừ sâu bác có đủ.',
      'Chào cháu! Bác là Bác Ba, coi nông trại này mấy chục năm rồi.',
      'Đất khô cằn thì dùng cuốc xới trước, rồi mới gieo hạt được.',
      'Mỗi lần cây lớn thêm một nấc là phải tưới lại. Trời mưa thì đỡ, mưa tưới hộ cho.',
      'Thấy chấm đỏ trên cây là có sâu đấy! Phun thuốc ngay kẻo cây đứng không lớn.',
      'Bón phân thì cây lớn nhanh hơn, lúc thu hoạch lại được gấp đôi.',
      'Thu hoạch xong đất lại khô cằn, nhớ cuốc lại nhé.',
      'Nông sản đem bán ở rương vàng trước nhà nhé.',
      'Cái chuồng bên kia bác đang dọn, sắp tới sẽ nuôi bò với lợn.',
    ],
  },
];
