# Shadow customer photos

Drop the three source pictures here, then run `sh tools/build_shadow.sh` from the repository root.

| File | Drive mode |
|---|---|
| `sport.png` | Sport |
| `comfort.png` | Comfort |
| `eco.png` | Eco Pro |

Each file is the full cluster art. The two-line slogan is part of the picture (it is not drawn by the baker). Replace the PNG to change the slogan, the portrait, or the background.

`tools/make_photos.py` scales each PNG to 1920×640 and bakes the data strip under the slogan: the labels in `CELLS` (時速, 轉速, 檔位, 續航, 水溫) and the units in `UNITS`. Edit those two lists in `make_photos.py` if a customer wants different strip words. The live speed, rpm, gear, range and coolant are not baked; the app draws them on top.

The script writes `apps/shadow_dash/hud/photos/<mode>.rgba` and the layouts under `apps/shadow_dash/hud/layouts/`. Label fonts default to Microsoft JhengHei Bold and Arial Bold on Windows. Elsewhere set `SHADOW_ZH_FONT` and `SHADOW_EN_FONT` to a `.ttf` or `.ttc`.
