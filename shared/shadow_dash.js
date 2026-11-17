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
 * Instruments sit in the dark area on the right of each photo, in EVA's type: the label, the speed
 * atlas, the unit, the segmented rev bar, the gear (evagear) and the small readouts. The photo
 * holds the fade and the slanted accent. Glyphs are EVA's atlases, drawn at their own size.
 */
const EvaHud = require('./eva_hud');

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

    /* The rev segments are painted here. Everything else is an ordinary EVA part or evagear. */
    _partLook(p, now) {
        if (p.type === 'segs') {
            const rpm = this._raw('rpm');
            const n = p.count || 28;
            const lit = typeof rpm === 'number' && isFinite(rpm) ? Math.max(0, Math.min(n, Math.ceil(rpm / (8000 / n)))) : 0;
            return 'segs|' + lit;
        }
        return EvaHud.prototype._partLook.call(this, p, now);
    }

    _partPixels(p, look) {
        if (p.type === 'segs') return this._paintSegs(p, Number(look.split('|')[1]) || 0);
        return EvaHud.prototype._partPixels.call(this, p, look);
    }

    /** Hard-edged segments, like EVA's rev bar. Red only once a segment in the 7-8k zone is lit. */
    _paintSegs(p, lit) {
        const buf = Buffer.alloc(p.w * p.h * 4);
        const accent = this.theme.accent || this.theme.fg;
        const hot = this.theme.hot || [255, 42, 42, 255];
        const rest = this.theme.track || accent;
        const quads = p.quads || [];
        for (let i = 0; i < quads.length; i++) {
            const on = i < lit;
            const c = on && i >= (p.redFrom || 24) ? hot : on ? accent : rest;
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
