#!/usr/bin/env python3
"""Prepare REAL EVA atlases for Shadow's build/preview; never bake substitutes.

Only the gitignored apps/shadow_dash/hud/fonts directory may receive font data.
An existing junction/symlink to EVA is also supported. No source fonts or atlas
data belong in a commit. Run before kit/tools/build.py shadow_dash.
"""
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'apps/eva_hud/hud/fonts'
OUT = ROOT / 'apps/shadow_dash/hud/fonts'
ATLASES = ('sq_speed', 'sqs_speed', 'gear', 'b_gear', 'd_aen', 'd_line',
           'd_label', 'd_unit', 'd_num42', 'sqs_num64', 'time70')


def main():
    # Read-only Git check; refuse to copy even one atlas to a tracked path.
    for name in ATLASES:
        target = OUT / (name + '.json')
        rel = target.relative_to(ROOT).as_posix()
        subprocess.run(['git', 'check-ignore', '-q', rel], cwd=ROOT, check=True)
        tracked = subprocess.run(['git', 'ls-files', '--error-unmatch', rel], cwd=ROOT,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if tracked.returncode == 0:
            raise SystemExit('Refusing tracked atlas destination: ' + rel)
        src = SRC / target.name
        meta = json.loads(src.read_text(encoding='utf-8'))
        if not meta.get('alpha') or meta.get('preview'):
            raise SystemExit('Not a real EVA atlas: ' + str(src))
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ATLASES:
        src, dst = SRC / (name+'.json'), OUT / (name+'.json')
        if not dst.exists() or not src.samefile(dst):
            shutil.copy2(src, dst)
        print('EVA atlas:', name)


if __name__ == '__main__':
    main()
