# EVA HUD — free-font build (iDrive 7 MGU / Z4 G29)

A build of [idrive7-EVAHUD](https://github.com/PenguinDukeYDAuto/idrive7-EVAHUD) that swaps the
commercial **MatissePro EB** for the **free Eva-Ming** typeface, so it builds at zero cost.
Rendered in the official bench, it matches the original closely; 16 of 17 layouts fit (only
`dash_c2` "Title card" is dropped by the taller substitute font).

## Fonts (not committed — see `.gitignore`)

| Font | Role | Licence |
|---|---|---|
| **Eva-Ming-SC** ([kaonashi-tyc/Eva-Ming-Simplified](https://github.com/kaonashi-tyc/Eva-Ming-Simplified)) | Matisse substitute (`MATISSE`) | **CC BY-NC 4.0** |
| **Barlow Condensed** Bold + SemiBold ([jpt/barlow](https://github.com/jpt/barlow)) | numerals / labels | SIL OFL 1.1 |

Get them: `sh setup-fonts.sh`  → downloads into `tools/fonts-src/`.

> Eva-Ming is **non-commercial**. This build and any `.mgu` it produces are for personal use.
> Keep attribution; do not sell.

## Build

```sh
sh setup-fonts.sh                 # fetch the free fonts
export MATISSE="$PWD/tools/fonts-src/EvaMing-SC.otf"
export PYTHONUTF8=1 MATISSE_SCALE=0.92     # PYTHONUTF8 avoids Windows cp950 errors on Japanese
uv run --no-project --with pillow python tools/eva_layout.py   # bake glyphs + layouts
# then, with a real BMW oap-sdk symlinked at idrive7-apps/oap-sdk:
python3 kit/tools/build.py eva_hud         # -> dist/eva_hud@<ver>.mgu
```

Preview without the car: `node bench/server.js eva_hud` → http://localhost:8078

## Changes from upstream (to fit the substitute font)

- `tools/bake_fonts.py` — `MATISSE_SCALE` env knob (scales only the MATISSE substitute).
- `tools/eva_layout.py` — `MIN_FONT` 14→12; `number()` pad 3→1; Comfort motto line spacing made
  adaptive; clock `colon_pad` made adaptive; `main()` skips a layout that does not fit instead of
  aborting the whole run.
- `bench/server.js` — uses a Windows named pipe (`\\.\pipe\…`) when `process.platform === 'win32'`
  (Unix sockets are not supported there).

## oap-sdk

Not here and never redistributable — it is BMW's. Extract it from the head unit and symlink it at
`idrive7-apps/oap-sdk` before the `build.py` step. The bench makes a non-installable stub on its own.

## On the car

Mode **Dash only** (no windshield HUD on this car). Per drive mode pick a layout in the centre-screen
settings, e.g. **Comfort → B (Active limit, keeps the BMW gauges)**, **Sport → D (Battle stations,
whole cluster)**. Confirm the BMW warning lights still show before driving.
