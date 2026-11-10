// Clothing atlases: one small atlas per item (client/public/assets/wear/<id>.webp,
// built by tools/build_assets.py), fetched the first time the item is worn or
// previewed, so the game download does not grow with the clothing catalogue.
import { type Atlas, loadAtlas } from './atlas.ts';

const cache = new Map<string, Atlas | 'loading' | 'missing'>();
const listeners: (() => void)[] = [];

/** called once an item's atlas has arrived (redraw previews) */
export function onWearLoaded(fn: () => void) { listeners.push(fn); }

/** The item's atlas if it is ready; otherwise starts loading it and returns null. */
export function wearAtlas(id: string): Atlas | null {
  const c = cache.get(id);
  if (c && typeof c !== 'string') return c;
  if (!c) {
    cache.set(id, 'loading');
    loadAtlas('/assets/wear/', undefined, id)
      .then((a) => { cache.set(id, a); for (const fn of listeners) fn(); })
      .catch(() => cache.set(id, 'missing'));
  }
  return null;
}

/** Start loading several items (equipped clothes at start-up). */
export function preloadWear(ids: (string | undefined)[]) { for (const id of ids) if (id) wearAtlas(id); }

/**
 * Frame of a clothing item matching a body frame `<sprite>_<d>_<tag><i>`:
 * standing frames share one pose per direction (`wh_<id>_<d>_i`), the others
 * map one to one (walk w, harvest h, hoe g, water u).
 */
export function wearFrame(id: string | undefined, body: string): [Atlas, string] | null {
  if (!id) return null;
  const m = /_(\d)_([iwhgu])(\d+)$/.exec(body);
  if (!m) return null;
  const a = wearAtlas(id);
  if (!a) return null;
  const n = m[2] === 'i' ? `wh_${id}_${m[1]}_i` : `wh_${id}_${m[1]}_${m[2]}${m[3]}`;
  return a.frames[n] ? [a, n] : null;
}
