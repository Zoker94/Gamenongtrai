import { G, type GameMap, type MapObject } from '../../shared/maps/farm.ts';
import { type Atlas, drawAnchored, drawAt } from './atlas.ts';
import { footprintFor } from './footprints.ts';

export const TILE = 32;
const CHUNK = 16; // tiles per chunk side
const CHUNK_PX = CHUNK * TILE;

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
  private renderChunks() {
    for (let cy = 0; cy < this.ch; cy++)
      for (let cx = 0; cx < this.cw; cx++) {
        const c = makeCanvas(CHUNK_PX, CHUNK_PX);
        const ctx = c.getContext('2d') as Ctx2D;
        ctx.imageSmoothingEnabled = false;
        const ox = cx * CHUNK, oy = cy * CHUNK;
        for (let y = 0; y < CHUNK; y++)
          for (let x = 0; x < CHUNK; x++) {
            const tx = ox + x, ty = oy + y;
            if (tx >= this.map.w || ty >= this.map.h) continue;
            this.drawTile(ctx, tx, ty, x * TILE, y * TILE);
          }
        ctx.translate(-ox * TILE, -oy * TILE);
        for (const d of this.map.decals) {
          const px = d.x * TILE + TILE / 2, py = d.y * TILE;
          if (px < ox * TILE - 64 || px > (ox + CHUNK) * TILE + 64 || py < oy * TILE - 64 || py > (oy + CHUNK) * TILE + 64) continue;
          drawAnchored(ctx, this.atlas, d.s, px, py, !!d.f);
        }
        this.chunks.push(c);
      }
  }

  private drawTile(ctx: Ctx2D, tx: number, ty: number, px: number, py: number) {
    const a = this.atlas;
    const g = this.ground(tx, ty);
    const h = hash(tx, ty);
    // neighbours (out of bounds counts as same type => no edge at map border)
    const nb = (dx: number, dy: number) => {
      const v = this.ground(tx + dx, ty + dy);
      return v < 0 ? g : v;
    };
    switch (g) {
      case G.Grass:
        drawAt(ctx, a, 'tile_grass' + (h % 4), px, py);
        return;
      case G.Stone:
        drawAt(ctx, a, 'tile_stone', px, py);
        return;
      case G.Bridge:
        drawAt(ctx, a, 'tile_water', px, py);
        drawAt(ctx, a, nb(0, -1) === G.Bridge ? 'tile_bridge_s' : 'tile_bridge_n', px, py);
        return;
      case G.Water:
        drawAt(ctx, a, 'tile_water', px, py);
        break;
      default: // dirt / field
        drawAt(ctx, a, 'tile_dirt' + (h % 4), px, py);
    }
    const kind = g === G.Water ? 'water' : 'dirt';
    const isEdge = (v: number) => (g === G.Water ? v !== G.Water && v !== G.Bridge : v === G.Grass);
    const n = isEdge(nb(0, -1)), s = isEdge(nb(0, 1)), w = isEdge(nb(-1, 0)), e = isEdge(nb(1, 0));
    if (n) drawAt(ctx, a, `edge_${kind}_n`, px, py);
    if (s) drawAt(ctx, a, `edge_${kind}_s`, px, py);
    if (w) drawAt(ctx, a, `edge_${kind}_w`, px, py);
    if (e) drawAt(ctx, a, `edge_${kind}_e`, px, py);
    if (!n && !w && isEdge(nb(-1, -1))) drawAt(ctx, a, `edge_${kind}_nw`, px, py);
    if (!n && !e && isEdge(nb(1, -1))) drawAt(ctx, a, `edge_${kind}_ne`, px, py);
    if (!s && !w && isEdge(nb(-1, 1))) drawAt(ctx, a, `edge_${kind}_sw`, px, py);
    if (!s && !e && isEdge(nb(1, 1))) drawAt(ctx, a, `edge_${kind}_se`, px, py);
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
        if (m.ground[ty * m.w + tx] === G.Water) return true;
        for (const i of this.grid[ty * m.w + tx]) {
          if (x < b[i] + b[i + 2] && x + w > b[i] && y < b[i + 1] + b[i + 3] && y + h > b[i + 1]) return true;
        }
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
