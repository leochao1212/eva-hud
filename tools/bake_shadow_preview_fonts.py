#!/usr/bin/env python3
"""Preview-only atlases for the Shadow simulation. Not used on the car and not a font file
to commit: the output is apps/shadow_dash/hud/fonts, which git ignores.

The hero (e_rpm) is DejaVu Sans Bold, drawn at the layout's glyph size and sheared once
with a bicubic filter so the render does not scale or shear it again. e_num and e3_time
match the footer icon cap-height.
"""
import base64
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shadow_geom import HERO_H, HERO_PAD  # noqa: E402

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
OUT = os.path.join(HERE, '..', 'apps', 'shadow_dash', 'hud', 'fonts')
ATLAS_W = 1024
# positive: top of the glyph leans right, about the same angle as the baked slash
SHEAR = 0.18


def _shear(im, k):
    w, h = im.size
    extra = int(abs(k) * h) + 2
    # output (x, y) reads input (x - k*(h-y), y) = (x + k*y - k*h, y)
    return im.transform((w + extra, h), Image.AFFINE, (1, k, -k * h, 0, 1, 0), resample=Image.BICUBIC)


def bake(name, size, chars, shear):
    font = ImageFont.truetype(FONT, size)
    ink = [c for c in chars if c != ' ']
    raw = {}
    for c in ink:
        box = font.getbbox(c, anchor='ls')
        l, t, r, b = box
        w, h = r - l + 4, b - t + 4
        img = Image.new('L', (w, h), 0)
        ImageDraw.Draw(img).text((2 - l, 2 - t), c, font=font, fill=255, anchor='ls')
        if shear:
            img = _shear(img, shear)
        raw[c] = (img, font.getlength(c))
    height = max(im.size[1] for im, _ in raw.values())
    tab = max(adv for c, (im, adv) in raw.items() if c in '0123456789') if any(c in chars for c in '0123456789') else 0
    cells = []
    for c in chars:
        if c == ' ':
            cells.append((c, None, 0, int(round(size * 0.33))))
            continue
        im, adv = raw[c]
        # pad every cell to the same height, glyph sitting on a shared baseline (bottom)
        canvas = Image.new('L', (im.size[0], height), 0)
        canvas.paste(im, (0, height - im.size[1]))
        # advance stays the upright width; the sheared top hangs into the next letter's gap
        use = tab if c in '0123456789' else adv
        cells.append((c, canvas, 0, int(round(use))))
    x = y = 0
    placed = {}
    for c, img, ox, adv in cells:
        if img is None:
            continue
        if x + img.width > ATLAS_W:
            x, y = 0, y + height
        placed[c] = (x, y)
        x += img.width
    atlas = Image.new('L', (ATLAS_W, y + height), 0)
    glyphs = {}
    for c, img, ox, adv in cells:
        if img is None:
            glyphs[c] = {'x': 0, 'y': 0, 'w': 0, 'h': 0, 'ox': 0, 'advance': adv}
            continue
        gx, gy = placed[c]
        atlas.paste(img, (gx, gy))
        glyphs[c] = {'x': gx, 'y': gy, 'w': img.width, 'h': img.height, 'ox': ox, 'advance': adv}
    meta = {
        'source': 'DejaVuSans-Bold.ttf', 'size': size, 'cellHeight': height,
        'baseline': 2, 'glyphs': glyphs, 'width': ATLAS_W, 'height': atlas.size[1],
        'alpha': base64.b64encode(atlas.tobytes()).decode('ascii'),
        'preview': True,
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, separators=(',', ':'))
    sample = ''.join(c for c in '118' if c in glyphs)
    print('%-8s size %3d cell %3d  %s width %d' % (
        name, size, height, sample, sum(glyphs[c]['advance'] for c in sample)))


def main():
    # largest DejaVu size whose ink still fits the Eco column (three digits + shear)
    bake('e_rpm', 168, '0123456789-', SHEAR)
    bake('e_num', 40, '0123456789-', 0)
    bake('b_gear', 78, '0123456789PRND-', 0)
    bake('e3_time', 40, '0123456789:', 0)


if __name__ == '__main__':
    main()
