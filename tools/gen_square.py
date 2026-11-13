#!/usr/bin/env python3
"""Generate only the ID8 'sq' centre design: bakes its sq_ fonts and writes dash_sq.json into the
packed app resources, without touching any other layout or font. Run after eva_layout.py's build_square
changes. Usage: python tools/gen_square.py"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import eva_layout as E  # noqa: E402


def main():
    fonts_dir = tempfile.mkdtemp(prefix='sq_fonts_')

    def refuse(why):
        raise SystemExit('REFUSED: ' + why)

    doc = E.build_square(fonts_dir, refuse)

    fonts_out = os.path.join(E.APP, 'fonts')
    layouts_out = os.path.join(E.APP, 'layouts')
    os.makedirs(fonts_out, exist_ok=True)
    os.makedirs(layouts_out, exist_ok=True)

    moved = []
    for f in sorted(os.listdir(fonts_dir)):
        shutil.move(os.path.join(fonts_dir, f), os.path.join(fonts_out, f))
        moved.append(f)
    shutil.rmtree(fonts_dir)

    with open(os.path.join(layouts_out, 'dash_sq.json'), 'w', encoding='utf8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print('wrote layouts/dash_sq.json and fonts: ' + ', '.join(moved))


if __name__ == '__main__':
    main()
