"""Cut the protagonist from assets/source/char_base.png (bald base body with
full animations) and dress every frame procedurally so he matches the farmer
of the farm map: straw hat, brown hair, red shirt, blue jeans, brown boots.

Returns {atlas_name: RGBA image}. Frame names:
  pl_{idle|walk}_{d|u|r}{0..3}   ('r' cells face LEFT on the sheet)
  pl_{dig|water}_{d|u|r}{0..3}   ('r' cells face RIGHT)
  portrait
"""
import os
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = Image.open(os.path.join(ROOT, 'assets/source/char_base.png')).convert('RGB')
MOD = Image.open(os.path.join(ROOT, 'assets/source/char_modular.png')).convert('RGB')
OUT_H = 46                          # target frame height (px) for idle/walk cells

# cell grid (source px)
COLS_A = [175, 347, 517, 688]       # idle / dig
COLS_B = [1071, 1243, 1415, 1587]   # walk / water
CW = 162
ROWS_TOP = {'d': (100, 275), 'u': (286, 461), 'r': (471, 656)}
ROWS_BOT = {'d': (965, 1114), 'u': (1126, 1275), 'r': (1287, 1437)}


def is_bg(p):
    r, g, b = p[:3]
    return b > r + 6 and r < 125 and abs(r - g) < 22


def cut(box):
    im = SRC.crop(box).convert('RGBA')
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque([(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)])
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not is_bg(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))
    return im


def lum(p):
    return 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]


def is_skin(p):
    r, g, b = p[:3]
    return r > 150 and 85 < g < 200 and 50 < b < 160 and r > g + 25 and g > b + 8


def is_shorts(p):
    r, g, b = p[:3]
    return 62 < r < 135 and 46 < g < 100 and 26 < b < 70 and 14 <= r - g <= 40 and g - b >= 6


def tint(p, base, ref=190.0):
    k = max(0.45, min(1.35, lum(p) / ref))
    return tuple(max(0, min(255, int(c * k))) for c in base) + (255,)


SHIRT = (196, 56, 50)
JEANS = (66, 104, 170)
BOOTS = (108, 66, 40)
HAIR = (120, 70, 40)


def dress(im, facing):
    """Recolour a bald body frame in place."""
    w, h = im.size
    px = im.load()
    bbox = im.getchannel('A').getbbox()
    if not bbox:
        return im
    x0, y0, x1, y1 = bbox
    H = y1 - y0
    # head: from the top down to the narrowest row (neck) in the upper 55%
    widths = []
    for y in range(y0, y1):
        xs = [x for x in range(x0, x1) if px[x, y][3]]
        widths.append((max(xs) - min(xs) + 1) if xs else 0)
    head_w = max(widths[: int(H * 0.45)])
    # neck = narrowest band between head and shoulders; the shirt starts where
    # the outline widens again (shoulders). The face ends at the neck top.
    lo, hi = int(H * 0.30), int(H * 0.62)
    seg = [(widths[i], i) for i in range(lo, hi) if widths[i]]
    mw, mi = min(seg) if seg else (0, int(H * 0.45))
    i = mi
    while i < hi and widths[i] <= mw + 5:
        i += 1
    neck = y0 + mi              # head (hair test) region ends here
    shoulders = y0 + i          # shirt starts here
    head_h = neck - y0
    # shorts top = first row (below the neck) with shorts colour
    shorts_top = None
    for y in range(neck, y1):
        if y >= y0 + H * 0.55 and sum(1 for x in range(x0, x1) if px[x, y][3] and is_shorts(px[x, y])) >= max(4, (x1 - x0) // 6):
            shorts_top = y
            break
    if shorts_top is None or shorts_top < y0 + H * 0.55:
        shorts_top = y0 + int(H * 0.70)
    boots_top = y1 - max(3, int(H * 0.08))
    xs_head = [x for x in range(x0, x1) if px[x, y0 + head_h // 2][3]]
    hx0, hx1 = (min(xs_head), max(xs_head)) if xs_head else (x0, x1)
    for y in range(y0, y1):
        for x in range(x0, x1):
            p = px[x, y]
            if not p[3]:
                continue
            if neck <= y < shoulders:
                continue                      # bare neck
            if y < neck:
                if not is_skin(p):
                    continue
                ry = (y - y0) / max(1, head_h)
                rx = (x - hx0) / max(1, hx1 - hx0)
                if facing == 'u':
                    hair = ry < 0.86
                elif facing in ('l', 'r'):   # side view: hair on the back of the head
                    back = rx > 0.55 if facing == 'l' else rx < 0.45
                    hair = ry < 0.36 or (back and ry < 0.8)
                else:
                    hair = ry < 0.34 or ((rx < 0.12 or rx > 0.88) and ry < 0.62)
                if hair:
                    px[x, y] = tint(p, HAIR)
            elif y < shorts_top:
                if is_skin(p):
                    # hands stay skin: lowest part of the arms just above the shorts
                    if y > shorts_top - max(2, int(H * 0.05)) and (x < x0 + (x1 - x0) * 0.22 or x > x0 + (x1 - x0) * 0.78):
                        continue
                    px[x, y] = tint(p, SHIRT)
            else:
                if y >= boots_top:
                    if is_skin(p) or is_shorts(p):
                        px[x, y] = tint(p, BOOTS, 150)
                elif is_shorts(p):
                    px[x, y] = tint(p, JEANS, 85)
                elif is_skin(p):
                    # legs: jeans, except hands hanging next to the hips
                    side = x < x0 + (x1 - x0) * 0.18 or x > x0 + (x1 - x0) * 0.82
                    if not (side and y < shorts_top + H * 0.08):
                        px[x, y] = tint(p, JEANS, 150)
    return im, (hx0, y0, hx1, neck)


_HAT = None


def hat():
    global _HAT
    if _HAT is None:
        im = MOD.crop((70, 1078, 214, 1192)).convert('RGBA')
        px = im.load()
        w, h = im.size
        q = deque([(x, 0) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)] + [(x, h - 1) for x in range(w)])
        seen = set()
        while q:
            x, y = q.popleft()
            if (x, y) in seen:
                continue
            seen.add((x, y))
            if not is_bg(px[x, y]):
                continue
            px[x, y] = (0, 0, 0, 0)
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    q.append((nx, ny))
        # drop the chin strap (thin dark line below the brim)
        bb = im.getchannel('A').getbbox()
        im = im.crop((bb[0], bb[1], bb[2], bb[1] + int((bb[3] - bb[1]) * 0.62)))
        _HAT = im
    return _HAT


def put_hat(im, head):
    hx0, y0, hx1, neck = head
    hw = hx1 - hx0 + 1
    hh = neck - y0
    h_ = hat()
    tw = int(hw * 1.42)
    th = max(1, int(h_.height * tw / h_.width))
    hs = h_.resize((tw, th), Image.LANCZOS)
    out = Image.new('RGBA', (im.width + tw, im.height + th), (0, 0, 0, 0))
    ox, oy = tw // 2, th
    out.alpha_composite(im, (ox, oy))
    cx = ox + (hx0 + hx1) // 2
    top = oy + y0 + int(hh * 0.40) - th
    out.alpha_composite(hs, (cx - tw // 2, top))
    return out


def frame(box, facing, scale):
    im = cut(box)
    im, head = dress(im, facing)
    im = put_hat(im, head)
    bb = im.getchannel('A').getbbox()
    im = im.crop(bb)
    w, h = im.size
    small = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BOX)
    a = small.getchannel('A').point(lambda v: 255 if v >= 110 else 0)
    small.putalpha(a)
    return small


def build():
    out = {}
    # scale from a front idle frame so the body (without hat) is ~OUT_H px
    ref = cut((COLS_A[0], ROWS_TOP['d'][0], COLS_A[0] + CW, ROWS_TOP['d'][1]))
    rb = ref.getchannel('A').getbbox()
    scale = OUT_H / (rb[3] - rb[1])
    for f, (ry0, ry1) in ROWS_TOP.items():
        for i in range(4):
            # idle/walk side cells face LEFT on the sheet
            out[f'pl_idle_{f}{i}'] = frame((COLS_A[i], ry0, COLS_A[i] + CW, ry1), 'l' if f == 'r' else f, scale)
            out[f'pl_walk_{f}{i}'] = frame((COLS_B[i], ry0, COLS_B[i] + CW, ry1), 'l' if f == 'r' else f, scale)
    for f, (ry0, ry1) in ROWS_BOT.items():
        for i in range(4):
            out[f'pl_dig_{f}{i}'] = frame((COLS_A[i], ry0, COLS_A[i] + CW, ry1), f, scale)
            out[f'pl_water_{f}{i}'] = frame((COLS_B[i], ry0, COLS_B[i] + CW, ry1), f, scale)
    # portrait: dress the framed avatar, keep its wooden frame
    av = SRC.crop((2218, 970, 2432, 1240)).convert('RGBA')
    inner = (16, 16, av.width - 16, av.height - 16)
    body = av.crop(inner)
    # the avatar background is brown, cut by colour instead of flood fill
    bp = body.load()
    bg = bp[3, 3]
    for y in range(body.height):
        for x in range(body.width):
            p = bp[x, y]
            if sum(abs(p[k] - bg[k]) for k in range(3)) < 40:
                bp[x, y] = (0, 0, 0, 0)
    body, head = dress(body, 'd')
    body = put_hat(body, head)
    bb = body.getchannel('A').getbbox()
    body = body.crop(bb)
    frame_im = av.copy()
    fp = frame_im.load()
    for y in range(16, av.height - 16):
        for x in range(16, av.width - 16):
            fp[x, y] = bg[:3] + (255,)
    k = min((av.width - 40) / body.width, (av.height - 30) / body.height)
    body = body.resize((int(body.width * k), int(body.height * k)), Image.LANCZOS)
    frame_im.alpha_composite(body, ((av.width - body.width) // 2, av.height - 16 - body.height))
    out['portrait'] = frame_im.resize((44, 56), Image.LANCZOS)
    return out


if __name__ == '__main__':
    imgs = build()
    names = sorted(k for k in imgs if k.startswith('pl_'))
    W = 12 * 50
    sheet = Image.new('RGBA', (W, ((len(names) + 11) // 12) * 70 + 70), (130, 175, 70, 255))
    for i, n in enumerate(names):
        im = imgs[n]
        sheet.alpha_composite(im, ((i % 12) * 50 + (50 - im.width) // 2, (i // 12) * 70 + 68 - im.height))
    sheet.alpha_composite(imgs['portrait'], (4, sheet.height - 62))
    sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST).save(os.environ.get('PREVIEW', '/tmp/pl_preview.png'))
