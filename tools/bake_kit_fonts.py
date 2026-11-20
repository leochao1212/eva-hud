"""Bake the kit's canvas fonts (kit/runtime/fonts/*.json) from EVA's own type, for the centre-screen page.

The kit draws text from pre-baked glyph atlases (kit/runtime/fonts.js): families label, bold, light and num for
Latin, and cjk for any text with CJK in it (fonts.get switches to it by itself). This repository ships no fonts
(.gitignore, README "字体"), so they are baked here from tools/fonts-src and stay local; a build packs them.

  label, light  Barlow Condensed SemiBold       bold, num  Barlow Condensed Bold      (SIL OFL)
  cjk           Matisse (Shippori Mincho B1 EB), only the characters the page and the translated settings use

Format (as bimmer-lab's kit): { family, source, sizes: [{ size, ascent, descent, atlasW, atlasH, alpha (base64 of
the deflated 8-bit atlas), glyphs: { codepoint: [x, y, w, h, ox, oy, advance] } }] }, oy from the baseline (negative up).

  python -X utf8 tools/bake_kit_fonts.py
"""
import base64
import json
import os
import re
import zlib

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'fonts-src')
OUT = os.path.join(ROOT, 'kit', 'runtime', 'fonts')
ATLAS_W = 1024
PAD = 2
LATIN = ''.join(chr(c) for c in range(32, 127)) + '°·×–—…•→←↑↓±²³µ%'

FAMILIES = [
    ('label', 'BarlowCondensed-SemiBold.ttf', [18, 24, 32, 44], 'latin'),
    ('light', 'BarlowCondensed-SemiBold.ttf', [32, 64], 'latin'),
    ('bold', 'BarlowCondensed-Bold.ttf', [24, 32, 44, 64], 'latin'),
    ('num', 'BarlowCondensed-Bold.ttf', [40, 64, 96, 150], 'latin'),
    ('cjk', 'MatisseSub-ShipporiMinchoB1-EB.ttf', [28, 56], 'cjk'),
]


def cjk_chars():
    """Every CJK character the page draws (shared/eva_page.js, MAGI's words in eva_magi.js) and the translations of EVA's settings."""
    text = ''.join(open(os.path.join(ROOT, 'shared', f), encoding='utf8').read() for f in ('eva_page.js', 'eva_magi.js'))
    zh = json.load(open(os.path.join(ROOT, 'kit', 'runtime', 'locales', 'zh-TW.json'), encoding='utf8'))
    app = json.load(open(os.path.join(ROOT, 'apps', 'eva_hud', 'app.json'), encoding='utf8'))
    for s in app.get('settings', []):
        for t in [s.get('label', '')] + [o[1] for o in s.get('options', [])]:
            text += t + zh.get(t, '')
    keep = set(c for c in text if re.match(r'[⺀-鿿　-〿＀-￯]', c))
    return ''.join(sorted(keep)) + LATIN


def bake_size(font_file, size, chars):
    font = ImageFont.truetype(os.path.join(SRC, font_file), size)
    ascent, descent = font.getmetrics()
    cells = []
    for ch in chars:
        l, t, r, b = font.getbbox(ch, anchor='ls')
        adv = round(font.getlength(ch), 2)
        if r <= l or b <= t:
            cells.append((ch, None, 0, 0, adv))
            continue
        w, h = r - l + 2 * PAD, b - t + 2 * PAD
        im = Image.new('L', (w, h), 0)
        ImageDraw.Draw(im).text((PAD - l, PAD - t), ch, font=font, fill=255, anchor='ls')
        cells.append((ch, im, l - PAD, t - PAD, adv))
    x = y = row_h = 0
    placed = {}
    for ch, im, *_ in cells:
        if im is None:
            continue
        if x + im.width > ATLAS_W:
            x, y, row_h = 0, y + row_h, 0
        placed[ch] = (x, y)
        x += im.width
        row_h = max(row_h, im.height)
    atlas = Image.new('L', (ATLAS_W, max(1, y + row_h)), 0)
    glyphs = {}
    for ch, im, ox, oy, adv in cells:
        if im is None:
            glyphs[str(ord(ch))] = [0, 0, 0, 0, 0, 0, adv]
            continue
        gx, gy = placed[ch]
        atlas.paste(im, (gx, gy))
        glyphs[str(ord(ch))] = [gx, gy, im.width, im.height, ox, oy, adv]
    return {'size': size, 'ascent': ascent, 'descent': descent, 'atlasW': ATLAS_W, 'atlasH': atlas.height,
            'alpha': base64.b64encode(zlib.compress(atlas.tobytes(), 9)).decode('ascii'), 'glyphs': glyphs}


def main():
    os.makedirs(OUT, exist_ok=True)
    cjk = cjk_chars()
    for name, font_file, sizes, set_ in FAMILIES:
        chars = LATIN if set_ == 'latin' else cjk
        doc = {'family': name, 'source': font_file, 'sizes': [bake_size(font_file, s, chars) for s in sizes]}
        if set_ == 'cjk':
            doc['cacheKey'] = '%08x' % zlib.crc32(chars.encode('utf8'))
        with open(os.path.join(OUT, name + '.json'), 'w', encoding='utf8') as f:
            json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
        print('%-6s %-36s sizes %s  %d glyphs  atlas h %s' % (name, font_file, sizes, len(chars), [s['atlasH'] for s in doc['sizes']]))


if __name__ == '__main__':
    main()
