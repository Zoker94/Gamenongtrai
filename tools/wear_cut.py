"""Clothing as body HALVES (paper doll split at the waist).

A shirt/jacket replaces the character's whole UPPER half (head included), pants
replace the whole LOWER half. Both halves come straight from the user's
"character wearing it" GIFs, so nothing has to be cut out pixel by pixel:

  upper item: every pixel of the dressed frame above the waist line
              (+ the hem of the garment that hangs a little below it)
  lower item: every pixel of the dressed frame from the waist line down

The waist line is taken from the BARE character's frame (top of the denim
shorts), so a jacket from one GIF and pants from another always meet there.

Usage:  python3 tools/wear_cut.py <item_id> <base_folder> [colour rule]
        e.g. python3 tools/wear_cut.py jacket_red_f char_f red

Sources in assets/source/wear/<item_id>/ (frame order = game directions):
  turnaround.gif  8 frames = standing pose, direction 0..7 (any canvas size)
  walk_<d>.gif    walk cycle of direction d (68px canvas, like char_f/walk_<d>.gif)
Output: idle_<d>.png and walk_<d>_<i>.png on the base's 68px canvas.
Items whose id contains 'pants' are lower halves, the rest upper halves.
"""
import os
import sys
from collections import Counter
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEM = 8          # rows below the waist where the upper garment's own colour is kept

RULES = {
    'red': lambda p: p[0] > 40 and p[0] >= 3 * p[1],      # crimson / red cloth
}


def waist_row(f):
    """first row of the bare character's denim shorts (= the waist line)"""
    px = f.load(); W, H = f.size
    rows = Counter(y for y in range(H) for x in range(W)
                   if px[x, y][3] and px[x, y][2] - px[x, y][0] > 45 and px[x, y][1] < 140)
    for k in (4, 2):
        ys = [y for y, n in rows.items() if n >= k]
        if ys:
            return min(ys)
    bb = f.getchannel('A').getbbox()
    return bb[1] + (bb[3] - bb[1]) * 58 // 100


def best_offset(src, base, r=2):
    """same-canvas frames: the small shift where the silhouettes overlap most"""
    sa, ba = src.getchannel('A').load(), base.getchannel('A').load()
    W, H = base.size
    pts = [(x, y) for y in range(H) for x in range(W) if sa[x, y]]
    best = (-1, 0, 0)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            n = sum(1 for x, y in pts if 0 <= x + dx < W and 0 <= y + dy < H and ba[x + dx, y + dy])
            if n > best[0]:
                best = (n, dx, dy)
    return best[1], best[2]


def half(src, base, lower, is_cloth, same_canvas):
    """the dressed frame aligned on the bare one, cut at the bare one's waist"""
    if same_canvas:
        dx, dy = best_offset(src, base)
    else:   # a separately drawn turnaround: align by the feet
        jb = src.getchannel('A').getbbox(); bb = base.getchannel('A').getbbox()
        dx = (bb[0] + bb[2]) // 2 - (jb[0] + jb[2]) // 2
        dy = bb[3] - jb[3]
    al = Image.new('RGBA', base.size, (0, 0, 0, 0)); al.alpha_composite(src, (dx, dy))
    ap = al.load(); W, H = al.size
    w = waist_row(base)
    out = Image.new('RGBA', base.size, (0, 0, 0, 0)); op = out.load()
    for y in range(H):
        for x in range(W):
            p = ap[x, y]
            if not p[3]:
                continue
            if lower:
                keep = y >= w
            else:
                keep = y < w or (y < w + HEM and is_cloth(p))
            if keep:
                op[x, y] = p
    return out


def main(item, base_folder, rule='red'):
    d0 = os.path.join(ROOT, 'assets/source/wear', item)
    bdir = os.path.join(ROOT, 'assets/source', base_folder)
    is_cloth = RULES[rule]
    lower = 'pants' in item
    for f in os.listdir(d0):                       # drop old cut-outs
        if f.endswith('.png') or f.endswith('.waist'):
            os.remove(os.path.join(d0, f))
    done = []
    tp = os.path.join(d0, 'turnaround.gif')
    if os.path.exists(tp):
        im = Image.open(tp)
        for d in range(min(8, im.n_frames)):
            im.seek(d)
            b = Image.open(os.path.join(bdir, f'idle_{d}.gif')); b.seek(0)
            half(im.convert('RGBA'), b.convert('RGBA'), lower, is_cloth, False).save(os.path.join(d0, f'idle_{d}.png'))
        done.append('idle x8')
    for d in range(8):
        sp = os.path.join(d0, f'walk_{d}.gif')
        if not os.path.exists(sp):
            continue
        src, base = Image.open(sp), Image.open(os.path.join(bdir, f'walk_{d}.gif'))
        for i in range(min(src.n_frames, base.n_frames)):
            src.seek(i); base.seek(i)
            half(src.convert('RGBA'), base.convert('RGBA'), lower, is_cloth, True).save(os.path.join(d0, f'walk_{d}_{i}.png'))
        done.append(f'walk_{d} x{min(src.n_frames, base.n_frames)}')
    print(item, 'lower half' if lower else 'upper half', ':', ', '.join(done))


# ---------------------------------------------------------------- outfits
# A whole outfit made with PixelLab transfer_outfit (tools/outfit_frames.py):
# every frame the game draws, re-dressed with the pose kept, in
# assets/source/wear/<outfit>/src/<anim>_<d>_<i>.png on the base canvas.
# One outfit gives two items: its upper half (shirt) and its lower half
# (pants / skirt), plus colour variants of each. Catalogue: wear/outfits.json.
ANIMS = ('idle', 'walk', 'harvest', 'hoe', 'water')


def base_frames(base_folder):
    from PIL import ImageSequence
    bdir = os.path.join(ROOT, 'assets/source', base_folder)
    out = {}
    for f in os.listdir(bdir):
        a, _, d = f[:-4].rpartition('_')
        if f.endswith('.gif') and a in ANIMS:
            for i, fr in enumerate(ImageSequence.Iterator(Image.open(os.path.join(bdir, f)))):
                out[(a, int(d), i)] = fr.convert('RGBA')
    return out


def frame_waist(f):
    """waist row of a bare frame: the denim shorts, searched only around the
    body's middle (a watering can's water is blue too)"""
    bb = f.getchannel('A').getbbox()
    px = f.load(); W, H = f.size
    y0, y1 = bb[1] + (bb[3] - bb[1]) * 30 // 100, bb[1] + (bb[3] - bb[1]) * 85 // 100
    rows = Counter(y for y in range(y0, y1) for x in range(W)
                   if px[x, y][3] and px[x, y][2] - px[x, y][0] > 45 and px[x, y][1] < 140)
    for k in (4, 2):
        ys = [y for y, n in rows.items() if n >= k]
        if ys:
            return min(ys)
    return bb[1] + (bb[3] - bb[1]) * 58 // 100


def cloth_mask(src, base, thr=70):
    """pixels the outfit changed (vs the bare frame at the same spot)"""
    sp, bp = src.load(), base.load(); W, H = src.size
    m = set()
    for y in range(H):
        for x in range(W):
            p = sp[x, y]
            if not p[3]:
                continue
            q = bp[x, y]
            if not q[3] or abs(p[0] - q[0]) + abs(p[1] - q[1]) + abs(p[2] - q[2]) > thr:
                m.add((x, y))
    # drop specks: a changed pixel needs 2+ changed neighbours
    return {(x, y) for x, y in m
            if sum((x + dx, y + dy) in m for dx in (-1, 0, 1) for dy in (-1, 0, 1)) >= 3}


def is_hair(p):
    """dark brown hair (or shoes) of the bare character"""
    import colorsys
    if not p[3]:
        return False
    h, s, v = colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)
    return v < 0.5 and s > 0.25 and (h < 0.12 or h > 0.95)


def vivid(p):
    """strongly coloured cloth (a sleeve raised over the head), never hair or skin"""
    import colorsys
    return colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)[1] > 0.6 and max(p[:3]) > 110


def near_water(px, x, y, W, H, r=2):
    """watering-can water (and its white foam) around a pixel of the bare frame"""
    for yy in range(max(0, y - r), min(H, y + r + 1)):
        for xx in range(max(0, x - r), min(W, x + r + 1)):
            p = px[xx, yy]
            if p[3] and p[2] > 150 and p[2] - p[0] > 50:
                return True
    return False


def is_shirt(p):
    """the bare character's white T-shirt"""
    return p[3] and min(p[:3]) > 150 and max(p[:3]) - min(p[:3]) < 40


def recolor(im, mask, spec):
    """colour variant of the cloth pixels: hue shift ('hue': deg, 'sat': k,
    'val': k) or a tint keeping the shading ('tint': '#rrggbb')."""
    import colorsys
    out = im.copy(); px = out.load()
    tint = spec.get('tint')
    lum = lambda r, g, b: (0.299 * r + 0.587 * g + 0.114 * b) / 255
    if tint:
        tr, tg, tb = (int(tint[i:i + 2], 16) for i in (1, 3, 5))
        th, tl, ts = colorsys.rgb_to_hls(tr / 255, tg / 255, tb / 255)
        if '_ref' not in spec:   # the garment's mean lightness, fixed per item (no flicker)
            ls = [lum(*px[p][:3]) for p in mask] or [0.5]
            spec['_ref'] = sum(ls) / len(ls)
        k = tl / max(0.05, spec['_ref'])
    for x, y in mask:
        r, g, b, a = px[x, y]
        if tint:
            l2 = max(0.0, min(0.97, lum(r, g, b) * k * spec.get('val', 1)))
            r2, g2, b2 = colorsys.hls_to_rgb(th, l2, ts * spec.get('sat', 1))
        else:
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            h = (h + spec.get('hue', 0) / 360) % 1
            r2, g2, b2 = colorsys.hsv_to_rgb(h, min(1, s * spec.get('sat', 1)), min(1, v * spec.get('val', 1)))
        px[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
    return out


def cut_outfit(oid, spec):
    """assets/source/wear/<oid>/src -> one folder per item (+ variants) with
    <anim>_<d>.png (idle) / <anim>_<d>_<i>.png halves and icon.png"""
    wdir = os.path.join(ROOT, 'assets/source/wear')
    src_dir = os.path.join(wdir, oid, 'src')
    base = base_frames(spec['base'])
    halves = [('upper', False), ('lower', True)]
    made = []
    for part, lower in halves:
        it = spec.get(part)
        if not it:
            continue
        ids = [(it['id'], None)] + [(v['id'], v) for v in it.get('variants', [])]
        for iid, var in ids:
            d0 = os.path.join(wdir, iid)
            os.makedirs(d0, exist_ok=True)
            for f in os.listdir(d0):
                if f.endswith('.png'):
                    os.remove(os.path.join(d0, f))
        # the garment's own colours, from the standing frames: a body band that
        # is all garment (below the head for tops, above the shoes for bottoms).
        # Variants recolour only pixels near these colours, so a face the AI
        # redrew a little differently is never tinted.
        pal = set()
        for d in range(8):
            fp = os.path.join(src_dir, f'idle_{d}_0.png')
            b = base.get(('idle', d, 0))
            if b is None or not os.path.exists(fp):
                continue
            s = Image.open(fp).convert('RGBA'); sp = s.load()
            bb = b.getchannel('A').getbbox(); w = frame_waist(b)
            y0, y1 = (w, bb[3] - 4) if lower else (bb[1] + (w - bb[1]) * 45 // 100, w)
            for x, y in cloth_mask(s, b):
                if y0 <= y < y1:
                    pal.add(sp[x, y][:3])
        memo = {}

        def near(c):
            if c not in memo:
                memo[c] = any(abs(c[0] - p[0]) + abs(c[1] - p[1]) + abs(c[2] - p[2]) <= 24 for p in pal)
            return memo[c]
        n = 0
        for f in sorted(os.listdir(src_dir)):
            a, d, i = f[:-4].rsplit('_', 2)
            d, i = int(d), int(i)
            b = base.get((a, d, i))
            if b is None:
                continue
            s = Image.open(os.path.join(src_dir, f)).convert('RGBA')
            w = frame_waist(b)
            out = Image.new('RGBA', s.size, (0, 0, 0, 0))
            out.paste(s.crop((0, w, s.width, s.height) if lower else (0, 0, s.width, w)), (0, w) if lower else (0, 0))
            mask = None
            name = f'{a}_{d}.png' if a == 'idle' else f'{a}_{d}_{i}.png'
            for iid, var in ids:
                im = out
                if mask is None:
                    sp_, bp_ = s.load(), b.load()
                    bt = b.getchannel('A').getbbox()[1]
                    # the head (hair over the eyes, a redrawn face) is never cloth:
                    # above the shoulders only the bare shirt's white is replaced
                    neck = bt + (w - bt) * 55 // 100
                    mask = {p for p in cloth_mask(s, b) if (p[1] >= w) == lower
                            and (p[1] >= neck or is_shirt(bp_[p]) or vivid(sp_[p]))
                            and near(sp_[p][:3]) and not is_hair(bp_[p])}
                    # a white garment over the bare white T-shirt / socks hardly
                    # differs from them: take those pixels by colour alone
                    mask |= {(x, y) for y in (range(max(w, neck), s.height) if lower else range(neck, w))
                             for x in range(s.width) if sp_[x, y][3] and is_shirt(bp_[x, y]) and near(sp_[x, y][:3])
                             and not near_water(bp_, x, y, s.width, s.height)}
                if var:
                    im = recolor(out, mask, var)
                im.save(os.path.join(wdir, iid, name))
                if a == 'idle' and d == 0:     # shop icon: the garment alone, facing us
                    m = mask
                    ic = Image.new('RGBA', s.size, (0, 0, 0, 0)); ip, sp = ic.load(), im.load()
                    for x, y in m:
                        ip[x, y] = sp[x, y]
                    ic.crop(ic.getchannel('A').getbbox()).save(os.path.join(wdir, iid, 'icon.png'))
            n += 1
        made += [f'{iid} ({n} frames)' for iid, _ in ids]
    print(oid, '->', ', '.join(made))


def cut_outfits(only=None):
    import json
    cat = json.load(open(os.path.join(ROOT, 'assets/source/wear/outfits.json'), encoding='utf-8'))
    for oid, spec in cat.items():
        if only and oid not in only:
            continue
        if os.path.isdir(os.path.join(ROOT, 'assets/source/wear', oid, 'src')):
            cut_outfit(oid, spec)
    write_catalog(cat)


def write_catalog(cat):
    """shared/wearables.ts: the shop catalogue, generated from outfits.json
    (only items whose frames exist, so a half-made outfit is not for sale)"""
    wdir = os.path.join(ROOT, 'assets/source/wear')
    lines = []
    for oid, spec in cat.items():
        for part, slot in (('upper', 'shirt'), ('lower', 'pants')):
            it = spec.get(part)
            if not it:
                continue
            for v in [it] + it.get('variants', []):
                if not os.path.exists(os.path.join(wdir, v['id'], 'idle_0.png')):
                    continue
                g = v['id'][-1]
                lines.append(f"  {v['id']}: {{ name: '{v['name']}', slot: '{slot}', icon: 'wri_{v['id']}', gender: '{g}', price: {v.get('price', it['price'])} }},")
    out = ['// GENERATED by tools/wear_cut.py from assets/source/wear/outfits.json - do not edit.',
           "import type { Wearable } from './rules.ts';", '',
           'export const OUTFIT_WEARABLES: Record<string, Wearable> = {', *lines, '};', '']
    with open(os.path.join(ROOT, 'shared/wearables.ts'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out))
    print('shared/wearables.ts:', len(lines), 'items')


if __name__ == '__main__':
    if sys.argv[1] == 'outfits':
        cut_outfits(sys.argv[2:])
    else:
        main(*sys.argv[1:])
