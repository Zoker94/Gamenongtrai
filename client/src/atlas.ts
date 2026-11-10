/** [srcX, srcY, worldW, worldH, srcW, srcH]: source rect in the atlas image,
 *  size in game pixels (atlas is stored at `res` x density). */
export type Frame = [x: number, y: number, w: number, h: number, sw: number, sh: number, below?: number];

export interface Atlas {
  img: CanvasImageSource;
  frames: Record<string, Frame>;
  /** atlas pixels per game pixel */
  res: number;
  /** per-sprite walkability masks (rows of '0'/'1', 4px cells; 1 = water) */
  masks: Record<string, string[]>;
  /** body frame -> waist line as a fraction of the frame height from its bottom (clothing halves) */
  waist: Record<string, number>;
}

/** fetch with retries (flaky mobile networks, a server that is waking up). */
async function fetchRetry(url: string, tries = 5): Promise<Response> {
  let wait = 600;
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
      if (i >= tries - 1) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i >= tries - 1) throw e;
    }
    await new Promise((res) => setTimeout(res, wait));
    wait = Math.min(wait * 2, 5000);
  }
}

/** Read a response body as a Blob, reporting progress 0..1. */
async function readWithProgress(r: Response, onProgress?: (p: number) => void): Promise<Blob> {
  const total = Number(r.headers.get('content-length')) || 0;
  if (!r.body || !total || !onProgress) return r.blob();
  const reader = r.body.getReader();
  const parts: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value as BlobPart);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  return new Blob(parts, { type: r.headers.get('content-type') || 'image/webp' });
}

export async function loadAtlas(base = '/assets/', onProgress?: (p: number) => void): Promise<Atlas> {
  const [meta, blob] = await Promise.all([
    fetchRetry(base + 'atlas.json').then((r) => r.json()),
    fetchRetry(base + 'atlas.webp').then((r) => readWithProgress(r, onProgress)),
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
    const below = meta.anchors?.[k] ? meta.anchors[k] / res : 0;
    frames[k] = [x, y, w / res, h / res, w, h, below];
  }
  return { img, frames, res, masks: meta.masks || {}, waist: meta.waist || {} };
}

/** Draw sprite with its bottom-centre at (x, y). */
export function drawAnchored(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  a: Atlas, name: string, x: number, y: number, flip = false,
) {
  const f = a.frames[name];
  if (!f) return;
  const dx = Math.round(x - f[2] / 2), dy = Math.round(y - f[3] + (f[6] || 0));
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
