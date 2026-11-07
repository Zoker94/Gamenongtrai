// Keyboard + virtual joystick + tap/click. No per-frame allocations.

export class Input {
  private keys = new Set<string>();
  /** joystick pushed to the rim */
  jrun = false;
  /** joystick vector */
  jx = 0;
  jy = 0;
  /** queued one-shot events */
  actionPressed = false;
  slotPressed = -1;
  slotDelta = 0;
  tap: { x: number; y: number } | null = null;
  hover: { x: number; y: number } | null = null;
  readonly touch: boolean;

  constructor(canvas: HTMLCanvasElement, stick: HTMLElement, knob: HTMLElement, actBtn: HTMLElement) {
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.body.classList.toggle('touch', this.touch);

    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ' || k === 'e' || k === 'enter') { this.actionPressed = true; e.preventDefault(); }
      else if (k >= '1' && k <= '9') this.slotPressed = +k - 1;
      else if (k === 'q') this.slotDelta = -1;
      else if (k === 'tab') { this.slotDelta = 1; e.preventDefault(); }
      if (k.startsWith('arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('wheel', (e) => { this.slotDelta = e.deltaY > 0 ? 1 : -1; }, { passive: true });
    canvas.addEventListener('pointerdown', (e) => {
      this.tap = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.hover = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- joystick
    let sid = -1, cx = 0, cy = 0;
    const R = 44;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== sid) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      // analog: small push = slow walk, beyond 60% of the radius = full speed
      const k = d > 6 ? Math.min(1, d / (R * 0.6)) / Math.max(d, 1) : 0;
      this.jx = dx * k;
      this.jy = dy * k;
      this.jrun = d > R * 0.92;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== sid) return;
      sid = -1; this.jx = this.jy = 0; this.jrun = false;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerdown', (e) => {
      sid = e.pointerId;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      stick.setPointerCapture(sid);
      move(e);
      e.preventDefault();
    });
    stick.addEventListener('pointermove', move);
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    actBtn.addEventListener('pointerdown', (e) => { this.actionPressed = true; e.preventDefault(); });
  }

  /** Shift held, or joystick pushed all the way out. */
  get run() { return this.keys.has('shift') || this.jrun; }

  /** Movement vector from keys + joystick. */
  axis(out: { x: number; y: number }) {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y -= 1;
    if (k.has('s') || k.has('arrowdown')) y += 1;
    out.x = x || this.jx;
    out.y = y || this.jy;
  }

  consume() {
    this.actionPressed = false;
    this.slotPressed = -1;
    this.slotDelta = 0;
    this.tap = null;
  }
}
