#!/usr/bin/env python3
"""Bake the three Shadow drive-mode backgrounds for the cluster. The banners have a person on the
left and big meme text in the centre-right, so the only face-free blank zone is the strip below the
text. We scale the banner to 1920x640, lay one frosted strip there, and bake the static
Traditional-Chinese labels and units into it. Only the live numbers are drawn by the app at runtime.
Output: apps/eva_hud/hud/photos/<mode>.rgba . Geometry is mirrored by tools/shadow_layout.py."""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'photos-src')
OUT = os.path.join(HERE, '..', 'apps', 'eva_hud', 'hud', 'photos')
MODES = ('sport', 'comfort', 'eco')
ACC = {'sport': (43, 232, 220), 'comfort': (46, 139, 255), 'eco': (245, 115, 26)}
SUB = (182, 196, 210)

ZH = ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc', 26)
EN = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 17)

STRIP = (706, 498, 1198, 138)  # x, y, w, h  (shadow_layout.py number boxes sit here)
# per-cell label anchor (x, y) baked into the photo; numbers are widgets
CELLS = [
    ('時速', 722, 500), ('轉速', 1054, 500), ('檔位', 1302, 500), ('續航', 1500, 500), ('水溫', 1708, 500),
]
UNITS = [('km/h', 902, 582), ('RPM', 1054, 602), ('KM', 1628, 560), ('°C', 1834, 560)]


def build(mode):
    acc = ACC[mode]
    base = Image.open(os.path.join(SRC, mode + '.png')).convert('RGBA').resize((1920, 720), Image.LANCZOS).crop((0, 0, 1920, 640))
    ov = Image.new('RGBA', (1920, 640), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    x, y, w, h = STRIP
    d.rounded_rectangle([x, y, x + w, y + h], radius=16, fill=(5, 8, 13, 170))
    d.rounded_rectangle([x, y, x + w, y + 5], radius=2, fill=acc + (255,))
    for zh, lx, ly in CELLS:
        d.text((lx, ly), zh, font=ZH, fill=acc + (255,))
    for t, ux, uy in UNITS:
        d.text((ux, uy), t, font=EN, fill=SUB + (255,))
    out = Image.alpha_composite(base, ov)
    open(os.path.join(OUT, mode + '.rgba'), 'wb').write(out.tobytes())
    print(mode, 'ok')


for m in MODES:
    build(m)
