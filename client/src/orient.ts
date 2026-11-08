// Always-landscape: on a phone held upright the whole game (canvas + HUD) is
// rotated 90 degrees with CSS, so it is played in landscape no matter how the
// phone is held. Pointer coordinates are mapped back with toLogical().
export const orient = { rotated: false };

const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

/** Update the rotation state; returns the logical viewport size (CSS px). */
export function updateOrientation(): [number, number] {
  const portrait = innerHeight > innerWidth;
  orient.rotated = touch && portrait;
  document.body.classList.toggle('rot', orient.rotated);
  return orient.rotated ? [innerHeight, innerWidth] : [innerWidth, innerHeight];
}

/** Screen (client) point -> point in the rotated game's own coordinates. */
export function toLogical(cx: number, cy: number): [number, number] {
  return orient.rotated ? [cy, innerWidth - cx] : [cx, cy];
}

/** Screen-space delta -> logical delta (for the joystick). */
export function deltaToLogical(dx: number, dy: number): [number, number] {
  return orient.rotated ? [dy, -dx] : [dx, dy];
}
