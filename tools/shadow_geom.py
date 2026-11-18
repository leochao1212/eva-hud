"""Shadow's EVA instruments in panel pixels, using unscaled local EVA atlases.

References: eva_layout.build_sq_sport's bilingual frame, build_square's speed,
and shaders.EVAHAZARD's 36px pitch. Photos/fades stay unchanged; all decoration
is on the transparent canvas in the dark field, above BMW's y=636 warning row.
"""
PHOTO_W, PHOTO_H = 1920, 640
PANEL_H, CLEAR_Y, RIGHT = 720, 636, 1896
# BMW draws a black box over the theme when anything covers the gear letter in
# its own bottom strip. Cluster Themes leaves x=1380..1460, y=660..720 open
# (bimmer-lab/apps apps/cluster_themes/hud/layouts/minimal.json) and covers the
# rest of that band. The letter itself stays BMW's.
GEAR_LETTER = (1380, 660, 80, 60)
ART_RIGHT = {'sport': 1172, 'comfort': 1248, 'eco': 1240}
FADE = {'sport': 1060, 'comfort': 1180, 'eco': 1190}
# Eco's slogan ran to x=1452 at full width and left a 412px column. Its photo is
# scaled to the panel height instead (1707x640) and moved 40px left, so the
# slogan ends near x=1240 and Eco gets Comfort's 612px column.
PHOTO_FIT = {'eco': ('height', 40)}
BOTTOM_FADE_Y = 576
ACCENT = {mode: (255, 106, 0) for mode in ART_RIGHT}
NAVY = (20, 40, 75)
SEGMENTS, RED_FROM = 32, 28  # exact 7000..8000 zone: 250 rpm per segment
ORIGIN = {'sport': 1238, 'comfort': 1284, 'eco': 1284}
CELLS = {'sq_speed': 179, 'sqs_speed': 119, 'd_label': 29, 'd_unit': 27,
         'd_line': 30, 'd_num42': 73, 'sqs_num64': 52, 'time70': 54}


def _text(pid, text, font, x, y, w, **more):
    p = dict(id=pid, type='text', text=text, font=font, x=x, y=y, w=w,
             h=CELLS[font], align='left', color='fg', textX=2)
    p.update(more)
    if p['align']=='right':
        p['textX'] = -2
    return p


def _rule(pid, x, y, w, h=1, color='rule'):
    return dict(id=pid, type='rule', x=x, y=y, w=w, h=h, color=color)


def _brackets(x, y, w, h):
    arm, thick, inset = 22, 3, 6
    p = [_rule('f_t', x+inset, y+inset, w-2*inset),
         _rule('f_b', x+inset, y+h-inset-1, w-2*inset),
         _rule('f_l', x+inset, y+inset+1, 1, h-2*inset-2),
         _rule('f_r', x+w-inset-1, y+inset+1, 1, h-2*inset-2)]
    for i, (cx, cy, dx, dy) in enumerate(((x,y,1,1), (x+w,y,-1,1),
                                         (x,y+h,1,-1), (x+w,y+h,-1,-1))):
        p += [_rule('c%dh'%i, cx if dx>0 else cx-arm,
                    cy if dy>0 else cy-thick, arm, thick, 'accent'),
              _rule('c%dv'%i, cx if dx>0 else cx-thick,
                    cy+thick if dy>0 else cy-arm, thick, arm-thick, 'accent')]
    return p


def _segments(w, h, n=SEGMENTS):
    pitch, slant = w/n, min(5, w/n/3)
    return [((i*pitch,h), ((i+1)*pitch-3-slant,h),
             ((i+1)*pitch-3,0), (i*pitch+slant,0)) for i in range(n)]


def _header(x, width):
    return [_text('system', '{{clusterstatus}}', 'd_line', x, 24, width),
            _rule('head_rule', x, 64, width-154),
            dict(id='hazard', type='hazard', x=x+width-144, y=60, w=144, h=8)]


def _footer(x, width):
    # Labels above values leave the full width for each reading and its unit.
    third = width//3
    p = [_rule('foot_rule', x, 528, width)]
    for key, label, value, font, dx, nw, unit, uw in (
        ('rng','RANGE','{{range}}','sqs_num64',0,126,'{{u:range}}',34),
        ('wat','WATER  水温','{{coolant}}','sqs_num64',third,100,'{{u:temp}}',34),
        ('clk','TIME','{{time}}','time70',2*third,182,'',0),
    ):
        p.append(_text(key+'_l', label, 'd_label', x+dx, 540, third-12, color='dim'))
        p.append(_text(key, value, font, x+dx, 578, nw))
        if unit:
            p.append(_text(key+'_u',unit,'d_unit',x+dx+nw+6,603,uw,color='dim'))
    return p


def _overlaps(parts):
    for i,a in enumerate(parts):
        for b in parts[i+1:]:
            if (a['x'] < b['x']+b['w'] and b['x'] < a['x']+a['w'] and
                    a['y'] < b['y']+b['h'] and b['y'] < a['y']+a['h']):
                raise SystemExit('parts overlap: %s and %s' % (a['id'],b['id']))


def layout(mode):
    x, width = ORIGIN[mode], RIGHT-ORIGIN[mode]
    speed_font = 'sq_speed' if mode=='sport' else 'sqs_speed'
    pad = 26 if mode=='sport' else 20
    speed_w = (348 if mode=='sport' else 231)+2*pad
    speed_y = 108
    parts = _header(x,width)
    parts += [_text('spd_l','SPEED  速度','d_label',x,76,180),
              _text('spd','{{speed}}',speed_font,x,speed_y,speed_w,
                    h=CELLS[speed_font]+2*pad,textX=pad,offsetY=pad,glow=True)]
    fx = x+424 if mode=='sport' else x+328
    fw,fy,fh = RIGHT-fx,76,304
    parts += [_text('spd_u','{{u:speed}}','d_unit',x+pad,speed_y+CELLS[speed_font]+2*pad+4,80,color='dim'),
              _text('gearcap','{{gearcap}}','d_unit',fx+16,fy+14,fw-32,color='dim'),
              _text('gearjp','{{gearcapjp}}','d_label',fx+16,fy+46,fw-32),
              _text('gearsub','UNIT-01','d_unit',fx+16,fy+fh-36,78,color='dim'),
              _text('gearsync','{{sync}}%','d_unit',fx+fw-92,fy+fh-36,76,align='right',color='dim')]
    gear = dict(id='gear',type='evagear',driveLetter=True,fontPrefix='',
                x=fx+14,y=fy+80,w=fw-28,h=182,class_='overlay',z=12)
    bar_y,bar_h = 400,32
    rpm_y,rpm_x,rpm_w,rpm_font = 444,x+96,200,'d_num42'
    parts += [_text('rpm_l','RPM','d_label',x,477,68,color='dim'),
              _text('rpm_jp','回転数','d_line',x+316,477,80,color='dim'),
              _text('rpm_max','8000 / MIN','d_unit',RIGHT-104,479,104,align='right',color='dim')]
    parts += _brackets(fx,fy,fw,fh)
    parts += [dict(id='segs',type='segs',count=SEGMENTS,redFrom=RED_FROM,
                   x=x,y=bar_y,w=width,h=bar_h,quads=_segments(width,bar_h)),
              _text('rpm','{{rpm}}',rpm_font,rpm_x,rpm_y,rpm_w)]
    parts += _footer(x,width)
    gear['class'] = gear.pop('class_')
    _overlaps(parts)
    for p in parts+[gear]:
        if p['x'] < x or p['x']+p['w'] > RIGHT or p['y'] < 20 or p['y']+p['h'] > CLEAR_Y:
            raise SystemExit('%s leaves safe field: %s' % (mode,p['id']))
    _overlaps([gear]+[p for p in parts if p['id'] not in ('f_l','f_r','f_t','f_b')])
    slash = {'sport':(16,36,120),'comfort':(12,8,100),'eco':(10,6,88)}[mode]
    return dict(column=ART_RIGHT[mode],fade=FADE[mode],parts=parts,gear=gear,
                stripe=dict(x=ART_RIGHT[mode]+6,y=(24 if mode=='eco' else 32)+8,
                            w=slash[0],slant=slash[1],h=slash[2]),speed_font=speed_font)
