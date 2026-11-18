# Project status

Last updated: 2026-11-18 (Asia/Taipei)

## Released (GitHub Releases, picked up by MGU Store source `leochao1212/eva-hud` -> Releases)

| App | Version | Release | Car |
|---|---|---|---|
| shadow_dash (Shadow photo cluster) | 1.4.7 | [shadow-1.4.7](https://github.com/leochao1212/eva-hud/releases/tag/shadow-1.4.7) | Z4 G29, iDrive 7 |
| eva_hud (EVA HUD) | 0.8.9 | same release | iDrive 7 |

## Shadow history

- 1.4.0: EVA-style right panel in dark amber (#D9651A), no slanted accent. Installed on the Z4 via MGU Store: works, but BMW's stock gear box showed as a black square over the picture, and BMW's bottom info strip stayed visible.
- 1.4.1: bottom strip covered black except BMW's gear-letter cell (x 1380-1460, y 660-720). Covering that letter is what makes the kombi draw its black gear box (bimmer-lab/apps issue 5, Cluster Themes, cruzen991/Cluster). No renderer flag or coding value removes the box. Right panel back to the 1.4.0 layout. On the Z4 BMW's bottom strip still showed: the black fills started at y=660, leaving y 640-660 (between the photo and the fills) uncovered.
- 1.4.2: black fills now cover y 640-720 (strip_l, strip_r, plus strip_c above the gear-letter cell). Only x 1380-1460, y 660-720 stays open.
- 1.4.3: Eco Pro's picture scaled to the panel height (1707x640) and moved 40px left; its slogan ends near x=1240, so Eco gets Comfort's 612px column and layout (speed, gear frame, full rpm bar, range / water / time). Sport and Comfort unchanged.
- 1.4.4: drive-mode swap no longer flashes the stock gauges. 1.4.3 dropped every layer and rebuilt, and while the 4.9 MB photo uploaded the panel had no photo, so the stock cluster under it showed. Now the old photo stays above the new one (z 1) until cluster-render reports the new one shown, then fades out over 250 ms and is dropped (3 s timeout). 7 layers during the swap. **Broken on the car:** cluster-render has 16 MB of pixel memory shared by all clients, image layers count twice, so two photos (2 x 9.8 MB) do not fit; the new photo is refused and after 3 s no photo shows.
- 1.4.5: 1.4.4's swap removed (back to 1.4.3's drop-and-rebuild: a short flash of the stock gauges on a swap). The test's fake client now tracks pixel memory and fails above 16 MB (1.4.4 peaked at 23.2 MB). Next (1.4.6): photos as preloaded etc2rgba assets (1.2 MB each).
- 1.4.6: the three photos go up once as etc2rgba assets (tools/etc2.py, our own encoder; 1.2 MB each, charged once) and an effect layer draws the shown one. A drive-mode swap adds a new effect layer on top and fades it in over 250 ms (u_alpha), then drops the old one: nothing is uploaded, no stock-gauge flash. Shadow now uses about 7 MB of the 16 (was 13.3). Off drops the photo layers and the assets. If cluster-render refuses an asset or the renderer its texture, Shadow falls back to the rgba photo. Shared hud.js: a layer refused because the pixel memory is full is built again after 5, 10, 20, 30, 30 s (EVA too: the cause of EVA staying incomplete after Shadow was switched off). cluster_render_client.js takes etc2rgba / etc2rgb assets (as cluster-render 0.6.9's client).
- 1.4.7: the black bottom strips stay put on a drive-mode swap. A rebuild dropped and made them again, and BMW's status row showed through for a moment on the car. They are kept out of the rebuild now (same rect and colour in every mode) and only dropped when Shadow is switched off or a layout changes them.

## Open / to verify on the Z4

- [ ] 1.4.6 on the Z4: the photo shows the right way up and looks like 1.4.5's; Sport / Comfort / Eco swaps fade with no stock gauges; log has "photos sent as etc2rgba assets" and no "etc2 photo refused".
- [ ] 1.4.7: no BMW status row during a drive-mode swap.
- [ ] Shadow off, then EVA on a whole-cluster design: EVA complete (no stuck layer); if the log shows "pixel memory full: building again", it recovers within ~5 s.
- [ ] Eco Pro (1.4.3): smaller picture on the left, wide column readable, coolant shows.
- [ ] 1.4.2: no BMW strip left between the photo and the bottom edge.
- [ ] The black gear box is gone. The gear-letter cell comes from other ID7 cars. If the box remains, measure the G29 letter from a photo of the stock cluster (theme off) and move the open cell.
- [ ] Bottom strip is black apart from the gear letter; the red seat-belt lamp stays (drawn by the kombi above all layers).
- [ ] Drive-mode swap changes photo and colours; D/M show in the gear frame; EVA and Shadow coexist.

## Rules

- Never commit `apps/*/hud/fonts` (commercial font derivatives, gitignored). Built packages include them.
- Build: `python -X utf8 kit/tools/build.py <app>` with `apps/shadow_dash/hud/fonts` linked to `apps/eva_hud/hud/fonts`.
- Car install: never uninstall first (wipes settings).
