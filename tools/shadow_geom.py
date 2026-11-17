"""Shadow's EVA instruments in panel pixels, using unscaled local EVA atlases.

The kombi composites the stock gear indicator above every cluster-render layer
(exclusive and z cannot hide it; confirmed on this car with a full black panel).
Other ID7 themes place that opaque box on the column x=1196..1424, right of
centre. The drive letter occupies that window. The status row under y=640 is
covered with black; the seat-belt lamp is drawn by the kombi after us.
"""
PHOTO_W, PHOTO_H = 1920, 640
PANEL_H, CLEAR_Y, RIGHT = 720, 636, 1896
ART_RIGHT = {'sport': 1172, 'comfort': 1248, 'eco': 1452}
FADE = {'sport': 1060, 'comfort': 1180, 'eco': 1360}
BOTTOM_FADE_Y = 576
ACCENT = {mode: (255, 106, 0) for mode in ART_RIGHT}
NAVY = (20, 40, 75)
SEGMENTS, RED_FROM = 32, 28  # exact 7000..8000 zone: 250 rpm per segment
# Stock gear window: x 1196-1424 is the column other ID7 themes measured for
# the gearbox black box. Vertically it sits right of centre, above the strip.
BMW_GEAR = (1196, 168, 228, 312)  # x, y, w, h; bottom at 480
# Opaque cover for the kombi status row (range, time, temperature). y=640..720.
BOTTOM_STRIP = (0, 640, 1920, 80)
CELLS = {'sq_speed': 179, 'sqs_speed': 119, 'd_label': 29, 'd_unit': 27,
         'd_line': 30, 'd_num42': 73, 'sqs_num64': 52, 'time70': 54}


def _text(pid, text, font, x, y, w, **more):
    p = dict(id=pid, type='text', text=text, font=font, x=x, y=y, w=w,
             h=CELLS[font], align='left', color='fg', textX=2)
    p.update(more)
    if p['align'] == 'right':
        p['textX'] = -2
    return p


def _rule(pid, x, y, w, h=1, color='rule'):
    return dict(id=pid, type='rule', x=x, y=y, w=w, h=h, color=color)


def _brackets(x, y, w, h):
    arm, thick, inset = 18, 3, 5
    p = [_rule('f_t', x + inset, y + inset, w - 2 * inset),
         _rule('f_b', x + inset, y + h - inset - 1, w - 2 * inset),
         _rule('f_l', x + inset, y + inset + 1, 1, h - 2 * inset - 2),
         _rule('f_r', x + w - inset - 1, y + inset + 1, 1, h - 2 * inset - 2)]
    for i, (cx, cy, dx, dy) in enumerate(((x, y, 1, 1), (x + w, y, -1, 1),
                                         (x, y + h, 1, -1), (x + w, y + h, -1, -1))):
        p += [_rule('c%dh' % i, cx if dx > 0 else cx - arm,
                    cy if dy > 0 else cy - thick, arm, thick, 'accent'),
              _rule('c%dv' % i, cx if dx > 0 else cx - thick,
                    cy + thick if dy > 0 else cy - arm, thick, arm - thick, 'accent')]
    return p


def _segments(w, h, n=SEGMENTS):
    pitch, slant = w / n, min(5, w / n / 3)
    return [((i * pitch, h), ((i + 1) * pitch - 3 - slant, h),
             ((i + 1) * pitch - 3, 0), (i * pitch + slant, 0)) for i in range(n)]


def _header(x, width):
    return [_text('system', '{{clusterstatus}}', 'd_line', x, 24, width),
            _rule('head_rule', x, 60, width),
            dict(id='hazard', type='hazard', x=x + width - 120, y=68, w=120, h=8)]


def _footer(x, width, eco):
    """Readings under the bar. Eco has no coolant. Slots stay inside `width`."""
    y = 516
    p = [_rule('foot_rule', x, y, width)]
    if eco:
        p += [
            _text('rng_l', 'RANGE', 'd_label', x, y + 8, 200, color='dim'),
            _text('rng', '{{range}}', 'sqs_num64', x, y + 40, 120),
            _text('rng_u', '{{u:range}}', 'd_unit', x + 126, y + 64, 40, color='dim'),
            _text('clk_l', 'TIME', 'd_label', x + 200, y + 8, width - 200, color='dim'),
            _text('clk', '{{time}}', 'time70', x + 200, y + 40, 182),
        ]
        return p
    # 456px: RANGE, WATER, TIME with the glyphs that actually fit each slot.
    slots = (
        ('rng', 'RANGE', '{{range}}', 'sqs_num64', 0, 140, 96, '{{u:range}}', 34),
        ('wat', 'WATER', '{{coolant}}', 'sqs_num64', 148, 120, 72, '{{u:temp}}', 32),
        ('clk', 'TIME', '{{time}}', 'time70', 272, width - 272, 184, '', 0),
    )
    for key, label, value, font, dx, slot, nw, unit, uw in slots:
        p.append(_text(key + '_l', label, 'd_label', x + dx, y + 8, slot - 4, color='dim'))
        p.append(_text(key, value, font, x + dx, y + 40, nw))
        if unit:
            p.append(_text(key + '_u', unit, 'd_unit', x + dx + nw + 4, y + 66, uw, color='dim'))
    return p


def _overlaps(parts):
    for i, a in enumerate(parts):
        for b in parts[i + 1:]:
            if (a['x'] < b['x'] + b['w'] and b['x'] < a['x'] + a['w'] and
                    a['y'] < b['y'] + b['h'] and b['y'] < a['y'] + a['h']):
                raise SystemExit('parts overlap: %s and %s' % (a['id'], b['id']))


def layout(mode):
    gx, gy, gw, gh = BMW_GEAR
    # Data stays to the right of the stock gear window. Eco also stays off the captain.
    x = 1484 if mode == 'eco' else gx + gw + 16
    width = RIGHT - x
    speed_font = 'sq_speed' if mode == 'sport' else 'sqs_speed'
    pad = 26 if mode == 'sport' else 20
    ink = 348 if mode == 'sport' else 231
    speed_w = ink + 2 * pad
    speed_y = 114
    parts = _header(x, width)
    parts += [
        _text('spd_l', 'SPEED  速度', 'd_label', x, 80, min(180, width)),
        _text('spd', '{{speed}}', speed_font, x, speed_y, speed_w,
              h=CELLS[speed_font] + 2 * pad, textX=pad, offsetY=pad, glow=True),
        _text('spd_u', '{{u:speed}}', 'd_unit', x + pad, speed_y + CELLS[speed_font] + 2 * pad + 4, 80, color='dim'),
    ]
    bar_y, bar_h = 400, 32
    rpm_font = 'd_num42' if mode != 'eco' else 'sqs_num64'
    rpm_w = 200 if mode != 'eco' else 140
    parts += [
        dict(id='segs', type='segs', count=SEGMENTS, redFrom=RED_FROM,
             x=x, y=bar_y, w=width, h=bar_h, quads=_segments(width, bar_h)),
        _text('rpm_l', 'RPM', 'd_label', x, bar_y + bar_h + 8, 68, color='dim'),
        _text('rpm', '{{rpm}}', rpm_font, x + 76, bar_y + bar_h + 4, rpm_w),
    ]
    if mode != 'eco':
        parts.append(_text('rpm_jp', '回転数', 'd_line', x + width - 88, bar_y + bar_h + 8, 88, color='dim'))
    parts += _footer(x, width, mode == 'eco')
    # The drive letter sits in the stock window, not in the data column.
    parts += _brackets(gx, gy, gw, gh)
    parts += [
        _text('gearcap', '{{gearcap}}', 'd_unit', gx + 12, gy + 12, gw - 24, color='dim'),
        _text('gearjp', '{{gearcapjp}}', 'd_label', gx + 12, gy + gh - 36, gw - 24),
    ]
    gear = dict(id='gear', type='evagear', driveLetter=True, fontPrefix='',
                x=gx + 14, y=gy + 48, w=gw - 28, h=gh - 96,
                class_='overlay', z=12)
    gear['class'] = gear.pop('class_')
    _overlaps(parts)
    def in_window(p):
        return p['id'] in ('gear', 'gearcap', 'gearjp') or p['id'].startswith('f_') or (len(p['id']) > 1 and p['id'][0] == 'c' and p['id'][1].isdigit())
    for p in parts + [gear]:
        if not in_window(p) and p['x'] < x:
            raise SystemExit('%s data enters the gear window: %s' % (mode, p['id']))
        if p['x'] < 0 or p['x'] + p['w'] > 1920 or p['y'] < 16 or p['y'] + p['h'] > CLEAR_Y:
            raise SystemExit('%s leaves the panel: %s %s' % (mode, p['id'], (p['x'], p['y'], p['w'], p['h'])))
    if (gear['x'], gear['y'], gear['w'], gear['h']) != (gx + 14, gy + 48, gw - 28, gh - 96):
        raise SystemExit('gear is not the stock window')
    return dict(column=ART_RIGHT[mode], fade=FADE[mode], parts=parts, gear=gear,
                stripe=dict(x=ART_RIGHT[mode] + 6, y=32, w=0, slant=0, h=0),
                speed_font=speed_font, gear_window=BMW_GEAR, bottom_strip=BOTTOM_STRIP)
