#!/bin/sh
# Rebake the three Shadow photos and build the installable tgz.
# Drop customer art in tools/photos-src/ first (see tools/photos-src/README.md).
# Font atlases are not in the repo. This links apps/shadow_dash/hud/fonts at EVA's
# atlases when that directory exists (bake them with tools/eva_layout.py; see README).
set -eu
cd "$(dirname "$0")/.."

fonts=apps/shadow_dash/hud/fonts
if [ ! -e "$fonts" ]; then
  if [ -d apps/eva_hud/hud/fonts ]; then
    mkdir -p apps/shadow_dash/hud
    ln -s ../../eva_hud/hud/fonts "$fonts"
    echo "linked $fonts -> EVA font atlases"
  else
    echo "warning: no font atlases at apps/eva_hud/hud/fonts. Numbers on the cluster will be blank until those atlases exist and this script is run again." >&2
  fi
fi

if command -v uv >/dev/null 2>&1; then
  uv run --no-project --with pillow python -X utf8 tools/make_photos.py
else
  python3 -X utf8 tools/make_photos.py
fi
python3 -X utf8 tools/shadow_layout.py
python3 -X utf8 kit/tools/build.py shadow_dash

ver=$(python3 -c "import json; print(json.load(open('apps/shadow_dash/app.json', encoding='utf-8'))['version'])")
echo "install artifact: dist/shadow_dash@${ver}.tgz"
