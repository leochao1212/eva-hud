'use strict';
/**
 * Shadow: the photo cluster as its own iDrive 7 app. Sport, Comfort and Eco Pro each swap the
 * baked photo and that photo's theme. The live numbers are speed, rpm, gear, range and coolant.
 *
 * It is an EvaHud on the whole-cluster panel only (cluster-render target "panel", 1920x720), with
 * its own client name so it can be installed next to EVA. There is no HUD, no ID8 map target and
 * no full-screen alerts: a saved EVA "shadow" design is not this app's problem.
 *
 * The three photos and the layouts live in this app's hud/ (tools/make_photos.py, tools/shadow_layout.py).
 * Instruments sit in the dark area on the right of each photo, in EVA's type. The kombi paints a
 * black box over the theme when a layer covers the gear letter in its bottom strip, so that
 * letter (x 1380-1460, y 660-720) is left open and the rest of the strip (y 640-720) is black. Glyphs are
 * EVA's atlases, drawn at their own size.
 */
const EvaHud = require('./eva_hud');
const textRaster = require('./hud_text');

const PHOTOS = ['sport', 'comfort', 'eco'];
const PROFILE_KEY = { comfort: 'Comfort', sport: 'Sport', eco: 'Eco' };
const TEXT_MS = 250;
const POPUP_SLOT = 0x202;   // BMW's cluster pop-ups, the same slot the EVA dash yields

class ShadowDash extends EvaHud {
    constructor(ctx) {
        super(ctx, {
            target: 'panel',
            statusName: 'SHADOW',
            clientName: (ctx.spec && ctx.spec.id ? ctx.spec.id : 'shadow_dash') + '_cluster',
            textRateMs: TEXT_MS,
        });
    }

    /* EVA's menu migration does not apply. The redline is fixed: this cluster does not show a shift bar. */
    _migrateMenu() {}
    _retireShadow() {}
    setting(key) {
        if (key === 'redline') return 7000;
        if (key === 'shiftBefore') return 300;
        if (key === 'coldGuard') return true;
        if (key === 'gmtOffset') return 'unit';   // the clock on the cluster follows the head unit
        return EvaHud.prototype.setting.call(this, key);
    }

    /** The kit's car data, without EVA's demo round or the pedal signal. */
    _setupVehicleData() { require('./hud').prototype._setupVehicleData.call(this); }
    _moreSignals() { return {}; }

    /** No engine-unit alerts. Coolant comes from the car's temperature signal. */
    _startDme() {}
    _alertNow() { return null; }
    _evaShowing() { return false; }

    _followsDriveMode() { return true; }

    _needsRebuild(key) {
        if (key === 'enabled' || /^photo(Comfort|Sport|Eco)$/.test(key)) return this._layoutName() !== this.activeName;
        return key !== 'demo';
    }

    /** Comfort's photo until the car has named a drive mode. */
    _layoutName() {
        if (this.setting('enabled') === false) return 'off';
        const mode = this._driveProfile();
        const pick = this.setting('photo' + PROFILE_KEY[mode]);
        const photo = PHOTOS.indexOf(pick) >= 0 ? pick : mode;
        return 'shadow_' + photo;
    }

    _layoutFile(name) { return name === 'off' ? name : 'dash_' + name; }

    _layoutLabel(name) {
        if (!name || name === 'off') return 'Off';
        return 'Shadow ' + String(name).replace(/^shadow_/, '');
    }

    _popupSlot() { return POPUP_SLOT; }

    _token(key) {
        if (key === 'clusterstatus') {
            const stage = this._gearFor().text[0];
            return 'SYSTEM // ' + ('PN-'.indexOf(stage) >= 0 ? '待命状態' : stage === 'R' ? '後退操作' : '同期中');
        }
        return EvaHud.prototype._token.call(this, key);
    }

    // A separate state kind avoids EVA's shift-point red, blink and scale pop.
    // Only the 7000..8000 rpm segments may turn red, and all glyphs stay 1:1.
    _gearFor() {
        const d = this.car.data();
        const stage = /^[DMPRNS]$/.test(d.stage) ? d.stage : d.gear === -1 ? 'R' : '-';
        const digit = Number.isFinite(d.gear) && d.gear > 0 ? String(Math.min(9, Math.floor(d.gear))) : '';
        return { kind: 'cluster', text: /^[DMS]$/.test(stage) ? stage + digit : stage === '-' ? digit || '-' : stage };
    }

    _paintGear(w, st) {
        const driving = /^[DMS][1-9]$/.test(st.text);
        const font = driving || /^[1-9]$/.test(st.text) ? 'gear' : /^[MS]$/.test(st.text) ? 'd_aen' : 'b_gear';
        const letterFont = 'd_aen';
        const glyph = driving ? st.text.slice(1) : st.text;
        const mainWidth = textRaster.measure(glyph, font);
        const letterWidth = driving ? textRaster.measure(st.text[0], letterFont) + 10 : 0;
        const x = Math.round((w.w - mainWidth - letterWidth) / 2);
        const cell = textRaster.loadFont(font).metrics.cellHeight;
        const y = Math.round((w.h - cell) / 2);
        const mask = textRaster.mask(w.w, w.h, glyph, { font, x: x + letterWidth, offsetY: y });
        if (driving) {
            const letter = textRaster.mask(w.w, w.h, st.text[0], {
                font: letterFont, x, offsetY: y + cell - textRaster.loadFont(letterFont).metrics.cellHeight - 6,
            });
            for (let i = 0; i < mask.length; i++) mask[i] = Math.max(mask[i], letter[i]);
        }
        return textRaster.tint(mask, w.w, w.h, { font, color: this.theme.fg, glow: 0 });
    }

    /* Transparent hazard material and the live rev segments share EVA's canvas. */
    _partLook(p, now) {
        if (p.type === 'hazard') return 'hazard';
        if (p.type === 'segs') {
            const rpm = this._raw('rpm');
            const n = p.count || 32;
            const lit = typeof rpm === 'number' && isFinite(rpm) ? Math.max(0, Math.min(n, Math.ceil(rpm / (8000 / n)))) : 0;
            return 'segs|' + lit;
        }
        return EvaHud.prototype._partLook.call(this, p, now);
    }

    _partPixels(p, look) {
        if (p.type === 'hazard') {
            const buf = Buffer.alloc(p.w * p.h * 4);
            const c = this.theme.accent;
            for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
                if ((x + y) % 36 >= 18) continue; // shaders.EVAHAZARD
                const o = (y * p.w + x) * 4;
                buf[o] = c[0]; buf[o+1] = c[1]; buf[o+2] = c[2]; buf[o+3] = 200;
            }
            return buf;
        }
        if (p.type === 'segs') return this._paintSegs(p, Number(look.split('|')[1]) || 0);
        return EvaHud.prototype._partPixels.call(this, p, look);
    }

    /** Hard-edged segments, like EVA's rev bar. Red only once a segment in the 7-8k zone is lit. */
    _paintSegs(p, lit) {
        const buf = Buffer.alloc(p.w * p.h * 4);
        const accent = this.theme.fg;
        const hot = this.theme.hot || [255, 42, 42, 255];
        const rest = this.theme.track || accent;
        const quads = p.quads || [];
        for (let i = 0; i < quads.length; i++) {
            const on = i < lit;
            const c = on && i >= p.redFrom ? hot : on ? accent : rest;
            fillQuad(buf, p.w, p.h, quads[i], [c[0], c[1], c[2], on ? 255 : (c[3] == null ? 46 : c[3])]);
        }
        return buf;
    }
}

function fillQuad(buf, w, h, quad, color) {
    let minY = h, maxY = 0;
    quad.forEach((p) => { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(h - 1, Math.ceil(maxY));
    for (let y = minY; y <= maxY; y++) {
        const xs = [];
        for (let i = 0; i < 4; i++) {
            const a = quad[i], b = quad[(i + 1) % 4];
            if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
                const t = (y - a[1]) / (b[1] - a[1]);
                xs.push(a[0] + (b[0] - a[0]) * t);
            }
        }
        if (xs.length < 2) continue;
        xs.sort((m, n) => m - n);
        const x0 = Math.max(0, Math.ceil(xs[0]));
        const x1 = Math.min(w - 1, Math.floor(xs[xs.length - 1]));
        for (let x = x0; x <= x1; x++) {
            const o = (y * w + x) * 4;
            const a = color[3] / 255;
            const ia = 1 - a;
            buf[o] = color[0] * a + buf[o] * ia;
            buf[o + 1] = color[1] * a + buf[o + 1] * ia;
            buf[o + 2] = color[2] * a + buf[o + 2] * ia;
            buf[o + 3] = Math.min(255, buf[o + 3] + color[3] * (1 - buf[o + 3] / 255));
        }
    }
}

module.exports = ShadowDash;
