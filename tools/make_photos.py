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
from shadow_geom import ACCENT, BOTTOM_FADE_Y, NAVY, PHOTO_H, PHOTO_W, layout  # noqa: E402

SRC = os.path.join(HERE, 'photos-src')
OUT = os.path.join(HERE, '..', 'apps', 'shadow_dash', 'hud', 'photos')
MODES = ('sport', 'comfort', 'eco')

# The stock gear window starts at panel x=1196. The source is 2048 wide, and
# 1196 there is panel x=1121. The slogan block must end before that, with a gap.
ECO_SLOGAN_RIGHT = 1152  # source px, under 1196


def _reflow_eco_slogan(im):
    """Scale the ECO PRO tag, its rule and the two slogan lines so they end left of the gear window."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()

    def ink(r, g, b, x, y):
        if x < 730 or y < 80 or y > 500:
            return False
        if r > 200 and g > 175 and b > 130:
            return True
        return r > 185 and 45 < g < 190 and b < 100 and r > g + 25

    mask = [[False] * w for _ in range(h)]
    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(80, 501):
        row = mask[y]
        for x in range(730, w):
            r, g, b, _a = px[x, y]
            if ink(r, g, b, x, y):
                row[x] = True
                minx, miny, maxx, maxy = min(minx, x), min(miny, y), max(maxx, x), max(maxy, y)
    if maxx < minx:
        raise SystemExit('eco slogan was not found')
    bw, bh = maxx - minx + 1, maxy - miny + 1
    scale = (ECO_SLOGAN_RIGHT - minx) / float(bw)
    if scale <= 0 or scale > 1:
        raise SystemExit('eco slogan scale %s does not fit' % scale)
    chip = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    cp = chip.load()
    for y in range(bh):
        for x in range(bw):
            if mask[miny + y][minx + x]:
                r, g, b, _a = px[minx + x, miny + y]
                cp[x, y] = (r, g, b, 255)
    # Blank the old block, shadow included, then put the orange ribbons back.
    # Those ribbons are bright orange and sit clear of the letter ink.
    saved = im.copy()
    spx = saved.load()
    x0, y0 = max(0, minx - 10), max(0, miny - 10)
    x1, y1 = min(w, maxx + 80), min(h, maxy + 70)
    for y in range(y0, y1):
        for x in range(x0, x1):
            px[x, y] = (0, 0, 0, 255)

    def near_ink(x, y, reach):
        for yy in range(max(0, y - reach), min(h, y + reach + 1), 2):
            row = mask[yy]
            for xx in range(max(0, x - reach), min(w, x + reach + 1), 2):
                if row[xx]:
                    return True
        return False

    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, _a = spx[x, y]
            if r > 150 and b < 90 and r > g + 20 and not near_ink(x, y, 8):
                px[x, y] = (r, g, b, 255)
    nw, nh = max(1, int(round(bw * scale))), max(1, int(round(bh * scale)))
    chip = chip.resize((nw, nh), Image.LANCZOS)
    top = miny + (bh - nh) // 2
    im.paste(chip, (minx, top), chip)
    # boxes in the 1920x640 panel: width-fit, then the even top/bottom crop
    panel = PHOTO_W / float(w)
    crop = int(round(h * panel - PHOTO_H)) // 2
    boxes = []
    sp = chip.load()
    band = None
    for y in range(nh):
        xs = [x for x in range(nw) if sp[x, y][3] > 40]
        if not xs:
            if band:
                boxes.append(band)
                band = None
            continue
        if band is None:
            band = [xs[0], y, xs[-1], y]
        else:
            band[0] = min(band[0], xs[0])
            band[2] = max(band[2], xs[-1])
            band[3] = y
    if band:
        boxes.append(band)
    # merge bands separated by a few empty rows (the gaps inside a glyph)
    merged = []
    for b in boxes:
        if merged and b[1] - merged[-1][3] < 8:
            p = merged[-1]
            merged[-1] = [min(p[0], b[0]), p[1], max(p[2], b[2]), b[3]]
        else:
            merged.append(b)
    out = []
    for x0, y0, x1, y1 in merged:
        out.append({
            'x': int(round((minx + x0) * panel)),
            'y': int(round((top + y0) * panel)) - crop,
            'w': max(1, int(round((x1 - x0 + 1) * panel))),
            'h': max(1, int(round((y1 - y0 + 1) * panel))),
        })
    return im, out


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
    src_im = Image.open(src)
    if mode == 'eco':
        src_im, boxes = _reflow_eco_slogan(src_im)
        print('eco slogan boxes', boxes)
    base = fit_panel(src_im)
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
    print(mode, 'ok', 'speed', speed['x'], speed['y'], speed['w'], speed['h'])


def main():
    for mode in MODES:
        build(mode)


if __name__ == '__main__':
    sys.exit(main() or 0)
