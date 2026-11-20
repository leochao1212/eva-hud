"""The bottom info row, in place of BMW's status row that the whole-cluster designs (EVA) and Shadow's photos cover:
fuel (a bar of cells and the range; yellow and blinking with the car's own low-fuel warning), the outside temperature
(ice blue from 3 C, with a road-ice note), the time, and the low-fuel words. One evacanvas widget, x 0..1380 and
y 662..718: clear of BMW's gear letter (x 1380..1460, which the kombi boxes in black when a layer meets it) and of its
seat-belt lamp (x ~540..690, left empty). Its glyphs are the bi_* fonts (tools/bake_fonts.py). Used by
tools/eva_layout.py and tools/shadow_layout.py; run on its own it adds the row to the layout files named.

  python -X utf8 tools/botinfo.py apps/eva_hud/hud/layouts/dash_eva.json ...
"""
import json
import sys

YEL, ICE = [255, 214, 0, 255], [120, 205, 255, 255]
def row(x0=0, w=1380, z=25):
    """z: over the design's black strips (EVA's are at 20, Shadow's at 30)."""
    P = []
    def t(id, text, font, x, y, w, h, color, **k):
        d = {'id': id, 'type': 'text', 'text': text, 'font': font, 'x': x, 'y': y, 'w': w, 'h': h, 'color': color}
        d.update(k); P.append(d)
    t('bi_fuel', '燃料', 'bi_jp', 24, 15, 50, 27, 'sub', warnWhen='fuel', warnColor=YEL)
    t('bi_fuel_en', 'FUEL', 'bi_en', 76, 18, 46, 24, 'sub', warnWhen='fuel', warnColor=YEL)
    P.append({'id': 'bi_fuelbar', 'type': 'fuelbar', 'x': 128, 'y': 19, 'w': 240, 'h': 18, 'cells': 12, 'color': 'fg', 'warnWhen': 'fuel', 'warnColor': YEL, 'blinkWhen': 'fuel'})
    t('bi_range', '{{range}}', 'bi_num', 380, 9, 96, 37, 'white', align='right', warnWhen='fuel', warnColor=YEL)
    t('bi_range_u', 'KM', 'bi_en', 482, 21, 34, 24, 'sub')
    # (x 540..690 left clear: BMW's seat-belt lamp lights there)
    t('bi_temp', '外気温', 'bi_jp', 700, 15, 72, 27, 'sub', warnWhen='ice', warnColor=ICE)
    t('bi_temp_v', '{{env:temp}}°C', 'bi_num', 776, 9, 112, 37, 'white', warnWhen='ice', warnColor=ICE)
    t('bi_ice', '{{env:ice}}', 'bi_jp', 892, 15, 140, 27, 'sub', warnWhen='ice', warnColor=ICE)
    t('bi_time', '{{time}}', 'bi_num', 1040, 9, 110, 37, 'white', align='right')
    t('bi_warn', '{{fuel:warn}}', 'bi_jp', 1166, 3, 200, 27, 'sub', warnWhen='fuel', warnColor=YEL, blinkWhen='fuel')
    t('bi_warn_en', '{{fuel:warnen}}', 'bi_en', 1166, 30, 200, 24, 'sub', warnWhen='fuel', warnColor=YEL)
    return {'id': 'botinfo', 'type': 'evacanvas', 'x': x0, 'y': 662, 'w': w, 'h': 56, 'class': 'overlay', 'z': z, 'parts': P}


def add(doc):
    """doc with the row (once)."""
    doc['widgets'] = [w for w in doc['widgets'] if w['id'] != 'botinfo'] + [row()]
    return doc


if __name__ == '__main__':
  for path in sys.argv[1:]:
    with open(path, encoding='utf8') as f: doc = json.load(f)
    ws = [w for w in doc['widgets'] if w['id'] != 'botinfo']
    ws.append(row())
    doc['widgets'] = ws
    with open(path, 'w', encoding='utf8', newline='\n') as f: json.dump(doc, f, ensure_ascii=False, indent=1)
    print(path, len(ws))
