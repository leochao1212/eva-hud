"""Geometry shared by the Shadow photo baker and the layout generator.

The cluster panel is 1920x720. The photo fills 1920x640 and stops there, so the
bottom 84px (y >= 636) stays clear for BMW's warning icons. Each drive mode's
art and slogan occupy the left; the instruments sit in the empty dark area on
the right, and the three blocks start at different x because the art does.
"""

PHOTO_W, PHOTO_H = 1920, 640
PANEL_H = 720
CLEAR_Y = PANEL_H - 84  # 636: live widgets end here

# (x, y, w, h) of the instrument block, measured off the cropped 1920x640 art
BLOCKS = {
    'sport': (1224, 16, 660, 600),
    'comfort': (1344, 20, 540, 596),
    'eco': (1512, 20, 372, 596),
}

# Accent sampled from each photo. Comfort also carries a navy rule.
ACCENT = {
    'sport': (255, 92, 0),
    'comfort': (240, 112, 0),
    'eco': (255, 106, 0),
}
NAVY = (22, 42, 78)
INK = (236, 240, 244)
DIM = (186, 196, 208)


def layout(mode):
    """Absolute rectangles for one mode. Text parts are also returned relative to the block,
    which is the evacanvas. Every live rect ends at or above CLEAR_Y."""
    x, y, w, h = BLOCKS[mode]
    pad = 16 if w < 420 else 20
    ix, iw = x + pad, w - 2 * pad
    cy = y

    def bake(text, bx, by, size, color):
        return {'text': text, 'x': bx, 'y': by, 'size': size, 'color': color}

    def live(i, text, font, lx, ly, lw, lh, color='fg', align='left'):
        return {'id': i, 'type': 'text', 'text': text, 'font': font,
                'x': lx - x, 'y': ly - y, 'w': lw, 'h': lh, 'align': align, 'color': color, 'glow': color == 'fg'}

    captions = [bake('SPEED', ix, cy + 2, 18, ACCENT[mode])]
    cy += 24
    speed_h = 118
    speed_w = min(iw - 100, 250)
    parts = [live('spd', '{{speed}}', 'e_rpm', ix, cy, speed_w, speed_h, 'fg', 'left')]
    bakes = [bake('km/h', ix + speed_w + 10, cy + 68, 26, INK)]
    cy += speed_h + 14

    captions.append(bake('RPM', ix, cy + 6, 16, ACCENT[mode]))
    parts.append(live('rpm', '{{rpm}}', 'e_num', ix + iw - 168, cy, 168, 40, 'fg', 'right'))
    cy += 42
    bar = {'x': ix, 'y': cy, 'w': iw, 'h': 70, 'top': 8, 'barH': 30, 'slant': 0, 'over': 1000}
    cy += bar['h'] + 2
    slot = iw / 9.0
    for n in range(9):
        parts.append(live('s%d' % n, str(n), 'e_num', int(ix + n * slot), cy, int(slot), 26,
                          'hot' if n >= 7 else 'dim', 'center'))
    cy += 32

    col = iw // 2
    captions.append(bake('GEAR', ix, cy, 15, DIM))
    captions.append(bake('RANGE', ix + col, cy, 15, DIM))
    cy += 20
    parts.append(live('gear', '{{gear}}', 'b_gear', ix, cy, col - 8, 76, 'fg', 'left'))
    parts.append(live('rng', '{{range}}', 'e_num', ix + col, cy + 16, col - 48, 52, 'fg', 'left'))
    bakes.append(bake('km', ix + iw - 40, cy + 32, 18, INK))
    cy += 82

    captions.append(bake('TEMP', ix, cy, 15, DIM))
    captions.append(bake('TIME', ix + col, cy, 15, DIM))
    cy += 20
    parts.append(live('wat', '{{coolant}}', 'e_num', ix, cy, col - 52, 52, 'fg', 'left'))
    bakes.append(bake('°C', ix + col - 48, cy + 16, 18, INK))
    parts.append(live('clk', '{{time}}', 'e3_time', ix + col, cy, col - 4, 52, 'fg', 'left'))

    rects = [(x, y, w, h), (bar['x'], bar['y'], bar['w'], bar['h'])]
    for p in parts:
        rects.append((x + p['x'], y + p['y'], p['w'], p['h']))
    for r in rects:
        if r[1] + r[3] > CLEAR_Y:
            raise SystemExit('%s instrument runs into BMW\'s row: %s' % (mode, r))
        if r[0] < x or r[0] + r[2] > x + w:
            raise SystemExit('%s instrument leaves its block: %s' % (mode, r))

    return {'block': (x, y, w, h), 'parts': parts, 'bar': bar, 'bakes': bakes + captions}
