#!/usr/bin/env python3
"""Bake the centre-screen cockpit background (1920x720 RGBA) for the EVA centre design:
the EVA-01 diagnostic hologram on the left inside a corner-bracket frame, and the static NERV labels
(readout labels on the right, the MAGI plates) baked in. Live numbers are drawn by the app at runtime
(tools/cockpit_layout.py). Output: apps/eva_hud/hud/photos/cockpit.rgba .

Drawn blind for the iDrive 7 centre screen (mgu-render); sizes/positions are a first pass to iterate
on the car. Hologram source: ../../../project/id7cus/中控駕駛艙-codex/eva01_holo.png (fallback: a drawn
placeholder if missing)."""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'apps', 'eva_hud', 'hud', 'photos')
HOLO = os.path.join(HERE, '..', '..', '..', 'OneDrive', 'Desktop', 'project', 'id7cus', '中控駕駛艙-codex', 'eva01_holo.png')

W, H = 1920, 720
ORANGE = (255, 136, 0)
AMBER = (255, 176, 0)
GREEN = (84, 224, 143)
DIM = (150, 125, 90)
GREY = (150, 150, 150)

ZH_L = ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc', 30)
ZH_M = ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc', 22)
ZH_S = ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc', 17)
EN_S = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 14)
EN_M = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 18)


def corner(d, x, y, w, h, c, L=26, t=3):
    for (cx, cy, dx, dy) in [(x, y, 1, 1), (x + w, y, -1, 1), (x, y + h, 1, -1), (x + w, y + h, -1, -1)]:
        d.line([(cx, cy), (cx + dx * L, cy)], fill=c, width=t)
        d.line([(cx, cy), (cx, cy + dy * L)], fill=c, width=t)


def build():
    img = Image.new('RGBA', (W, H), (3, 4, 5, 255))
    d = ImageDraw.Draw(img)

    # --- hologram on the left, inside a corner-bracket frame ---
    fx, fy, fw, fh = 70, 44, 560, 632
    try:
        holo = Image.open(HOLO).convert('RGBA')
        s = min(fw / holo.width, fh / holo.height)
        hw, hh = int(holo.width * s), int(holo.height * s)
        holo = holo.resize((hw, hh), Image.LANCZOS)
        img.alpha_composite(holo, (fx + (fw - hw) // 2, fy + (fh - hh) // 2))
    except Exception as e:
        d.text((fx + 180, fy + 300), 'HOLOGRAM', font=ZH_L, fill=ORANGE)
        print('hologram missing, placeholder:', e)
    corner(d, fx, fy, fw, fh, ORANGE)
    d.text((fx + 14, fy + fh - 28), '変速機 UNIT-01', font=ZH_S, fill=DIM)
    d.text((fx + fw - 150, fy + fh - 28), 'SYNC', font=EN_S, fill=DIM)  # value drawn by app to the right

    # --- right: three readout labels (orange), live numbers drawn by app below each ---
    rx = 740
    for i, (zh, en) in enumerate([('水温', 'WATER'), ('油温', 'OIL'), ('増圧', 'BOOST')]):
        ry = 70 + i * 150
        d.text((rx, ry), zh, font=ZH_M, fill=ORANGE)
        d.text((rx + 70, ry + 5), en, font=EN_S, fill=DIM)

    # --- MAGI SYSTEM panel (green plates) bottom-right ---
    my = 470
    d.text((rx, my), 'MAGI SYSTEM', font=EN_M, fill=DIM)
    d.text((rx + 150, my + 2), '// 出撃判定', font=ZH_S, fill=DIM)
    plates = [('MELCHIOR', '1', '油温'), ('BALTHASAR', '2', '水温'), ('CASPER', '3', '駆動')]
    for i, (nm, no, watch) in enumerate(plates):
        px = rx + i * 230
        py = my + 40
        d.rounded_rectangle([px, py, px + 200, py + 150], radius=14, outline=GREEN, width=2)
        d.text((px + 16, py + 12), '%s\u00b7%s' % (nm, no), font=EN_S, fill=GREEN)
        d.text((px + 50, py + 48), '承認', font=ZH_L, fill=GREEN)
        d.text((px + 70, py + 112), watch, font=ZH_S, fill=DIM)
    # verdict area (value drawn by app): a label
    d.text((rx + 710, my + 70), 'UNANIMOUS', font=EN_S, fill=DIM)

    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, 'cockpit.rgba'), 'wb').write(img.tobytes())
    print('wrote cockpit.rgba', W, 'x', H)


build()
