import { G, GRASSY, SOLID, type GameMap, type MapObject } from '../../shared/maps/farm.ts';
import { type Atlas, drawAnchored, drawAt } from './atlas.ts';
import { footprintFor } from './footprints.ts';

export const TILE = 32;
const CHUNK = 16; // tiles per chunk side
const CHUNK_PX = CHUNK * TILE;
const CELL = 4; // px per fine terrain cell

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Placed {
  name: string;
  /** anchor in world px */
  x: number;
  y: number;
  flip: boolean;
  /** sprite bounds for culling */
  l: number; t: number; r: number; b: number;
}

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const NO_SHADOW = /^(fence_|flowers_|dec_|leaves|pebbles|waterfall|cave|arena_floor|fern)/;

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

/**
 * Static part of a map: ground pre-rendered into chunk canvases once,
 * objects with collision boxes indexed in a tile grid.
 */
export class World {
  readonly map: GameMap;
  readonly atlas: Atlas;
  readonly pxW: number;
  readonly pxH: number;
  readonly objects: Placed[] = [];
  private chunks: (OffscreenCanvas | HTMLCanvasElement)[] = [];
  private cw: number;
  private ch: number;
  /** collision boxes [x, y, w, h] in world px */
  private boxes: Float32Array;
  /** per-tile list of box indices */
  private grid: number[][];

  constructor(map: GameMap, atlas: Atlas) {
    this.map = map;
    this.atlas = atlas;
    this.pxW = map.w * TILE;
    this.pxH = map.h * TILE;
    this.cw = Math.ceil(map.w / CHUNK);
    this.ch = Math.ceil(map.h / CHUNK);

    const boxes: number[] = [];
    for (const o of map.objects) this.place(o, boxes);
    // tall grass blades drawn over the player's legs
    const tg = atlas.frames['tallgrass_top'];
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++)
        if (tg && map.ground[y * map.w + x] === G.TallGrass) {
          const ax = x * TILE + TILE / 2, ay = (y + 1) * TILE;
          this.objects.push({ name: 'tallgrass_top', x: ax, y: ay, flip: (x + y) % 2 === 1, l: ax - 16, r: ax + 16, t: ay - tg[3], b: ay });
        }
    this.objects.sort((a, b) => a.y - b.y);
    this.boxes = new Float32Array(boxes);
    this.grid = Array.from({ length: map.w * map.h }, () => []);
    for (let i = 0; i < boxes.length; i += 4) {
      const x0 = Math.floor(boxes[i] / TILE), y0 = Math.floor(boxes[i + 1] / TILE);
      const x1 = Math.floor((boxes[i] + boxes[i + 2]) / TILE), y1 = Math.floor((boxes[i + 1] + boxes[i + 3]) / TILE);
      for (let y = Math.max(0, y0); y <= Math.min(map.h - 1, y1); y++)
        for (let x = Math.max(0, x0); x <= Math.min(map.w - 1, x1); x++) this.grid[y * map.w + x].push(i);
    }
    this.renderChunks();
  }

  private place(o: MapObject, boxes: number[]) {
    const f = this.atlas.frames[o.s];
    if (!f) return;
    const x = Math.round(o.x * TILE + TILE / 2), y = Math.round(o.y * TILE);
    this.objects.push({
      name: o.s, x, y, flip: !!o.f,
      l: x - f[2] / 2, r: x + f[2] / 2, t: y - f[3], b: y,
    });
    for (const [dx, dy, w, h] of footprintFor(o.s, f[2], f[3])) {
      boxes.push(o.f ? x - dx - w : x + dx, y + dy, w, h);
    }
  }

  ground(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return -1;
    return this.map.ground[y * this.map.w + x];
  }

  // ------------------------------------------------------------- ground art
  /**
   * Ground is rendered from a fine terrain grid (CELL px per cell) so that
   * roads, water and meadows get smooth organic edges instead of tile steps.
   * Each terrain type is drawn as a tiled texture, masked by its cells, then
   * outlines are added. All of it happens once at load; per frame we only
   * blit the cached chunks.
   */
  private fine!: Uint8Array;
  private fw = 0;
  private fh = 0;

  fineAt(px: number, py: number): number {
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
    if (cx < 0 || cy < 0 || cx >= this.fw || cy >= this.fh) return -1;
    return this.fine[cy * this.fw + cx];
  }

  private buildFine() {
    this.fw = this.pxW / CELL; this.fh = this.pxH / CELL;
    this.fine = new Uint8Array(this.fw * this.fh);
    const k = CELL / TILE;
    for (let y = 0; y < this.fh; y++)
      for (let x = 0; x < this.fw; x++) this.fine[y * this.fw + x] = this.map.terrainAt((x + 0.5) * k, (y + 0.5) * k);
    // painted scenes carry their own water mask
    for (const sc of this.map.scenes) {
      const mask = this.atlas.masks[sc.s];
      const [l, t] = this.sceneOrigin(sc);
      if (!mask) continue;
      const cx0 = l / CELL, cy0 = t / CELL;
      for (let y = 0; y < mask.length; y++)
        for (let x = 0; x < mask[y].length; x++) {
          const fx = cx0 + x, fy = cy0 + y;
          if (mask[y][x] === '1' && fx >= 0 && fy >= 0 && fx < this.fw && fy < this.fh) this.fine[fy * this.fw + fx] = G.Water;
        }
    }
  }

  /** Top-left of a scene in world px, snapped to the collision cell grid. */
  private sceneOrigin(sc: MapObject): [number, number] {
    const f = this.atlas.frames[sc.s];
    const px = sc.x * TILE + TILE / 2, py = sc.y * TILE;
    return [Math.round((px - f[2] / 2) / CELL) * CELL, Math.round((py - f[3]) / CELL) * CELL];
  }

  private texture(g: number, tx: number, ty: number): string {
    const h = hash(tx, ty);
    switch (g) {
      case G.Grass: return 'tile_grass' + (h % 4);
      case G.DarkGrass: return 'tile_grassd' + (h % 4);
      case G.TallGrass: return 'tile_tallgrass';
      case G.Field: return 'tile_field';
      case G.Sand: return 'tile_sand';
      case G.Stone: return 'tile_stone';
      case G.Water: return 'tile_water';
      case G.Bridge: return 'tile_bridge_m';
      case G.CliffTop: return 'tile_cliff_top';
      case G.CliffFace: return 'tile_cliff_face';
      case G.Stairs: return 'tile_stairs';
      default: return 'tile_dirt' + (h % 4);
    }
  }

  private renderChunks() {
    this.buildFine();
    const CPC = CHUNK_PX / CELL; // cells per chunk side
    const layer = makeCanvas(CHUNK_PX, CHUNK_PX);
    const lctx = layer.getContext('2d') as Ctx2D;
    const mask = makeCanvas(CPC, CPC);
    const mctx = mask.getContext('2d') as Ctx2D;
    const mdata = mctx.createImageData(CPC, CPC);
    const m32 = new Uint32Array(mdata.data.buffer);
    lctx.imageSmoothingEnabled = false;
    const ORDER = [G.DarkGrass, G.TallGrass, G.Field, G.Dirt, G.Sand, G.Stone, G.Water, G.Bridge, G.CliffTop, G.CliffFace, G.Stairs];

    for (let cy = 0; cy < this.ch; cy++)
      for (let cx = 0; cx < this.cw; cx++) {
        const c = makeCanvas(CHUNK_PX, CHUNK_PX);
        const ctx = c.getContext('2d') as Ctx2D;
        ctx.imageSmoothingEnabled = false;
        const ox = cx * CHUNK, oy = cy * CHUNK;
        const fx0 = cx * CPC, fy0 = cy * CPC;
        // base: grass everywhere
        for (let y = 0; y < CHUNK; y++)
          for (let x = 0; x < CHUNK; x++) drawAt(ctx, this.atlas, this.texture(G.Grass, ox + x, oy + y), x * TILE, y * TILE);
        // one masked layer per terrain type present in this chunk
        const present = new Set<number>();
        for (let y = 0; y < CPC; y++)
          for (let x = 0; x < CPC; x++) {
            const fxx = fx0 + x, fyy = fy0 + y;
            if (fxx < this.fw && fyy < this.fh) present.add(this.fine[fyy * this.fw + fxx]);
          }
        for (const g of ORDER) {
          if (!present.has(g)) continue;
          for (let y = 0; y < CPC; y++)
            for (let x = 0; x < CPC; x++) {
              const fxx = fx0 + x, fyy = fy0 + y;
              m32[y * CPC + x] = fxx < this.fw && fyy < this.fh && this.fine[fyy * this.fw + fxx] === g ? 0xffffffff : 0;
            }
          mctx.putImageData(mdata, 0, 0);
          lctx.globalCompositeOperation = 'source-over';
          lctx.clearRect(0, 0, CHUNK_PX, CHUNK_PX);
          for (let y = 0; y < CHUNK; y++)
            for (let x = 0; x < CHUNK; x++) drawAt(lctx, this.atlas, this.texture(g, ox + x, oy + y), x * TILE, y * TILE);
          lctx.globalCompositeOperation = 'destination-in';
          lctx.drawImage(mask, 0, 0, CHUNK_PX, CHUNK_PX);
          ctx.drawImage(layer, 0, 0);
        }
        lctx.globalCompositeOperation = 'source-over';
        this.drawOutlines(ctx, fx0, fy0, CPC);

        ctx.translate(-ox * TILE, -oy * TILE);
        const near = (px: number, py: number, m: number) =>
          px > ox * TILE - m && px < (ox + CHUNK) * TILE + m && py > oy * TILE - m && py < (oy + CHUNK) * TILE + m;
        // painted court lines
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (const cr of this.map.courts) {
          const x0 = cr.x0 * TILE + 6, y0 = cr.y0 * TILE + 6, x1 = (cr.x1 + 1) * TILE - 6, y1 = (cr.y1 + 1) * TILE - 6;
          ctx.fillRect(x0, y0, x1 - x0, 2); ctx.fillRect(x0, y1 - 2, x1 - x0, 2);
          ctx.fillRect(x0, y0, 2, y1 - y0); ctx.fillRect(x1 - 2, y0, 2, y1 - y0);
          const mx = Math.round((x0 + x1) / 2) - 1, my = (y0 + y1) / 2;
          ctx.fillRect(mx, y0, 2, y1 - y0);
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(mx + 1, my, 26, 0, Math.PI * 2); ctx.stroke();
        }
        // painted scenes (pond...), then decals (tiny flowers, tufts...), then soft contact shadows
        for (const sc of this.map.scenes) {
          const f = this.atlas.frames[sc.s];
          if (!f) continue;
          const [l, t] = this.sceneOrigin(sc);
          if (l > (ox + CHUNK) * TILE || t > (oy + CHUNK) * TILE || l + f[2] < ox * TILE || t + f[3] < oy * TILE) continue;
          drawAt(ctx, this.atlas, sc.s, l, t);
        }
        for (const d of this.map.decals) {
          const px = d.x * TILE + TILE / 2, py = d.y * TILE;
          if (near(px, py, 64) && !this.underScene(px, py)) drawAnchored(ctx, this.atlas, d.s, px, py, !!d.f);
        }
        ctx.fillStyle = 'rgba(18,40,22,0.26)';
        for (const o of this.objects) {
          if (!near(o.x, o.y, 96) || o.name === 'tallgrass_top' || NO_SHADOW.test(o.name)) continue;
          const w = o.r - o.l;
          const rx = Math.max(5, Math.min(w * 0.42, 56)), ry = Math.max(2.5, Math.min(rx * 0.32, 11));
          ctx.beginPath(); ctx.ellipse(o.x, o.y - ry * 0.6, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        }
        this.chunks.push(c);
      }
  }

  private underScene(px: number, py: number) {
    for (const sc of this.map.scenes) {
      const f = this.atlas.frames[sc.s];
      const [l, t] = this.sceneOrigin(sc);
      if (f && px >= l && px < l + f[2] && py >= t && py < t + f[3]) return true;
    }
    return false;
  }

  /** Pixel-art outlines where terrain types meet (grass rim, shore, bridge rails, cliff shadow). */
  private drawOutlines(ctx: Ctx2D, fx0: number, fy0: number, n: number) {
    const fw = this.fw, fh = this.fh, f = this.fine;
    const at = (x: number, y: number, self: number) => (x < 0 || y < 0 || x >= fw || y >= fh ? self : f[y * fw + x]);
    const C = CELL;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const gx = fx0 + x, gy = fy0 + y;
        if (gx >= fw || gy >= fh) continue;
        const g = f[gy * fw + gx];
        const px = x * C, py = y * C;
        const up = at(gx, gy - 1, g), dn = at(gx, gy + 1, g), lf = at(gx - 1, gy, g), rt = at(gx + 1, gy, g);
        if (g === G.Dirt || g === G.Field || g === G.Sand) {
          // grass lip overhanging the soil
          ctx.fillStyle = '#4f8f3e';
          if (GRASSY.has(up)) ctx.fillRect(px, py, C, 2);
          if (GRASSY.has(dn)) ctx.fillRect(px, py + C - 1, C, 1);
          if (GRASSY.has(lf)) ctx.fillRect(px, py, 2, C);
          if (GRASSY.has(rt)) ctx.fillRect(px + C - 2, py, 2, C);
          ctx.fillStyle = 'rgba(90,60,30,0.35)';
          if (GRASSY.has(up)) ctx.fillRect(px, py + 2, C, 1);
        } else if (g === G.Water) {
          const land = (v: number) => v !== G.Water && v !== G.Bridge && v !== G.CliffFace && v !== G.CliffTop;
          ctx.fillStyle = '#2f5a3a';
          if (land(up)) ctx.fillRect(px, py, C, 2);
          if (land(dn)) ctx.fillRect(px, py + C - 2, C, 2);
          if (land(lf)) ctx.fillRect(px, py, 2, C);
          if (land(rt)) ctx.fillRect(px + C - 2, py, 2, C);
          ctx.fillStyle = 'rgba(200,236,250,0.8)';
          if (land(up)) ctx.fillRect(px, py + 2, C, 1);
          if (land(lf)) ctx.fillRect(px + 2, py, 1, C);
          if (land(rt)) ctx.fillRect(px + C - 3, py, 1, C);
        } else if (g === G.Bridge) {
          if (up !== G.Bridge) { ctx.fillStyle = '#7a4e2c'; ctx.fillRect(px, py, C, 3); ctx.fillStyle = '#3e2718'; ctx.fillRect(px, py + 3, C, 1); }
          if (dn !== G.Bridge) { ctx.fillStyle = '#3e2718'; ctx.fillRect(px, py + C - 4, C, 1); ctx.fillStyle = '#7a4e2c'; ctx.fillRect(px, py + C - 3, C, 3); }
          if ((gx & 3) === 0 && (up !== G.Bridge || dn !== G.Bridge)) { ctx.fillStyle = '#3e2718'; ctx.fillRect(px, py, 2, C); }
        } else if (g === G.TallGrass) {
          ctx.fillStyle = '#3d7a37';
          if (up !== G.TallGrass && GRASSY.has(up)) ctx.fillRect(px, py, C, 1);
        }
        if (up === G.CliffFace && g !== G.CliffFace) {
          ctx.fillStyle = 'rgba(10,20,10,0.30)'; ctx.fillRect(px, py, C, C);
        } else if (at(gx, gy - 2, g) === G.CliffFace && g !== G.CliffFace) {
          ctx.fillStyle = 'rgba(10,20,10,0.15)'; ctx.fillRect(px, py, C, C);
        }
      }
  }

  /** Little moving glints on visible water (a few fillRects per frame). */
  drawWaterGlints(ctx: CanvasRenderingContext2D, vx: number, vy: number, vw: number, vh: number, time: number) {
    const x0 = Math.max(0, Math.floor(vx / TILE)), y0 = Math.max(0, Math.floor(vy / TILE));
    const x1 = Math.min(this.map.w - 1, Math.floor((vx + vw) / TILE)), y1 = Math.min(this.map.h - 1, Math.floor((vy + vh) / TILE));
    const step = Math.floor(time / 450);
    ctx.fillStyle = 'rgba(220,245,255,0.75)';
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (this.map.ground[y * this.map.w + x] !== G.Water) continue;
        const hh = hash(x * 7 + step, y * 3 + (step >> 1));
        if (hh % 3) continue;
        const gx = x * TILE + 6 + (hh >>> 4) % 20, gy = y * TILE + 6 + (hh >>> 9) % 20;
        if (this.fineAt(gx, gy) !== G.Water || this.fineAt(gx + 4, gy) !== G.Water) continue;
        ctx.fillRect(gx, gy, 3, 1);
        ctx.fillRect(gx + 1, gy - 1, 1, 1);
      }
  }

  /** Draw ground chunks intersecting the view rect (world px). */
  drawGround(ctx: CanvasRenderingContext2D, vx: number, vy: number, vw: number, vh: number) {
    const x0 = Math.max(0, Math.floor(vx / CHUNK_PX)), y0 = Math.max(0, Math.floor(vy / CHUNK_PX));
    const x1 = Math.min(this.cw - 1, Math.floor((vx + vw) / CHUNK_PX));
    const y1 = Math.min(this.ch - 1, Math.floor((vy + vh) / CHUNK_PX));
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) ctx.drawImage(this.chunks[cy * this.cw + cx], cx * CHUNK_PX, cy * CHUNK_PX);
  }

  // -------------------------------------------------------------- collision
  /** True if an axis-aligned box (world px) hits water / map edge / an object. */
  blocked(x: number, y: number, w: number, h: number): boolean {
    const m = this.map;
    const tx0 = Math.floor(x / TILE), ty0 = Math.floor(y / TILE);
    const tx1 = Math.floor((x + w - 0.001) / TILE), ty1 = Math.floor((y + h - 0.001) / TILE);
    const b = this.boxes;
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) {
          if (!this.exitAt(tx, ty)) return true;
          continue;
        }
        for (const i of this.grid[ty * m.w + tx]) {
          if (x < b[i] + b[i + 2] && x + w > b[i] && y < b[i + 1] + b[i + 3] && y + h > b[i + 1]) return true;
        }
      }
    // terrain at sub-tile resolution (smooth shores, cliff)
    for (let py = Math.floor(y / CELL) * CELL; py < y + h; py += CELL)
      for (let px = Math.floor(x / CELL) * CELL; px < x + w; px += CELL) {
        const g = this.fineAt(px, py);
        if (g >= 0 && SOLID.has(g)) return true;
      }
    return false;
  }

  /** Exit for a tile just outside the map (or on its border). */
  exitAt(tx: number, ty: number) {
    const cx = Math.min(this.map.w - 1, Math.max(0, tx)), cy = Math.min(this.map.h - 1, Math.max(0, ty));
    for (const e of this.map.exits) if (cx >= e.x0 && cx <= e.x1 && cy >= e.y0 && cy <= e.y1) return e;
    return null;
  }
}
