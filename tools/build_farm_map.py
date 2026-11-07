#!/usr/bin/env python3
"""Build the farm map background from the painted mockup (assets/source/farm_mockup.png).

Steps: resize to 2000px wide (all coordinates below use that space), crop the
playable area, scale to the game size, remove baked characters / labels / UI,
repaint the crop area with tile-aligned beds, and compute a 4px collision mask.

Output: client/public/assets/farm_bg.webp + farm_bg.json
"""
import json, os, random
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'client', 'public', 'assets')
T = 32
W_T, H_T = 38, 19                    # map size in tiles
OW, OH = W_T * T, H_T * T            # 1216 x 608
CROP = (0, 70, 2000, 1055)           # mockup area kept (2000px space)
SX = OW / (CROP[2] - CROP[0])
SY = OH / (CROP[3] - CROP[1])
CELL = 4


def o(x, y):
    """mockup (2000px space) -> output px"""
    return round((x - CROP[0]) * SX), round((y - CROP[1]) * SY)


def orect(x0, y0, x1, y1):
    a, b = o(x0, y0)
    c, d = o(x1, y1)
    return a, b, c, d


def load():
    src = Image.open(os.path.join(ROOT, 'assets/source/farm_mockup.png')).convert('RGB')
    m = src.resize((2000, round(src.height * 2000 / src.width)), Image.LANCZOS)
    # watermark star (bottom-right): cover with the bushes just below it
    patch = Image.new('RGB', (90, 76))
    patch.paste(m.crop((1876, 1066, 1966, 1112)), (0, 0))
    patch.paste(m.crop((1876, 1068, 1966, 1100)), (0, 44))
    fade = Image.new('L', patch.size, 255)
    fp = fade.load()
    for y in range(patch.height):
        for x in range(patch.width):
            fp[x, y] = int(255 * min(1, x / 16, y / 16))
    m.paste(patch, (1876, 984), fade)
    return m.crop(CROP).resize((OW, OH), Image.LANCZOS)


def tile_fill(img, rect, patch, seed=1):
    """Fill rect with a texture patch, random offsets per row to hide repeats."""
    rnd = random.Random(seed)
    x0, y0, x1, y1 = rect
    pw, ph = patch.size
    y = y0
    while y < y1:
        x = x0 - rnd.randrange(pw)
        while x < x1:
            img.paste(patch, (x, y))
            x += pw
        y += ph
    # trim overflow by restoring outside pixels is unnecessary: callers pass
    # rects inside the image and paste only touches the rect rows/cols span


def fill_rect(img, rect, patch, seed=1):
    x0, y0, x1, y1 = rect
    tmp = Image.new('RGB', (x1 - x0, y1 - y0))
    tile_fill(tmp, (0, 0, x1 - x0, y1 - y0), patch, seed)
    img.paste(tmp, (x0, y0))


def clone(img, src_rect, dst_xy, base):
    """Copy a rect from the untouched base image to dst."""
    img.paste(base.crop(src_rect), dst_xy)


# beds (tile coords, inclusive) must match FARM_BEDS in shared/maps/farm.ts.
BEDS = [(14, 8, 15, 9), (18, 8, 19, 9), (21, 8, 22, 9),
        (14, 11, 15, 14), (18, 11, 19, 14), (21, 11, 22, 14)]
# how each bed is painted (output px), copied from the mockup's bed positions
_COLS = [(444, 516), (572, 644), (668, 740)]
_ROWS = [(244, 323), (341, 483)]
BED_VISUAL = [(c[0], r[0], c[1], r[1]) for r in _ROWS for c in _COLS]


def main():
    img = load()
    base = img.copy()
    d = ImageDraw.Draw(img)

    # ---- sand texture patch from a clean stretch of path
    sand = base.crop(orect(1165, 393, 1295, 431))
    # ---- 1. repaint the crop area interior as sand (removes farmers, beds)
    fill_rect(img, orect(752, 456, 1230, 834), sand, seed=2)
    # fringe band: keep the painted grass edge, turn leftover bed soil into sand
    ox0, oy0, ox1, oy1 = orect(737, 442, 1243, 848)
    ix0, iy0, ix1, iy1 = orect(752, 456, 1230, 834)
    sp_ = sand.load(); ip = img.load()
    for y in range(oy0, oy1):
        for x in range(ox0, ox1):
            if ix0 <= x < ix1 and iy0 <= y < iy1:
                continue
            r_, g_, b_ = ip[x, y]
            soil_like = r_ < 175 and g_ < 135 and r_ > g_ + 25 and b_ < g_
            if soil_like:
                ip[x, y] = sp_[x % sand.width, y % sand.height]
    # fringe strips over-painted by crops/farmers: rebuild them by tiling clean
    # pieces of the same painted edge (mockup coords)
    def tile_strip(src, dst):
        sx0, sy0, sx1, sy1 = orect(*src)
        dx0, dy0, dx1, dy1 = orect(*dst)
        piece = base.crop((sx0, sy0, sx1, sy1))
        if dx1 - dx0 > dy1 - dy0:      # horizontal strip
            x = dx0
            while x < dx1:
                img.paste(piece.crop((0, 0, min(piece.width, dx1 - x), dy1 - dy0)), (x, dy0)); x += piece.width
        else:
            y = dy0
            while y < dy1:
                img.paste(piece.crop((0, 0, dx1 - dx0, min(piece.height, dy1 - y))), (dx0, y)); y += piece.height
    tile_strip((876, 430, 918, 457), (748, 430, 1232, 457))      # top edge
    tile_strip((882, 832, 918, 856), (748, 832, 1232, 856))      # bottom edge
    tile_strip((1228, 676, 1252, 720), (1228, 457, 1252, 832))   # right edge

    # ---- 2. label "KHU VỰC TRỒNG TRỌT" on the road
    fill_rect(img, orect(812, 390, 1166, 434), sand, seed=3)
    # ---- 3. watering farmer outside the crop area: copy the strip just below
    x0, y0, x1, y1 = orect(1243, 528, 1300, 642)
    clone(img, (x0, y1 + 4, x1, y1 + 4 + (y1 - y0)), (x0, y0), base)

    # ---- 4. beds, matching the painted ones: flat mid-brown soil, soft darker
    # edge, light lip along the bottom, slightly wavy lower edge
    rnd = random.Random(11)
    ip = img.load()
    for (vx0, vy0, vx1, vy1) in BED_VISUAL:
        for y in range(vy0, vy1):
            for x in range(vx0, vx1):
                # rounded corners (r=3)
                cx_ = min(x - vx0, vx1 - 1 - x); cy_ = min(y - vy0, vy1 - 1 - y)
                if cx_ < 3 and cy_ < 3 and (3 - cx_) ** 2 + (3 - cy_) ** 2 > 10:
                    continue
                wave = 1 if (x // 5 + vx0) % 3 == 0 else 0
                if y >= vy1 - 1 - wave:
                    continue
                edge = min(x - vx0, vx1 - 1 - x, y - vy0)
                n = rnd.randint(-5, 5)
                if y >= vy1 - 3 - wave:
                    col = (160 + n, 126 + n, 82 + n)        # light lip
                elif edge == 0:
                    col = (72, 46, 34)
                elif edge == 1:
                    col = (96, 61, 42)
                else:
                    col = (121 + n, 77 + n, 50 + n)
                    if rnd.random() < 0.04:
                        col = (104, 66, 44)
                ip[x, y] = col

    # ---- 5. scarecrow back, standing between the bed rows
    sc = base.crop(orect(862, 528, 932, 642))
    sx, sy = 545 - sc.width // 2, 352 - sc.height
    # paste only its non-sand pixels
    mask = Image.new('L', sc.size, 0)
    mp, sp = mask.load(), sc.load()
    for y in range(sc.height):
        for x in range(sc.width):
            r_, g_, b_ = sp[x, y]
            sandish = r_ > 190 and 140 < g_ < 200 and b_ < 140
            leafy = g_ > r_ + 15 and g_ > b_ + 30
            soil = r_ < 150 and r_ > g_ + 25 and g_ < 105 and b_ < 80 and (x < 12 or x > sc.width - 13)
            mp[x, y] = 0 if (sandish or leafy or soil) else 255
    img.paste(sc, (sx, sy), mask)

    # ---- 6. fisherman on the dock: clean water + rebuild the dock end
    fx0, fy0, fx1, fy1 = orect(1486, 714, 1668, 870)
    water = base.crop(orect(1680, 752, 1740, 790))
    fill_rect(img, (fx0, fy0, fx1, fy1), water, seed=5)
    fill_rect(img, orect(1444, 836, 1600, 878), water, seed=6)   # dock post shadow
    dx0, dy0, dx1, dy1 = orect(1416, 760, 1582, 838)
    plank = base.crop((dx0 + 2, dy0, dx0 + 2 + (fx0 - dx0) // 2 * 2, dy1))
    xx = fx0
    while xx < dx1:
        img.paste(plank.crop((0, 0, min(plank.width, dx1 - xx), plank.height)), (xx, dy0))
        xx += plank.width

    # ---- 7. leftovers of the UI and the watermark
    clone(img, (0, 24, 205, 48), (0, 0), base)                 # HUD avatar/bars
    clone(img, (1146, 26, OW, 52), (1146, 0), base)            # top-right badge
    img.save(os.path.join(OUT, 'farm_bg.webp'), 'WEBP', quality=88, method=6)
    if os.environ.get('PREVIEW'):
        img.save(os.environ['PREVIEW'])

    # ---- collision mask (4px cells): 1 = solid
    cw, ch = OW // CELL, OH // CELL
    solid = [[0] * cw for _ in range(ch)]
    px = img.load()
    # water: blue cells, then fill enclosed holes (lily pads, rocks in the pond)
    for cy in range(ch):
        for cx in range(cw):
            r_, g_, b_ = px[cx * CELL + 2, cy * CELL + 2]
            if b_ > r_ + 60 and b_ > g_ + 15:
                solid[cy][cx] = 1
    pond = orect(1440, 655, 1915, 1050)
    for cy in range(pond[1] // CELL, pond[3] // CELL):
        row = solid[cy]
        xs = [cx for cx in range(pond[0] // CELL, min(cw, pond[2] // CELL)) if row[cx]]
        if len(xs) > 2:
            for cx in range(xs[0], xs[-1]):
                row[cx] = 1
    dock = orect(1414, 758, 1584, 840)
    for cy in range(dock[1] // CELL, dock[3] // CELL + 1):
        for cx in range(dock[0] // CELL, dock[2] // CELL + 1):
            solid[cy][cx] = 0

    def block(x0, y0, x1, y1):
        a, b, c, e = orect(x0, y0, x1, y1)
        for cy in range(max(0, b // CELL), min(ch, e // CELL + 1)):
            for cx in range(max(0, a // CELL), min(cw, c // CELL + 1)):
                solid[cy][cx] = 1

    for r in SOLIDS:
        block(*r)
    for r in OPENINGS:
        a, b, c, e = orect(*r)
        for cy in range(max(0, b // CELL), min(ch, e // CELL + 1)):
            for cx in range(max(0, a // CELL), min(cw, c // CELL + 1)):
                solid[cy][cx] = 0

    # scarecrow standing between the bed rows (output px)
    for cy in range(338 // CELL, 350 // CELL + 1):
        for cx in range(537 // CELL, 553 // CELL + 1):
            solid[cy][cx] = 1

    meta = {'w': OW, 'h': OH, 'cell': CELL, 'mask': [''.join(map(str, row)) for row in solid]}
    with open(os.path.join(OUT, 'farm_bg.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    print('farm_bg', OW, 'x', OH, os.path.getsize(os.path.join(OUT, 'farm_bg.webp')) // 1024, 'KB')


# Solid areas in mockup (2000px) coordinates. Tall things are blocked whole so
# the player never overlaps them.
SOLIDS = [
    # north-west: bamboo grove, barn, barrels, water tower, yard fence
    (0, 70, 455, 200), (0, 70, 120, 420), (125, 185, 415, 425), (400, 315, 450, 420),
    (450, 110, 570, 400), (100, 190, 650, 222), (620, 180, 650, 445),
    (540, 330, 620, 360), (575, 385, 612, 430),
    # west: trees, dog house
    (0, 380, 135, 1055), (135, 395, 230, 505),
    # house, tree, jar, well, fence, patio table, hay, dog house, jars
    (100, 530, 505, 800), (500, 505, 640, 690), (565, 685, 630, 752), (535, 752, 625, 835),
    (625, 600, 652, 852), (625, 908, 652, 1000), (390, 830, 475, 915), (355, 835, 400, 905), (470, 840, 515, 910),
    (55, 835, 215, 960), (30, 875, 125, 985), (210, 905, 275, 970),
    (295, 960, 445, 1025), (445, 965, 545, 1025), (110, 1005, 650, 1055),
    # south: fences, notice board, gate posts, mailbox, trees
    (660, 985, 805, 1055), (810, 950, 935, 1055), (940, 900, 975, 1055), (1090, 900, 1125, 1055),
    (1135, 965, 1190, 1055), (1195, 990, 1265, 1055), (1240, 930, 1420, 1055),
    # north: trees + chicken yard + cow pen + pig pen (fences closed)
    (650, 70, 760, 75), (760, 70, 1195, 350), (1225, 70, 1565, 355), (1585, 70, 1900, 355),
    (1890, 110, 2000, 360), (1180, 70, 1230, 110),
    # east: tree, fences, palms, rocks, trees around the pond
    (1318, 400, 1455, 550), (1335, 445, 1360, 1000), (1340, 445, 1645, 505), (1715, 445, 1820, 505),
    (1760, 400, 2000, 660), (1785, 595, 1870, 655), (1910, 640, 2000, 1055),
    (1380, 930, 1470, 1015), (1460, 990, 1910, 1055),
]
# walkable gaps kept open after the solids (gates)
OPENINGS = [
    (975, 900, 1090, 1055),        # farm gate (south exit)
    (1325, 754, 1368, 800),        # gap in the pond fence (walk to the dock)
]

if __name__ == '__main__':
    main()
