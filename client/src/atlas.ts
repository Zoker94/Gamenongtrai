/** [srcX, srcY, worldW, worldH, srcW, srcH]: source rect in the atlas image,
 *  size in game pixels (atlas is stored at `res` x density). */
export type Frame = [x: number, y: number, w: number, h: number, sw: number, sh: number];

export interface Atlas {
  img: CanvasImageSource;
  frames: Record<string, Frame>;
  /** atlas pixels per game pixel */
  res: number;
  /** per-sprite walkability masks (rows of '0'/'1', 4px cells; 1 = water) */
  masks: Record<string, string[]>;
}

export async function loadAtlas(base = '/assets/'): Promise<Atlas> {
  const [meta, blob] = await Promise.all([
    fetch(base + 'atlas.json').then((r) => r.json()),
    fetch(base + 'atlas.webp').then((r) => r.blob()),
  ]);
  // createImageBitmap decodes off the main thread where supported.
  let img: CanvasImageSource;
  if ('createImageBitmap' in window) img = await createImageBitmap(blob);
  else {
    const el = new Image();
    el.src = URL.createObjectURL(blob);
    await el.decode();
    img = el;
  }
  const res: number = meta.res || 1;
  const frames: Record<string, Frame> = {};
  for (const k in meta.frames) {
    const [x, y, w, h] = meta.frames[k];
    frames[k] = [x, y, w / res, h / res, w, h];
  }
  return { img, frames, res, masks: meta.masks || {} };
}

/** Draw sprite with its bottom-centre at (x, y). */
export function drawAnchored(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  a: Atlas, name: string, x: number, y: number, flip = false,
) {
  const f = a.frames[name];
  if (!f) return;
  const dx = Math.round(x - f[2] / 2), dy = Math.round(y - f[3]);
  if (flip) {
    ctx.save();
    ctx.translate(dx + f[2], dy);
    ctx.scale(-1, 1);
    ctx.drawImage(a.img, f[0], f[1], f[4], f[5], 0, 0, f[2], f[3]);
    ctx.restore();
  } else {
    ctx.drawImage(a.img, f[0], f[1], f[4], f[5], dx, dy, f[2], f[3]);
  }
}

/** Draw sprite with top-left at (x, y). */
export function drawAt(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  a: Atlas, name: string, x: number, y: number,
) {
  const f = a.frames[name];
  if (f) ctx.drawImage(a.img, f[0], f[1], f[4], f[5], x, y, f[2], f[3]);
}

/** Small standalone canvas with one sprite, for DOM icons. */
export function iconCanvas(a: Atlas, name: string, size = 32): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const px = size * 2;
  c.width = c.height = px;
  const f = a.frames[name];
  if (f) {
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const s = Math.min(px / f[4], px / f[5]);
    const w = Math.round(f[4] * s), h = Math.round(f[5] * s);
    ctx.drawImage(a.img, f[0], f[1], f[4], f[5], (px - w) >> 1, (px - h) >> 1, w, h);
  }
  return c;
}
