#!/usr/bin/env python3
"""Bake the three Shadow drive-mode backgrounds.

Scales each source to width 1920 without stretching, then crops the same amount
off the top and the bottom to 1920x640. The portrait and slogan stay. The dark
right-hand side fades to black, and a slanted accent sits in that dark, left of
the instruments. The app draws the numbers.

    python3 -X utf8 tools/make_photos.py
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shadow_geom import ACCENT, BOTTOM_FADE_Y, NAVY, PHOTO_FIT, PHOTO_H, PHOTO_W, layout  # noqa: E402
import etc2  # noqa: E402
import numpy as np  # noqa: E402

SRC = os.path.join(HERE, 'photos-src')
OUT = os.path.join(HERE, '..', 'apps', 'shadow_dash', 'hud', 'photos')
MODES = ('sport', 'comfort', 'eco')

def fit_height(im, dx):
    """Scale to the panel height, drop dx px off the left, black to the right of the picture."""
    im = im.convert('RGBA')
    w, h = im.size
    nw = max(1, int(round(w * (PHOTO_H / float(h)))))
    im = im.resize((nw, PHOTO_H), Image.LANCZOS)
    canvas = Image.new('RGBA', (PHOTO_W, PHOTO_H), (0, 0, 0, 255))
    canvas.paste(im.crop((dx, 0, min(nw, dx + PHOTO_W), PHOTO_H)), (0, 0))
    return canvas


def fit_panel(im):
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


def _fade(im, x0, x1, strength):
    """Darken toward black from x0 to the right edge. x1 is where it is fully dark."""
    px = im.load()
    w, h = im.size
    span = max(1, x1 - x0)
    for x in range(max(0, x0), w):
        t = 1.0 if x >= x1 else (x - x0) / float(span)
        t = t * t * (3 - 2 * t)
        k = strength * t
        if k <= 0:
            continue
        for y in range(h):
            r, g, b, a = px[x, y]
            px[x, y] = (int(r * (1 - k)), int(g * (1 - k)), int(b * (1 - k)), a)


def _fade_bottom(im, y0, y_black=636):
    """Fade to pure black by y_black. Rows from there down match the panel below the photo."""
    px = im.load()
    w, h = im.size
    span = max(1, y_black - y0)
    for y in range(max(0, y0), h):
        if y >= y_black:
            t = 1.0
        else:
            t = (y - y0) / float(span)
            t = t * t * (3 - 2 * t)
        if t <= 0:
            continue
        keep = 0 if t >= 1 else (1 - t)
        for x in range(w):
            r, g, b, a = px[x, y]
            px[x, y] = (int(r * keep), int(g * keep), int(b * keep), a)


def build(mode):
    src = os.path.join(SRC, mode + '.png')
    if not os.path.isfile(src):
        raise SystemExit('missing %s' % src)
    fit = PHOTO_FIT.get(mode)
    base = fit_height(Image.open(src), fit[1]) if fit else fit_panel(Image.open(src))
    spec = layout(mode)
    speed = next(p for p in spec['parts'] if p['id'] == 'spd')
    # fully black by the time the instruments start, so the panel below the photo matches
    _fade(base, spec['fade'], speed['x'] - 8, 1.0)
    ov = Image.new('RGBA', (PHOTO_W, PHOTO_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    st = spec['stripe']
    sx, sy, sw, sh, slant = st['x'], st['y'], st['w'], st['h'], st['slant']
    band = [(sx, sy + sh), (sx + sw, sy + sh), (sx + sw + slant, sy), (sx + slant, sy)]
    # owner removed the slanted accent on every mode
    out = Image.alpha_composite(base, ov)
    _fade_bottom(out, BOTTOM_FADE_Y)
    os.makedirs(OUT, exist_ok=True)
    raw = out.tobytes()
    if len(raw) != PHOTO_W * PHOTO_H * 4:
        raise SystemExit('%s rgba is %d bytes' % (mode, len(raw)))
    open(os.path.join(OUT, mode + '.rgba'), 'wb').write(raw)
    # the copy the app sends: etc2rgba, 1 byte a pixel, charged once to cluster-render's pixel memory
    open(os.path.join(OUT, mode + '.etc2'), 'wb').write(
        etc2.encode(np.frombuffer(raw, np.uint8).reshape(PHOTO_H, PHOTO_W, 4)))
    print(mode, 'ok', 'speed', speed['x'], speed['y'], speed['w'], speed['h'])


def main():
    for mode in (sys.argv[1:] or MODES):
        build(mode)


if __name__ == '__main__':
    sys.exit(main() or 0)
