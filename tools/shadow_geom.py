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

# Rightmost artwork in the band where the slash sits (y 30-180), measured on the
# 1920x640 crop. The slash must stay to the right of this.
ART_RIGHT = {'sport': 1172, 'comfort': 1248, 'eco': 1452}
FADE = {'sport': 1060, 'comfort': 1180, 'eco': 1360}
# Photo rows from here down fade to pure black; y=636-720 is that same black.
BOTTOM_FADE_Y = 576

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
# The visible digits are HERO_GLYPH tall. The part is taller by the padding.
HERO_GLYPH = 248
HERO_H = HERO_GLYPH + 2 * HERO_PAD
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
    right = 1904
    art = ART_RIGHT[mode]
    # Slash sits entirely to the right of the artwork and entirely to the left of the speed quad.
    slash_w, slash_slant, slash_h = (16, 52, 112) if mode == 'sport' else (14, 28, 100) if mode == 'comfort' else (8, 4, 72)
    slash_right = art + 8 + slash_w + slash_slant
    ix = slash_right + HERO_PAD + 6
    iw = right - ix
    top = 28

    speed = {
        'id': 'spd', 'type': 'text', 'text': '{{speed}}', 'font': 'e_rpm', 'hero': True,
        'x': ix - HERO_PAD, 'y': top, 'w': min(iw + HERO_PAD - 8, 760), 'h': HERO_H,
        'align': 'left', 'color': 'fg', 'pad': HERO_PAD,
    }
    # Beside the baseline of the digits, not a line of its own underneath.
    kmh = {
        'text': 'km/h',
        'x': ix + (356 if mode == 'eco' else 512),
        'y': top + HERO_PAD + HERO_GLYPH - 4,
        'size': 16 if mode == 'eco' else 18, 'color': MUTED, 'alpha': 165, 'anchor': 'ls',
    }

    bar_y = top + HERO_H + 18
    bar_h = 36
    quads = _quads(ix, bar_y, iw - SLANT, bar_h, SLANT, 4)
    segs = {
        'id': 'segs', 'type': 'segs', 'count': SEGMENTS, 'redFrom': RED_FROM,
        'x': ix, 'y': bar_y, 'w': iw, 'h': bar_h,
        'quads': [[[p[0] - ix, p[1] - bar_y] for p in q] for q in quads],
    }

    badge_y = bar_y + bar_h + 22
    badge_h = 88
    badge_w = 176 if mode != 'eco' else 150
    badge = {
        'id': 'gear', 'type': 'badge', 'text': '{{gear}}', 'font': 'b_gear',
        'x': ix, 'y': badge_y, 'w': badge_w, 'h': badge_h, 'slant': 18,
    }
    rpm_w = 86
    rpm = {
        'id': 'rpm', 'type': 'text', 'text': '{{rpm}}', 'font': 'e_num',
        'x': ix + iw - rpm_w, 'y': badge_y + (badge_h - ICON) // 2, 'w': rpm_w, 'h': ICON,
        'align': 'right', 'color': 'dim',
    }
    rpm_label = {
        'text': 'rpm',
        'x': rpm['x'] + rpm_w - 78,
        'y': rpm['y'] + ICON - 4,
        'size': 18, 'color': MUTED, 'alpha': 160, 'anchor': 'rs',
    }

    # Just above the fade to black, so the gap under the badge stays modest.
    row_y = BOTTOM_FADE_Y - ICON - 16
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
    # Bottom-left of the slash is just past the artwork; the top leans toward the digits.
    stripe = {
        'x': art + 10,
        'y': top + HERO_PAD,
        'w': slash_w,
        'h': slash_h,
        'slant': slash_slant,
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
        'column': art,
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
