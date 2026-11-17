# Project status

Last updated: 2026-11-17 (Asia/Taipei)

## Released (GitHub Releases, picked up by MGU Store source `leochao1212/eva-hud` -> Releases)

| App | Version | Release | Car |
|---|---|---|---|
| shadow_dash (Shadow photo cluster) | 1.4.1 | [shadow-1.4.1](https://github.com/leochao1212/eva-hud/releases/tag/shadow-1.4.1) | Z4 G29, iDrive 7 |
| eva_hud (EVA HUD) | 0.8.9 | same release | iDrive 7 |

## Shadow history

- 1.4.0: EVA-style right panel in dark amber (#D9651A), no slanted accent. Installed on the Z4 via MGU Store: works, but BMW's stock gear box showed as a black square over the picture, and BMW's bottom info strip stayed visible.
- 1.4.1: bottom strip covered black except BMW's gear-letter cell (x 1380-1460, y 660-720). Covering that letter is what makes the kombi draw its black gear box (bimmer-lab/apps issue 5, Cluster Themes, cruzen991/Cluster). No renderer flag or coding value removes the box. Right panel back to the 1.4.0 layout.

## Open / to verify on the Z4

- [ ] 1.4.1: the black gear box is gone. The gear-letter cell comes from other ID7 cars. If the box remains, measure the G29 letter from a photo of the stock cluster (theme off) and move the open cell.
- [ ] Bottom strip is black apart from the gear letter; the red seat-belt lamp stays (drawn by the kombi above all layers).
- [ ] Drive-mode swap changes photo and colours; D/M show in the gear frame; EVA and Shadow coexist.

## Rules

- Never commit `apps/*/hud/fonts` (commercial font derivatives, gitignored). Built packages include them.
- Build: `python -X utf8 kit/tools/build.py <app>` with `apps/shadow_dash/hud/fonts` linked to `apps/eva_hud/hud/fonts`.
- Car install: never uninstall first (wipes settings).
