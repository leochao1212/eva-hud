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
const hudData = require('./hud_data');

const PHOTOS = ['sport', 'comfort', 'eco'];
const PHOTO_W = 1920, PHOTO_H = 640;
const PROFILE_KEY = { comfort: 'Comfort', sport: 'Sport', eco: 'Eco' };
const TEXT_MS = 250;
const POPUP_SLOT = 0x202;   // BMW's cluster pop-ups, the same slot the EVA dash yields
// The photos go up once as etc2rgba assets (1 byte a pixel, charged once: 1.2 MB each in
// cluster-render's 16 MB of pixel memory, against 9.8 MB for one rgba image layer) and an
// effect layer draws one. A drive-mode swap puts a new effect layer on top and fades it in;
// nothing is uploaded, so the stock gauges under the panel never show through.
const PHOTO_FS = 'precision mediump float;uniform sampler2D u_photo;uniform float u_alpha;varying vec2 v_uv;' +
    'void main(){vec4 c=texture2D(u_photo,v_uv);gl_FragColor=vec4(c.rgb,c.a*u_alpha);}';
const PHOTO_FADE_MS = 250;

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

    /* ---------------- the photo: preloaded etc2rgba assets, drawn by an effect layer ---------------- */

    _rebuildInner() {
        if (this._layoutName() === 'off') this._dropPhotos();   // free the memory and the panel for EVA
        EvaHud.prototype._rebuildInner.call(this);
    }

    _create(w) {
        if (w.type !== 'evaphoto' || this.etc2Broken || !this._showPhoto(w)) EvaHud.prototype._create.call(this, w);
    }

    /** The three photos as assets, sent once. False when this build has no etc2 copies. */
    _photoAssets() {
        if (this.photoAssets) return true;
        const data = {};
        for (const name of PHOTOS) {
            const buf = hudData.bytes && hudData.bytes('photos/' + name + '.etc2');
            if (!buf || buf.length !== PHOTO_W * PHOTO_H) return false;
            data[name] = buf;
        }
        this.photoAssets = {};
        for (const name of PHOTOS) {
            const ref = this.client.asset({ target: this.target, format: 'etc2rgba', w: PHOTO_W, h: PHOTO_H, sampling: 'nearest' });
            if (!ref) { this._dropPhotos(); return false; }
            this.photoAssets[name] = ref;
            this.client.pixels(ref, null, data[name]);
        }
        this.log.info('photos sent as etc2rgba assets (' + PHOTOS.length + ' x ' + (PHOTO_W * PHOTO_H / 1e6).toFixed(1) + ' MB)');
        return true;
    }

    /** Shows w.photo; the shown one stays below until the new one has faded in. */
    _showPhoto(w) {
        if (w.w !== PHOTO_W || w.h !== PHOTO_H || PHOTOS.indexOf(w.photo) < 0 || !this._photoAssets()) return false;
        const cur = this.photo;
        if (cur && cur.name === w.photo) return true;
        if (this.photoFade) this._endFade();          // a swap during a swap: the one fading in is the shown one
        const ref = this.client.effect({ target: this.target, klass: w.class || 'ambient', z: w.z || 0,
            x: w.x, y: w.y, w: w.w, h: w.h, fs: PHOTO_FS });
        if (!ref) return false;
        this.client.bind(ref, 'u_photo', this.photoAssets[w.photo]);
        this.client.uniform(ref, 'u_alpha', [cur ? 0 : 1]);
        if (this.givingWay) this.client.set(ref, { visible: 0 });
        this.photo = { ref, name: w.photo };
        if (cur) this.photoFade = { ref, under: cur.ref, from: Date.now() };
        return true;
    }

    _endFade() {
        const f = this.photoFade;
        this.photoFade = null;
        if (!f) return;
        this.client.uniform(f.ref, 'u_alpha', [1]);
        this.client.drop(f.under);
    }

    _stepFade(now) {
        const f = this.photoFade;
        if (!f) return;
        const t = (now - f.from) / PHOTO_FADE_MS;
        if (t >= 1) { this._endFade(); return; }
        if (t > 0) this.client.uniform(f.ref, 'u_alpha', [Math.round(t * 100) / 100]);
    }

    _dropPhotos() {
        if (this.photoFade) { this.client.drop(this.photoFade.under); this.photoFade = null; }
        if (this.photo) { this.client.drop(this.photo.ref); this.photo = null; }
        if (this.photoAssets) Object.keys(this.photoAssets).forEach((k) => this.client.drop(this.photoAssets[k]));
        this.photoAssets = null;
    }

    /** cluster-render refused an asset or the photo layer (or the renderer its texture): the rgba photo from then on. */
    _onRefused(op, ref, reason) {
        const mine = (this.photo && this.photo.ref === ref) ||
            (this.photoAssets && Object.keys(this.photoAssets).some((k) => this.photoAssets[k] === ref));
        if (!mine || this.etc2Broken) return;
        this.etc2Broken = reason || op;
        this.log.warn('etc2 photo refused (' + this.etc2Broken + '): using the rgba photo');
        this._dropPhotos();
        setImmediate(() => this._rebuild());
    }

    _showForPopup(hide, now) {
        if (this.photo) this.client.set(this.photo.ref, { visible: hide ? 0 : 1 });
        if (this.photoFade) this.client.set(this.photoFade.under, { visible: hide ? 0 : 1 });
        EvaHud.prototype._showForPopup.call(this, hide, now);
    }

    _tick() {
        if (this.client.ready) this._guard('photo fade', () => this._stepFade(Date.now()));
        EvaHud.prototype._tick.call(this);
    }

    stop() {
        this._dropPhotos();
        EvaHud.prototype.stop.call(this);
    }

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
