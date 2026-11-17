"""Geometry for the Shadow cluster.

Photo is 1920x640. Live widgets end at y=636 (bottom 84px is BMW's row).
The fade, slash, segment outlines, icons, km/h and the rpm label are baked.
The app draws the speed, lit segments, gear badge and the readout numbers.

The speed part is padded so its glow dies inside the quad, and the slash sits
entirely to the left of that quad.
"""

PHOTO_W, PHOTO_H = 1920, 640
PANEL_H = 720
CLEAR_Y = PANEL_H - 84  # 636

# Left edge of each instrument column, past the art. Eco keeps the full picture:
# shifting it far enough for a 600px column cuts the captain.
COLUMNS = {'sport': 1216, 'comfort': 1336, 'eco': 1488}
FADE = {'sport': 1060, 'comfort': 1180, 'eco': 1360}

ACCENT = {
    'sport': (255, 92, 0),
    'comfort': (240, 112, 0),
    'eco': (255, 106, 0),
}
NAVY = (18, 36, 72)
MUTED = (255, 255, 255)

SEGMENTS = 16
RED_FROM = 14
SLANT = 18
HERO_PAD = 32          # glow must reach 0 inside this inset
HERO_H = 220           # part height; preview glyph cell fits in HERO_H - 2*HERO_PAD
ICON = 32              # matches the footer number cap-height
ICON_GAP = 12
ITEM_GAP = 48


def _quads(x, y, w, h, slant, gap):
    pitch = w / float(SEGMENTS)
    out = []
    for i in range(SEGMENTS):
        x0 = x + i * pitch
        bl, br = x0 + gap * 0.5, x0 + pitch - gap * 0.5
        out.append(((bl + slant, y), (br + slant, y), (br, y + h), (bl, y + h)))
    return out


def layout(mode):
    col = COLUMNS[mode]
    right = 1904
    width = right - col
    # content column, one left edge for the bar, the badge and the footer
    # ix is the left edge of the ink. The speed quad starts HERO_PAD to the left,
    # and that strip stays transparent so it cannot cover the slash.
    ix = col + 20
    iw = right - ix
    top = 40

    speed = {
        'id': 'spd', 'type': 'text', 'text': '{{speed}}', 'font': 'e_rpm', 'hero': True,
        'x': ix - HERO_PAD, 'y': top, 'w': min(iw + HERO_PAD, 700), 'h': HERO_H,
        'align': 'left', 'color': 'fg', 'pad': HERO_PAD,
    }
    kmh_y = speed['y'] + speed['h'] + 10
    kmh = {'text': 'km/h', 'x': ix, 'y': kmh_y, 'size': 20, 'color': MUTED, 'alpha': 160}

    bar_y = kmh_y + 36
    bar_h = 34
    quads = _quads(ix, bar_y, iw - SLANT, bar_h, SLANT, 4)
    segs = {
        'id': 'segs', 'type': 'segs', 'count': SEGMENTS, 'redFrom': RED_FROM,
        'x': ix, 'y': bar_y, 'w': iw, 'h': bar_h,
        'quads': [[[p[0] - ix, p[1] - bar_y] for p in q] for q in quads],
    }

    # badge on the left, rpm number right-aligned to the bar, same row
    badge_y = bar_y + bar_h + 28
    badge_h = 96
    badge_w = 168 if mode != 'eco' else 148
    badge = {
        'id': 'gear', 'type': 'badge', 'text': '{{gear}}', 'font': 'b_gear',
        'x': ix, 'y': badge_y, 'w': badge_w, 'h': badge_h, 'slant': 18,
    }
    rpm_w = 168
    rpm = {
        'id': 'rpm', 'type': 'text', 'text': '{{rpm}}', 'font': 'e_num',
        'x': ix + iw - rpm_w, 'y': badge_y + 8, 'w': rpm_w, 'h': ICON,
        'align': 'right', 'color': 'dim',
    }
    rpm_label = {
        'text': 'rpm', 'x': rpm['x'] - 8, 'y': badge_y + 14, 'size': 18,
        'color': MUTED, 'alpha': 150, 'anchor': 'rt',
    }

    # footer pinned near the bottom so the column uses the height
    row_y = 574
    row_h = ICON
    # text widths sized for the footer atlas (about 0.62 em per digit)
    texts = [('rng', '{{range}}', 'e_num', 92), ('wat', '{{coolant}}', 'e_num', 72), ('clk', '{{time}}', 'e3_time', 132)]
    if mode == 'eco':
        texts = [('rng', '{{range}}', 'e_num', 96), ('clk', '{{time}}', 'e3_time', 140)]
    gap = ITEM_GAP if mode != 'eco' else 36
    icons, parts_footer = [], []
    cursor = ix
    for key, token, font, tw in texts:
        icons.append({'id': key, 'x': cursor, 'y': row_y + 2, 's': ICON})
        parts_footer.append({
            'id': key, 'type': 'text', 'text': token, 'font': font,
            'x': cursor + ICON + ICON_GAP, 'y': row_y, 'w': tw, 'h': row_h,
            'align': 'left', 'color': 'dim',
        })
        cursor += ICON + ICON_GAP + tw + gap
    if cursor - gap > right:
        raise SystemExit('%s footer runs past the screen (%d)' % (mode, cursor))

    parts = [speed, segs, badge, rpm] + parts_footer
    # slash: its rightmost point stays left of the speed quad
    slash_top_right = ix - 18
    stripe = {
        'x': slash_top_right - 110,
        'y': top + 6,
        'w': 16,
        'h': 132,
        'slant': 78,
    }

    for p in parts:
        left_limit = ix - HERO_PAD - 1 if p['id'] == 'spd' else ix - 1
        if p['x'] < left_limit or p['x'] + p['w'] > right + 1:
            raise SystemExit('%s part leaves the column: %s' % (mode, p['id']))
        if p['y'] < 24 or p['y'] + p['h'] > CLEAR_Y:
            raise SystemExit('%s part hits the BMW row: %s y %d' % (mode, p['id'], p['y']))
    # speed quad must not cover the slash
    slash_right = stripe['x'] + stripe['w'] + stripe['slant']
    ink_left = speed['x'] + speed['pad']
    if slash_right > ink_left - 6:
        raise SystemExit('%s slash meets the digits (%d >= %d)' % (mode, slash_right, ink_left))

    return {
        'column': col,
        'fade': FADE[mode],
        'parts': parts,
        'quads': quads,
        'kmh': kmh,
        'rpm_label': rpm_label,
        'icons': icons,
        'stripe': stripe,
        'canvas': (min(p['x'] for p in parts), top - 4,
                   right - min(p['x'] for p in parts), CLEAR_Y - (top - 4)),
    }
