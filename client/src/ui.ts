import { CROPS, CROP_IDS, SUPPLIES, WEAR_SLOTS, WEARABLES, needsAt, ownsWear, restMinutes, type FarmState } from '../../shared/rules.ts';
import { type Atlas, iconCanvas } from './atlas.ts';
import { type Settings, settings } from './settings.ts';
import { wearFrame } from './wear.ts';

export interface Slot { id: string; icon: string; label: string; count?: number }

const $ = (id: string) => document.getElementById(id)!;
/** money is shown in Vietnamese dong: 1 in-game coin = 1.000 ₫ */
export const vnd = (n: number) => (n * 1000).toLocaleString('vi-VN') + ' ₫';
const needLabel = (v: number, words: [string, string, string, string]) => words[v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3];

export class UI {
  slots: Slot[] = [];
  sel = 0;
  private atlas: Atlas;
  private hotbar = $('hotbar');
  private coins = $('coins');
  private gems = $('gems');
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
  onBuyWear: (item: string) => void = () => {};
  onSetting: (k: keyof Settings, v: Settings[keyof Settings]) => void = () => {};
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
      else if (b.dataset.buywear) this.onBuyWear(b.dataset.buywear);
      else if (b.dataset.wshop != null) this.openWearShop(this.lastSt!);
      else if (b.dataset.wback != null) this.openWardrobe(this.lastSt!);
      else if (b.dataset.set) {
        const k = b.dataset.set as keyof Settings, raw = b.dataset.v!;
        const v = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? +raw : raw;
        this.onSetting(k, v as Settings[keyof Settings]);
        this.openSettings();
      }
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
    this.coins.innerHTML = `<i class="coin"></i>${vnd(st.coins)}`;
    this.gems.innerHTML = `<i class="gem"></i>${(st.gems || 0).toLocaleString('vi-VN')}`;
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
        <span class="nm">${d.name}<small>${d.stageSecs * 3}s · bán ${vnd(d.sellPrice)}</small></span>
        <span class="have">${st.inv['seed:' + c] || 0}</span>
        <button data-buy="${c}" data-n="1" ${st.coins < d.seedPrice ? 'disabled' : ''}>${vnd(d.seedPrice)}</button>
        <button data-buy="${c}" data-n="5" ${st.coins < d.seedPrice * 5 ? 'disabled' : ''}>×5</button></div>`;
    }).join('');
    const supplies = Object.entries(SUPPLIES).map(([id, d]) => `<div class="row"><span class="ic" data-ic="it_${id}"></span>
        <span class="nm">${d.name}<small>${id === 'fert' ? 'Lớn nhanh 40% · thu hoạch gấp đôi' : 'Diệt sâu, cây lớn tiếp'}</small></span>
        <span class="have">${st.inv[id] || 0}</span>
        <button data-item="${id}" data-n="1" ${st.coins < d.price ? 'disabled' : ''}>${vnd(d.price)}</button>
        <button data-item="${id}" data-n="5" ${st.coins < d.price * 5 ? 'disabled' : ''}>×5</button></div>`).join('');
    this.showPanel(this.shopTitle, `<p class="sub">Bạn có ${vnd(st.coins)}</p><h3>Hạt giống</h3>` + rows + '<h3>Vật tư</h3>' + supplies);
  }

  openShip(st: FarmState) {
    this.panel.dataset.kind = 'ship';
    const items = CROP_IDS.filter((c) => st.inv[c]);
    const rows = items.length
      ? items.map((c) => `<div class="row"><span class="ic" data-ic="${this.atlas.frames[`cp_${c}_item`] ? `cp_${c}_item` : `pc_${c}`}"></span>
          <span class="nm">${CROPS[c].name}<small>${vnd(CROPS[c].sellPrice)} / cái</small></span>
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
    const body = `<p class="sub">Tổng: ${total} món · ${vnd(st.coins)}</p>
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
    else if (this.panel.dataset.kind === 'wshop') this.openWearShop(st);
  }

  /** Game settings (gear button). Values live in settings.ts / localStorage. */
  openSettings() {
    this.panel.dataset.kind = 'settings';
    const seg = (k: keyof Settings, opts: [string | number | boolean, string][]) =>
      `<span class="seg">${opts.map(([v, l]) => `<button data-set="${k}" data-v="${v}" class="${settings[k] === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;
    const onoff = (k: keyof Settings) => seg(k, [[true, 'Bật'], [false, 'Tắt']]);
    const row = (nm: string, hint: string, ctl: string) => `<div class="srow"><span class="nm">${nm}<small>${hint}</small></span>${ctl}</div>`;
    const body = `<h3>Đồ họa</h3>
      ${row('Chất lượng hình ảnh', 'Thấp giúp máy yếu chạy mượt hơn', seg('quality', [['high', 'Cao'], ['mid', 'Vừa'], ['low', 'Thấp']]))}
      ${row('Khung hình', '30 FPS giúp tiết kiệm pin', seg('fps', [[60, '60'], [30, '30']]))}
      ${row('Hiệu ứng thời tiết', 'Mưa, sương, mây trên màn hình', onoff('weatherFx'))}
      ${row('Hiệu ứng cảnh vật', 'Bướm, lá bay, bụi nắng', onoff('ambientFx'))}
      <h3>Hiển thị</h3>
      ${row('Thanh trạng thái cây', 'Tiến độ lớn, cần tưới, sâu bệnh', onoff('cropBars'))}
      ${row('Tên trên đầu nhân vật', '', onoff('nameTag'))}
      ${row('Hiện FPS', 'Số khung hình mỗi giây', onoff('showFps'))}
      <h3>Tài khoản</h3>
      <div class="srow"><span class="nm">${this.me.name}<small>@${this.me.username}</small></span><button class="out" data-logout>Đăng xuất</button></div>`;
    this.showPanel('Cài đặt', `<div class="settings">${body}</div>`);
  }

  /** Character tab (tap the avatar): the character, its clothing slots and the
   *  wardrobe of owned clothes. Clothing items come later with their assets. */
  private lastSt: FarmState | null = null;
  /** character + equipped clothes, all frames anchored at the same feet point.
   *  part 'up' / 'lo': the bare body clipped above / below its waist */
  private figure(layers: [Atlas, string, ('up' | 'lo')?][], size: number): HTMLCanvasElement {
    const px = size * 2, c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d')!, ref = this.atlas.frames[`${this.me.sprite}_0_i0`];
    if (!ref) return c;
    const k = Math.min(px / ref[2], px / ref[3]) * 0.96, foot = px - 2;
    g.imageSmoothingEnabled = false;
    for (const [a, n, part] of layers) {
      const f = a.frames[n];
      if (!f) continue;
      // unrounded, like the game: all layers share one pixel grid (no gap at the waist)
      const w = f[2] * k, h = f[3] * k, x = px / 2 - w / 2, y = foot - h + (f[6] || 0) * k;
      g.save();
      if (part) {
        const cut = foot + (f[6] || 0) * k - (a.waist[n] || 0.45) * h, lap = 2 / a.res * k;
        g.beginPath(); part === 'up' ? g.rect(0, 0, px, cut) : g.rect(0, cut - lap, px, px); g.clip();
      }
      g.drawImage(a.img, f[0], f[1], f[4], f[5], x, y, w, h);
      g.restore();
    }
    return c;
  }
  /** layers for the wardrobe preview: [lower half, upper half] or the bare body */
  private wearLayers(st: FarmState, d = 0): [Atlas, string, ('up' | 'lo')?][] {
    const body = `${this.me.sprite}_${d}_i0`, a = this.atlas;
    if (a.waist[body] == null) return [[a, body]];   // no clothes for this body yet (chibi test)
    const lo = wearFrame(st.wear?.pants, body), up = wearFrame(st.wear?.shirt, body);
    return !lo && !up ? [[a, body]] : [lo || [a, body, 'lo'], up || [a, body, 'up']];
  }

  /** Clothing shop (from the character tab). */
  openWearShop(st: FarmState) {
    this.lastSt = st;
    this.panel.dataset.kind = 'wshop';
    const ids = Object.keys(WEARABLES).filter((id) => WEARABLES[id].price && (!WEARABLES[id].gender || WEARABLES[id].gender === this.me.gender));
    const slotName = (sl: string) => WEAR_SLOTS.find((x) => x.id === sl)?.name || sl;
    const rows = ids.length ? ids.map((id) => {
      const d = WEARABLES[id], own = !!st.inv['wear:' + id];
      return `<div class="row"><span class="ic" data-ic="${d.icon}"></span>
        <span class="nm">${d.name}<small>${slotName(d.slot)}</small></span>
        <span class="have">${own ? 'Đã có' : ''}</span>
        ${own ? (st.wear?.[d.slot] === id ? '<button disabled>Đang mặc</button>' : `<button data-equip="${id}">Mặc</button>`)
              : `<button data-buywear="${id}" ${st.coins < d.price! ? 'disabled' : ''}>${vnd(d.price!)}</button>`}</div>`;
    }).join('') : '<p class="empty">Chưa có quần áo cho nhân vật này.</p>';
    this.showPanel('Cửa hàng quần áo', `<p class="sub">Bạn có ${vnd(st.coins)} <button class="back" data-wback>← Nhân vật</button></p>` + rows);
  }

  openWardrobe(st: FarmState) {
    this.lastSt = st;
    this.panel.dataset.kind = 'wear';
    const me = this.me, wear = st.wear || {};
    const slots = WEAR_SLOTS.map((sl) => {
      const id = wear[sl.id], def = id ? WEARABLES[id] : null;
      return `<div class="wslot${def ? ' on' : ''}">
        ${def ? `<span class="ic" data-ic="${def.icon}"></span>` : `<span class="ic none" data-slot="${sl.id}"></span>`}
        <span class="nm">${sl.name}<small>${def ? def.name : 'Trống'}</small></span>
        ${def ? `<button data-unequip="${sl.id}">Tháo</button>` : ''}</div>`;
    }).join('');
    const nd = needsAt(st, Date.now());
    const bar = (nm: string, v: number, words: [string, string, string, string], cls: string) =>
      `<div class="need ${cls}${v >= 75 ? ' bad' : ''}"><span class="nm">${nm}<small>${needLabel(v, words)}</small></span>
        <span class="bar"><i style="width:${Math.round(v)}%"></i></span><b>${Math.round(v)}%</b></div>`;
    const needs = bar('Đói', nd.h, ['No bụng', 'Hơi đói', 'Đói', 'Rất đói'], 'hunger')
      + bar('Khát', nd.t, ['Đủ nước', 'Hơi khát', 'Khát', 'Rất khát'], 'thirst')
      + bar('Mệt mỏi', nd.f, nd.x ? Array(4).fill('Kiệt sức') as [string, string, string, string]
        : ['Khỏe khoắn', 'Hơi mệt', 'Mệt', 'Rất mệt'], 'tired' + (nd.x ? ' bad' : ''));
    const owned = Object.keys(WEARABLES).filter((id) => ownsWear(st, id) && (!WEARABLES[id].gender || WEARABLES[id].gender === me.gender));
    const items = owned.length
      ? owned.map((id) => {
          const d = WEARABLES[id], on = wear[d.slot] === id;
          return `<div class="cell${on ? ' on' : ''}"><span class="ic" data-ic="${d.icon}"></span><small>${d.name}</small>
            ${on ? '<em>Đang mặc</em>' : `<button data-equip="${id}">Mặc</button>`}</div>`;
        }).join('')
      : '<p class="empty">Chưa có đồ trong tủ. Bấm "Cửa hàng quần áo" để mua.</p>';
    const body = `<div class="wardrobe">
        <div class="me"><span class="fig"></span>
          <b>${me.name}</b><small>@${me.username}</small>
          <button class="out" data-logout>Đăng xuất</button></div>
        <div class="wear-r">
          <div class="money"><span>Tiền</span><b>${vnd(st.coins)}</b><span>Kim cương</span><b class="g"><i class="gem"></i>${(st.gems || 0).toLocaleString('vi-VN')}</b></div>
          <h3>Trạng thái</h3><div class="needs">${needs}</div>
          ${nd.x ? `<p class="rest">Đang kiệt sức: nghỉ thêm khoảng ${restMinutes(nd)} phút mới cuốc đất, chăm cây được.</p>` : ''}
          <h3>Đang mặc</h3><div class="wslots">${slots}</div>
          <h3 class="wh">Tủ đồ <button class="shopbtn" data-wshop>Cửa hàng quần áo</button></h3><div class="grid">${items}</div></div>
      </div>`;
    this.showPanel('Nhân vật', body);
    this.panel.querySelector('.fig')!.append(this.figure(this.wearLayers(st), 96));
  }

  private showPanel(title: string, body: string) {
    this.panel.innerHTML = `<div class="box"><header><h2>${title}</h2><button data-close aria-label="Đóng">✕</button></header>${body}</div>`;
    this.panel.querySelectorAll<HTMLElement>('[data-ic]').forEach((el) => el.append(this.iconEl(el.dataset.ic!, +(el.dataset.sz || 28))));
    this.panel.hidden = false;
  }
}
