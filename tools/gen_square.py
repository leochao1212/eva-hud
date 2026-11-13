#!/usr/bin/env python3
"""Generate the ID8 'sq' family of layouts and their fonts into the packed app resources, without
touching any other layout or font:
  - dash_sq.json       design 'sq'       on the map target  (874x749)
  - dash_sq_alert.json the sq alert      on the map target  (874x749)
  - hud_sq.json        design 'sqhud'    on the hud target  (353x203)
Run after eva_layout.py's build_square / build_square_alert / build_sqhud changes.
Usage: python -X utf8 tools/gen_square.py"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import eva_layout as E  # noqa: E402

LAYOUTS = [
    ('dash_sq', E.build_square),
    ('dash_sq_alert', E.build_square_alert),
    ('hud_sq', E.build_sqhud),
]


def main():
    fonts_out = os.path.join(E.APP, 'fonts')
    layouts_out = os.path.join(E.APP, 'layouts')
    os.makedirs(fonts_out, exist_ok=True)
    os.makedirs(layouts_out, exist_ok=True)

    def refuse(why):
        raise SystemExit('REFUSED: ' + why)

    moved = []
    for layout_name, builder in LAYOUTS:
        fonts_dir = tempfile.mkdtemp(prefix='sq_fonts_')
        doc = builder(fonts_dir, refuse)
        for f in sorted(os.listdir(fonts_dir)):
            shutil.move(os.path.join(fonts_dir, f), os.path.join(fonts_out, f))
            moved.append(f)
        shutil.rmtree(fonts_dir)
        with open(os.path.join(layouts_out, layout_name + '.json'), 'w', encoding='utf8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
            f.write('\n')
        print('wrote layouts/%s.json' % layout_name)

    print('fonts: ' + ', '.join(moved))


if __name__ == '__main__':
    main()
