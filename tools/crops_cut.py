"""Cut crop growth stages + items from per-crop sheets (assets/source/crop_<name>.png).

Layout of a crop sheet (2000px wide, like crop_carrot.png):
  row 1: tilled soil, seed bag, empty soil, seed in soil, sprout
  row 2: 4 growing stages (plant on grey background + soil band)
  row 3: full harvest bunch, item views, crate, item card + shovel
"""
import os
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

COMMON = {
    'seed': (1368, 82, 1632, 330, 'green'),
    'sprout': (1665, 82, 1950, 330, 'green'),
    'item': (473, 786, 709, 1034, 'item'),
    'bag': (632, 108, 792, 292, 'item'),
}
# per crop: growth stages g1..g4 and the ripe plant (cells differ per sheet)
LAYOUT = {
    'carrot': {
        'g1': (50, 405, 335, 670, 'plant'), 'g2': (472, 405, 735, 670, 'plant'),
        'g3': (861, 405, 1123, 670, 'plant'), 'g4': (1368, 405, 1632, 670, 'plant'),
        'ripe': (1368, 405, 1632, 670, 'plant'),
    },
    'tomato': {
        'g1': (50, 405, 335, 670, 'plant'), 'g2': (472, 405, 735, 670, 'plant'),
        'g3': (1032, 405, 1334, 670, 'plant'), 'g4': (1665, 405, 1950, 670, 'plant'),
        'ripe': (50, 766, 335, 1034, 'plant'),
    },
    'rice': {
        'seed': (1368, 82, 1632, 330, 'grain'),
        'g1': (50, 405, 335, 670, 'plant'), 'g2': (472, 405, 735, 670, 'plant'),
        'g3': (1032, 405, 1334, 670, 'plant'), 'g4': (1368, 405, 1632, 670, 'plant'),
        'ripe': (50, 766, 335, 1034, 'plant'),
        'item': (1032, 786, 1334, 1034, 'item'),
    },
    'cabbage': {
        'seed': (1440, 160, 1560, 260, 'seedbrown'),
        'g1': (50, 418, 335, 640, 'plant'), 'g2': (548, 418, 840, 640, 'plant'),
        'g3': (1032, 418, 1334, 640, 'plant'), 'g4': (1665, 418, 1950, 640, 'plant'),
        'ripe': (50, 780, 335, 1030, 'plant'),
        'item': (500, 795, 835, 1035, 'item'),
    },
}


def is_grey(p):
    r, g, b = p[:3]
    return abs(r - g) < 10 and abs(g - b) < 10 and 30 < r < 120


def is_soil(p):
    r, g, b = p[:3]
    return (55 <= r <= 150 and 30 <= g <= 100 and 18 <= b <= 70 and 18 <= r - g <= 60 and b < g) or \
        (abs(r - 88) < 12 and abs(g - 87) < 12 and abs(b - 84) < 12)


def largest(im):
    px = im.load(); w, h = im.size
    seen = set(); best = []
    for sy in range(h):
        for sx in range(w):
            if px[sx, sy][3] and (sx, sy) not in seen:
                st, comp = [(sx, sy)], []
                seen.add((sx, sy))
                while st:
                    x, y = st.pop(); comp.append((x, y))
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] and (nx, ny) not in seen:
                            seen.add((nx, ny)); st.append((nx, ny))
                if len(comp) > len(best):
                    best = comp
    keep = set(best)
    for y in range(h):
        for x in range(w):
            if (x, y) not in keep:
                px[x, y] = (0, 0, 0, 0)
    return im.crop(im.getchannel('A').getbbox())


def cut(src, box, mode):
    x0, y0, x1, y1 = box
    im = src.crop((x0 + 4, y0 + 4, x1 - 4, y1 - 4)).convert('RGBA')
    px = im.load(); w, h = im.size
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            r, g, b = p[:3]
            if mode == 'green':
                keep = g > r + 15 and g > b + 15
            elif mode == 'seedbrown':     # a pale seed lying on brown soil
                keep = r > 150 and g > 115 and r - b < 110 and g - b > 20
            elif mode == 'grain':
                keep = r > 160 and g > 140 and b > 90
            elif mode == 'plant':
                keep = not is_grey(p) and not is_soil(p)
            else:  # item on grey / dark backgrounds: flood fill from the border
                keep = True
            if not keep:
                px[x, y] = (0, 0, 0, 0)
    if mode == 'item':
        q = deque([(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)])
        seen = set()
        while q:
            x, y = q.popleft()
            if (x, y) in seen:
                continue
            seen.add((x, y))
            r, g, b, a = px[x, y]
            if not (is_grey((r, g, b)) or (r < 70 and g < 70 and b < 70 and abs(r - b) < 15)):
                continue
            px[x, y] = (0, 0, 0, 0)
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    q.append((nx, ny))
    return largest(im)


def build(res, T=32):
    out = {}
    for crop, cells in LAYOUT.items():
        path = os.path.join(ROOT, f'assets/source/crop_{crop}.png')
        if not os.path.exists(path):
            continue
        src = Image.open(path).convert('RGB')
        for k, (x0, y0, x1, y1, mode) in {**COMMON, **cells}.items():
            im = cut(src, (x0, y0, x1, y1), mode)
            # sheet cells are ~265px for one tile; stages keep their relative size
            if k in ('item', 'bag'):
                s = min(30 * res / im.width, 30 * res / im.height)
            else:
                s = (T * res) / 265 * 1.15
                s = min(s, 30 * res / im.width)   # never wider than ~one tile
            out[f'cp_{crop}_{k}'] = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    return out


if __name__ == '__main__':
    imgs = build(3)
    W = sum(i.width + 10 for i in imgs.values())
    H = max(i.height for i in imgs.values()) + 10
    sheet = Image.new('RGBA', (W, H), (110, 70, 40, 255))
    x = 5
    for i in imgs.values():
        sheet.alpha_composite(i, (x, H - 5 - i.height)); x += i.width + 10
    sheet.save(os.environ.get('PREVIEW', '/tmp/crops.png'))
