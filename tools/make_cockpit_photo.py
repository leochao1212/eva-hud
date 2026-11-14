#!/usr/bin/env python3
"""Bake the centre-screen cockpit background (1280x480 RGBA) for the EVA centre design, for the
iDrive 7 centre screen (mgu-render, native 1280x480). The EVA-01 diagnostic hologram on the left in a
corner-bracket frame; the static NERV labels baked (readout labels + units top-right, the MAGI plates
bottom-right), spread edge to edge. Live numbers are drawn by the app at runtime (tools/cockpit_layout.py).
Output: apps/eva_hud/hud/photos/cockpit.rgba . Hologram source:
../../../project/id7cus/中控駕駛艙-codex/eva01_holo.png (fallback: a drawn placeholder if missing)."""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'apps', 'eva_hud', 'hud', 'photos')
HOLO = os.path.join(HERE, '..', '..', '..', 'OneDrive', 'Desktop', 'project', 'id7cus', '中控駕駛艙-codex', 'eva01_holo.png')

W, H = 1280, 480
ORANGE = (255, 136, 0)
AMBER = (255, 176, 0)
GREEN = (84, 224, 143)
DIM = (150, 125, 90)
GREY = (150, 150, 150)

ZH_L = ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc', 30)   # 承認
ZH_M = ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc', 22)   # 水温 labels
ZH_S = ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc', 15)
EN_S = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 12)
EN_M = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 16)

# --- shared geometry (also used by cockpit_layout.py; keep in sync) ---
FX, FY, FW, FH = 16, 12, 384, 456          # hologram corner-bracket frame
RX = [432, 720, 1008]                       # three readout columns (top-right)
RLABEL_Y = 44                               # readout label row
RNUM_Y = 82                                 # live number row (drawn by app)
MX = 416                                     # MAGI panel left
MHDR_Y = 250                                 # MAGI header
PY = 290                                     # MAGI plate top
PW, PH, PGAP = 202, 176, 20                 # plate size / gap
PLX = [MX, MX + PW + PGAP, MX + 2 * (PW + PGAP)]   # 416, 638, 860
VX = PLX[2] + PW + 18                         # verdict x (1080)


def corner(d, x, y, w, h, c, L=24, t=3):
    for (cx, cy, dx, dy) in [(x, y, 1, 1), (x + w, y, -1, 1), (x, y + h, 1, -1), (x + w, y + h, -1, -1)]:
        d.line([(cx, cy), (cx + dx * L, cy)], fill=c, width=t)
        d.line([(cx, cy), (cx, cy + dy * L)], fill=c, width=t)


def build():
    img = Image.new('RGBA', (W, H), (3, 4, 5, 255))
    d = ImageDraw.Draw(img)

    # --- hologram on the left, inside a corner-bracket frame ---
    try:
        holo = Image.open(HOLO).convert('RGBA')
        s = min(FW / holo.width, FH / holo.height)
        hw, hh = int(holo.width * s), int(holo.height * s)
        holo = holo.resize((hw, hh), Image.LANCZOS)
        img.alpha_composite(holo, (FX + (FW - hw) // 2, FY + (FH - hh) // 2))
    except Exception as e:
        d.text((FX + 120, FY + 200), 'HOLOGRAM', font=ZH_L, fill=ORANGE)
        print('hologram missing, placeholder:', e)
    corner(d, FX, FY, FW, FH, ORANGE)
    d.text((FX + 12, FY + FH - 26), '変速機 UNIT-01', font=ZH_S, fill=DIM)
    d.text((FX + FW - 118, FY + FH - 26), 'SYNC', font=EN_S, fill=DIM)   # value drawn by app to the right

    # --- top-right: three readout labels + units (orange); live numbers drawn by app at RNUM_Y ---
    units = ['\u2103', '\u2103', 'bar']
    for i, (zh, en) in enumerate([('水温', 'WATER'), ('油温', 'OIL'), ('増圧', 'BOOST')]):
        x = RX[i]
        d.text((x, RLABEL_Y), zh, font=ZH_M, fill=ORANGE)
        d.text((x + 62, RLABEL_Y + 5), en, font=EN_S, fill=DIM)
        d.text((x + 128, RNUM_Y + 34), units[i], font=ZH_S, fill=DIM)   # unit, number drawn to its left

    # --- MAGI SYSTEM panel (green plates), bottom-right, spread across ---
    d.text((MX, MHDR_Y), 'MAGI SYSTEM', font=EN_M, fill=DIM)
    d.text((MX + 140, MHDR_Y + 2), '// 出撃判定', font=ZH_S, fill=DIM)
    plates = [('MELCHIOR', '1', '油温'), ('BALTHASAR', '2', '水温'), ('CASPER', '3', '駆動')]
    for i, (nm, no, watch) in enumerate(plates):
        px = PLX[i]
        d.rounded_rectangle([px, PY, px + PW, PY + PH], radius=14, outline=GREEN, width=2)
        d.text((px + 14, PY + 12), '%s\u00b7%s' % (nm, no), font=EN_S, fill=GREEN)
        d.text((px + PW // 2 - 32, PY + 58), '承認', font=ZH_L, fill=GREEN)
        d.text((px + PW // 2 - 16, PY + PH - 30), watch, font=ZH_S, fill=DIM)
    # verdict block (big word drawn by app above this label)
    d.text((VX, PY + PH - 26), 'UNANIMOUS', font=EN_S, fill=DIM)
    d.text((VX, PY + 8), '// 出撃承認', font=ZH_S, fill=DIM)

    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, 'cockpit.rgba'), 'wb').write(img.tobytes())
    print('wrote cockpit.rgba', W, 'x', H, '=', len(img.tobytes()), 'bytes (expect', W * H * 4, ')')


build()
