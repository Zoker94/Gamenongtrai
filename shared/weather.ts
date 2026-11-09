// Weather schedule shared by client (visuals) and server (rain waters crops).
// A slot's weather is a pure function of time, so everyone agrees on it.
export type Kind = 'sun' | 'cloud' | 'rain' | 'storm' | 'fog';
export const SLOT_MS = 5 * 60 * 1000; // weather changes every 5 minutes

export function weatherForSlot(slot: number): Kind {
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

export const weatherAt = (t: number): Kind => weatherForSlot(Math.floor(t / SLOT_MS));
const wet = (k: Kind) => k === 'rain' || k === 'storm';
export const isRainingAt = (t: number) => wet(weatherAt(t));

/** First moment in [from, to] when it is raining, or 0. Checks at most ~1 day. */
export function firstRainBetween(from: number, to: number): number {
  if (to < from) return 0;
  let slot = Math.floor(from / SLOT_MS);
  const last = Math.min(Math.floor(to / SLOT_MS), slot + 480);
  for (; slot <= last; slot++) if (wet(weatherForSlot(slot))) return Math.max(from, slot * SLOT_MS);
  return 0;
}
