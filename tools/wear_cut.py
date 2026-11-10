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


if __name__ == '__main__':
    main(*sys.argv[1:])
