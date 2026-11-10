"""Cut a clothing layer out of a "character wearing it" image so it can be drawn
over the bare character (paper-doll), and clean the seams.

Usage:  python3 tools/wear_cut.py <item_id> <base_folder> [colour rule]
  e.g.  python3 tools/wear_cut.py jacket_red_f char_f red

Input:  assets/source/wear/<item_id>/turnaround.gif  (frame d = direction d, same order as the game)
Base:   assets/source/<base_folder>/idle_<d>.gif     (the bare character)
Output: assets/source/wear/<item_id>/idle_<d>.png     (layer on the base's 68x68 canvas)

Steps for every direction:
 1. keep the clothing pixels (by colour rule) of the source image
 2. align the source to the base by the feet (bottom of the figure, centred)
 3. leaks: base pixels that are light/white (the bare T-shirt) where the source
    is NOT white, right next to the clothing -> painted with the nearest clothing colour
 4. specks: any remaining small light blobs (<= SPECK px, 8-connected) in the
    composed picture that touch the clothing -> painted with the most common
    neighbouring clothing colour. Big light areas (a shirt showing inside an
    open jacket, drawn that way in the source) are kept.
"""
import os
import sys
from collections import Counter
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECK = 4

RULES = {
    # crimson / red cloth: strong red, almost no green
    'red': lambda p: p[0] > 40 and p[0] >= 3 * p[1],
}


def light(p):
    """white / light-grey pixel (bare T-shirt, highlight lines)"""
    return p[3] > 0 and min(p[:3]) > 140 and max(p[:3]) - min(p[:3]) < 60


def nearest_colour(layer, x, y, max_r=2):
    lp = layer.load(); w, h = layer.size
    for r in range(1, max_r + 1):
        found = Counter()
        for yy in range(y - r, y + r + 1):
            for xx in range(x - r, x + r + 1):
                if 0 <= xx < w and 0 <= yy < h and lp[xx, yy][3]:
                    found[lp[xx, yy]] += 1
        if found:
            return found.most_common(1)[0][0]
    return None


def best_offset(src, base, r=2):
    """same-canvas animation frames: the small shift where the silhouettes overlap most"""
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


def cut_direction(src, base, is_cloth, same_canvas=False):
    if same_canvas:
        dx, dy = best_offset(src, base)
    else:
        jb = src.getchannel('A').getbbox(); bb = base.getchannel('A').getbbox()
        dx = (bb[0] + bb[2]) // 2 - (jb[0] + jb[2]) // 2
        dy = bb[3] - jb[3]
    al = Image.new('RGBA', base.size, (0, 0, 0, 0)); al.alpha_composite(src, (dx, dy))
    sp, bp = al.load(), base.load()
    W, H = base.size
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0)); lp = layer.load()
    for y in range(H):
        for x in range(W):
            if sp[x, y][3] and is_cloth(sp[x, y]):
                lp[x, y] = sp[x, y]
    cloth = layer.copy()                      # colours to sample from
    lb = layer.getchannel('A').getbbox()
    # 3a. the bare body sticking out past the edge of the clothing: base pixel
    #     right next to the clothing where the dressed source shows background
    out = 0
    for y in range(lb[1] + 1, lb[3] - 1):
        for x in range(W):
            if lp[x, y][3] or not bp[x, y][3] or sp[x, y][3]:
                continue
            if any(cloth.getpixel((nx, ny))[3] for nx in (x - 1, x, x + 1) for ny in (y - 1, y, y + 1) if 0 <= nx < W and 0 <= ny < H):
                c = nearest_colour(cloth, x, y)
                if c:
                    lp[x, y] = c; out += 1
    # 3. leaks of the bare shirt next to the clothing
    leaks = 0
    for y in range(H):
        for x in range(W):
            if lp[x, y][3] or not light(bp[x, y]) or light(sp[x, y]):
                continue
            c = nearest_colour(cloth, x, y)
            if c:
                lp[x, y] = c; leaks += 1
    # 3b. holes: an uncovered body pixel almost surrounded by clothing (>= 6 of
    #     its 8 neighbours) -> the base shorts / skin peeking through a gap
    holes = 0
    for _ in range(2):
        snap = layer.copy(); sn = snap.load()
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                if sn[x, y][3] or not bp[x, y][3]:
                    continue
                n = sum(1 for nx in (x - 1, x, x + 1) for ny in (y - 1, y, y + 1) if (nx, ny) != (x, y) and sn[nx, ny][3])
                if n >= 6:
                    c = nearest_colour(snap, x, y, 1)
                    if c:
                        lp[x, y] = c; holes += 1
    leaks += holes
    # 4. small light specks left in the composed picture, touching the clothing
    comp = base.copy(); comp.alpha_composite(layer); cp = comp.load()
    seen, specks = set(), 0
    for sy in range(H):
        for sx in range(W):
            if (sx, sy) in seen or not light(cp[sx, sy]):
                continue
            stack, blob = [(sx, sy)], []
            seen.add((sx, sy))
            while stack:
                x, y = stack.pop(); blob.append((x, y))
                for nx in (x - 1, x, x + 1):
                    for ny in (y - 1, y, y + 1):
                        if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen and light(cp[nx, ny]):
                            seen.add((nx, ny)); stack.append((nx, ny))
            if len(blob) > SPECK:
                continue
            touches = any(lp[nx, ny][3] for x, y in blob for nx in (x - 1, x, x + 1) for ny in (y - 1, y, y + 1)
                          if 0 <= nx < W and 0 <= ny < H)
            if not touches:
                continue
            for x, y in blob:
                c = nearest_colour(cloth, x, y)
                if c:
                    lp[x, y] = c; specks += 1
    return layer, leaks + out, specks


def _mask(img):
    bb = img.getchannel('A').getbbox(); a = img.getchannel('A').load()
    cx = (bb[0] + bb[2]) // 2
    return {(x - cx, y - bb[3]) for y in range(img.height) for x in range(img.width) if a[x, y]}


def check_order(im, base_folder):
    """the source frames must be in the game's direction order: warn if a frame
    looks more like another direction of the bare character"""
    bases = []
    for d in range(8):
        b = Image.open(os.path.join(ROOT, 'assets/source', base_folder, f'idle_{d}.gif')); b.seek(0)
        bases.append(_mask(b.convert('RGBA')))
    for j in range(8):
        im.seek(j); m = _mask(im.convert('RGBA'))
        sc = [len(m & b) / len(m | b) for b in bases]
        best = sc.index(max(sc))
        if best != j and sc[best] - sc[j] > 0.03:
            print(f'  ! frame {j} looks like direction {best} ({sc[best]:.2f} vs {sc[j]:.2f})')


def cut_lower(d0, base_folder, is_cloth, act):
    """Pants: the redrawn legs follow their own step cycle, so a layer over the
    base legs can't fit. Instead the game hides the base body below the waist and
    draws the source's whole lower body (pants, shoes, hands) from its own frame i.
    -> <act>_<d>_<i>.png (lower body) + <act>_<d>.waist (waist row per frame)"""
    for d in range(8):
        sp = os.path.join(d0, f'{act}_{d}.gif')
        if not os.path.exists(sp):
            continue
        src, base = Image.open(sp), Image.open(os.path.join(ROOT, 'assets/source', base_folder, f'{act}_{d}.gif'))
        waists = []
        for i in range(min(src.n_frames, base.n_frames)):
            src.seek(i); base.seek(i)
            sf, bf = src.convert('RGBA'), base.convert('RGBA')
            dx, dy = best_offset(sf, bf)
            al = Image.new('RGBA', bf.size, (0, 0, 0, 0)); al.alpha_composite(sf, (dx, dy))
            ap = al.load(); W, H = al.size
            per_row = Counter(y for y in range(H) for x in range(W) if ap[x, y][3] and is_cloth(ap[x, y]))
            waist = min(y for y, n in per_row.items() if n >= 4)   # ignore a stray red dot higher up
            layer = Image.new('RGBA', bf.size, (0, 0, 0, 0)); lp = layer.load()
            for y in range(waist, H):
                for x in range(W):
                    if ap[x, y][3]:
                        lp[x, y] = ap[x, y]
            layer.save(os.path.join(d0, f'{act}_{d}_{i}.png'))
            waists.append(waist)
        open(os.path.join(d0, f'{act}_{d}.waist'), 'w').write(' '.join(map(str, waists)))
        print(f'  {act}_{d}: lower body from own frames, waist rows {waists}')


def cut_anim(d0, base_folder, is_cloth, act):
    """<act>_<d>.gif in the item folder = the base animation <act>_<d>.gif redrawn
    wearing the item (same 68px canvas, same frame count) -> <act>_<d>_<i>.png"""
    for d in range(8):
        sp = os.path.join(d0, f'{act}_{d}.gif')
        if not os.path.exists(sp):
            continue
        src, base = Image.open(sp), Image.open(os.path.join(ROOT, 'assets/source', base_folder, f'{act}_{d}.gif'))
        if src.n_frames != base.n_frames:
            print(f'  ! {act}_{d}: {src.n_frames} frames, base has {base.n_frames}')
        sfr = []
        for i in range(src.n_frames):
            src.seek(i); sfr.append(src.convert('RGBA'))
        res, pick = [], []
        for i in range(base.n_frames):
            base.seek(i); bf = base.convert('RGBA')
            # the redrawn cycle may be out of step with the base one: use the
            # source frame whose silhouette (legs included) fits this base frame best
            def fit(f):
                dx, dy = best_offset(f, bf)
                sa, ba = f.getchannel('A').load(), bf.getchannel('A').load()
                W, H = bf.size
                a = {(x + dx, y + dy) for y in range(H) for x in range(W) if sa[x, y]}
                b = {(x, y) for y in range(H) for x in range(W) if ba[x, y]}
                return len(a & b) / len(a | b)
            j = max(range(len(sfr)), key=lambda k: fit(sfr[k]) + (0.01 if k == i else 0))
            layer, leaks, specks = cut_direction(sfr[j], bf, is_cloth, same_canvas=True)
            layer.save(os.path.join(d0, f'{act}_{d}_{i}.png'))
            res.append(leaks + specks); pick.append(j)
        print(f'  {act}_{d}: base frame -> source frame {pick}, pixels fixed {res}')


def main(item, base_folder, rule='red'):
    d0 = os.path.join(ROOT, 'assets/source/wear', item)
    im = Image.open(os.path.join(d0, 'turnaround.gif'))
    is_cloth = RULES[rule]
    out = []
    lower = 'pants' in item                      # pants replace the lower body
    for act in ('walk',):
        (cut_lower if lower else cut_anim)(d0, base_folder, is_cloth, act)
    check_order(im, base_folder)
    for d in range(8):
        im.seek(d); src = im.convert('RGBA')
        b = Image.open(os.path.join(ROOT, 'assets/source', base_folder, f'idle_{d}.gif')); b.seek(0)
        base = b.convert('RGBA')
        layer, leaks, specks = cut_direction(src, base, is_cloth)
        layer.save(os.path.join(d0, f'idle_{d}.png'))
        out.append((d, leaks, specks))
    print(item, 'direction, leaks fixed, specks fixed:', out)


if __name__ == '__main__':
    main(*sys.argv[1:])
