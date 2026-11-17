"""Geometry for the Shadow cluster.

The photo is 1920x640 on a 1920x720 panel. Live widgets end at y=636 so the
bottom 84px stays clear for BMW's warning icons. Art stays on the left; the
instruments use only the dark field on the right.

Static pieces (the fade, the diagonal stripe, segment outlines, icons, km/h)
are baked into the photo. The app draws the speed, the lit segments, the gear
badge and the three small readouts.
"""

PHOTO_W, PHOTO_H = 1920, 640
PANEL_H = 720
CLEAR_Y = PANEL_H - 84  # 636

# (x, y, w, h) of the instrument field. x is past each photo's art.
BLOCKS = {
    'sport': (1224, 8, 672, 616),
    'comfort': (1344, 12, 552, 612),
    'eco': (1512, 12, 384, 612),
}

# Where the photo starts dissolving into black. Left of the block, clear of the face.
FADE = {'sport': 1040, 'comfort': 1160, 'eco': 1340}

ACCENT = {
    'sport': (255, 92, 0),
    'comfort': (240, 112, 0),
    'eco': (255, 106, 0),
}
NAVY = (18, 36, 72)
INK = (255, 255, 255)
MUTED = (255, 255, 255)  # baked at alpha 150, about 60%
SEGMENTS = 16
RED_FROM = 14            # 7000-8000 rpm, the last two thousands
SLANT = 22               # px the top of a segment sits right of its bottom


def _quads(x, y, w, h, slant, gap):
    """Parallelograms, top edge shifted right by `slant`. w is the bottom run."""
    pitch = w / float(SEGMENTS)
    out = []
    for i in range(SEGMENTS):
        x0 = x + i * pitch
        bl, br = x0 + gap * 0.5, x0 + pitch - gap * 0.5
        out.append(((bl + slant, y), (br + slant, y), (br, y + h), (bl, y + h)))
    return out


def layout(mode):
    x, y, w, h = BLOCKS[mode]
    pad = 18 if w > 420 else 12
    ix, iw = x + pad, w - pad - 16
    # A digit is about 0.72 of its height, three of them plus the shear must fit.
    speed_h = int(min(h * 0.46, (iw * 0.90) / (3 * 0.72)))
    speed_h = max(140, speed_h)
    cy = y + 6
    parts = [{
        'id': 'spd', 'type': 'text', 'text': '{{speed}}', 'font': 'e_rpm', 'hero': True,
        'x': ix - x, 'y': cy - y, 'w': iw, 'h': speed_h, 'align': 'left', 'color': 'fg', 'skew': 0.28,
    }]
    kmh = {'text': 'km/h', 'x': ix + int(speed_h * 1.15), 'y': cy + speed_h + 4, 'size': 22, 'color': MUTED, 'alpha': 170}
    cy += speed_h + 36

    seg_h = 36 if w < 420 else 42
    quads = _quads(ix, cy, iw - SLANT, seg_h, SLANT, 5)
    # bounding box includes the slant
    seg = {
        'id': 'segs', 'type': 'segs', 'count': SEGMENTS, 'redFrom': RED_FROM, 'slant': SLANT, 'gap': 5,
        'x': ix - x, 'y': cy - y, 'w': iw, 'h': seg_h,
        'quads': [[[p[0] - ix, p[1] - cy] for p in q] for q in quads],
    }
    parts.append(seg)
    parts.append({
        'id': 'rpm', 'type': 'text', 'text': '{{rpm}}', 'font': 'e_num',
        'x': ix + iw - 150 - x, 'y': cy + seg_h + 4 - y, 'w': 150, 'h': 32,
        'align': 'right', 'color': 'dim',
    })
    cy += seg_h + 40

    badge_h = 92 if w >= 500 else 78
    badge_w = min(210, iw // 2 + 20)
    parts.append({
        'id': 'gear', 'type': 'badge', 'text': '{{gear}}', 'font': 'b_gear',
        'x': ix - x, 'y': cy - y, 'w': badge_w, 'h': badge_h, 'slant': 16,
    })
    cy += badge_h + 28

    # one compact row: range, coolant, time. Time is the widest ("14:32").
    row_h = 40
    icon = 20 if iw < 420 else 24
    if iw < 420:
        slots = [108, 84, iw - 192]
    else:
        slots = [int(iw * 0.30), int(iw * 0.26), 0]
        slots[2] = iw - slots[0] - slots[1]
    acc = 0
    icons = []
    for key, token, font, slot in (
        ('rng', '{{range}}', 'e_num', slots[0]),
        ('wat', '{{coolant}}', 'e_num', slots[1]),
        ('clk', '{{time}}', 'e3_time', slots[2]),
    ):
        sx = ix + acc
        icons.append({'id': key, 'x': sx, 'y': cy + 6, 's': icon})
        parts.append({
            'id': key, 'type': 'text', 'text': token, 'font': font,
            'x': sx + icon + 4 - x, 'y': cy - y, 'w': max(40, slot - icon - 6), 'h': row_h,
            'align': 'left', 'color': 'dim',
        })
        acc += slot
    # keep the row above BMW's icons even on the shortest block
    if cy + row_h > CLEAR_Y:
        raise SystemExit('%s footer runs into BMW\'s row (y %d)' % (mode, cy + row_h))

    rects = []
    for p in parts:
        rects.append((x + p['x'], y + p['y'], p['w'], p['h']))
    for r in rects:
        if r[1] < 0 or r[0] < x or r[0] + r[2] > x + w + 4:
            raise SystemExit('%s part leaves the dark field: %s' % (mode, r))
        if r[1] + r[3] > CLEAR_Y:
            raise SystemExit('%s part reaches BMW\'s row: %s' % (mode, r))

    return {
        'block': (x, y, w, h),
        'fade': FADE[mode],
        'parts': parts,
        'quads': quads,
        'kmh': kmh,
        'icons': icons,
        # a short brush slash at the top of the field, not a full-height wall
        'stripe': {'x': x + 4, 'y': y + 10, 'w': 22, 'h': min(170, speed_h - 20), 'slant': 96},
    }
