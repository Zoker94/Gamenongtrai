import { CROPS, CROP_IDS, type FarmState } from '../../shared/rules.ts';
import { type Atlas, iconCanvas } from './atlas.ts';

export interface Slot { id: string; icon: string; label: string; count?: number }

const $ = (id: string) => document.getElementById(id)!;

export class UI {
  slots: Slot[] = [];
  sel = 0;
  private atlas: Atlas;
  private hotbar = $('hotbar');
  private coins = $('coins');
  private toastEl = $('toast');
  private netEl = $('net');
  private actBtn = $('act');
  panel = $('panel');
  private toastTimer = 0;
  private sig = '';
  private icons = new Map<string, HTMLCanvasElement>();
  onBuy: (crop: string, n: number) => void = () => {};
  onSell: (item: string, n: number) => void = () => {};

  constructor(atlas: Atlas) {
    this.atlas = atlas;
    const av = $('avatar');
    av.replaceChildren(this.iconEl('portrait', 44));
    this.hotbar.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
      if (el) { this.select(+el.dataset.i!); e.preventDefault(); }
    });
    this.panel.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      if (b.dataset.close != null) this.closePanel();
      else if (b.dataset.buy) this.onBuy(b.dataset.buy, +(b.dataset.n || 1));
      else if (b.dataset.sell) this.onSell(b.dataset.sell, +(b.dataset.n || 1));
    });
  }

  private icon(name: string, size = 32) {
    const k = name + size;
    let c = this.icons.get(k);
    if (!c) { c = iconCanvas(this.atlas, name, size); this.icons.set(k, c); }
    return c.cloneNode(false) as HTMLCanvasElement;
  }

  private iconEl(name: string, size = 32) {
    const c = this.icon(name, size);
    c.getContext('2d')!.drawImage(this.icons.get(name + size)!, 0, 0);
    return c;
  }

  get current(): Slot { return this.slots[this.sel] || this.slots[0]; }

  select(i: number) {
    if (!this.slots.length) return;
    this.sel = ((i % this.slots.length) + this.slots.length) % this.slots.length;
    this.hotbar.querySelectorAll('.slot').forEach((el, j) => el.classList.toggle('sel', j === this.sel));
    this.actBtn.replaceChildren(this.iconEl(this.current.icon, 32));
  }

  /** Rebuild hotbar only when the inventory signature changes. */
  update(st: FarmState) {
    this.coins.innerHTML = `<i class="coin"></i>${st.coins}`;
    const seeds = CROP_IDS.filter((c) => st.inv['seed:' + c]);
    const sig = seeds.map((c) => c + st.inv['seed:' + c]).join('|');
    if (sig === this.sig && this.slots.length) return;
    const prevId = this.current?.id;
    this.sig = sig;
    this.slots = [
      { id: 'hoe', icon: 'tool_hoe', label: 'Cuốc' },
      { id: 'can', icon: 'tool_can', label: 'Bình tưới' },
      { id: 'hand', icon: 'pc_tomato', label: 'Thu hoạch' },
      ...seeds.map((c) => ({ id: 'seed:' + c, icon: 'pc_' + c, label: 'Hạt ' + CROPS[c].name, count: st.inv['seed:' + c] })),
    ];
    this.hotbar.replaceChildren(...this.slots.map((s, i) => {
      const d = document.createElement('div');
      d.className = 'slot';
      d.dataset.i = String(i);
      d.title = `${s.label} (${i + 1})`;
      d.append(this.iconEl(s.icon, 32));
      if (s.id.startsWith('seed:')) d.classList.add('seed');
      if (s.count != null) {
        const b = document.createElement('b');
        b.textContent = String(s.count);
        d.append(b);
      }
      return d;
    }));
    const idx = this.slots.findIndex((s) => s.id === prevId);
    this.select(idx >= 0 ? idx : Math.min(this.sel, this.slots.length - 1));
  }

  toast(msg: string, ms = 1800) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setNet(online: boolean) {
    this.netEl.textContent = online ? '● Online' : '○ Offline';
    this.netEl.classList.toggle('on', online);
  }

  get panelOpen() { return !this.panel.hidden; }

  closePanel() { this.panel.hidden = true; this.panel.dataset.kind = ''; }

  openShop(st: FarmState) {
    this.panel.dataset.kind = 'shop';
    const rows = CROP_IDS.map((c) => {
      const d = CROPS[c];
      return `<div class="row"><span class="ic" data-ic="pc_${c}"></span>
        <span class="nm">${d.name}<small>${d.stageSecs * 3}s · bán ${d.sellPrice}<i class="coin"></i></small></span>
        <span class="have">${st.inv['seed:' + c] || 0}</span>
        <button data-buy="${c}" data-n="1" ${st.coins < d.seedPrice ? 'disabled' : ''}>${d.seedPrice}<i class="coin"></i></button>
        <button data-buy="${c}" data-n="5" ${st.coins < d.seedPrice * 5 ? 'disabled' : ''}>×5</button></div>`;
    }).join('');
    this.showPanel('Cửa hàng hạt giống', rows);
  }

  openShip(st: FarmState) {
    this.panel.dataset.kind = 'ship';
    const items = CROP_IDS.filter((c) => st.inv[c]);
    const rows = items.length
      ? items.map((c) => `<div class="row"><span class="ic" data-ic="pc_${c}"></span>
          <span class="nm">${CROPS[c].name}<small>${CROPS[c].sellPrice}<i class="coin"></i> / cái</small></span>
          <span class="have">${st.inv[c]}</span>
          <button data-sell="${c}" data-n="1">Bán 1</button>
          <button data-sell="${c}" data-n="999">Bán hết</button></div>`).join('')
      : '<p class="empty">Chưa có nông sản. Hãy trồng và thu hoạch nhé!</p>';
    this.showPanel('Thùng bán hàng', rows);
  }

  /** Re-render the open panel after the state changed. */
  refresh(st: FarmState) {
    if (this.panel.dataset.kind === 'shop') this.openShop(st);
    else if (this.panel.dataset.kind === 'ship') this.openShip(st);
  }

  private showPanel(title: string, body: string) {
    this.panel.innerHTML = `<div class="box"><header><h2>${title}</h2><button data-close aria-label="Đóng">✕</button></header>${body}</div>`;
    this.panel.querySelectorAll<HTMLElement>('[data-ic]').forEach((el) => el.append(this.iconEl(el.dataset.ic!, 28)));
    this.panel.hidden = false;
  }
}
