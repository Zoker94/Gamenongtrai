"""Chibi restyle (branch style-chibi): swap PixelLab chibi art into the atlas.

assets/source/chibi/
  tiles_grass_soil.png/.json  Wang tileset (32px): lower = tilled soil, upper = grass
  crops/<crop>_<stage>.png     48px crop stages (g1, g2, g3, ripe, item, bag)
  girl/<south|east|north|west>.png  chibi girl standing, 68px canvas

Called by build_assets.main() after the regular sprites are made; replaces
them by name so the game code does not change.
"""
import json
import os
from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'assets/source/chibi')


def wang_tiles():
    """corner pattern (NW, NE, SW, SE as 'U'/'L') -> 32px tile"""
    sheet = Image.open(os.path.join(DIR, 'tiles_grass_soil.png')).convert('RGBA')
    meta = json.load(open(os.path.join(DIR, 'tiles_grass_soil.json'), encoding='utf-8'))
    out = {}
    for t in meta['tileset_data']['tiles']:
        c = t['corners']; b = t['bounding_box']
        key = ''.join('U' if c[k] == 'upper' else 'L' for k in ('NW', 'NE', 'SW', 'SE'))
        out[key] = sheet.crop((b['x'], b['y'], b['x'] + b['width'], b['y'] + b['height']))
    return out


def apply(images, native, RES, T):
    if not os.path.isdir(DIR):
        return
    TR = T * RES
    up = lambda im: im.resize((im.width * TR // 32, im.height * TR // 32), Image.NEAREST)

    # ---------------------------------------------------------------- ground
    if os.path.exists(os.path.join(DIR, 'tiles_grass_soil.png')):
        w = wang_tiles()
        grass, soil = up(w['UUUU']), up(w['LLLL'])
        tiles = {
            'gt_grass0': grass, 'gt_grass1': grass, 'gt_grass2': grass, 'gt_grass3': grass,
            # field rim (9-slice of the map; flips give the other sides)
            'gt_dirt_tl': up(w['UUUL']), 'gt_dirt_t': up(w['UULL']),
            'gt_dirt_l': up(w['ULUL']), 'gt_dirt_l2': up(w['ULUL']),
            'gt_dirt': soil, 'gt_dirt2': soil,
            # paths + ploughed plots: plain soil for this test
            'gt_path_v': soil, 'gt_path_v2': soil, 'gt_path_h': soil, 'gt_path_x': soil,
            'gt_furrow': soil, 'gt_soil_t': soil, 'tile_soil': soil,
            'gt_furrow_wet': ImageEnhance.Brightness(soil).enhance(0.72),
        }
        for k, im in tiles.items():
            images[k] = im; native.add(k)

        def tex(t):          # 4x4 repeat: the pattern size the game expects (128 px)
            out = Image.new('RGBA', (t.width * 4, t.height * 4))
            for y in range(4):
                for x in range(4):
                    out.paste(t, (x * t.width, y * t.height))
            return out
        for k, t in (('tex_grass', grass), ('tex_grassd', grass), ('tex_dirt', soil), ('tex_field', soil)):
            images[k] = tex(t); native.add(k)

    # ----------------------------------------------------------------- crops
    cdir = os.path.join(DIR, 'crops')
    stages = {'seed': 'g1', 'sprout': 'g1', 'g1': 'g1', 'g2': 'g2', 'g3': 'g2', 'g4': 'g3',
              'ripe': 'ripe', 'item': 'item', 'bag': 'bag'}
    for crop in ('carrot',):                 # one crop for the first test
        for game, src in stages.items():
            p = os.path.join(cdir, f'{crop}_{src}.png')
            if not os.path.exists(p):
                continue
            im = Image.open(p).convert('RGBA')
            im = im.crop(im.getchannel('A').getbbox())
            images[f'cp_{crop}_{game}'] = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
            native.add(f'cp_{crop}_{game}')

    # ------------------------------------------------------------- character
    gdir = os.path.join(DIR, 'girl')
    if os.path.isdir(gdir):
        # game directions 0..7 = S, SE, E, NE, N, NW, W, SW; diagonals use the side view
        view = ['south', 'east', 'east', 'east', 'north', 'west', 'west', 'west']
        for d, v in enumerate(view):
            f = Image.open(os.path.join(gdir, v + '.png')).convert('RGBA')
            f = f.resize((f.width * 2, f.height * 2), Image.NEAREST)
            bb = f.getchannel('A').getbbox()
            cx = (bb[0] + bb[2]) // 2
            hw = max(cx - bb[0], bb[2] - cx) + 1
            im = Image.new('RGBA', (hw * 2, bb[3] - bb[1]), (0, 0, 0, 0))
            im.paste(f.crop(bb), (hw - (cx - bb[0]), 0))
            # standing only for now: the walk 'cycle' is the same pose
            for tag in ('i0', 'w0'):
                images[f'pl6_{d}_{tag}'] = im; native.add(f'pl6_{d}_{tag}')
