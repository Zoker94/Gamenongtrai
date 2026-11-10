"""Export / import the frames of a base character for PixelLab transfer_outfit.

export: python3 tools/outfit_frames.py export <base_folder> <out_dir>
    Writes every frame the game draws (idle frame 0 of each direction, every
    walk / harvest / hoe / water frame) as a 64x64 PNG (cropped from the base
    canvas, offset in plan.json) grouped in batches of <= 15 frames per
    direction, so one transfer_outfit call (one reference = the dressed
    rotation of that direction) re-dresses a whole batch.

import: python3 tools/outfit_frames.py import <base_folder> <plan.json> <results_dir> <outfit_dir>
    results_dir/<batch>_<k>.png (frame k of batch, in plan order) are pasted
    back on the base canvas -> assets/source/wear/<outfit>/src/<anim>_<d>_<i>.png.
    Pixels outside the 64px window (a hoe swung past it) come from the base.
"""
import json
import os
import sys
from PIL import Image, ImageSequence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = ('idle', 'walk', 'harvest', 'hoe', 'water')
DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']
N = 64
MAXB = 15


def frames_of(base_folder):
    bdir = os.path.join(ROOT, 'assets/source', base_folder)
    out = []   # (anim, d, i, image)
    for d in range(8):
        for a in ANIMS:
            p = os.path.join(bdir, f'{a}_{d}.gif')
            if not os.path.exists(p):
                continue
            fr = [f.convert('RGBA') for f in ImageSequence.Iterator(Image.open(p))]
            if a == 'idle':
                fr = fr[:1]
            for i, f in enumerate(fr):
                out.append((a, d, i, f))
    return out


def window(fs):
    """one 64px crop window for a whole animation (keeps its framing stable)"""
    W, H = fs[0].size
    bb = [W, H, 0, 0]
    for f in fs:
        b = f.getchannel('A').getbbox()
        if b:
            bb = [min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3])]
    ox = min(max(0, (bb[0] + bb[2]) // 2 - N // 2), max(0, W - N))
    oy = min(max(0, bb[3] - N + 2), max(0, H - N))   # keep the feet, lose the top first
    oy = max(0, min(oy, bb[1]))
    return ox, oy


def export(base_folder, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    fs = frames_of(base_folder)
    win = {}
    for a, d, i, f in fs:
        win.setdefault((a, d), []).append(f)
    win = {k: window(v) for k, v in win.items()}
    plan = []
    for d in range(8):
        cur = [x for x in fs if x[1] == d]
        for b in range(0, len(cur), MAXB):
            chunk = cur[b:b + MAXB]
            if len(chunk) == 1:          # transfer needs 2+ frames: borrow the next walk frame
                chunk = cur[max(0, b - 1):b + 1]
            name = f'd{d}_{b // MAXB}'
            items = []
            for k, (a, dd, i, f) in enumerate(chunk):
                ox, oy = win[(a, dd)]
                f.crop((ox, oy, ox + N, oy + N)).save(os.path.join(out_dir, f'{name}_{k}.png'))
                items.append({'anim': a, 'd': dd, 'i': i, 'ox': ox, 'oy': oy})
            plan.append({'batch': name, 'dir': DIRS[d], 'frames': items})
    json.dump(plan, open(os.path.join(out_dir, 'plan.json'), 'w'), indent=1)
    print(len(fs), 'frames in', len(plan), 'batches ->', out_dir)


def do_import(base_folder, plan_path, res_dir, outfit_dir):
    plan = json.load(open(plan_path))
    bf = {(a, d, i): f for a, d, i, f in frames_of(base_folder)}
    dst = os.path.join(ROOT, 'assets/source/wear', outfit_dir, 'src')
    os.makedirs(dst, exist_ok=True)
    n = 0
    for b in plan:
        for k, it in enumerate(b['frames']):
            rp = os.path.join(res_dir, f"{b['batch']}_{k}.png")
            if not os.path.exists(rp):
                continue
            base = bf[(it['anim'], it['d'], it['i'])]
            r = Image.open(rp).convert('RGBA')
            if r.size != (N, N):
                r = r.resize((N, N), Image.NEAREST)
            out = base.copy()
            ox, oy = it['ox'], it['oy']
            out.paste(Image.new('RGBA', (N, N), (0, 0, 0, 0)), (ox, oy))
            out.alpha_composite(r, (ox, oy))
            out.save(os.path.join(dst, f"{it['anim']}_{it['d']}_{it['i']}.png"))
            n += 1
    print(n, 'frames ->', dst)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'export':
        export(*sys.argv[2:4])
    else:
        do_import(*sys.argv[2:6])
