#!/usr/bin/env python3
"""Bake the three Shadow drive-mode backgrounds for apps/shadow_dash.

Source pictures: tools/photos-src/{sport,comfort,eco}.png. They are scaled to the
cluster width without stretching, then cropped evenly top and bottom to 1920x640.
The two-line slogan stays part of the picture. Static captions and units are drawn
in the empty right-hand area (tools/shadow_geom.py). The live numbers and the rpm
bar are widgets.

    python3 -X utf8 tools/make_photos.py

Unit font: SHADOW_EN_FONT, else Arial Bold or DejaVu Sans Bold.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

from shadow_geom import ACCENT, BLOCKS, NAVY, PHOTO_H, PHOTO_W, layout

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'photos-src')
OUT = os.path.join(HERE, '..', 'apps', 'shadow_dash', 'hud', 'photos')
MODES = ('sport', 'comfort', 'eco')

EN_CANDIDATES = [
    os.environ.get('SHADOW_EN_FONT'),
    'C:/Windows/Fonts/arialbd.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]


def _font(size):
    for path in EN_CANDIDATES:
        if path and os.path.isfile(path):
            return ImageFont.truetype(path, size)
    raise SystemExit('No Latin font for the baked units. Set SHADOW_EN_FONT.\nLooked for:\n  %s' %
                     '\n  '.join(p for p in EN_CANDIDATES if p))


def fit_panel(im):
    """Scale to width 1920, then crop top and bottom by the same amount to 640px."""
    im = im.convert('RGBA')
    w, h = im.size
    nh = max(1, int(round(h * (PHOTO_W / float(w)))))
    im = im.resize((PHOTO_W, nh), Image.LANCZOS)
    if nh == PHOTO_H:
        return im
    if nh < PHOTO_H:
        canvas = Image.new('RGBA', (PHOTO_W, PHOTO_H), (0, 0, 0, 255))
        canvas.paste(im, (0, (PHOTO_H - nh) // 2))
        return canvas
    top = (nh - PHOTO_H) // 2
    return im.crop((0, top, PHOTO_W, top + PHOTO_H))


def build(mode, fonts):
    src = os.path.join(SRC, mode + '.png')
    if not os.path.isfile(src):
        raise SystemExit('missing %s' % src)
    base = fit_panel(Image.open(src))
    spec = layout(mode)
    x, y, w, h = spec['block']
    ov = Image.new('RGBA', (PHOTO_W, PHOTO_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    # a light plate so the orange swirls never fight the numbers; the art is to the left of x
    d.rounded_rectangle([x - 10, y - 6, x + w - 4, min(PHOTO_H - 8, y + h)], radius=16, fill=(0, 0, 0, 78))
    acc = ACCENT[mode]
    d.rounded_rectangle([x - 10, y - 6, x + w - 4, y - 1], radius=2, fill=acc + (255,))
    if mode == 'comfort':
        d.rectangle([x - 10, y + 2, x + w - 4, y + 5], fill=NAVY + (255,))
    for item in spec['bakes']:
        font = fonts.get(item['size']) or fonts.setdefault(item['size'], _font(item['size']))
        d.text((item['x'], item['y']), item['text'], font=font, fill=item['color'] + (255,), anchor='lt')
    out = Image.alpha_composite(base, ov)
    os.makedirs(OUT, exist_ok=True)
    raw = out.tobytes()
    if len(raw) != PHOTO_W * PHOTO_H * 4:
        raise SystemExit('%s rgba is %d bytes' % (mode, len(raw)))
    open(os.path.join(OUT, mode + '.rgba'), 'wb').write(raw)
    print(mode, 'ok', BLOCKS[mode])


def main():
    fonts = {}
    for mode in MODES:
        build(mode, fonts)


if __name__ == '__main__':
    sys.path.insert(0, HERE)
    sys.exit(main() or 0)
