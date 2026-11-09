import { CROPS, CROP_IDS, SUPPLIES, WEAR_SLOTS, WEARABLES, type FarmState } from '../../shared/rules.ts';
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
  onBuyItem: (item: string, n: number) => void = () => {};
  onSell: (item: string, n: number) => void = () => {};
  onEquip: (item: string) => void = () => {};
  onUnequip: (slot: string) => void = () => {};
  onLogout: () => void = () => {};
  /** who is shown in the wardrobe (set once after login) */
  me = { name: '', username: '', sprite: 'pl4', gender: 'm' as 'm' | 'f' };

  constructor(atlas: Atlas, portrait = 'portrait') {
    this.atlas = atlas;
    const av = $('avatar');
    av.replaceChildren(this.iconEl(portrait, 44));
    this.hotbar.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
      if (el) { this.select(+el.dataset.i!); e.preventDefault(); }
    });
    this.panel.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      if (b.dataset.close != null) this.closePanel();
      else if (b.dataset.buy) this.onBuy(b.dataset.buy, +(b.dataset.n || 1));
      else if (b.dataset.item) this.onBuyItem(b.dataset.item, +(b.dataset.n || 1));
      else if (b.dataset.sell) this.onSell(b.dataset.sell, +(b.dataset.n || 1));
      else if (b.dataset.equip) this.onEquip(b.dataset.equip);
      else if (b.dataset.unequip) this.onUnequip(b.dataset.unequip);
      else if (b.dataset.logout != null) this.onLogout();
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
    const sig = seeds.map((c) => c + st.inv['seed:' + c]).join('|') + `|f${st.inv.fert || 0}|s${st.inv.spray || 0}`;
    if (sig === this.sig && this.slots.length) return;
    const prevId = this.current?.id;
    this.sig = sig;
    this.slots = [
      { id: 'hoe', icon: 'tool_hoe', label: 'Cuốc' },
      { id: 'can', icon: 'tool_can', label: 'Bình tưới' },
      { id: 'hand', icon: 'pc_tomato', label: 'Thu hoạch' },
      { id: 'fert', icon: 'it_fert', label: 'Phân bón (cây lớn nhanh 40%, thu hoạch x2)', count: st.inv.fert || 0 },
      { id: 'spray', icon: 'it_spray', label: 'Thuốc trừ sâu', count: st.inv.spray || 0 },
      ...seeds.map((c) => ({ id: 'seed:' + c, icon: this.atlas.frames[`cp_${c}_bag`] ? `cp_${c}_bag` : 'pc_' + c, label: 'Hạt ' + CROPS[c].name, count: st.inv['seed:' + c] })),
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

  private shopTitle = 'Cửa hàng';
  openShop(st: FarmState, title?: string) {
    if (title) this.shopTitle = title;
    this.panel.dataset.kind = 'shop';
    const rows = CROP_IDS.map((c) => {
      const d = CROPS[c];
      return `<div class="row"><span class="ic" data-ic="${this.atlas.frames[`cp_${c}_item`] ? `cp_${c}_item` : `pc_${c}`}"></span>
        <span class="nm">${d.name}<small>${d.stageSecs * 3}s · bán ${d.sellPrice}<i class="coin"></i></small></span>
        <span class="have">${st.inv['seed:' + c] || 0}</span>
        <button data-buy="${c}" data-n="1" ${st.coins < d.seedPrice ? 'disabled' : ''}>${d.seedPrice}<i class="coin"></i></button>
        <button data-buy="${c}" data-n="5" ${st.coins < d.seedPrice * 5 ? 'disabled' : ''}>×5</button></div>`;
    }).join('');
    const supplies = Object.entries(SUPPLIES).map(([id, d]) => `<div class="row"><span class="ic" data-ic="it_${id}"></span>
        <span class="nm">${d.name}<small>${id === 'fert' ? 'Lớn nhanh 40% · thu hoạch gấp đôi' : 'Diệt sâu, cây lớn tiếp'}</small></span>
        <span class="have">${st.inv[id] || 0}</span>
        <button data-item="${id}" data-n="1" ${st.coins < d.price ? 'disabled' : ''}>${d.price}<i class="coin"></i></button>
        <button data-item="${id}" data-n="5" ${st.coins < d.price * 5 ? 'disabled' : ''}>×5</button></div>`).join('');
    this.showPanel(this.shopTitle, `<p class="sub">Bạn có <i class="coin"></i>${st.coins}</p><h3>Hạt giống</h3>` + rows + '<h3>Vật tư</h3>' + supplies);
  }

  openShip(st: FarmState) {
    this.panel.dataset.kind = 'ship';
    const items = CROP_IDS.filter((c) => st.inv[c]);
    const rows = items.length
      ? items.map((c) => `<div class="row"><span class="ic" data-ic="${this.atlas.frames[`cp_${c}_item`] ? `cp_${c}_item` : `pc_${c}`}"></span>
          <span class="nm">${CROPS[c].name}<small>${CROPS[c].sellPrice}<i class="coin"></i> / cái</small></span>
          <span class="have">${st.inv[c]}</span>
          <button data-sell="${c}" data-n="1">Bán 1</button>
          <button data-sell="${c}" data-n="999">Bán hết</button></div>`).join('')
      : '<p class="empty">Chưa có nông sản. Hãy trồng và thu hoạch nhé!</p>';
    this.showPanel('Thùng bán hàng', rows);
  }

  /** The farmhouse storehouse: everything the player owns. */
  openStore(st: FarmState) {
    this.panel.dataset.kind = 'store';
    const icon = (c: string, seed: boolean) => seed
      ? (this.atlas.frames[`cp_${c}_bag`] ? `cp_${c}_bag` : `pc_${c}`)
      : (this.atlas.frames[`cp_${c}_item`] ? `cp_${c}_item` : `pc_${c}`);
    const cell = (c: string, seed: boolean) => {
      const n = st.inv[seed ? 'seed:' + c : c];
      return `<div class="cell" title="${seed ? 'Hạt ' : ''}${CROPS[c].name}"><span class="ic" data-ic="${icon(c, seed)}"></span>
        <b>${n}</b><small>${seed ? 'Hạt ' : ''}${CROPS[c].name}</small></div>`;
    };
    const crops = CROP_IDS.filter((c) => st.inv[c]);
    const seeds = CROP_IDS.filter((c) => st.inv['seed:' + c]);
    const total = crops.reduce((a, c) => a + st.inv[c], 0) + seeds.reduce((a, c) => a + st.inv['seed:' + c], 0);
    const body = `<p class="sub">Tổng: ${total} món · <i class="coin"></i>${st.coins}</p>
      <h3>Nông sản</h3>
      <div class="grid">${crops.length ? crops.map((c) => cell(c, false)).join('') : '<p class="empty">Chưa có nông sản.</p>'}</div>
      <h3>Hạt giống</h3>
      <div class="grid">${seeds.length ? seeds.map((c) => cell(c, true)).join('') : '<p class="empty">Hết hạt giống.</p>'}</div>
      <h3>Vật tư</h3>
      <div class="grid">${Object.entries(SUPPLIES).map(([id, d]) => `<div class="cell"><span class="ic" data-ic="it_${id}"></span>
        <b>${st.inv[id] || 0}</b><small>${d.name}</small></div>`).join('')}</div>`;
    this.showPanel('Kho nhà', body);
  }

  /** Re-render the open panel after the state changed. */
  refresh(st: FarmState) {
    if (this.panel.dataset.kind === 'shop') this.openShop(st);
    else if (this.panel.dataset.kind === 'ship') this.openShip(st);
    else if (this.panel.dataset.kind === 'store') this.openStore(st);
    else if (this.panel.dataset.kind === 'wear') this.openWardrobe(st);
  }

  /** Character tab (tap the avatar): the character, its clothing slots and the
   *  wardrobe of owned clothes. Clothing items come later with their assets. */
  openWardrobe(st: FarmState) {
    this.panel.dataset.kind = 'wear';
    const me = this.me, wear = st.wear || {};
    const slots = WEAR_SLOTS.map((sl) => {
      const id = wear[sl.id], def = id ? WEARABLES[id] : null;
      return `<div class="wslot${def ? ' on' : ''}">
        ${def ? `<span class="ic" data-ic="${def.icon}"></span>` : `<span class="ic none" data-slot="${sl.id}"></span>`}
        <span class="nm">${sl.name}<small>${def ? def.name : 'Trống'}</small></span>
        ${def ? `<button data-unequip="${sl.id}">Tháo</button>` : ''}</div>`;
    }).join('');
    const owned = Object.keys(WEARABLES).filter((id) => st.inv['wear:' + id] && (!WEARABLES[id].gender || WEARABLES[id].gender === me.gender));
    const items = owned.length
      ? owned.map((id) => {
          const d = WEARABLES[id], on = wear[d.slot] === id;
          return `<div class="cell${on ? ' on' : ''}"><span class="ic" data-ic="${d.icon}"></span><small>${d.name}</small>
            ${on ? '<em>Đang mặc</em>' : `<button data-equip="${id}">Mặc</button>`}</div>`;
        }).join('')
      : '<p class="empty">Chưa có đồ trong tủ. Quần áo, mũ, giày sẽ được cập nhật sau.</p>';
    const body = `<div class="wardrobe">
        <div class="me"><span class="fig" data-ic="${me.sprite}_0_i0" data-sz="96"></span>
          <b>${me.name}</b><small>@${me.username}</small>
          <button class="out" data-logout>Đăng xuất</button></div>
        <div class="wear-r"><h3>Đang mặc</h3><div class="wslots">${slots}</div>
          <h3>Tủ đồ</h3><div class="grid">${items}</div></div>
      </div>`;
    this.showPanel('Nhân vật', body);
  }

  private showPanel(title: string, body: string) {
    this.panel.innerHTML = `<div class="box"><header><h2>${title}</h2><button data-close aria-label="Đóng">✕</button></header>${body}</div>`;
    this.panel.querySelectorAll<HTMLElement>('[data-ic]').forEach((el) => el.append(this.iconEl(el.dataset.ic!, +(el.dataset.sz || 28))));
    this.panel.hidden = false;
  }
}
