// Entry screens: login / register, then character creation (pick a
// character, give it a name). Resolves with a valid session.
import type { Atlas } from './atlas.ts';

export interface Profile { username: string; name: string; gender: string; hasCharacter: boolean }
export interface Session { token: string; profile: Profile }

const LS_TOKEN = 'gnt_token';
export const getToken = () => { try { return localStorage.getItem(LS_TOKEN) || ''; } catch { return ''; } };
const setToken = (t: string) => { try { if (t) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN); } catch { /* ignore */ } };
export function logout() { setToken(''); location.reload(); }

async function call(path: string, body?: unknown, token?: string): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const r = await fetch('/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data: any = {};
    try { data = await r.json(); } catch { /* empty */ }
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Không kết nối được máy chủ. Thử lại sau giây lát.' } };
  }
}

/** Characters the player can choose. A character becomes available as soon
 *  as its sprites are in the atlas (female: pl5_*). */
const CHARACTERS = [
  { id: 'm', label: 'Nam', prefix: 'pl4' },
  { id: 'f', label: 'Nữ', prefix: 'pl6' },   // chibi test character (branch style-chibi)
];

export async function enterGame(atlas: Atlas): Promise<Session> {
  const root = document.getElementById('auth')!;
  root.hidden = false;

  // already logged in?
  let token = getToken();
  if (token) {
    const r = await call('me', undefined, token);
    if (r.ok && r.data.profile?.hasCharacter) { root.hidden = true; return { token, profile: r.data.profile }; }
    if (r.ok) return finish(await createCharacter(root, atlas, token, r.data.profile));
    if (r.status === 401) setToken('');
    token = '';
  }
  const s = await loginScreen(root);
  if (s.profile.hasCharacter) return finish(s);
  return finish(await createCharacter(root, atlas, s.token, s.profile));

  function finish(s: Session) { root.hidden = true; root.innerHTML = ''; return s; }
}

function loginScreen(root: HTMLElement): Promise<Session> {
  return new Promise((resolve) => {
    let mode: 'login' | 'register' = 'login';
    const render = () => {
      root.innerHTML = `
        <form class="abox" autocomplete="on">
          <h1>Nông Trại</h1>
          <div class="tabs">
            <button type="button" data-m="login" class="${mode === 'login' ? 'on' : ''}">Đăng nhập</button>
            <button type="button" data-m="register" class="${mode === 'register' ? 'on' : ''}">Đăng ký</button>
          </div>
          <label>Tên đăng nhập<input name="u" autocomplete="username" maxlength="20" required
            placeholder="vd: nongdan_99" autocapitalize="off" spellcheck="false"></label>
          <label>Mật khẩu<input name="p" type="password" maxlength="72" required
            autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="ít nhất 6 ký tự"></label>
          ${mode === 'register' ? '<label>Nhập lại mật khẩu<input name="p2" type="password" maxlength="72" required autocomplete="new-password"></label>' : ''}
          <p class="err" hidden></p>
          <button class="go" type="submit">${mode === 'login' ? 'Vào game' : 'Tạo tài khoản'}</button>
        </form>`;
      const form = root.querySelector('form')!;
      const err = root.querySelector('.err') as HTMLElement;
      root.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) =>
        b.addEventListener('click', () => { mode = b.dataset.m as typeof mode; render(); }));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const u = String(fd.get('u') || ''), p = String(fd.get('p') || '');
        if (mode === 'register' && p !== String(fd.get('p2') || '')) { err.textContent = 'Hai mật khẩu không khớp'; err.hidden = false; return; }
        const go = form.querySelector('.go') as HTMLButtonElement;
        go.disabled = true; err.hidden = true;
        const r = await call(mode, { username: u, password: p });
        go.disabled = false;
        if (!r.ok) { err.textContent = r.data.error || 'Có lỗi xảy ra'; err.hidden = false; return; }
        setToken(r.data.token);
        resolve({ token: r.data.token, profile: r.data.profile });
      });
      (root.querySelector('input[name=u]') as HTMLInputElement).focus();
    };
    render();
  });
}

function createCharacter(root: HTMLElement, atlas: Atlas, token: string, profile: Profile): Promise<Session> {
  return new Promise((resolve) => {
    const avail = (prefix: string) => !!atlas.frames[`${prefix}_0_i0`];
    let pick = CHARACTERS.find((c) => avail(c.prefix))?.id || 'm';
    root.innerHTML = `
      <form class="abox wide">
        <h1>Tạo nhân vật</h1>
        <p class="hint">Xin chào <b>${profile.username}</b>! Chọn nhân vật và đặt tên.</p>
        <div class="chars">
          ${CHARACTERS.map((c) => `
            <button type="button" class="char ${avail(c.prefix) ? '' : 'soon'}" data-c="${c.id}" ${avail(c.prefix) ? '' : 'disabled'}>
              <canvas width="160" height="200"></canvas>
              <span>${c.label}${avail(c.prefix) ? '' : ' · sắp ra mắt'}</span>
            </button>`).join('')}
        </div>
        <label>Tên nhân vật<input name="n" maxlength="16" required placeholder="2-16 ký tự" autocomplete="off"></label>
        <p class="err" hidden></p>
        <button class="go" type="submit">Bắt đầu</button>
      </form>`;
    const cards = [...root.querySelectorAll<HTMLButtonElement>('.char')];
    const sel = () => cards.forEach((b) => b.classList.toggle('on', b.dataset.c === pick));
    cards.forEach((b) => b.addEventListener('click', () => { pick = b.dataset.c!; sel(); }));
    sel();

    // animated previews: idle (breathing) facing the camera
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      CHARACTERS.forEach((c, i) => {
        const cv = cards[i].querySelector('canvas')!;
        const g = cv.getContext('2d')!;
        g.clearRect(0, 0, cv.width, cv.height);
        g.imageSmoothingEnabled = false;
        let n = 0; while (atlas.frames[`${c.prefix}_0_i${n}`]) n++;
        const f = atlas.frames[`${c.prefix}_0_i${n ? Math.floor((now - t0) / 220) % n : 0}`];
        if (!f) { g.fillStyle = 'rgba(74,44,23,.25)'; g.font = 'bold 72px system-ui'; g.textAlign = 'center'; g.fillText('?', 80, 125); return; }
        const k = Math.min(140 / f[5], 120 / f[4]);
        const w = f[4] * k, h = f[5] * k;
        g.fillStyle = 'rgba(60,40,20,.25)';
        g.beginPath(); g.ellipse(80, 186, w * 0.35, 8, 0, 0, Math.PI * 2); g.fill();
        g.drawImage(atlas.img, f[0], f[1], f[4], f[5], 80 - w / 2, 188 - h, w, h);
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const form = root.querySelector('form')!;
    const err = root.querySelector('.err') as HTMLElement;
    (root.querySelector('input[name=n]') as HTMLInputElement).focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = String(new FormData(form).get('n') || '');
      const go = form.querySelector('.go') as HTMLButtonElement;
      go.disabled = true; err.hidden = true;
      const r = await call('character', { name, gender: pick }, token);
      go.disabled = false;
      if (!r.ok) { err.textContent = r.data.error || 'Có lỗi xảy ra'; err.hidden = false; return; }
      cancelAnimationFrame(raf);
      resolve({ token, profile: r.data.profile });
    });
  });
}
