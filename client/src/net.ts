import { type Action, type FarmState, type StarterPlot, applyAction, growAll, newFarm } from '../../shared/rules.ts';

const LS_FARM = 'gnt_farm:';

type ServerMsg =
  | { t: 'state'; st: FarmState; now: number }
  | { t: 'ok'; seq: number; v: number }
  | { t: 'err'; seq: number; msg: string; st: FarmState; now: number };

/**
 * Farm state store. Actions are applied immediately (client prediction with
 * the shared rules) and sent to the server, which is authoritative. Without a
 * server the game keeps working offline from localStorage.
 */
export class Store {
  st: FarmState;
  online = false;
  private skew = 0;
  private ws: WebSocket | null = null;
  private seq = 0;
  private retry = 1000;
  private saveTimer = 0;
  private readonly canTill: (x: number, y: number) => boolean;
  onChange: () => void = () => {};
  onError: (msg: string) => void = () => {};
  onNet: (online: boolean) => void = () => {};
  /** server rejected the session token */
  onAuthFail: () => void = () => {};
  private readonly token: string;
  private readonly lsKey: string;

  constructor(canTill: (x: number, y: number) => boolean, starter: StarterPlot[], token: string, username: string) {
    this.canTill = canTill;
    this.token = token;
    this.lsKey = LS_FARM + username;
    let st: FarmState | null = null;
    try { st = JSON.parse(localStorage.getItem(this.lsKey) || 'null'); } catch { /* ignore */ }
    this.st = st && st.plots ? st : newFarm(starter);
    this.connect();
  }

  now() { return Date.now() + this.skew; }

  /** Lazily advance crop growth; call ~1/s. */
  tick() {
    if (growAll(this.st, this.now())) { this.onChange(); this.saveLocal(); }
  }

  act(a: Action): boolean {
    const err = applyAction(this.st, a, this.now(), this.canTill);
    if (err) { this.onError(err); return false; }
    this.onChange();
    if (this.online && this.ws) this.ws.send(JSON.stringify({ t: 'act', seq: ++this.seq, a }));
    this.saveLocal();
    return true;
  }

  private saveLocal() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try { localStorage.setItem(this.lsKey, JSON.stringify(this.st)); } catch { /* quota */ }
    }, 500);
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    try { ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(this.token)}`); } catch { return; }
    this.ws = ws;
    ws.onopen = () => { this.retry = 1000; };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'state' || m.t === 'err') {
        this.skew = m.now - Date.now();
        this.st = m.st;
        if (!this.online) { this.online = true; this.onNet(true); }
        if (m.t === 'err') this.onError(m.msg);
        this.onChange();
        this.saveLocal();
      }
    };
    ws.onclose = (ev) => {
      if (ev.code === 4001) { this.onAuthFail(); return; }
      this.ws = null;
      if (this.online) { this.online = false; this.onNet(false); }
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 30000);
    };
  }
}
