# Shadow customer photos

Drop the three source pictures here, then run `sh tools/build_shadow.sh` from the repository root.

| File | Drive mode |
|---|---|
| `sport.png` | Sport |
| `comfort.png` | Comfort |
| `eco.png` | Eco Pro |

The pictures shipped here are the default Puma Shen set (2048×768). Each one keeps the portrait and the two-line slogan on the left and an empty dark area on the right. Replace a PNG to use a customer's own art. The slogan is part of the picture; the baker does not draw it.

`tools/make_photos.py` scales each PNG to the cluster width without stretching, crops the same amount off the top and the bottom to 1920×640, and bakes the fade to black plus the slanted accent into the dark area. Positions are `tools/shadow_geom.py`. The app draws the column with EVA's atlases: the speed, the unit, the rev segments, the gear and the small readouts. From y=640 the panel is covered in black. The seat-belt lamp is drawn by the cluster on top of that cover.

The script writes `apps/shadow_dash/hud/photos/<mode>.rgba` and `tools/shadow_layout.py` writes the layouts. Units use EVA's `d_unit` atlas (Barlow Condensed SemiBold). The transparent instrument canvas adds the bilingual labels, hazard strip and bracket frame without rebaking or changing the photos.

For a real-atlas preview, run `python tools/bake_shadow_preview_fonts.py`, build `shadow_dash`, then run `node tools/render_shadow.js dist/shadow-preview --stills-only`. It exports the three 1920×720 PNGs and their `*-right-2x.png` crops. All font atlases and build/preview output stay gitignored. See [the design notes](../../docs/shadow-eva.md).
