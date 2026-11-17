# Shadow customer photos

Drop the three source pictures here, then run `sh tools/build_shadow.sh` from the repository root.

| File | Drive mode |
|---|---|
| `sport.png` | Sport |
| `comfort.png` | Comfort |
| `eco.png` | Eco Pro |

The pictures shipped here are the default Puma Shen set (2048×768). Each one keeps the portrait and the two-line slogan on the left and an empty dark area on the right. Replace a PNG to use a customer's own art. The slogan is part of the picture; the baker does not draw it.

`tools/make_photos.py` scales each PNG to the cluster width without stretching, crops the same amount off the top and the bottom to 1920×640, and bakes the captions and units (`km/h`, `km`, `°C`, SPEED, RPM, GEAR, RANGE, TEMP, TIME) into that dark area. The positions are `tools/shadow_geom.py`. The app draws the live speed, rpm bar (0–8 ×1000, red from 7), gear, range, coolant and time on top, and leaves the bottom 84px of the 720px panel clear for BMW's warning icons.

The script writes `apps/shadow_dash/hud/photos/<mode>.rgba` and `tools/shadow_layout.py` writes the layouts. The unit font is Arial Bold or DejaVu Sans Bold, or `SHADOW_EN_FONT`.
