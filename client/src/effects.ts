// Ambient life: water sparkles, ripples, jumping fish, swaying plants,
// butterflies, falling leaves and drifting cloud shadows.
// Everything is cheap: a few fillRects / arcs per frame, no allocations in
// the hot path (particles live in fixed pools).
import { G } from '../../shared/maps/farm.ts';
import type { World } from './world.ts';

type Ctx = CanvasRenderingContext2D;

const rnd = Math.random;

// ------------------------------------------------------------------ sway
/** Sway amount (shear) for a sprite, 0 = static. */
export function swayFor(name: string, x: number, y: number, t: number): number {
  let amp = 0, speed = 1.3;
  if (name.startsWith('tree') || name === 'forest_pines') amp = 0.022;
  else if (name.startsWith('flower') || name === 'fern' || name === 'plant' || name.startsWith('bush')) { amp = 0.05; speed = 2.1; }
  else if (name.startsWith('crop_')) { amp = 0.035; speed = 1.8; }
  else if (name === 'tallgrass_top') { amp = 0.08; speed = 2.4; }
  else return 0;
  // wind gusts travel across the map from west to east
  const gust = 0.6 + 0.4 * Math.sin(t * 0.35 - x * 0.004);
  return Math.sin(t * speed + x * 0.05 + y * 0.03) * amp * gust;
}

// ------------------------------------------------------------- particles
interface Ripple { x: number; y: number; t: number; life: number; big: boolean }
interface Drop { x: number; y: number; vx: number; vy: number; t: number }
interface Fly { x: number; y: number; hx: number; hy: number; ph: number; c: string }
interface Leaf { x: number; y: number; vx: number; t: number; life: number; c: string }
interface Glint { x: number; y: number; t: number; life: number }

const FLY_COLORS = ['#fff6d8', '#ffd84a', '#f59fd0', '#9fd4ff', '#ffb35c'];
const LEAF_COLORS = ['#7fb24a', '#a6c94a', '#d9a441', '#c9703a'];

export class Effects {
  private water: Int32Array;        // packed px coords of water cells (4px grid)
  private ripples: Ripple[] = [];
  private drops: Drop[] = [];
  private glints: Glint[] = [];
  private flies: Fly[] = [];
  private leaves: Leaf[] = [];
  private nextRipple = 0;
  private nextFish = 3;
  private nextLeaf = 0;
  private trees: { x: number; y: number; h: number }[] = [];
  private world: World;

  constructor(world: World) {
    this.world = world;
    const pts: number[] = [];
    for (let y = 2; y < world.pxH; y += 4)
      for (let x = 2; x < world.pxW; x += 4)
        // keep cells with water all around so effects stay off the banks
        if (world.fineAt(x, y) === G.Water && world.fineAt(x + 8, y) === G.Water && world.fineAt(x - 8, y) === G.Water
          && world.fineAt(x, y + 6) === G.Water && world.fineAt(x, y - 6) === G.Water) pts.push(x, y);
    this.water = new Int32Array(pts);
    // butterflies live around flowers
    const homes = world.objects.filter((o) => o.name.startsWith('flower'));
    for (let i = 0; i < Math.min(9, homes.length); i++) {
      const h = homes[Math.floor(rnd() * homes.length)];
      this.flies.push({ x: h.x, y: h.y - 16, hx: h.x, hy: h.y - 16, ph: rnd() * 10, c: FLY_COLORS[i % FLY_COLORS.length] });
    }
    for (const o of world.objects) if (o.name.startsWith('tree')) this.trees.push({ x: o.x, y: o.y, h: o.b - o.t });
  }

  private cloudCanvas: HTMLCanvasElement | null = null;

  private cloud(): HTMLCanvasElement {
    if (this.cloudCanvas) return this.cloudCanvas;
    const c = document.createElement('canvas');
    c.width = 360; c.height = 170;
    const g = c.getContext('2d')!;
    const blob = (x: number, y: number, r: number) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(20,30,50,0.07)');
      gr.addColorStop(1, 'rgba(20,30,50,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    blob(120, 90, 85); blob(190, 75, 95); blob(255, 95, 75); blob(165, 110, 70);
    this.cloudCanvas = c;
    return c;
  }

  private randomWater(): [number, number] | null {
    const n = this.water.length / 2;
    if (!n) return null;
    const i = Math.floor(rnd() * n) * 2;
    return [this.water[i], this.water[i + 1]];
  }

  update(dt: number) {
    // ripples from insects / drops on the surface
    if ((this.nextRipple -= dt) <= 0) {
      this.nextRipple = 0.35 + rnd() * 0.5;
      const p = this.randomWater();
      if (p && this.ripples.length < 14) this.ripples.push({ x: p[0], y: p[1], t: 0, life: 1.6, big: false });
    }
    // a fish jumps now and then: splash + big ring
    if ((this.nextFish -= dt) <= 0) {
      this.nextFish = 4 + rnd() * 5;
      const p = this.randomWater();
      if (p) {
        this.ripples.push({ x: p[0], y: p[1], t: 0, life: 2.2, big: true });
        for (let i = 0; i < 7; i++)
          this.drops.push({ x: p[0], y: p[1], vx: (rnd() - 0.5) * 34, vy: -30 - rnd() * 30, t: 0 });
      }
    }
    // sparkles on the water
    while (this.glints.length < Math.min(26, this.water.length / 30)) {
      const p = this.randomWater();
      if (!p) break;
      this.glints.push({ x: p[0], y: p[1], t: -rnd() * 1.5, life: 0.8 + rnd() * 0.8 });
    }
    for (let i = this.glints.length - 1; i >= 0; i--) if ((this.glints[i].t += dt) > this.glints[i].life) this.glints.splice(i, 1);
    for (let i = this.ripples.length - 1; i >= 0; i--) if ((this.ripples[i].t += dt) > this.ripples[i].life) this.ripples.splice(i, 1);
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt; d.vy += 140 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.t > 0.6) this.drops.splice(i, 1);
    }
    // butterflies: flutter around their flower, wander a bit
    for (const f of this.flies) {
      f.ph += dt;
      f.x = f.hx + Math.sin(f.ph * 0.9) * 26 + Math.sin(f.ph * 2.3) * 6;
      f.y = f.hy + Math.cos(f.ph * 0.7) * 14 + Math.sin(f.ph * 3.1) * 4;
      if (rnd() < dt * 0.05) { f.hx += (rnd() - 0.5) * 60; f.hy += (rnd() - 0.5) * 40; }
    }
    // leaves drifting down from trees
    if ((this.nextLeaf -= dt) <= 0 && this.trees.length) {
      this.nextLeaf = 0.5 + rnd() * 0.9;
      const tr = this.trees[Math.floor(rnd() * this.trees.length)];
      this.leaves.push({ x: tr.x + (rnd() - 0.5) * 24, y: tr.y - tr.h * (0.5 + rnd() * 0.3), vx: 6 + rnd() * 8, t: 0,
        life: 3 + rnd() * 2, c: LEAF_COLORS[Math.floor(rnd() * LEAF_COLORS.length)] });
      if (this.leaves.length > 24) this.leaves.shift();
    }
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const l = this.leaves[i];
      l.t += dt; l.y += 9 * dt; l.x += (l.vx + Math.sin(l.t * 3) * 12) * dt;
      if (l.t > l.life) this.leaves.splice(i, 1);
    }
  }

  /** On the ground layer, before sprites. */
  drawWater(ctx: Ctx, t: number) {
    // rings
    ctx.lineWidth = 1;
    for (const r of this.ripples) {
      const k = r.t / r.life;
      const rad = (r.big ? 3 + k * 16 : 2 + k * 9);
      ctx.strokeStyle = `rgba(225,245,255,${(1 - k) * (r.big ? 0.85 : 0.6)})`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, rad, rad * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // sparkles: tiny crosses that twinkle
    for (const g of this.glints) {
      if (g.t < 0) continue;
      const a = Math.sin((g.t / g.life) * Math.PI);
      ctx.fillStyle = `rgba(255,255,255,${a * 0.9})`;
      ctx.fillRect(g.x - 1, g.y, 3, 1);
      if (a > 0.6) ctx.fillRect(g.x, g.y - 1, 1, 3);
    }
    // slow light streaks drifting across the pond
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    const n = this.water.length / 2;
    for (let i = 0; i < 6 && n; i++) {
      const j = (Math.floor(i * n / 6) * 2) | 0;
      const x = this.water[j] + Math.sin(t * 0.6 + i) * 6, y = this.water[j + 1];
      ctx.fillRect(Math.round(x), y, 7, 1);
    }
  }

  /** Above sprites: splash drops, butterflies, leaves, cloud shadows. */
  drawAir(ctx: Ctx, t: number, vx: number, vy: number, vw: number, vh: number) {
    ctx.fillStyle = '#e8f7ff';
    for (const d of this.drops) ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 2);
    for (const l of this.leaves) {
      if (l.x < vx - 8 || l.x > vx + vw + 8 || l.y < vy - 8 || l.y > vy + vh + 8) continue;
      const a = Math.min(1, (l.life - l.t) / 0.8);
      ctx.globalAlpha = a;
      ctx.fillStyle = l.c;
      const flip = Math.sin(l.t * 6) > 0;
      ctx.fillRect(Math.round(l.x), Math.round(l.y), flip ? 3 : 2, flip ? 2 : 3);
    }
    ctx.globalAlpha = 1;
    for (const f of this.flies) {
      if (f.x < vx - 8 || f.x > vx + vw + 8 || f.y < vy - 8 || f.y > vy + vh + 8) continue;
      const open = Math.sin(f.ph * 18) > 0;
      const x = Math.round(f.x), y = Math.round(f.y);
      ctx.fillStyle = f.c;
      if (open) { ctx.fillRect(x - 2, y - 1, 2, 2); ctx.fillRect(x + 1, y - 1, 2, 2); }
      else { ctx.fillRect(x - 1, y - 2, 1, 2); ctx.fillRect(x + 1, y - 2, 1, 2); }
      ctx.fillStyle = '#3a2a1e';
      ctx.fillRect(x, y - 1, 1, 2);
    }
    // soft cloud shadows sliding over the farm (pre-rendered blurry blob)
    const cloud = this.cloud();
    for (let i = 0; i < 3; i++) {
      const span = this.world.pxW + 700;
      const cx = ((t * 9 + i * span / 3) % span) - 350;
      const cy = (i * 0.37 % 1) * this.world.pxH + Math.sin(t * 0.05 + i) * 30;
      if (cx + cloud.width < vx || cx > vx + vw || cy + cloud.height < vy || cy > vy + vh) continue;
      ctx.drawImage(cloud, Math.round(cx), Math.round(cy));
    }
  }
}
