#!/bin/sh
# Downloads the free fonts this build uses into tools/fonts-src/.
# No fonts are committed to this repo (see .gitignore); this fetches them.
#
#   Eva-Ming-SC  : Matisse substitute, CC BY-NC 4.0, github.com/kaonashi-tyc/Eva-Ming-Simplified
#   Barlow Cond. : SIL OFL 1.1, github.com/jpt/barlow (via google/fonts)
set -e
cd "$(dirname "$0")"
DST=tools/fonts-src
mkdir -p "$DST"
GF=https://raw.githubusercontent.com/google/fonts/main/ofl

echo "Barlow Condensed Bold/SemiBold (OFL)..."
curl -fsSL "$GF/barlowcondensed/BarlowCondensed-Bold.ttf"     -o "$DST/BarlowCondensed-Bold.ttf"
curl -fsSL "$GF/barlowcondensed/BarlowCondensed-SemiBold.ttf" -o "$DST/BarlowCondensed-SemiBold.ttf"

echo "Eva-Ming-SC (Matisse substitute, CC BY-NC)..."
curl -fsSL "https://raw.githubusercontent.com/kaonashi-tyc/Eva-Ming-Simplified/master/data/Eva-Ming-SC-v0.1.otf" \
  -o "$DST/EvaMing-SC.otf"

echo "Done. Fonts in $DST :"
ls -la "$DST"
