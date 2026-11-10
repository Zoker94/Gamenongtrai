#!/usr/bin/env python3
"""Cut sprites out of the source sheets, generate procedural tiles and the
player character, then pack everything into one small palette PNG atlas.

Usage: python3 tools/build_assets.py [--preview out.png]
Output: client/public/assets/atlas.png + atlas.json
"""
import json, math, os, random, sys
from collections import deque
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from sprites import SPRITES, SCALE  # noqa: E402

OUT_DIR = os.path.join(ROOT, 'client', 'public', 'assets')
T = 32
# Atlas pixel density: every sprite is stored at RES x its in-game size, so a
# 32px tile has 64x64 real pixels and stays sharp when zoomed in.
RES = 3

sheets = {
    's1': Image.open(os.path.join(ROOT, 'assets/source/sheet1.png')).convert('RGB'),
    's2': Image.open(os.path.join(ROOT, 'assets/source/sheet2.png')).convert('RGB'),
    's3': Image.open(os.path.join(ROOT, 'assets/source/sheet3.png')).convert('RGB'),
    's4': Image.open(os.path.join(ROOT, 'assets/source/sheet4.png')).convert('RGB'),
    's5': Image.open(os.path.join(ROOT, 'assets/source/sheet5.png')).convert('RGB'),
}


def is_cell_bg(p):
    """Lighter slate cells behind the character frames (sheet 5)."""
    r, g, b = p[:3]
    return 98 <= r <= 124 and 107 <= g <= 133 and 124 <= b <= 152 and b - r > 18


def is_bg(p):
    # Both sheets use a desaturated blue-slate backdrop (+ lighter grid lines).
    r, g, b = p[:3]
    return 26 <= r <= 92 and r + 1 <= g <= r + 12 and g + 6 <= b <= g + 20


def cut_object(sheet, box):
    """Crop + remove the slate background by flood filling from the border."""
    im = sheets[sheet].crop(box).convert('RGBA')
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not (is_bg(px[x, y]) or (sheet == 's5' and is_cell_bg(px[x, y]))):
            continue
        px[x, y] = (0, 0, 0, 0)
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    # background pockets enclosed by leaves (not reachable from the border)
    for y in range(h):
        for x in range(w):
            p_ = px[x, y]
            if p_[3] and is_bg(p_) and p_[2] > p_[1] + 6:
                px[x, y] = (0, 0, 0, 0)
    drop_border_fragments(im, keep_only_big=True)
    return im


def drop_border_fragments(im, keep_only_big=False):
    """Remove small opaque islands touching the crop edge (bits of neighbouring
    sprites that leaked into the crop box)."""
    w, h = im.size
    px = im.load()
    label = [0] * (w * h)
    comps = []
    for sy in range(h):
        for sx in range(w):
            if label[sy * w + sx] or px[sx, sy][3] == 0:
                continue
            cid = len(comps) + 1
            stack = [(sx, sy)]
            label[sy * w + sx] = cid
            pts = []
            border = False
            while stack:
                x, y = stack.pop()
                pts.append((x, y))
                if x in (0, w - 1) or y in (0, h - 1):
                    border = True
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not label[ny * w + nx] and px[nx, ny][3]:
                        label[ny * w + nx] = cid
                        stack.append((nx, ny))
            comps.append((pts, border))
    if not comps:
        return
    biggest = max(len(p) for p, _ in comps)
    for pts, border in comps:
        if len(pts) < biggest * 0.2 and (border or len(pts) < 40 or keep_only_big):
            for x, y in pts:
                px[x, y] = (0, 0, 0, 0)


def is_grass(p):
    r, g, b = p[:3]
    return g > r + 30 and g > b + 30 and g > 90


def cut_scene(sheet, box):
    """A painted scene (e.g. the pond): remove the surrounding grass by flood
    filling green from the crop border, keep everything else (bank, water,
    lily pads, docks...). Returns RGBA."""
    im = sheets[sheet].crop(box).convert('RGBA')
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque([(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] +
              [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)])
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not (is_grass(px[x, y]) or is_bg(px[x, y])):
            continue
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))
    return im


def is_water(p):
    r, g, b, a = p
    return a and b > r + 35 and b > g + 10


def close_scene(im, M=14 * RES):
    """The painted pond runs off the bottom/right edge of its panel. Extend it
    by M px: water continues and ends in a wavy shore (foam + grass rim),
    docks that touch the edge keep going until they reach the shore."""
    w, h = im.size
    out = Image.new('RGBA', (w + M, h + M), (0, 0, 0, 0))
    out.paste(im, (0, 0))
    src, px = im.load(), out.load()
    WATER = (64, 128, 188, 255)
    shore_b = [h + 5 * RES + round(RES * (2 * math.sin(x / (9 * RES)) + 1.4 * math.sin(x / (3.7 * RES)))) for x in range(w + M)]
    shore_r = [w + 5 * RES + round(RES * (2 * math.sin(y / (8 * RES)) + 1.4 * math.sin(y / (3.1 * RES)))) for y in range(h + M)]
    for y in range(h + M):
        for x in range(w + M):
            if x < w and y < h:
                continue
            sx, sy = min(x, w - 1), min(y, h - 1)
            edge = src[sx, sy]
            limit_ok = y <= shore_b[x] and x <= shore_r[y]
            if not limit_ok:
                continue
            if is_water(edge):
                px[x, y] = WATER
            elif edge[3] and edge[0] > edge[2] + 30:          # dock planks: repeat the last 8 rows/cols
                if y >= h:
                    px[x, y] = src[sx, h - 8 * RES + (y - h) % (8 * RES)]
                else:
                    px[x, y] = src[w - 8 * RES + (x - w) % (8 * RES), sy]
    # foam on water touching transparency, dark grass rim just outside
    snap = out.copy().load()
    for y in range(h + M):
        for x in range(w + M):
            if (x < w - 2 and y < h - 2) or not is_water(snap[x, y]):
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w + M and 0 <= ny < h + M and snap[nx, ny][3] == 0:
                    px[x, y] = (196, 232, 246, 255)
                    px[nx, ny] = (58, 112, 52, 255)
    return out


def water_mask(im, cell=4):
    """Rows of '0'/'1' per cell: 1 = water/rock the player cannot walk on."""
    px = im.load()
    rows = []
    for cy in range(0, im.height, cell):
        row = []
        for cx in range(0, im.width, cell):
            wet = tot = 0
            for y in range(cy, min(cy + cell, im.height)):
                for x in range(cx, min(cx + cell, im.width)):
                    r, g, b, a = px[x, y]
                    tot += 1
                    if is_water((r, g, b, a)):
                        wet += 1
            row.append('1' if wet * 2 >= tot else '0')
        rows.append(''.join(row))
    return rows


# ---------------------------------------------------------------- player
# Cell grid of sheet 5 (source px): 4 idle columns, 2 walk, 2 run; 4 rows.
P_ROWS = [(138, 296), (307, 465), (476, 635), (647, 807)]
P_COLS = [(46, 190), (201, 343), (355, 496), (507, 650), (718, 859), (871, 1012), (1125, 1269), (1281, 1426)]
P_SCALE = 0.82
# frame name -> (col, row). Side frames: 'r' faces RIGHT, 'l' faces LEFT.
P_FRAMES = {
    'pl_idle_d': (0, 0), 'pl_walk_d0': (4, 0), 'pl_walk_d1': (4, 1),
    'pl_idle_u': (1, 1), 'pl_walk_u0': (5, 0), 'pl_walk_u1': (5, 1),
    'pl_idle_r': (2, 0), 'pl_walk_l0': (4, 2), 'pl_walk_l1': (4, 3),
    'pl_run_r0': (6, 0), 'pl_run_r1': (6, 1), 'pl_run_r2': (6, 2), 'pl_run_r3': (6, 3),
}


def feet_align(im, half_w=None):
    """Re-centre a trimmed character so the middle of its feet sits exactly at
    the horizontal centre of the image (the draw anchor). Without this, frames
    whose bbox grows because of a swinging arm, a backpack or a tool make the
    character jump sideways while animating."""
    bb = im.getchannel('A').getbbox()
    im = im.crop(bb)
    w, h = im.size
    px = im.load()
    xs = [x for y in range(int(h * 0.9), h) for x in range(w) if px[x, y][3]]
    fx = (min(xs) + max(xs)) / 2 if xs else w / 2
    hw = max(round(fx), w - round(fx)) if half_w is None else half_w
    out = Image.new('RGBA', (hw * 2, h), (0, 0, 0, 0))
    out.paste(im, (hw - round(fx), 0))
    return out


def cut_player_gif():
    """8-direction turnaround GIF (56x56 frames): 0 down, 1 down-right, 2 right,
    3 up-right, 4 up, 5 up-left, 6 left, 7 down-left. Pixel art is scaled up
    with nearest-neighbour so it stays crisp."""
    from PIL import ImageSequence
    path = os.path.join(ROOT, 'assets/source/char_monk.gif')
    if not os.path.exists(path):
        return {}
    out = {}
    frames = [f.convert('RGBA') for f in ImageSequence.Iterator(Image.open(path))]
    for i, f in enumerate(frames):
        big = f.resize((f.width * 2, f.height * 2), Image.NEAREST)
        out[f'pl2_{i}'] = feet_align(big)
    # HUD portrait: head of the front frame
    head = frames[0].crop((14, 0, 42, 26)).resize((28 * 4, 26 * 4), Image.NEAREST)
    port = Image.new('RGBA', (44 * RES, 42 * RES), (240, 190, 110, 255))
    port.alpha_composite(head.resize((44 * RES - 8, int((44 * RES - 8) * 26 / 28)), Image.NEAREST), (4, 4))
    out['portrait'] = port
    return out


def cut_player_walk():
    """Walk cycles: assets/source/char_walk_<dir>.gif (dir 0 down, 1 down-right,
    2 right, 3 up-right, 4 up, 5 up-left, 6 left, 7 down-left), 9 frames each:
    frame 0 = standing, 1..8 = walk loop."""
    from PIL import ImageSequence
    out = {}
    for d in range(8):
        path = os.path.join(ROOT, f'assets/source/char_walk_{d}.gif')
        if not os.path.exists(path):
            return {}
        frames = []
        for f in ImageSequence.Iterator(Image.open(path)):
            f = f.convert('RGBA')
            px = f.load()
            for y in range(f.height):
                for x in range(f.width):
                    r_, g_, b_, a_ = px[x, y]
                    if a_ and g_ > 140 and g_ > r_ + 45 and g_ > b_ + 25:   # stray bright-green pixels
                        px[x, y] = (0, 0, 0, 0)
            frames.append(f.resize((f.width * 2, f.height * 2), Image.NEAREST))
        # one shared horizontal anchor per direction so the loop never slides
        xs = []
        for f in frames:
            a = f.getchannel('A').load()
            w, h = f.size
            bot = max(y for y in range(h) for x in range(w) if a[x, y])
            fx = [x for y in range(bot - 6, bot + 1) for x in range(w) if a[x, y]]
            xs.append((min(fx) + max(fx)) / 2)
        cx = round(sum(xs) / len(xs))
        for i, f in enumerate(frames):
            bb = f.getchannel('A').getbbox()
            hw = max(cx - bb[0], bb[2] - cx) + 1
            im = Image.new('RGBA', (hw * 2, bb[3] - bb[1]), (0, 0, 0, 0))
            im.paste(f.crop((bb[0], bb[1], bb[2], bb[3])), (hw - (cx - bb[0]), 0))
            # keep the feet on one baseline: frames are bottom-aligned by the draw anchor
            out[f'pl3_{d}_{i}'] = im
    return out


ANCHORS = {}   # sprite name -> px (atlas) the image extends below its anchor
WAIST = {}     # body frame -> waist line, fraction of the frame height from its bottom


def cut_char2(folder='char2', prefix='pl4'):
    """assets/source/char2/: idle_<d>.gif (breathing, 4 directions) and
    walk_<d>.gif (8 directions). d: 0 down, 1 down-right, 2 right, 3 up-right,
    4 up, 5 up-left, 6 left, 7 down-left. Frames -> pl4_<d>_i<n> / pl4_<d>_w<n>.
    Diagonal directions without an idle use their most 'standing' walk frame."""
    from PIL import ImageSequence
    base = os.path.join(ROOT, 'assets/source', folder)
    if not os.path.isdir(base):
        return {}

    def load(path):
        fr = []
        for f in ImageSequence.Iterator(Image.open(path)):
            f = f.convert('RGBA')
            fr.append(f.resize((f.width * 2, f.height * 2), Image.NEAREST))
        return fr

    def feet_x(f):
        a = f.getchannel('A').load(); w, h = f.size
        bot = max(y for y in range(h) for x in range(w) if a[x, y])
        xs = [x for y in range(bot - 8, bot + 1) for x in range(w) if a[x, y]]
        return (min(xs) + max(xs)) / 2

    def place(f, cx):
        bb = f.getchannel('A').getbbox()
        hw = max(cx - bb[0], bb[2] - cx) + 1
        im = Image.new('RGBA', (hw * 2, bb[3] - bb[1]), (0, 0, 0, 0))
        im.paste(f.crop(bb), (hw - (cx - bb[0]), 0))
        return im

    out = {}
    for d in range(8):
        walk = load(os.path.join(base, f'walk_{d}.gif'))
        ip = os.path.join(base, f'idle_{d}.gif')
        idle = load(ip) if os.path.exists(ip) else [min(walk, key=lambda f: f.getchannel('A').getbbox()[2] - f.getchannel('A').getbbox()[0])]
        frames = idle + walk
        cx = round(sum(feet_x(f) for f in frames) / len(frames))
        for i, f in enumerate(idle):
            out[f'{prefix}_{d}_i{i}'] = place(f, cx)
        for i, f in enumerate(walk):
            out[f'{prefix}_{d}_w{i}'] = place(f, cx)
        # clothing = body halves (tools/wear_cut.py): wh_<id>_<d>_i (standing) and
        # wh_<id>_<d>_w<i> (walking), each on the canvas of the body frame it
        # replaces half of. WAIST[frame] = waist line as a fraction of the frame
        # height from its bottom, so the game can split the bare body there.
        import wear_cut
        for tag, fl in (('i', idle), ('w', walk)):
            for i, f in enumerate(fl):
                small = f.resize((f.width // 2, f.height // 2), Image.NEAREST)
                fb = f.getchannel('A').getbbox()
                wy = wear_cut.waist_row(small) * 2
                WAIST[f'{prefix}_{d}_{tag}{i}'] = round((fb[3] - wy) / (fb[3] - fb[1]), 4)
        sfx = '_f' if folder == 'char_f' else '_m'
        wdir = os.path.join(ROOT, 'assets/source/wear')

        def wear_frame(L, f):
            L = L.resize((L.width * 2, L.height * 2), Image.NEAREST)
            fb = f.getchannel('A').getbbox(); lb = L.getchannel('A').getbbox()
            if not lb:
                return None, 0
            hwf = max(cx - fb[0], fb[2] - cx) + 1
            hw = max(hwf, cx - lb[0] + 1, lb[2] - cx + 1); hw += (hw - hwf) % 2
            top, bot = min(lb[1], fb[1]), max(lb[3], fb[3])
            im = Image.new('RGBA', (hw * 2, bot - top), (0, 0, 0, 0))
            im.paste(L.crop((cx - hw, top, cx + hw, bot)), (0, 0))
            return im, bot - fb[3]

        for item in sorted(os.listdir(wdir)) if os.path.isdir(wdir) else []:
            if not item.endswith(sfx):
                continue
            jobs = [(f'idle_{d}.png', idle[0], f'wh_{item}_{d}_i')]
            jobs += [(f'walk_{d}_{i}.png', f, f'wh_{item}_{d}_w{i}') for i, f in enumerate(walk)]
            for fn, f, name in jobs:
                lpth = os.path.join(wdir, item, fn)
                if not os.path.exists(lpth):
                    continue
                im, below = wear_frame(Image.open(lpth).convert('RGBA'), f)
                if im is None:
                    continue
                out[name] = im
                if below:
                    ANCHORS[name] = below
            ip = os.path.join(wdir, item, 'turnaround.gif')
            if d == 0 and os.path.exists(ip):         # icon: the item's front view
                t = Image.open(ip); t.seek(0); t = t.convert('RGBA'); tp = t.load()
                for yy in range(t.height):           # the garment alone
                    for xx in range(t.width):
                        if tp[xx, yy][3] and not wear_cut.RULES['red'](tp[xx, yy]):
                            tp[xx, yy] = (0, 0, 0, 0)
                t = t.resize((t.width * 2, t.height * 2), Image.NEAREST)
                out[f'wri_{item}'] = t.crop(t.getchannel('A').getbbox())
        # harvest (pick up a crate): same canvas position as the idle frames,
        # bottom cut at the idle feet line so the body does not jump
        for act, tag in (('harvest', 'h'), ('hoe', 'g'), ('water', 'u')):
          hp = os.path.join(base, f'{act}_{d}.gif')
          if not os.path.exists(hp):
              continue
          base_y = max(f.getchannel('A').getbbox()[3] for f in idle)
          for i, f in enumerate(load(hp)):
              # watering: keep the water that falls below the feet line; the
              # extra height is stored as an anchor offset (ANCHORS)
              bot = max(base_y, f.getchannel('A').getbbox()[3]) if tag == 'u' else base_y
              f2 = f.crop((0, 0, f.width, bot))
              bb2 = f2.getchannel('A').getbbox()
              hw = max(cx - bb2[0], bb2[2] - cx) + 1
              im = Image.new('RGBA', (hw * 2, bot - bb2[1]), (0, 0, 0, 0))
              im.paste(f2.crop((bb2[0], bb2[1], bb2[2], bot)), (hw - (cx - bb2[0]), 0))
              out[f'{prefix}_{d}_{tag}{i}'] = im
              if bot > base_y:
                  ANCHORS[f'{prefix}_{d}_{tag}{i}'] = bot - base_y
    return out


def cut_npcs():
    """NPC turnaround GIFs (8 frames: down, down-right, right, up-right, up,
    up-left, left, down-left) -> npc_<name>_<d>, scaled 2x nearest."""
    from PIL import ImageSequence
    out = {}
    for name in ('farmer',):
        path = os.path.join(ROOT, f'assets/source/npc_{name}.gif')
        if not os.path.exists(path):
            continue
        frames = [f.convert('RGBA') for f in ImageSequence.Iterator(Image.open(path))]
        for i, f in enumerate(frames):
            out[f'npc_{name}_{i}'] = feet_align(f.resize((f.width * 2, f.height * 2), Image.NEAREST))
    return out


def cut_player():
    out = {}
    for name, (c, r) in P_FRAMES.items():
        x0, x1 = P_COLS[c]; y0, y1 = P_ROWS[r]
        im = cut_object('s5', (x0 + 4, y0 + 4, x1 - 4, y1 - 4))
        out[name] = feet_align(downscale(im, mult=P_SCALE))
    return out


# ------------------------------------------------------- sheet 4 ground tiles
# Cells of sheet4.png (source px). Path panel cells are ~118px, terrain
# transition cells ~165px; each becomes one 32px game tile (64px in the atlas).
S4_PATH_COLS = [(47, 166), (181, 300), (316, 434), (450, 568)]
S4_PATH_ROWS = [(1092, 1215), (1231, 1355), (1371, 1495)]
S4_TR_COLS = [(851, 1018), (1032, 1194), (1209, 1370), (1385, 1545)]
S4_TR_ROWS = [(154, 333), (349, 529), (544, 760), (773, 912)]
S4_TILES = {
    # grass (same panel/scale as the paths so they match)
    'gt_grass0': ('p', 0, 0), 'gt_grass1': ('p', 0, 2), 'gt_grass2': ('p', 3, 0), 'gt_grass3': ('p', 3, 2),
    # dirt paths
    'gt_path_v': ('p', 1, 0), 'gt_path_v2': ('p', 1, 2), 'gt_path_h': ('p', 0, 1), 'gt_path_x': ('p', 1, 1),
    # dirt area with grass edges (9-slice: other sides are mirrored copies)
    'gt_dirt_tl': ('t', 0, 0), 'gt_dirt_t': ('t', 1, 0), 'gt_dirt_l': ('t', 0, 1), 'gt_dirt_l2': ('t', 0, 3),
    'gt_dirt': ('t', 1, 3), 'gt_dirt2': ('t', 1, 2),
    # ploughed soil
    'gt_furrow': ('t', 2, 1), 'gt_soil_t': ('t', 2, 0),
}


def key_grass(im):
    """Make the flat grass of a path/edge tile transparent (soft edge), keeping
    the dirt and the grass tufts that overhang it."""
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r_, g_, b_, a_ = px[x, y]
            d = abs(r_ - 152) + abs(g_ - 173) + abs(b_ - 46)
            if g_ > r_ + 4 and g_ > b_ + 60 and d < 70:
                px[x, y] = (r_, g_, b_, 0 if d < 45 else int(255 * (d - 45) / 25))
    return im


def s4_tiles():
    out = {}
    for name, (panel, c, r) in S4_TILES.items():
        cols, rows = (S4_PATH_COLS, S4_PATH_ROWS) if panel == 'p' else (S4_TR_COLS, S4_TR_ROWS)
        (x0, x1), (y0, y1) = cols[c], rows[r]
        ins = 9 if panel == 'p' else 12   # stay clear of the cell's anti-aliased border
        im = sheets['s4'].crop((x0 + ins, y0 + ins, x1 - ins, y1 - ins)).convert('RGBA')
        im = im.resize((T * RES, T * RES), Image.LANCZOS)
        if name.startswith(('gt_path', 'gt_dirt_')):
            im = key_grass(im)       # the continuous grass texture shows through
        out[name] = im
    # watered furrows: same tile, darker and a touch bluer
    wet = out['gt_furrow'].copy()
    px = wet.load()
    for y in range(wet.height):
        for x in range(wet.width):
            r_, g_, b_, a_ = px[x, y]
            px[x, y] = (int(r_ * 0.62), int(g_ * 0.58), int(b_ * 0.62) + 6, a_)
    out['gt_furrow_wet'] = wet
    return out


# --------------------------------------------- single plants (no soil square)
# One plant cut out of the crop beds of sheet 1; the bed soil and the sheet
# background are removed so the plant can stand on any ground tile.
PLANTS = {
    'pc_carrot': (1162, 884, 1210, 952),
    'pc_strawberry': (1495, 884, 1537, 950),
    'pc_turnip': (1604, 880, 1662, 1002),
    'pc_pumpkin': (1712, 878, 1772, 1004),
    'pc_beet': (1832, 880, 1886, 1004),
    'pc_tomato': (1164, 1022, 1214, 1084),
    'pc_eggplant': (1388, 1028, 1436, 1084),
    'pc_sprout': (1494, 1026, 1540, 1088),
}


def is_soil(p):
    r, g, b = p[:3]
    return (60 <= r <= 175 and 30 <= g <= 120 and 15 <= b <= 90 and r > g + 22 and g >= b + 2) or is_bg(p)


def cut_plant(box):
    im = sheets['s1'].crop(box).convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            if is_soil(px[x, y]):
                px[x, y] = (0, 0, 0, 0)
    # keep only the plant itself: the largest connected blob
    seen = [[0] * w for _ in range(h)]
    best = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or not px[sx, sy][3]:
                continue
            comp, st = [], [(sx, sy)]
            seen[sy][sx] = 1
            while st:
                x, y = st.pop(); comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny][3]:
                        seen[ny][nx] = 1; st.append((nx, ny))
            if len(comp) > len(best):
                best = comp
    keep = set(best)
    for y in range(h):
        for x in range(w):
            if (x, y) not in keep:
                px[x, y] = (0, 0, 0, 0)
    return trim(im)


def downscale(im, size=None, mult=1.0):
    if size is None:
        size = (max(1, round(im.width * SCALE * mult * RES)), max(1, round(im.height * SCALE * mult * RES)))
    small = im.resize(size, Image.BOX)
    if small.mode == 'RGBA':
        a = small.getchannel('A').point(lambda v: 255 if v >= 110 else 0)
        small.putalpha(a)
    return small


def trim(im):
    bbox = im.getchannel('A').getbbox()
    return im.crop(bbox) if bbox else im


# ---------------------------------------------------------------- procedural
def noise_tile(base, palette, density, seed, size=T):
    rnd = random.Random(seed)
    im = Image.new('RGBA', (size, size), base)
    px = im.load()
    for _ in range(int(size * size * density)):
        x, y = rnd.randrange(size), rnd.randrange(size)
        px[x, y] = rnd.choice(palette)
    return im


def tuft(im, x, y, dark, light, rnd):
    px = im.load()
    for dx, dy, c in ((0, 0, dark), (1, -1, dark), (2, 0, dark), (1, 0, light), (-1, -1, light)):
        xx, yy = (x + dx) % T, (y + dy) % T
        px[xx, yy] = c


GRASS = (105, 173, 72, 255)
GRASS_D = (88, 155, 64, 255)
GRASS_DD = (55, 115, 52, 255)
GRASS_L = (124, 190, 84, 255)
DIRT = (203, 150, 82, 255)
DIRT_D = (178, 126, 68, 255)
DIRT_L = (220, 172, 104, 255)
OUTLINE_G = (44, 92, 46, 255)


def make_grass(seed):
    rnd = random.Random(seed)
    im = noise_tile(GRASS, [GRASS_D, GRASS_L, GRASS_D], 0.03, seed)
    for _ in range(rnd.randint(1, 3)):
        tuft(im, rnd.randrange(T), rnd.randrange(T), GRASS_DD, GRASS_L, rnd)
    return im


def make_dirt(seed):
    rnd = random.Random(seed)
    im = noise_tile(DIRT, [DIRT_D, DIRT_L, DIRT_D], 0.05, seed)
    px = im.load()
    for _ in range(rnd.randint(0, 2)):  # tiny pebbles
        x, y = rnd.randrange(1, T - 2), rnd.randrange(1, T - 2)
        px[x, y] = (150, 110, 70, 255); px[x + 1, y] = (232, 196, 140, 255)
    return im


def edge_overlay(kind, side):
    """Grass fringe drawn on top of a dirt/water tile on the side touching grass.
    side: n,s,e,w (edges) or ne,nw,se,sw (inner corners)."""
    rnd = random.Random(hash((kind, side)) & 0xffff)
    im = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    px = im.load()
    rim = (60, 125, 55, 255) if kind == 'dirt' else (40, 82, 48, 255)
    foam = (150, 210, 235, 255)
    depth = [3 + int(1.6 * ((i * 7919 + len(side) * 31) % 5) / 2) for i in range(T)]
    # smooth the depth profile so it tiles (ends meet at 3)
    prof = []
    for i in range(T):
        d = 3 + round(1.8 * (1 + __import__('math').sin(i / T * 6.283 * 2 + (1 if kind == 'dirt' else 2))) / 2) + (rnd.random() < .25)
        prof.append(d)
    prof[0] = prof[-1] = 3

    def put(x, y, c):
        if 0 <= x < T and 0 <= y < T:
            px[x, y] = c

    def edge(fn):
        for i in range(T):
            d = prof[i]
            for k in range(d):
                put(*fn(i, k), GRASS if k < d - 1 else rim)
            if kind == 'water':
                put(*fn(i, d), foam)

    if side == 'n': edge(lambda i, k: (i, k))
    elif side == 's': edge(lambda i, k: (i, T - 1 - k))
    elif side == 'w': edge(lambda i, k: (k, i))
    elif side == 'e': edge(lambda i, k: (T - 1 - k, i))
    else:  # inner corner: small quarter blob
        cx = 0 if 'w' in side else T - 1
        cy = 0 if 'n' in side else T - 1
        for y in range(T):
            for x in range(T):
                d = ((x - cx) ** 2 + (y - cy) ** 2) ** .5
                if d < 4: px[x, y] = GRASS
                elif d < 5: px[x, y] = rim
                elif kind == 'water' and d < 6: px[x, y] = foam
    return im


def make_seamless(im):
    """Cross-fade with a half-offset copy so the texture tiles without seams."""
    w, h = im.size
    rolled = Image.new('RGBA', (w, h))
    rolled.paste(im, (-(w // 2), -(h // 2))); rolled.paste(im, (w - w // 2, -(h // 2)))
    rolled.paste(im, (-(w // 2), h - h // 2)); rolled.paste(im, (w - w // 2, h - h // 2))
    a, b = im.load(), rolled.load()
    out = Image.new('RGBA', (w, h)); o = out.load()
    fx = [min(1.0, min(x, w - 1 - x) / (w * 0.22)) for x in range(w)]
    fy = [min(1.0, min(y, h - 1 - y) / (h * 0.22)) for y in range(h)]
    for y in range(h):
        for x in range(w):
            k = fx[x] * fy[y]
            pa, pb = a[x, y], b[x, y]
            o[x, y] = tuple(round(pa[i] * k + pb[i] * (1 - k)) for i in range(3)) + (255,)
    return out


def make_bombed_texture(sheet, box, src_size, out=128, patch=22, stamps=160, seed=7):
    """Large seamless texture made by stamping random feathered patches of the
    painted source at random places (wrapping). Features such as pebbles end up
    scattered irregularly instead of repeating on a grid."""
    rnd = random.Random(seed)
    src = make_seamless(sheets[sheet].crop(box).convert('RGBA').resize(src_size, Image.BOX))
    sw, sh = src.size
    sp = src.load()
    acc = [[[0.0, 0.0, 0.0, 0.0] for _ in range(out)] for _ in range(out)]
    # base: tile the seamless source so nothing is empty
    for y in range(out):
        for x in range(out):
            r, g, b, _ = sp[x % sw, y % sh]
            acc[y][x] = [r * 0.2, g * 0.2, b * 0.2, 0.2]
    half = patch / 2
    for _ in range(stamps):
        sx, sy = rnd.randrange(sw), rnd.randrange(sh)
        dx, dy = rnd.randrange(out), rnd.randrange(out)
        for j in range(patch):
            for i in range(patch):
                d = max(abs(i - half + 0.5), abs(j - half + 0.5)) / half
                w = 1.0 if d < 0.6 else max(0.0, (1 - d) / 0.4)
                if w <= 0:
                    continue
                r, g, b, _ = sp[(sx + i) % sw, (sy + j) % sh]
                cell = acc[(dy + j) % out][(dx + i) % out]
                cell[0] += r * w; cell[1] += g * w; cell[2] += b * w; cell[3] += w
    im = Image.new('RGBA', (out, out))
    px = im.load()
    for y in range(out):
        for x in range(out):
            r, g, b, w = acc[y][x]
            px[x, y] = (round(r / w), round(g / w), round(b / w), 255)
    return im


def make_mirror_texture(sheet, box, size):
    """2x2 mirrored tiling: seamless by construction, no blur, longer period."""
    a = sheets[sheet].crop(box).convert('RGBA').resize(size, Image.BOX)
    w, h = size
    out = Image.new('RGBA', (w * 2, h * 2))
    out.paste(a, (0, 0))
    out.paste(a.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    out.paste(a.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
    out.paste(a.transpose(Image.ROTATE_180), (w, h))
    return out


def make_texture(sheet, box, size):
    """Ground texture cut from a painted sheet, resized and made seamless."""
    im = sheets[sheet].crop(box).convert('RGBA').resize(size, Image.BOX)
    return make_seamless(im)


def make_dark_grass(seed):
    """Shaded forest-floor grass."""
    rnd = random.Random(seed)
    base = (82, 148, 62, 255)
    im = noise_tile(base, [(70, 132, 56, 255), (96, 162, 68, 255), (62, 120, 52, 255)], 0.06, seed)
    for _ in range(rnd.randint(2, 4)):
        tuft(im, rnd.randrange(T), rnd.randrange(T), (50, 104, 46, 255), (104, 170, 72, 255), rnd)
    return im


def make_field(seed):
    """Untilled farmland: light soil with faint furrows."""
    im = noise_tile((178, 124, 74, 255), [(160, 108, 62, 255), (192, 138, 84, 255)], 0.06, seed)
    d = ImageDraw.Draw(im)
    for y in range(3, T, 8):
        d.line([(0, y), (T - 1, y)], fill=(150, 98, 56, 255))
        d.line([(0, y + 1), (T - 1, y + 1)], fill=(196, 144, 90, 255))
    return im


def make_sand(seed):
    rnd = random.Random(seed)
    return noise_tile((214, 176, 112, 255), [(198, 160, 98, 255), (226, 192, 130, 255)], 0.05, seed)


def make_decals():
    """Tiny ground details baked into the ground layer (zero runtime cost)."""
    out = {}
    petals = {'w': ((246, 244, 232), (210, 206, 190)), 'y': ((250, 214, 70), (214, 168, 40)),
              'p': ((240, 130, 170), (200, 90, 130)), 'b': ((120, 170, 240), (80, 120, 200)),
              'r': ((230, 80, 70), (180, 50, 50))}
    for k, (c1, c2) in petals.items():
        for v in range(2):
            rnd = random.Random(hash(k) % 1000 + v)
            im = Image.new('RGBA', (12, 10), (0, 0, 0, 0)); px = im.load()
            for _ in range(2 + v):
                x, y = rnd.randrange(1, 10), rnd.randrange(1, 8)
                px[x, y + 1] = (60, 120, 50, 255)
                for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                    if 0 <= x + dx < 12 and 0 <= y + dy < 10:
                        px[x + dx, y + dy] = c1 + (255,)
                px[x, y] = (250, 210, 80, 255) if k != 'y' else (200, 110, 40, 255)
                if 0 <= y + 1 < 10: px[x, y + 1] = c2 + (255,)
            out[f'dec_flower_{k}{v}'] = im
    for v in range(3):
        rnd = random.Random(500 + v)
        im = Image.new('RGBA', (12, 8), (0, 0, 0, 0)); px = im.load()
        for i in range(4 + v):
            x = 1 + rnd.randrange(10); h = 2 + rnd.randrange(4)
            for y in range(h):
                px[x, 7 - y] = (52, 110, 48, 255) if y < h - 1 else (124, 190, 84, 255)
        out[f'dec_tuft{v}'] = im
    im = Image.new('RGBA', (8, 6), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse([0, 1, 5, 5], fill=(150, 150, 140, 255), outline=(80, 80, 76, 255)); d.point((2, 2), fill=(200, 200, 190, 255))
    out['dec_pebble'] = im
    im = Image.new('RGBA', (10, 8), (0, 0, 0, 0)); px = im.load()
    for (x, y) in ((2, 2), (6, 1), (4, 5), (8, 4)):
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            px[x + dx - 1, y + dy - 1] = (76, 150, 64, 255)
    out['dec_clover'] = im
    return out


def make_fence_v(post):
    """Vertical fence segment: a post with a rail running up to the previous post."""
    W, H = post.width, 32 + post.height - 6
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0 = W // 2 - 2
    d.rectangle([x0, 4, x0 + 3, H - 6], fill=(150, 96, 54, 255), outline=(70, 42, 26, 255))
    d.line([(x0 + 1, 5), (x0 + 1, H - 7)], fill=(192, 132, 76, 255))
    im.alpha_composite(post, (0, H - post.height))
    return im


BLADES = [(76, 150, 64, 255), (96, 170, 72, 255), (64, 132, 56, 255), (118, 186, 80, 255), (86, 160, 66, 255)]


def blade(px, w, h, x, y, height, lean, color, tip):
    for k in range(height):
        xx = (x + (lean * k) // 4) % w
        yy = y - k
        if 0 <= yy < h:
            px[xx, yy] = tip if k == height - 1 else color


def make_tall_grass_tile(seed):
    """Seamless dense grass tile (meadow floor)."""
    rnd = random.Random(seed)
    im = Image.new('RGBA', (T, T), (54, 112, 48, 255))
    px = im.load()
    for _ in range(170):
        x, y = rnd.randrange(T), rnd.randrange(T + 6)
        h = rnd.randint(3, 6)
        c = rnd.choice(BLADES)
        for k in range(h):  # wrap vertically too so the tile is seamless
            yy = (y - k) % T
            xx = (x + (rnd.choice((-1, 0, 0, 1)) if k == h - 1 else 0)) % T
            px[xx, yy] = (150, 206, 96, 255) if k == h - 1 else c
    return im


def tall_grass_top(seed):
    """Tall blades drawn over the player's legs while walking in the meadow."""
    rnd = random.Random(seed)
    W, H = T, 20
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    for i in range(26):
        x = (i * 5 + rnd.randrange(4)) % W
        blade(px, W, H, x, H - 1, rnd.randint(7, 14), rnd.choice((-2, -1, 0, 1, 2)), rnd.choice(BLADES), (150, 206, 96, 255))
        if 0 <= x - 1:
            px[x - 1, H - 1] = (44, 92, 42, 255)
    return im


def make_bridge(rail_side):
    im = Image.new('RGBA', (T, T), (150, 100, 56, 255))
    d = ImageDraw.Draw(im)
    for x in range(0, T, 8):  # planks running north-south
        d.rectangle([x, 0, x + 7, T - 1], fill=(160, 108, 60, 255) if (x // 8) % 2 else (146, 96, 54, 255))
        d.line([(x, 0), (x, T - 1)], fill=(92, 58, 34, 255))
        d.point((x + 3, 6 + (x % 16)), fill=(110, 70, 40, 255))
        d.point((x + 4, 22 - (x % 12)), fill=(110, 70, 40, 255))
    if rail_side == 'm':
        return im
    y = 0 if rail_side == 'n' else T - 6
    d.rectangle([0, y, T - 1, y + 5], fill=(120, 78, 44, 255))
    d.line([(0, y + 1), (T - 1, y + 1)], fill=(176, 124, 70, 255))
    d.rectangle([0, y, 3, y + 5], fill=(92, 58, 34, 255))
    d.rectangle([16, y, 19, y + 5], fill=(92, 58, 34, 255))
    d.line([(0, y + 5 if rail_side == 'n' else y), (T - 1, y + 5 if rail_side == 'n' else y)], fill=(60, 38, 26, 255))
    return im


def make_watered(soil):
    im = soil.copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (int(r * .62), int(g * .55), int(b * .55), a)
    return im


def make_seeds(soil):
    im = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    px = im.load()
    for (x, y) in ((8, 9), (22, 8), (9, 23), (23, 22), (15, 15)):
        px[x, y] = (236, 214, 150, 255); px[x + 1, y] = (200, 170, 110, 255)
        px[x, y + 1] = (120, 80, 40, 255)
    return im


# ------------------------------------------------------------- player sprite
SKIN = (240, 196, 150, 255); SKIN_D = (206, 150, 110, 255)
HAIR = (110, 64, 36, 255); HAT = (226, 186, 92, 255); HAT_D = (170, 128, 56, 255)
SHIRT = (64, 128, 196, 255); SHIRT_D = (44, 90, 150, 255)
PANTS = (92, 70, 54, 255); BOOT = (60, 40, 30, 255); OUT = (34, 26, 32, 255)
EYE = (34, 26, 32, 255)


def draw_player(direction, frame):
    """16x24 farmer. direction: 0 down,1 left,2 right,3 up. frame 0..3."""
    W, H = 16, 24
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    bob = 1 if frame in (1, 3) else 0
    step = (0, 1, 0, -1)[frame]
    # legs
    ly = 18 + 0
    if direction in (0, 3):
        d.rectangle([5, ly, 7, 21 - (step > 0)], fill=PANTS)
        d.rectangle([8, ly, 10, 21 - (step < 0)], fill=PANTS)
        d.rectangle([5, 22 - (step > 0), 7, 23 - (step > 0)], fill=BOOT)
        d.rectangle([8, 22 - (step < 0), 10, 23 - (step < 0)], fill=BOOT)
    else:
        s = step
        d.rectangle([6 + s, ly, 8 + s, 21], fill=PANTS)
        d.rectangle([7 - s, ly, 9 - s, 21], fill=PANTS)
        d.rectangle([6 + s, 22, 8 + s, 23], fill=BOOT)
        d.rectangle([7 - s, 22, 9 - s, 23], fill=BOOT)
    y0 = bob
    # body / shirt
    d.rectangle([4, 11 + y0, 11, 18 + y0], fill=SHIRT)
    d.rectangle([4, 17 + y0, 11, 18 + y0], fill=SHIRT_D)
    # overall straps
    if direction == 0:
        d.rectangle([5, 12 + y0, 5, 17 + y0], fill=PANTS)
        d.rectangle([10, 12 + y0, 10, 17 + y0], fill=PANTS)
    # arms
    sw = (0, 1, 0, -1)[frame] if direction in (0, 3) else 0
    if direction in (0, 3):
        d.rectangle([3, 12 + y0 + sw, 3, 16 + y0 + sw], fill=SHIRT_D)
        d.rectangle([12, 12 + y0 - sw, 12, 16 + y0 - sw], fill=SHIRT_D)
        d.point((3, 17 + y0 + sw), fill=SKIN); d.point((12, 17 + y0 - sw), fill=SKIN)
    else:
        ax = 7 + (step if direction == 2 else -step)
        d.rectangle([ax, 12 + y0, ax + 1, 16 + y0], fill=SHIRT_D)
        d.rectangle([ax, 17 + y0, ax + 1, 17 + y0], fill=SKIN)
    # head
    d.rectangle([4, 4 + y0, 11, 11 + y0], fill=SKIN)
    if direction == 3:
        d.rectangle([4, 5 + y0, 11, 10 + y0], fill=HAIR)
    elif direction == 0:
        d.rectangle([4, 5 + y0, 11, 6 + y0], fill=HAIR)
        d.point((6, 8 + y0), fill=EYE); d.point((9, 8 + y0), fill=EYE)
        d.point((7, 10 + y0), fill=SKIN_D); d.point((8, 10 + y0), fill=SKIN_D)
    else:
        left = direction == 1
        d.rectangle([4, 5 + y0, 11, 6 + y0], fill=HAIR)
        hx = 9 if left else 4
        d.rectangle([hx, 5 + y0, hx + 2, 9 + y0], fill=HAIR)
        d.point((5 if left else 10, 8 + y0), fill=EYE)
    # straw hat
    d.rectangle([2, 4 + y0, 13, 5 + y0], fill=HAT)
    d.rectangle([5, 1 + y0, 10, 3 + y0], fill=HAT)
    d.rectangle([5, 3 + y0, 10, 3 + y0], fill=(200, 70, 60, 255))
    d.rectangle([2, 5 + y0, 13, 5 + y0], fill=HAT_D)
    # outline pass
    src = im.copy(); sp = src.load(); px = im.load()
    for y in range(H):
        for x in range(W):
            if sp[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < W and 0 <= yy < H and sp[xx, yy][3]:
                    px[x, y] = OUT
                    break
    return im


def supply_icons():
    """Fertilizer sack and pesticide spray bottle (16x16 pixel art)."""
    out = {}
    OUTL = (60, 38, 22, 255)
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.polygon([(4, 4), (11, 4), (13, 14), (2, 14)], fill=(214, 186, 128, 255), outline=OUTL)
    d.rectangle([5, 2, 10, 4], fill=(190, 160, 105, 255), outline=OUTL)
    d.line([(4, 3), (11, 3)], fill=(150, 90, 50, 255))
    d.ellipse([5, 7, 10, 12], fill=(96, 168, 70, 255), outline=(50, 100, 40, 255))
    d.line([(7, 12), (8, 8)], fill=(50, 100, 40, 255))
    out['it_fert'] = im
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([5, 6, 11, 14], fill=(220, 70, 60, 255), outline=(110, 30, 25, 255))
    d.rectangle([6, 9, 10, 12], fill=(250, 240, 220, 255))
    d.point((8, 10), fill=(60, 60, 60, 255)); d.point((7, 11), fill=(60, 60, 60, 255)); d.point((9, 11), fill=(60, 60, 60, 255))
    d.rectangle([7, 3, 9, 5], fill=(70, 70, 80, 255), outline=(30, 30, 35, 255))
    d.line([(9, 3), (13, 3)], fill=(30, 30, 35, 255)); d.point((14, 2), fill=(170, 220, 255, 255)); d.point((14, 4), fill=(170, 220, 255, 255))
    d.line([(5, 4), (6, 6)], fill=(30, 30, 35, 255))
    out['it_spray'] = im
    return out


def tool_icons():
    icons = {}
    # hoe
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.line([(3, 14), (11, 4)], fill=(150, 100, 56, 255), width=2)
    d.polygon([(9, 2), (14, 2), (14, 5), (11, 5)], fill=(170, 176, 186, 255), outline=OUT)
    icons['icon_hoe'] = im
    # watering can
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([3, 6, 10, 13], fill=(96, 160, 210, 255), outline=OUT)
    d.line([(10, 8), (14, 4)], fill=(96, 160, 210, 255), width=2)
    d.arc([3, 2, 10, 9], 180, 360, fill=OUT)
    icons['icon_can'] = im
    return icons


# --------------------------------------------------------------------- pack
def polish(im, rim=True, sharp=150, color=1.18, contrast=1.08):
    """Crisper, glossier sprite: unsharp mask, a little more colour/contrast and
    a soft rim light on the top-left edges (as if lit by the sun)."""
    a = im.getchannel('A')
    rgb = im.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.4, percent=sharp, threshold=1))
    rgb = ImageEnhance.Color(rgb).enhance(color)
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    out = rgb.convert('RGBA'); out.putalpha(a)
    if rim:
        px, ap = out.load(), a.load()
        w, h = out.size
        d = max(1, RES)
        for y in range(h):
            for x in range(w):
                if not ap[x, y]:
                    continue
                ux, uy = x - d, y - d
                if ux < 0 or uy < 0 or ap[ux, uy] < 40 or ap[x, uy] < 40:
                    r_, g_, b_, a_ = px[x, y]
                    px[x, y] = (min(255, int(r_ * 1.25 + 28)), min(255, int(g_ * 1.25 + 28)), min(255, int(b_ * 1.15 + 18)), a_)
    return out


def soft_gloss(im):
    """Small, subtle highlight on fruit only (no glow on leaves)."""
    px = im.load()
    w, h = im.size
    fruit = lambda p: p[3] and p[0] > 150 and p[0] > p[1] + 60 and p[2] < 120
    for y in range(h):
        for x in range(w):
            if not fruit(px[x, y]):
                continue
            d = 0
            while d < 6 * RES and x - d - 1 >= 0 and y - d - 1 >= 0 and fruit(px[x - d - 1, y - d - 1]):
                d += 1
            if RES <= d <= RES + 1:
                r_, g_, b_, a_ = px[x, y]
                px[x, y] = (min(255, r_ + 30), min(255, g_ + 38), min(255, b_ + 38), a_)
    return im


def gloss_fruit(im):
    """Specular highlight on fruit (red / orange blobs): the upper-left part of
    every fruit pixel run gets a soft white shine, like a polished tomato."""
    px = im.load()
    w, h = im.size
    fruit = lambda p: p[3] and p[0] > 150 and p[0] > p[1] + 60 and p[2] < 120
    for y in range(h):
        for x in range(w):
            if not fruit(px[x, y]):
                continue
            # distance to the fruit edge towards the upper-left
            d = 0
            while d < 8 * RES and x - d - 1 >= 0 and y - d - 1 >= 0 and fruit(px[x - d - 1, y - d - 1]):
                d += 1
            if RES <= d <= 2 * RES:
                r_, g_, b_, a_ = px[x, y]
                px[x, y] = (min(255, r_ + 70), min(255, g_ + 90), min(255, b_ + 90), a_)
            elif d < RES:
                r_, g_, b_, a_ = px[x, y]
                px[x, y] = (min(255, r_ + 25), min(255, g_ + 25), min(255, b_ + 20), a_)
    return im


GLOSSY = ('cp_', 'flower', 'flowers_', 'd_flower', 'd_clover', 'd_tuft', 'd_sprouts', 'd_mushroom', 'fern', 'plant', 'pc_',
          'bush', 'tree', 'trees_', 'forest_')


def pack(images, pad=3):
    """Shelf packer. Every sprite gets a `pad`-px border made of its own edge
    pixels (extrusion): lossy WebP and texture filtering then never bleed a
    neighbour's colours into tiles/patterns (no seams, no grey lines)."""
    items = sorted(images.items(), key=lambda kv: (-kv[1].height, -kv[1].width))
    W = 3072
    x = y = shelf = 0
    rects = {}
    for name, im in items:
        w, h = im.width + 2 * pad, im.height + 2 * pad
        if x + w > W:
            x = 0; y += shelf; shelf = 0
        rects[name] = (x + pad, y + pad, im.width, im.height)
        x += w
        shelf = max(shelf, h)
    H = y + shelf
    atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for name, im in images.items():
        rx, ry, w, h = rects[name]
        im = im.convert('RGBA')
        # extrude: edge rows/cols repeated into the padding
        atlas.paste(im.crop((0, 0, w, 1)).resize((w, pad)), (rx, ry - pad))
        atlas.paste(im.crop((0, h - 1, w, h)).resize((w, pad)), (rx, ry + h))
        atlas.paste(im.crop((0, 0, 1, h)).resize((pad, h)), (rx - pad, ry))
        atlas.paste(im.crop((w - 1, 0, w, h)).resize((pad, h)), (rx + w, ry))
        atlas.paste(im, (rx, ry))
    return atlas, rects


def main():
    images = {}
    masks = {}
    native = set()   # images already at RES density
    for name, spec in SPRITES.items():
        sh, x0, y0, x1, y1, kind = spec[:6]
        mult = spec[6] if len(spec) > 6 else 1.0
        native.add(name)
        if kind == 'tile':
            images[name] = downscale(sheets[sh].crop((x0, y0, x1, y1)).convert('RGBA'), (T * RES, T * RES))
        elif kind == 'scene':
            im = close_scene(downscale(cut_scene(sh, (x0, y0, x1, y1)), mult=mult))
            if name == 'pond_scene':
                # keep only the pond itself: drops the leftover strip of the painted
                # mud path and loose grass specks around it
                drop_border_fragments(im, keep_only_big=True)
                ap = im.load()
                lab = {}
                comps = []
                for sy in range(im.height):
                    for sx in range(im.width):
                        if ap[sx, sy][3] and (sx, sy) not in lab:
                            st, comp = [(sx, sy)], []
                            lab[(sx, sy)] = 1
                            while st:
                                x_, y_ = st.pop(); comp.append((x_, y_))
                                for nx, ny in ((x_ + 1, y_), (x_ - 1, y_), (x_, y_ + 1), (x_, y_ - 1)):
                                    if 0 <= nx < im.width and 0 <= ny < im.height and ap[nx, ny][3] and (nx, ny) not in lab:
                                        lab[(nx, ny)] = 1; st.append((nx, ny))
                            comps.append(comp)
                big = max(len(c) for c in comps)
                for c in comps:
                    if len(c) < big * 0.05:
                        for x_, y_ in c:
                            ap[x_, y_] = (0, 0, 0, 0)
            # pad so the size is a multiple of the 4px collision cell (in game px)
            g = 4 * RES
            pw, ph = -(-im.width // g) * g, -(-im.height // g) * g
            padded = Image.new('RGBA', (pw, ph), (0, 0, 0, 0)); padded.paste(im, (0, 0))
            images[name] = padded
            masks[name] = water_mask(padded, cell=g)
        elif name.startswith('pl_'):
            images[name] = feet_align(downscale(cut_object(sh, (x0, y0, x1, y1)), mult=mult))
        else:
            images[name] = trim(downscale(cut_object(sh, (x0, y0, x1, y1)), mult=mult))
    images.update(cut_player()); native.update(k for k in images if k.startswith('pl_'))
    npcs = cut_npcs(); images.update(npcs); native.update(npcs)
    c2 = cut_char2()
    if c2:
        # active protagonist: only its frames go into the atlas
        images.update(c2); native.update(c2)
        from PIL import ImageSequence
        cf = cut_char2('char_f', 'pl5')          # female protagonist
        images.update(cf); native.update(cf)
        for folder, pname in (('char2', 'portrait'), ('char_f', 'portrait_f')):
            fp = os.path.join(ROOT, 'assets/source', folder, 'idle_0.gif')
            if not os.path.exists(fp):
                continue
            f0 = next(ImageSequence.Iterator(Image.open(fp))).convert('RGBA')
            bb = f0.getchannel('A').getbbox()
            head = f0.crop((bb[0], bb[1], bb[2], bb[1] + (bb[3] - bb[1]) * 45 // 100))
            port = Image.new('RGBA', (44 * RES, 42 * RES), (240, 190, 110, 255))
            k = min((44 * RES - 10) / head.width, (42 * RES - 6) / head.height)
            hs = head.resize((int(head.width * k), int(head.height * k)), Image.NEAREST)
            port.alpha_composite(hs, ((port.width - hs.width) // 2, port.height - hs.height))
            images[pname] = port; native.add(pname)
    else:
        images.update(cut_player_gif()); native.update(k for k in images if k.startswith('pl2_'))
        images.update(cut_player_walk()); native.update(k for k in images if k.startswith('pl3_'))
    for name, box in PLANTS.items():
        im = cut_plant(box)
        k = min(26 * RES / im.width, 28 * RES / im.height)
        images[name] = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        native.add(name)
    # watering can icon from the farming-action panel of sheet 5
    can = cut_object('s5', (1160, 1108, 1262, 1186))
    images['tool_can'] = trim(downscale(can, mult=0.6)); native.add('tool_can')
    import crops_cut
    cp = crops_cut.build(RES, T)
    images.update(cp); native.update(cp)
    # barren / cracked soil for empty plots (user asset)
    ds = Image.open(os.path.join(ROOT, 'assets/source/dry_soil.png')).convert('RGBA')
    side = min(ds.size)
    ds = ds.crop(((ds.width - side) // 2, (ds.height - side) // 2, (ds.width + side) // 2, (ds.height + side) // 2))
    images['tex_dry'] = ds.resize((T * RES, T * RES), Image.NEAREST); native.add('tex_dry')
    images.update(s4_tiles()); native.update(S4_TILES); native.add('gt_furrow_wet')
    # crops render as 1 tile
    for name in list(images):
        if name.startswith('crop_'):
            im = images[name]
            s = min(T * RES / im.width, T * RES / im.height)
            images[name] = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)

    for i in range(4):
        images[f'tile_grass{i}'] = make_grass(100 + i)
        images[f'tile_dirt{i}'] = make_dirt(200 + i)
    for kind in ('dirt', 'water'):
        for side in ('n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'):
            images[f'edge_{kind}_{side}'] = edge_overlay(kind, side)
    # cobblestone: the source only has a stone band, so stack it twice
    band = downscale(sheets['s2'].crop((700, 1042, 940, 1104)).convert('RGBA'), (T * 2 * RES, T // 2 * RES))
    TR = T * RES
    stone = Image.new('RGBA', (TR, TR))
    stone.paste(band.crop((0, 0, TR, TR // 2)), (0, 0))
    stone.paste(band.crop((TR, 0, 2 * TR, TR // 2)), (0, TR // 2))
    images['tile_stone'] = stone; native.add('tile_stone')
    images['tile_bridge_n'] = make_bridge('n')
    images['tile_bridge_s'] = make_bridge('s')
    images['tile_bridge_m'] = make_bridge('m')
    for i in range(4):
        images[f'tile_grassd{i}'] = make_dark_grass(300 + i)
    images['tile_sand'] = make_sand(400)
    images['tile_field'] = make_field(410)
    # painted ground textures (sheet 4: one consistent palette for grass + soil)
    R = RES
    images['tex_grass'] = make_bombed_texture('s4', (55, 355, 182, 505), (34 * R, 40 * R), out=128 * R, patch=22 * R, seed=3)
    images['tex_grassd'] = make_bombed_texture('s4', (228, 360, 362, 505), (36 * R, 39 * R), out=128 * R, patch=18 * R, seed=5)
    images['tex_tall'] = make_bombed_texture('s4', (414, 165, 558, 318), (38 * R, 41 * R), out=128 * R, patch=18 * R, seed=6)
    images['tex_dirt'] = make_bombed_texture('s4', (1042, 782, 1175, 895), (36 * R, 30 * R), out=128 * R, patch=22 * R, seed=7)
    images['tex_field'] = make_bombed_texture('s4', (1402, 252, 1530, 325), (34 * R, 20 * R), out=128 * R, patch=14 * R, seed=9)
    images['tex_cobble'] = make_seamless(sheets['s4'].crop((1400, 782, 1530, 895)).convert('RGBA').resize((40 * R, 34 * R), Image.BOX))
    images['tile_soil'] = downscale(sheets['s4'].crop((1217, 362, 1348, 505)).convert('RGBA'), (T * R, T * R))  # ploughed furrows
    images['tile_soil_wet'] = make_watered(images['tile_soil'])
    native.update(['tex_grass', 'tex_grassd', 'tex_tall', 'tex_dirt', 'tex_field', 'tex_cobble', 'tile_soil', 'tile_soil_wet'])
    images.update(make_decals())
    images['fence_v'] = make_fence_v(images['fence_post'].resize((images['fence_post'].width // RES, images['fence_post'].height // RES), Image.BOX))
    images['tile_tallgrass'] = make_tall_grass_tile(600)
    images['tallgrass_top'] = tall_grass_top(601)
    images['seeds'] = make_seeds(None)
    # HUD portrait (opaque, keeps its orange frame)
    if 'portrait' not in images:
        images['portrait'] = sheets['s5'].crop((2278, 138, 2552, 398)).convert('RGBA').resize((44 * R, 42 * R), Image.LANCZOS)
    native.add('portrait')
    images.update(tool_icons())
    images.update(supply_icons())
    # procedural pixel art is drawn at game resolution: blow it up crisply
    for k in list(images):
        if k not in native:
            im = images[k]
            images[k] = im.resize((im.width * RES, im.height * RES), Image.NEAREST)

    for k in list(images):
        if k.startswith('cp_'):
            # match the softer palette of the map: no extra saturation, gentle shine
            images[k] = soft_gloss(polish(images[k], rim=False, sharp=110, color=0.9, contrast=0.97))
        elif k.startswith(GLOSSY):
            images[k] = polish(images[k], rim=not k.startswith(('tree', 'trees_', 'forest_')))
        elif k in ('tex_grass', 'tex_grassd', 'tex_tall'):
            images[k] = polish(images[k], rim=False, sharp=170, color=1.12, contrast=1.1)
        elif k.startswith('gt_'):
            images[k] = polish(images[k], rim=False, sharp=130, color=1.1, contrast=1.06)
    atlas, rects = pack(images)
    os.makedirs(OUT_DIR, exist_ok=True)
    for old in ('atlas.png',):
        if os.path.exists(os.path.join(OUT_DIR, old)):
            os.remove(os.path.join(OUT_DIR, old))
    out_path = os.path.join(OUT_DIR, 'atlas.webp')
    atlas.save(out_path, 'WEBP', quality=90, method=6)
    with open(os.path.join(OUT_DIR, 'atlas.json'), 'w') as f:
        json.dump({'w': atlas.width, 'h': atlas.height, 'res': RES, 'frames': rects, 'masks': masks, 'anchors': ANCHORS, 'waist': WAIST}, f, separators=(',', ':'))
    print(f'atlas {atlas.width}x{atlas.height} @{RES}x, {len(rects)} sprites, {os.path.getsize(out_path)//1024} KB')

    if '--preview' in sys.argv:
        out = sys.argv[sys.argv.index('--preview') + 1]
        bg = Image.new('RGBA', atlas.size, (255, 0, 255, 255))
        bg.alpha_composite(atlas)
        bg.save(out)


if __name__ == '__main__':
    main()
