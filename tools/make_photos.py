#!/usr/bin/env python3
"""Bake the three Shadow drive-mode backgrounds for apps/shadow_dash.

The source pictures live in tools/photos-src/{sport,comfort,eco}.png. The two-line slogan is part
of each picture. This script scales the picture to 1920x640, lays one frosted strip under the
slogan, and bakes the static labels and units into that strip. Only the live numbers are drawn
by the app. Geometry is mirrored by tools/shadow_layout.py.

    python3 -X utf8 tools/make_photos.py

Label fonts: SHADOW_ZH_FONT and SHADOW_EN_FONT, or the usual Windows / Linux paths.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'photos-src')
OUT = os.path.join(HERE, '..', 'apps', 'shadow_dash', 'hud', 'photos')
MODES = ('sport', 'comfort', 'eco')
ACC = {'sport': (43, 232, 220), 'comfort': (46, 139, 255), 'eco': (245, 115, 26)}
SUB = (182, 196, 210)

# x, y, w, h of the frosted strip. shadow_layout.py's number boxes sit on the same strip.
STRIP = (706, 498, 1198, 138)
# per-cell label anchor (x, y) baked into the photo; numbers are widgets
CELLS = [
    ('時速', 722, 500), ('轉速', 1054, 500), ('檔位', 1302, 500), ('續航', 1500, 500), ('水溫', 1708, 500),
]
UNITS = [('km/h', 902, 582), ('RPM', 1054, 602), ('KM', 1628, 560), ('°C', 1834, 560)]

ZH_CANDIDATES = [
    os.environ.get('SHADOW_ZH_FONT'),
    'C:/Windows/Fonts/msjhbd.ttc',
    '/Library/Fonts/Microsoft JhengHei Bold.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
]
EN_CANDIDATES = [
    os.environ.get('SHADOW_EN_FONT'),
    'C:/Windows/Fonts/arialbd.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]


def _font(which, size, candidates):
    for path in candidates:
        if path and os.path.isfile(path):
            return ImageFont.truetype(path, size)
    raise SystemExit('No %s font. Set SHADOW_%s_FONT. Looked for:\n  %s' % (
        which, 'ZH' if which == 'Chinese' else 'EN', '\n  '.join(p for p in candidates if p)))


def build(mode, zh, en):
    acc = ACC[mode]
    src = os.path.join(SRC, mode + '.png')
    if not os.path.isfile(src):
        raise SystemExit('missing %s' % src)
    base = Image.open(src).convert('RGBA').resize((1920, 720), Image.LANCZOS).crop((0, 0, 1920, 640))
    ov = Image.new('RGBA', (1920, 640), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    x, y, w, h = STRIP
    d.rounded_rectangle([x, y, x + w, y + h], radius=16, fill=(5, 8, 13, 170))
    d.rounded_rectangle([x, y, x + w, y + 5], radius=2, fill=acc + (255,))
    for label, lx, ly in CELLS:
        d.text((lx, ly), label, font=zh, fill=acc + (255,))
    for text, ux, uy in UNITS:
        d.text((ux, uy), text, font=en, fill=SUB + (255,))
    out = Image.alpha_composite(base, ov)
    os.makedirs(OUT, exist_ok=True)
    raw = out.tobytes()
    open(os.path.join(OUT, mode + '.rgba'), 'wb').write(raw)
    print(mode, 'ok', len(raw))


def main():
    zh = _font('Chinese', 26, ZH_CANDIDATES)
    en = _font('Latin', 17, EN_CANDIDATES)
    for mode in MODES:
        build(mode, zh, en)


if __name__ == '__main__':
    sys.exit(main() or 0)
