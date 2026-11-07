#!/usr/bin/env python3
"""Cut sprites out of the source sheets, generate procedural tiles and the
player character, then pack everything into one small palette PNG atlas.

Usage: python3 tools/build_assets.py [--preview out.png]
Output: client/public/assets/atlas.png + atlas.json
"""
import json, math, os, random, sys
from collections import deque
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from sprites import SPRITES, SCALE  # noqa: E402

OUT_DIR = os.path.join(ROOT, 'client', 'public', 'assets')
T = 32

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
    drop_border_fragments(im, keep_only_big=(sheet == 's5'))
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


def close_scene(im, M=14):
    """The painted pond runs off the bottom/right edge of its panel. Extend it
    by M px: water continues and ends in a wavy shore (foam + grass rim),
    docks that touch the edge keep going until they reach the shore."""
    w, h = im.size
    out = Image.new('RGBA', (w + M, h + M), (0, 0, 0, 0))
    out.paste(im, (0, 0))
    src, px = im.load(), out.load()
    WATER = (64, 128, 188, 255)
    shore_b = [h + 5 + round(2 * math.sin(x / 9) + 1.4 * math.sin(x / 3.7)) for x in range(w + M)]
    shore_r = [w + 5 + round(2 * math.sin(y / 8) + 1.4 * math.sin(y / 3.1)) for y in range(h + M)]
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
                    px[x, y] = src[sx, h - 8 + (y - h) % 8]
                else:
                    px[x, y] = src[w - 8 + (x - w) % 8, sy]
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


def downscale(im, size=None, mult=1.0):
    if size is None:
        size = (max(1, round(im.width * SCALE * mult)), max(1, round(im.height * SCALE * mult)))
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


def _ragged_cell(seed):
    """Mask (set of opaque px) for a 32x32 bed cell with a 1px gap and ragged
    2px-block edges, so cells read as separate squares."""
    rnd = random.Random(seed)
    inset = lambda: rnd.choice((1, 1, 1, 2))
    top = [inset() for _ in range(16)]; bot = [inset() for _ in range(16)]
    lef = [inset() for _ in range(16)]; rig = [inset() for _ in range(16)]
    return lambda x, y: (y >= top[x // 2] and y < T - bot[x // 2] and x >= lef[y // 2] and x < T - rig[y // 2])


def make_bed_cell(kind, seed):
    """kind: dry (untilled, barren), tilled (furrows), wet (watered)."""
    rnd = random.Random(seed)
    inside = _ragged_cell(seed)
    im = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    px = im.load()
    for y in range(T):
        for x in range(T):
            if not inside(x, y):
                continue
            r = rnd.random()
            if kind == 'dry':
                c = (178, 132, 88)
                if r < 0.10: c = (164, 118, 78)
                elif r < 0.16: c = (192, 148, 102)
            else:
                c = (137, 72, 44)
                if r < 0.07: c = (156, 88, 52)
                elif r < 0.13: c = (116, 60, 40)
                # two furrows + ridges
                for fx in (9, 22):
                    d = x - fx
                    if d in (0, 1) and 2 < y < T - 3:
                        c = (88, 45, 38)
                    elif d == 2 and 2 < y < T - 3:
                        c = (160, 92, 56)
                if kind == 'wet':
                    c = tuple(int(v * 0.66) for v in c)
            px[x, y] = c + (255,)
    if kind == 'dry':
        d = ImageDraw.Draw(im)
        for _ in range(3):  # cracks
            x, y = rnd.randrange(5, T - 5), rnd.randrange(5, T - 5)
            pts = [(x, y)]
            for _ in range(rnd.randint(2, 4)):
                x = max(3, min(T - 4, x + rnd.randint(-4, 4))); y = max(3, min(T - 4, y + rnd.randint(-4, 4)))
                pts.append((x, y))
            d.line(pts, fill=(128, 88, 58, 255))
        for _ in range(3):  # pebbles
            x, y = rnd.randrange(4, T - 6), rnd.randrange(4, T - 6)
            d.rectangle([x, y, x + 1, y + 1], fill=(150, 140, 126, 255)); px[x, y] = (196, 188, 172, 255)
        for _ in range(rnd.randint(0, 2)):  # dry weeds
            x, y = rnd.randrange(5, T - 6), rnd.randrange(8, T - 5)
            for k in range(3):
                px[x + k - 1, y - (1 if k == 1 else 0)] = (172, 156, 82, 255)
    if kind == 'wet':
        for _ in range(7):  # damp glints
            x, y = rnd.randrange(4, T - 5), rnd.randrange(4, T - 5)
            if px[x, y][3]:
                px[x, y] = (150, 120, 110, 255)
                if px[x + 1, y][3]: px[x + 1, y] = (120, 92, 84, 255)
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
def pack(images):
    items = sorted(images.items(), key=lambda kv: (-kv[1].height, -kv[1].width))
    W = 1024
    x = y = shelf = 0
    rects = {}
    for name, im in items:
        if x + im.width > W:
            x = 0; y += shelf + 1; shelf = 0
        rects[name] = (x, y, im.width, im.height)
        x += im.width + 1
        shelf = max(shelf, im.height)
    H = y + shelf
    atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for name, im in images.items():
        rx, ry, _, _ = rects[name]
        atlas.paste(im, (rx, ry))
    return atlas, rects


def main():
    images = {}
    masks = {}
    for name, spec in SPRITES.items():
        sh, x0, y0, x1, y1, kind = spec[:6]
        mult = spec[6] if len(spec) > 6 else 1.0
        if kind == 'tile':
            images[name] = downscale(sheets[sh].crop((x0, y0, x1, y1)).convert('RGBA'), (T, T))
        elif kind == 'scene':
            im = close_scene(downscale(cut_scene(sh, (x0, y0, x1, y1)), mult=mult))
            if name == 'pond_scene':  # drop the muddy path patch in the bottom-left corner of the painting
                cp = im.load()
                for yy in range(int(im.height * 0.66), im.height):
                    for xx in range(0, 26):
                        if not is_water(cp[xx, yy]):
                            cp[xx, yy] = (0, 0, 0, 0)
            # pad so the size is a multiple of the 4px collision cell
            pw, ph = -(-im.width // 4) * 4, -(-im.height // 4) * 4
            padded = Image.new('RGBA', (pw, ph), (0, 0, 0, 0)); padded.paste(im, (0, 0))
            images[name] = padded
            masks[name] = water_mask(padded)
        else:
            images[name] = trim(downscale(cut_object(sh, (x0, y0, x1, y1)), mult=mult))
    # crops render as 1 tile
    for name in list(images):
        if name.startswith('crop_'):
            im = images[name]
            s = min(T / im.width, T / im.height)
            images[name] = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.NEAREST)

    for i in range(4):
        images[f'tile_grass{i}'] = make_grass(100 + i)
        images[f'tile_dirt{i}'] = make_dirt(200 + i)
    for kind in ('dirt', 'water'):
        for side in ('n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'):
            images[f'edge_{kind}_{side}'] = edge_overlay(kind, side)
    # cobblestone: the source only has a stone band, so stack it twice
    band = downscale(sheets['s2'].crop((700, 1042, 940, 1104)).convert('RGBA'), (T * 2, T // 2))
    stone = Image.new('RGBA', (T, T))
    stone.paste(band.crop((0, 0, T, T // 2)), (0, 0))
    stone.paste(band.crop((T, 0, 2 * T, T // 2)), (0, T // 2))
    images['tile_stone'] = stone
    for i in range(3):
        images[f'bed_dry{i}'] = make_bed_cell('dry', 700 + i)
        images[f'bed_tilled{i}'] = make_bed_cell('tilled', 710 + i)
        images[f'bed_wet{i}'] = make_bed_cell('wet', 710 + i)
    images['tile_bridge_n'] = make_bridge('n')
    images['tile_bridge_s'] = make_bridge('s')
    images['tile_bridge_m'] = make_bridge('m')
    for i in range(4):
        images[f'tile_grassd{i}'] = make_dark_grass(300 + i)
    images['tile_sand'] = make_sand(400)
    images['tile_field'] = make_field(410)
    # painted ground textures (sheet 4: one consistent palette for grass + soil)
    images['tex_grass'] = make_bombed_texture('s4', (55, 355, 182, 505), (34, 40), seed=3)
    images['tex_grassd'] = make_bombed_texture('s4', (228, 360, 362, 505), (36, 39), patch=18, seed=5)
    images['tex_tall'] = make_bombed_texture('s4', (414, 165, 558, 318), (38, 41), patch=18, seed=6)
    images['tex_dirt'] = make_bombed_texture('s4', (1042, 782, 1175, 895), (36, 30), seed=7)
    images['tex_field'] = make_bombed_texture('s4', (1402, 252, 1530, 325), (34, 20), patch=14, seed=9)
    images['tex_cobble'] = make_seamless(sheets['s4'].crop((1400, 782, 1530, 895)).convert('RGBA').resize((40, 34), Image.BOX))
    images['tile_soil'] = downscale(sheets['s4'].crop((1217, 362, 1348, 505)).convert('RGBA'), (T, T))  # ploughed furrows
    images['tile_soil_wet'] = make_watered(images['tile_soil'])
    images.update(make_decals())
    images['fence_v'] = make_fence_v(images['fence_post'])
    images['tile_tallgrass'] = make_tall_grass_tile(600)
    images['tallgrass_top'] = tall_grass_top(601)
    images['seeds'] = make_seeds(images['tile_soil'])
    # protagonist: cut from char_base.png as drawn
    import player_cut as player_dress
    images.update(player_dress.build())
    images.update(tool_icons())

    atlas, rects = pack(images)
    os.makedirs(OUT_DIR, exist_ok=True)
    q = atlas.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    png_path = os.path.join(OUT_DIR, 'atlas.png')
    q.save(png_path, optimize=True)
    with open(os.path.join(OUT_DIR, 'atlas.json'), 'w') as f:
        json.dump({'w': atlas.width, 'h': atlas.height, 'frames': rects, 'masks': masks}, f, separators=(',', ':'))
    print(f'atlas {atlas.width}x{atlas.height}, {len(rects)} sprites, {os.path.getsize(png_path)//1024} KB')

    if '--preview' in sys.argv:
        out = sys.argv[sys.argv.index('--preview') + 1]
        bg = Image.new('RGBA', atlas.size, (255, 0, 255, 255))
        bg.alpha_composite(q.convert('RGBA'))
        bg.resize((atlas.width * 2, atlas.height * 2), Image.NEAREST).save(out)


if __name__ == '__main__':
    main()
