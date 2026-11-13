#!/usr/bin/env python3
"""Bake the three Shadow drive-mode backgrounds for the cluster: scale the source banner to the
1920x640 cluster, draw four frosted corner panels, and bake the static Traditional-Chinese labels
and units into them. Only the live numbers are drawn by the app at runtime (digit/latin fonts it
already ships), so no Chinese glyphs are needed on the car. Output: apps/eva_hud/hud/photos/<mode>.rgba
Geometry here is mirrored by the number boxes in tools/shadow_layout.py."""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'photos-src')
OUT = os.path.join(HERE, '..', 'apps', 'eva_hud', 'hud', 'photos')
BANNER = {'sport': 'sport', 'comfort': 'comfort', 'eco': 'eco'}
ACC = {'sport': (43, 232, 220), 'comfort': (46, 139, 255), 'eco': (245, 115, 26)}

ZH = ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc', 30)
EN = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 19)
UNIT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 22)

# panels: x, y, w, h on 1920x640  (shadow_layout.py number boxes sit inside these)
P_SPD, P_RNG, P_GEAR, P_WAT = (46, 30, 470, 250), (1404, 30, 470, 220), (46, 360, 500, 250), (1404, 360, 470, 250)
SUB = (176, 190, 205)


def panel(d, box, acc):
    x, y, w, h = box
    d.rounded_rectangle([x, y, x + w, y + h], radius=18, fill=(5, 8, 13, 150))
    d.rounded_rectangle([x, y, x + 6, y + h], radius=3, fill=acc + (255,))


def label(d, x, y, zh, en, acc):
    d.text((x, y), zh, font=ZH, fill=acc + (255,))
    if en:
        d.text((x + ZH.getlength(zh) + 10, y + 10), en, font=EN, fill=SUB + (255,))


def unit(d, x, y, t, acc):
    d.text((x, y), t, font=UNIT, fill=acc + (255,), anchor='la')


def build(mode):
    acc = ACC[mode]
    base = Image.open(os.path.join(SRC, BANNER[mode] + '.png')).convert('RGBA').resize((1920, 720), Image.LANCZOS).crop((0, 0, 1920, 640))
    ov = Image.new('RGBA', (1920, 640), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for box in (P_SPD, P_RNG, P_GEAR, P_WAT):
        panel(d, box, acc)
    # speed (top-left): label + km/h unit; big number drawn by app
    label(d, 70, 48, '時速', 'SPEED', acc)
    unit(d, 428, 232, 'km/h', acc)
    # range (top-right)
    label(d, 1428, 48, '續航', 'RANGE', acc)
    unit(d, 1740, 196, 'KM', acc)
    # gear + rpm (bottom-left)
    label(d, 70, 378, '檔位', '', acc)
    label(d, 296, 378, '轉速', '', acc)
    unit(d, 470, 556, 'RPM', acc)
    # water (bottom-right)
    label(d, 1428, 378, '水溫', 'WATER', acc)
    unit(d, 1740, 540, '°C', acc)
    out = Image.alpha_composite(base, ov)
    open(os.path.join(OUT, mode + '.rgba'), 'wb').write(out.tobytes())
    print(mode, 'ok')


for m in BANNER:
    build(m)
