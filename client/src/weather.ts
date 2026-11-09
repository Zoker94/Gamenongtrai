// Weather: sunny, cloudy, rain, storm, fog. The weather of a time slot is
// derived from the (server-synced) clock, so every player sees the same sky.
// Everything is drawn in screen space after the world; cheap fixed pools.

export type Kind = 'sun' | 'cloud' | 'rain' | 'storm' | 'fog';
export const WEATHER_NAME: Record<Kind, string> = {
  sun: 'Trời nắng', cloud: 'Nhiều mây', rain: 'Trời mưa', storm: 'Mưa giông', fog: 'Sương mù',
};

const SLOT_MS = 3 * 60 * 1000; // weather changes every 3 minutes

function weatherForSlot(slot: number): Kind {
  // murmur3 finalizer: well mixed even for consecutive slot numbers
  let h = (slot ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  const v = (h >>> 0) / 4294967296;
  if (v < 0.40) return 'sun';
  if (v < 0.58) return 'cloud';
  if (v < 0.83) return 'rain';
  if (v < 0.93) return 'storm';
  return 'fog';
}

interface Drop { x: number; y: number; v: number; l: number }
interface Splash { x: number; y: number; t: number }

export class Weather {
  kind: Kind = 'sun';
  /** smoothed intensities 0..1 */
  rain = 0;
  dark = 0;
  fog = 0;
  sun = 1;
  private flash = 0;
  private nextBolt = 5;
  private drops: Drop[] = [];
  private splashes: Splash[] = [];
  private forced: Kind | null;
  onChange: (k: Kind) => void = () => {};

  constructor() {
    const q = new URLSearchParams(location.search).get('w') as Kind | null;
    this.forced = q && q in WEATHER_NAME ? q : null;
    for (let i = 0; i < 420; i++) this.drops.push({ x: Math.random(), y: Math.random(), v: 0.9 + Math.random() * 0.6, l: 0.6 + Math.random() * 0.8 });
  }

  update(dt: number, now: number) {
    const k = this.forced || weatherForSlot(Math.floor(now / SLOT_MS));
    if (k !== this.kind) { this.kind = k; this.onChange(k); }
    const tr = Math.min(1, dt * 0.6); // ~2 s cross-fade
    const target = {
      sun: [0, 0, 0, 1], cloud: [0, 0.35, 0, 0.2], rain: [0.65, 0.55, 0.1, 0], storm: [1, 0.8, 0.15, 0], fog: [0, 0.2, 1, 0.1],
    }[k];
    this.rain += (target[0] - this.rain) * tr;
    this.dark += (target[1] - this.dark) * tr;
    this.fog += (target[2] - this.fog) * tr;
    this.sun += (target[3] - this.sun) * tr;
    // lightning
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (k === 'storm' && (this.nextBolt -= dt) <= 0) {
      this.nextBolt = 6 + Math.random() * 9;
      this.flash = 1;
      setTimeout(() => { this.flash = Math.max(this.flash, 0.6); }, 120); // double flicker
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) if ((this.splashes[i].t += dt) > 0.3) this.splashes.splice(i, 1);
  }

  /** Screen-space overlay. w/h in device px, s = device px per CSS px. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, s: number) {
    // overcast tint
    if (this.dark > 0.01) {
      ctx.fillStyle = `rgba(22,32,52,${0.5 * this.dark})`;
      ctx.fillRect(0, 0, w, h);
    }
    // rain streaks
    if (this.rain > 0.02) {
      const n = Math.floor(this.drops.length * this.rain);
      const slant = 0.28;
      ctx.strokeStyle = `rgba(210,228,255,${0.5 + 0.3 * this.rain})`;
      ctx.lineWidth = Math.max(1.5, s * 1.3);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const d = this.drops[i];
        d.y += d.v * dt * 1.6;
        d.x += d.v * dt * 1.6 * slant * (h / w);
        if (d.y > 1) {
          // landed: small splash on the ground, respawn at the top
          if (this.splashes.length < 60 && Math.random() < 0.5) this.splashes.push({ x: d.x * w, y: d.y * h * 0.98, t: 0 });
          d.y -= 1 + Math.random() * 0.2; d.x = Math.random() * 1.2 - 0.2;
        }
        const x = d.x * w, y = d.y * h, L = 26 * s * d.l;
        ctx.moveTo(x, y); ctx.lineTo(x - L * slant, y - L);
      }
      ctx.stroke();
      // splashes anywhere on screen (the ground is everywhere in a top-down view)
      if (Math.random() < this.rain * 0.9 && this.splashes.length < 60)
        this.splashes.push({ x: Math.random() * w, y: Math.random() * h, t: 0 });
      ctx.strokeStyle = `rgba(225,238,255,${0.75 * this.rain})`; ctx.lineWidth = Math.max(1, s);
      for (const p of this.splashes) {
        const r = (2 + p.t * 20) * s;
        ctx.globalAlpha = 1 - p.t / 0.3;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // fog: soft white veil, slowly drifting bands
    if (this.fog > 0.02) {
      const t = performance.now() / 1000;
      ctx.fillStyle = `rgba(225,232,236,${0.28 * this.fog})`;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) {
        const y = ((i * 0.27 + t * 0.01) % 1.2 - 0.1) * h;
        const g = ctx.createLinearGradient(0, y - h * 0.12, 0, y + h * 0.12);
        g.addColorStop(0, 'rgba(235,240,242,0)');
        g.addColorStop(0.5, `rgba(235,240,242,${0.22 * this.fog})`);
        g.addColorStop(1, 'rgba(235,240,242,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, y - h * 0.12, w, h * 0.24);
      }
    }
    // lightning flash
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(235,240,255,${0.55 * this.flash})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
