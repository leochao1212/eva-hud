"""Geometry for the Shadow cluster.

Photo is 1920x640. Live widgets end at y=636 (bottom 84px is BMW's row).
The photo holds the fade to black and the slanted accent. The app draws the
column in EVA's own type: a label, the speed atlas, the unit, a segmented
rev bar, the rpm figure, a bracketed gear, and the small readouts.

Every atlas is drawn at its own cell size. The speed box is padded so the
glow dies inside the quad.
"""

PHOTO_W, PHOTO_H = 1920, 640
PANEL_H = 720
CLEAR_Y = PANEL_H - 84  # 636
RIGHT = 1896

# Rightmost artwork in the band where the slash sits (y 30-180).
ART_RIGHT = {'sport': 1172, 'comfort': 1248, 'eco': 1452}
FADE = {'sport': 1060, 'comfort': 1180, 'eco': 1360}
BOTTOM_FADE_Y = 576

ACCENT = {
    'sport': (255, 106, 0),
    'comfort': (255, 106, 0),
    'eco': (255, 106, 0),
}
NAVY = (20, 40, 75)

SEGMENTS = 28
RED_FROM = 24          # 7000-8000 of an 8000 rpm bar

# Measured from the EVA atlases. cell is the glyph height; ink is the advance of "118".
SPEED = {
    'sq_speed': {'cell': 179, 'size': 240, 'ink': 348},
    'sqs_speed': {'cell': 119, 'size': 160, 'ink': 231},
}
LABEL_H = 29           # d_label
UNIT_H = 27            # d_unit
RPM_CELL = {'d_num42': 73, 'sqs_num64': 52}
NUM_CELL = 52          # sqs_num64
TIME_CELL = 54         # time70
GEAR_CELL = 181        # sq_gear
GEAR_W = 216           # one digit plus the glow margin; a P/R word still fits


def _pad(size):
    # two passes of the text blur (radius = size/24) plus a few pixels
    return max(2, int(round(size / 24.0))) * 2 + 6


def _rects(w, h, n, gap):
    slot = (w + gap) / float(n)
    out = []
    for i in range(n):
        x0 = i * slot
        x1 = x0 + slot - gap
        out.append(((x0, 0), (x1, 0), (x1, h), (x0, h)))
    return out


def _text(pid, text, font, x, y, w, h, **more):
    one = {
        'id': pid, 'type': 'text', 'text': text, 'font': font,
        'x': x, 'y': y, 'w': w, 'h': h, 'align': 'left', 'color': 'fg',
    }
    one.update(more)
    return one


def _rule(pid, x, y, w, h, color):
    return {'id': pid, 'type': 'rule', 'x': x, 'y': y, 'w': w, 'h': h, 'color': color}


def _brackets(x, y, w, h):
    """EVA's gear frame: a hairline and heavy corners. The hairline is inset so it misses the corners."""
    arm, thick, inset = 28, 3, 7
    parts = [
        _rule('f_t', x + inset, y + inset, w - 2 * inset, 1, 'rule'),
        _rule('f_b', x + inset, y + h - inset - 1, w - 2 * inset, 1, 'rule'),
        _rule('f_l', x + inset, y + inset + 1, 1, h - 2 * inset - 2, 'rule'),
        _rule('f_r', x + w - inset - 1, y + inset + 1, 1, h - 2 * inset - 2, 'rule'),
    ]
    corners = (
        (x, y, 1, 1),
        (x + w, y, -1, 1),
        (x, y + h, 1, -1),
        (x + w, y + h, -1, -1),
    )
    for i, (cx, cy, dx, dy) in enumerate(corners):
        hx = cx if dx > 0 else cx - arm
        hy = cy if dy > 0 else cy - thick
        vy = cy if dy > 0 else cy - arm
        vx = cx if dx > 0 else cx - thick
        parts.append(_rule('c%dh' % i, hx, hy, arm, thick, 'accent'))
        parts.append(_rule('c%dv' % i, vx, vy + (thick if dy > 0 else 0), thick, arm - thick, 'accent'))
    return parts


def _footer(mode, x, y, width):
    """RANGE, WATER, TIME on one baseline. Eco drops coolant."""
    row = TIME_CELL
    groups = [('rng', 'RANGE', 86, '{{range}}', 'sqs_num64', 98, '{{u:range}}', 28)]
    if mode != 'eco':
        groups.append(('wat', 'WATER', 92, '{{coolant}}', 'sqs_num64', 66, '{{u:temp}}', 24))
    groups.append(('clk', '', 0, '{{time}}', 'time70', 182, '', 0))
    gap, join = 8, 4
    need = 0
    for _, _, lw, _, _, nw, _, uw in groups:
        need += (lw + join if lw else 0) + nw + (join + uw if uw else 0)
    need += gap * (len(groups) - 1)
    if need > width:
        raise SystemExit('%s footer needs %d, has %d' % (mode, need, width))
    parts = []
    cursor = x
    for key, label, lw, value, font, nw, unit, uw in groups:
        base = y + row
        cell = TIME_CELL if font == 'time70' else NUM_CELL
        if label:
            parts.append(_text(key + '_l', label, 'd_label', cursor, base - LABEL_H, lw, LABEL_H, color='dim'))
            cursor += lw + join
        parts.append(_text(key, value, font, cursor, base - cell, nw, cell, color='fg'))
        cursor += nw
        if unit:
            cursor += join
            parts.append(_text(key + '_u', unit, 'd_unit', cursor, base - UNIT_H, uw, UNIT_H, color='dim'))
            cursor += uw
        cursor += gap
    return parts


def _overlaps(parts):
    for i, a in enumerate(parts):
        for b in parts[i + 1:]:
            if a['x'] + a['w'] <= b['x'] or b['x'] + b['w'] <= a['x']:
                continue
            if a['y'] + a['h'] <= b['y'] or b['y'] + b['h'] <= a['y']:
                continue
            raise SystemExit('parts overlap: %s and %s' % (a['id'], b['id']))


def layout(mode):
    art = ART_RIGHT[mode]
    # The slash stays in the dark, immediately left of the column.
    if mode == 'eco':
        slash = (10, 6, 88)
    elif mode == 'comfort':
        slash = (12, 8, 100)
    else:
        slash = (16, 36, 120)
    slash_x = art + 6
    slash_right = slash_x + slash[0] + slash[1]
    ix = slash_right + 8
    top = 24 if mode == 'eco' else 32
    wide = mode != 'eco'
    # sq_speed (cell 179) fits beside the gear on Sport. Comfort's artwork
    # leaves a narrower field, so it uses the sport-square speed (cell 119).
    speed_font = 'sq_speed' if mode == 'sport' else 'sqs_speed'
    spec = SPEED[speed_font]
    pad = _pad(spec['size'])
    # Eco shows two digits beside the unit; the box is the two-digit ink plus the glow pad.
    ink = 154 if mode == 'eco' else spec['ink']
    speed_w = pad + ink + pad
    speed_h = pad + spec['cell'] + pad

    if wide and ix + speed_w + 12 + (GEAR_W + 16) > RIGHT:
        raise SystemExit('%s column is short by %d' % (mode, ix + speed_w + 12 + GEAR_W + 16 - RIGHT))
    if not wide and ix + max(speed_w, GEAR_W + 16) > RIGHT:
        raise SystemExit('%s stacked column does not fit' % (mode, ))

    parts = []
    parts.append(_text('spd_l', 'SPEED  速度', 'd_label', ix, top, 160, LABEL_H, color='dim'))
    speed_y = top + LABEL_H + 6
    parts.append(_text(
        'spd', '{{speed}}', speed_font, ix, speed_y, speed_w, speed_h,
        align='left', color='fg', glow=True, textX=pad, offsetY=pad,
    ))

    gear_h = GEAR_CELL + 52
    if wide:
        gap = 16
        frame_x = ix + speed_w + gap
        frame_w = 1910 - frame_x
        frame_y = speed_y
        frame_h = max(speed_h, gear_h + 16)
        gw = min(GEAR_W + 40, frame_w - 16)
        gear = {
            'id': 'gear', 'type': 'evagear', 'fontPrefix': 'sq_', 'words': True, 'wordPitch': 96,
            'x': frame_x + (frame_w - gw) // 2, 'y': frame_y + (frame_h - gear_h) // 2,
            'w': gw, 'h': gear_h,
            'class': 'overlay', 'z': 12,
        }
        parts += _brackets(frame_x, frame_y, frame_w, frame_h)
        parts.append(_text(
            'gearcap', '{{gearcap}}', 'd_unit', frame_x, top, min(frame_w, 200), UNIT_H,
            color='dim',
        ))
        # Centered under the digits, the way the EVA dash puts the unit under the speed.
        unit_x = ix + pad + spec['ink'] // 2 - 36
        unit_y = speed_y + speed_h + 4
        parts.append(_text('spd_u', '{{u:speed}}', 'd_unit', unit_x, unit_y, 80, UNIT_H, color='dim'))
        bar_y = max(frame_y + frame_h, unit_y + UNIT_H) + 12
    else:
        unit_x = ix + speed_w + 8
        unit_y = speed_y + pad + spec['cell'] - UNIT_H
        parts.append(_text('spd_u', '{{u:speed}}', 'd_unit', unit_x, unit_y, 64, UNIT_H, color='dim'))
        # The rev bar and the rpm figure share a row; the gear sits under them.
        bar_y = speed_y + speed_h + 8
        frame_x = ix
        frame_w = GEAR_W + 16
        gear_h = GEAR_CELL + 40
        frame_h = gear_h + 16
        gear = {
            'id': 'gear', 'type': 'evagear', 'fontPrefix': 'sq_', 'words': True, 'wordPitch': 96,
            'x': frame_x + 8, 'y': 0, 'w': GEAR_W, 'h': gear_h,
            'class': 'overlay', 'z': 12,
        }

    bar_h = 22
    rpm_font = 'd_num42' if wide else 'sqs_num64'
    rpm_cell = RPM_CELL[rpm_font]
    if wide:
        bar_w = RIGHT - ix
        rpm_x, rpm_y, rpm_w = ix + 78, bar_y + bar_h + 10, 200
        parts.append(_text('rpm_l', 'RPM', 'd_label', ix, rpm_y + rpm_cell - LABEL_H, 70, LABEL_H, color='dim'))
    else:
        # number at the right of the bar, on the same row, so the gear can sit higher
        rpm_w, label_w = 130, 54
        bar_w = RIGHT - ix - label_w - rpm_w - 16
        label_x = ix + bar_w + 8
        rpm_x = label_x + label_w + 4
        rpm_y = bar_y
        parts.append(_text('rpm_l', 'RPM', 'd_label', label_x, rpm_y + rpm_cell - LABEL_H, label_w, LABEL_H, color='dim'))
    parts.append({
        'id': 'segs', 'type': 'segs', 'count': SEGMENTS, 'redFrom': RED_FROM,
        'x': ix, 'y': bar_y if wide else rpm_y + rpm_cell - bar_h, 'w': bar_w, 'h': bar_h,
        'quads': _rects(bar_w, bar_h, SEGMENTS, 3),
    })
    parts.append(_text('rpm', '{{rpm}}', rpm_font, rpm_x, rpm_y, rpm_w, rpm_cell, color='fg'))

    if wide:
        foot_y = rpm_y + rpm_cell + 18
        parts += _footer(mode, ix, foot_y, RIGHT - ix)
    else:
        gear['y'] = rpm_y + rpm_cell + 8
        parts += _brackets(frame_x, gear['y'] - 8, frame_w, frame_h)
        foot_y = gear['y'] - 8 + frame_h + 6
        parts += _footer(mode, ix, foot_y, RIGHT - ix)

    _overlaps(parts)
    for p in parts:
        if p['x'] < ix - 1 or p['x'] + p['w'] > 1912:
            raise SystemExit('%s part leaves the column: %s x %d w %d' % (mode, p['id'], p['x'], p['w']))
        if p['y'] < 20 or p['y'] + p['h'] > CLEAR_Y:
            raise SystemExit('%s part hits the BMW row: %s y %d' % (mode, p['id'], p['y']))
    if gear['x'] < ix or gear['y'] + gear['h'] > CLEAR_Y:
        raise SystemExit('%s gear leaves the column' % mode)

    return {
        'column': art,
        'fade': FADE[mode],
        'parts': parts,
        'gear': gear,
        'stripe': {'x': slash_x, 'y': top + 8, 'w': slash[0], 'h': slash[2], 'slant': slash[1]},
        'speed_font': speed_font,
    }
