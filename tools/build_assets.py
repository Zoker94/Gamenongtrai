#!/usr/bin/env python3
"""Cut sprites out of the source sheets, generate procedural tiles and the
player character, then pack everything into one small palette PNG atlas.

Usage: python3 tools/build_assets.py [--preview out.png]
Output: client/public/assets/atlas.png + atlas.json
"""
import json, os, random, sys
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
}


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
        if not is_bg(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    drop_border_fragments(im)
    return im


def drop_border_fragments(im):
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
        if len(pts) < biggest * 0.2 and (border or len(pts) < 40):
            for x, y in pts:
                px[x, y] = (0, 0, 0, 0)


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


def make_bridge(rail_side):
    im = Image.new('RGBA', (T, T), (150, 100, 56, 255))
    d = ImageDraw.Draw(im)
    for x in range(0, T, 8):  # planks running north-south
        d.rectangle([x, 0, x + 7, T - 1], fill=(160, 108, 60, 255) if (x // 8) % 2 else (146, 96, 54, 255))
        d.line([(x, 0), (x, T - 1)], fill=(92, 58, 34, 255))
        d.point((x + 3, 6 + (x % 16)), fill=(110, 70, 40, 255))
        d.point((x + 4, 22 - (x % 12)), fill=(110, 70, 40, 255))
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
    for name, spec in SPRITES.items():
        sh, x0, y0, x1, y1, kind = spec[:6]
        mult = spec[6] if len(spec) > 6 else 1.0
        if kind == 'tile':
            images[name] = downscale(sheets[sh].crop((x0, y0, x1, y1)).convert('RGBA'), (T, T))
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
    images['tile_soil_wet'] = make_watered(images['tile_soil'])
    # cobblestone: the source only has a stone band, so stack it twice
    band = downscale(sheets['s2'].crop((700, 1042, 940, 1104)).convert('RGBA'), (T * 2, T // 2))
    stone = Image.new('RGBA', (T, T))
    stone.paste(band.crop((0, 0, T, T // 2)), (0, 0))
    stone.paste(band.crop((T, 0, 2 * T, T // 2)), (0, T // 2))
    images['tile_stone'] = stone
    images['tile_bridge_n'] = make_bridge('n')
    images['tile_bridge_s'] = make_bridge('s')
    images['seeds'] = make_seeds(images['tile_soil'])
    for dname, di in (('down', 0), ('left', 1), ('right', 2), ('up', 3)):
        for f in range(4):
            images[f'player_{dname}_{f}'] = draw_player(di, f)
    images.update(tool_icons())

    atlas, rects = pack(images)
    os.makedirs(OUT_DIR, exist_ok=True)
    q = atlas.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    png_path = os.path.join(OUT_DIR, 'atlas.png')
    q.save(png_path, optimize=True)
    with open(os.path.join(OUT_DIR, 'atlas.json'), 'w') as f:
        json.dump({'w': atlas.width, 'h': atlas.height, 'frames': rects}, f, separators=(',', ':'))
    print(f'atlas {atlas.width}x{atlas.height}, {len(rects)} sprites, {os.path.getsize(png_path)//1024} KB')

    if '--preview' in sys.argv:
        out = sys.argv[sys.argv.index('--preview') + 1]
        bg = Image.new('RGBA', atlas.size, (255, 0, 255, 255))
        bg.alpha_composite(q.convert('RGBA'))
        bg.resize((atlas.width * 2, atlas.height * 2), Image.NEAREST).save(out)


if __name__ == '__main__':
    main()
