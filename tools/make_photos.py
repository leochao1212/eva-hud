#!/usr/bin/env python3
"""Bake the three Shadow drive-mode backgrounds.

Scales each source to width 1920 without stretching, then crops the same amount
off the top and the bottom to 1920x640. The portrait and slogan stay. The dark
right-hand side gets a horizontal fade (not a box), a slanted accent stripe,
empty rpm-segment outlines, three small icons and a small km/h. Live numbers
are drawn by the app.

    python3 -X utf8 tools/make_photos.py
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shadow_geom import ACCENT, BOTTOM_FADE_Y, MUTED, NAVY, PHOTO_H, PHOTO_W, layout  # noqa: E402

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
    raise SystemExit('No Latin font for the baked marks. Set SHADOW_EN_FONT.')


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


def _icon_fuel(d, x, y, s, color):
    d.rounded_rectangle([x + 4, y + 3, x + s - 5, y + s - 2], radius=2, outline=color, width=2)
    d.rectangle([x + s - 8, y + 6, x + s - 2, y + 11], outline=color, width=2)


def _icon_temp(d, x, y, s, color):
    d.line([x + s // 2, y + 3, x + s // 2, y + s - 8], fill=color, width=2)
    d.ellipse([x + s // 2 - 5, y + s - 12, x + s // 2 + 5, y + s - 2], outline=color, width=2)


def _icon_clock(d, x, y, s, color):
    d.ellipse([x + 2, y + 2, x + s - 2, y + s - 2], outline=color, width=2)
    cx, cy = x + s // 2, y + s // 2
    d.line([cx, cy, cx, y + 6], fill=color, width=2)
    d.line([cx, cy, x + s - 6, cy + 2], fill=color, width=2)


ICONS = {'rng': _icon_fuel, 'wat': _icon_temp, 'clk': _icon_clock}


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


def _outline(draw, quad, color, width):
    draw.line(list(quad) + [quad[0]], fill=color, width=width)


def build(mode, font):
    src = os.path.join(SRC, mode + '.png')
    if not os.path.isfile(src):
        raise SystemExit('missing %s' % src)
    base = fit_panel(Image.open(src))
    spec = layout(mode)
    speed = spec['parts'][0]
    # fully black by the time the instruments start, so the panel below the photo matches
    _fade(base, spec['fade'], speed['x'] - 10, 1.0)
    ov = Image.new('RGBA', (PHOTO_W, PHOTO_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    acc = ACCENT[mode] + (255,)
    st = spec['stripe']
    sx, sy, sw, sh, slant = st['x'], st['y'], st['w'], st['h'], st['slant']
    band = [(sx, sy + sh), (sx + sw, sy + sh), (sx + sw + slant, sy), (sx + slant, sy)]
    if mode == 'comfort':
        d.polygon([(p[0] - 8, p[1]) for p in band], fill=NAVY + (255,))
    d.polygon(band, fill=acc)
    muted = MUTED + (190,)
    for i, quad in enumerate(spec['quads']):
        red = i >= 14
        _outline(d, quad, (255, 54, 48, 230) if red else (255, 255, 255, 110), 2 if red else 1)
    kmh = spec['kmh']
    d.text((kmh['x'], kmh['y']), kmh['text'], font=_font(kmh['size']), fill=muted, anchor=kmh['anchor'])
    label = spec['rpm_label']
    d.text((label['x'], label['y']), label['text'], font=font, fill=MUTED + (label['alpha'],), anchor=label['anchor'])
    for icon in spec['icons']:
        ICONS[icon['id']](d, icon['x'], icon['y'], icon['s'], muted)
    out = Image.alpha_composite(base, ov)
    _fade_bottom(out, BOTTOM_FADE_Y)
    os.makedirs(OUT, exist_ok=True)
    raw = out.tobytes()
    if len(raw) != PHOTO_W * PHOTO_H * 4:
        raise SystemExit('%s rgba is %d bytes' % (mode, len(raw)))
    open(os.path.join(OUT, mode + '.rgba'), 'wb').write(raw)
    print(mode, 'ok', 'speed', speed['x'], speed['y'], speed['w'], speed['h'])


def main():
    font = _font(22)
    for mode in MODES:
        build(mode, font)


if __name__ == '__main__':
    sys.exit(main() or 0)
