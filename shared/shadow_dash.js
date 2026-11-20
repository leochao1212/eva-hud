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
const PersistentLayers = require('./persistent_layers');

const PHOTOS = ['sport', 'comfort', 'eco'];
const PHOTO_W = 1920, PHOTO_H = 640;
const PROFILE_KEY = { comfort: 'Comfort', sport: 'Sport', eco: 'Eco' };
const TEXT_MS = 250;
const POPUP_SLOT = 0x202;   // BMW's cluster pop-ups, the same slot the EVA dash yields
// The photos go up once as etc2rgba assets (1 byte a pixel, charged once: 1.2 MB each in
// cluster-render's 16 MB of pixel memory, against 9.8 MB for one rgba image layer) and an
// effect layer draws one. A drive-mode swap puts a new effect layer on top that shows the new
// photo in the style picked ("photoTransition"), then drops the one under it; nothing is
// uploaded, so the stock gauges under the panel never show through.
//   u_style 0 fade (u_alpha), 1 wave (a breaking wave left to right, foam on its crest), 2 flag stripes (four
//           diagonal bands in the photos' navy / orange / cream), 3 light sweep (a warm sheen, the new photo behind it)
//   u_t     0..1 through the change, u_span the photo's art width px (the data column sits on top past it)
const PHOTO_FS = `precision mediump float;
uniform sampler2D u_photo;
uniform float u_alpha;
uniform float u_style;
uniform float u_t;
uniform float u_span;
uniform vec2 u_size;
varying vec2 v_uv;
const vec3 ORANGE = vec3(0.918, 0.333, 0.016);
const vec3 CREAM = vec3(0.98, 0.95, 0.88);
const vec3 NAVY = vec3(0.06, 0.09, 0.18);
void main() {
    vec4 c = texture2D(u_photo, v_uv);
    if (u_style < 0.5) { gl_FragColor = vec4(c.rgb, c.a * u_alpha); return; }
    vec2 px = v_uv * u_size;
    float t = u_t, m = 0.0;
    vec3 deco = vec3(0.0);
    float da = 0.0;
    if (u_style < 1.5) {
        float edge = -260.0 + t * (u_span + 520.0) + 40.0 * sin(px.y / 38.0 + t * 12.0) + 10.0 * sin(px.y / 21.0 - t * 15.0)
            + 90.0 * (1.0 - px.y / u_size.y);
        m = smoothstep(edge, edge - 6.0, px.x);
        float body = smoothstep(edge - 70.0, edge - 30.0, px.x) * (1.0 - smoothstep(edge - 2.0, edge + 2.0, px.x));
        float foam = clamp(1.0 - abs(px.x - edge + 6.0) / 8.0, 0.0, 1.0);
        float line = clamp(1.0 - abs(px.x - edge + 22.0) / 3.0, 0.0, 1.0);
        deco = mix(NAVY, CREAM, foam); da = max(body * 0.75, foam);
        deco = mix(deco, ORANGE, line * 0.8); da = max(da, line * 0.8);
    } else if (u_style < 2.5) {
        float k = px.x + (u_size.y - px.y) * 0.6, bw = 70.0;
        float pos = -20.0 + t * (u_span + u_size.y * 0.6 + 4.0 * bw + 40.0);
        m = smoothstep(pos - 4.0 * bw + 1.0, pos - 4.0 * bw - 1.0, k);
        for (int i = 0; i < 4; i++) {
            float hi = pos - float(i) * bw, lo = hi - bw;
            float a = smoothstep(hi + 1.0, hi - 1.0, k) * smoothstep(lo - 1.0, lo + 1.0, k);
            vec3 bc = i == 0 ? NAVY : i == 2 ? CREAM : ORANGE;
            deco = mix(deco, bc, a); da = max(da, a);
        }
    } else {
        float pos = -200.0 + t * (u_span + 400.0);
        float sl = px.x + (px.y - u_size.y * 0.5) * 0.35;
        float d = sl - pos;
        m = smoothstep(pos + 40.0, pos - 120.0, sl);
        float glow = exp(-(d / 60.0) * (d / 60.0)) * 0.85 + exp(-(d / 8.0) * (d / 8.0)) * 0.5;
        deco = vec3(1.0, 0.85, 0.7); da = clamp(glow * 0.55, 0.0, 1.0);
    }
    if (px.x > u_span + 200.0) m = step(1.0, t);          // under the data column: the photos are black there
    da *= 1.0 - smoothstep(u_span - 80.0, u_span + 20.0, px.x);   // and nothing of the wave / bands / sheen behind its numbers
    float pa = m * c.a;
    gl_FragColor = vec4(mix(c.rgb, deco, da), da + pa * (1.0 - da));
}`;
// the styles: [u_style, ms]; Random picks one of the moving ones, not the last
const PHOTO_STYLES = { off: [0, 0], fade: [0, 250], wave: [1, 1100], stripes: [2, 1000], sheen: [3, 900] };
const PHOTO_RANDOM = ['wave', 'stripes', 'sheen'];
const PHOTO_SHOWN_MS = 700;     // the most a change waits for cluster-render to say the new photo is drawn
const PHOTO_SPAN = 1240;     // the photos' art ends about here (tools/shadow_geom.py ART_RIGHT), the data column's black after

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
        return key !== 'demo' && key !== 'photoTransition';
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
        this._stripSet().begin();
        EvaHud.prototype._rebuildInner.call(this);
        // strips the new layout no longer has (or 'off'): only now are they dropped
        this._stripSet().end();
    }

    _create(w) {
        if (w.type === 'fill' && /^strip_/.test(w.id)) { this._keepStrip(w); return; }
        if (w.type !== 'evaphoto' || this.etc2Broken || !this._showPhoto(w)) EvaHud.prototype._create.call(this, w);
    }

    /* ---------------- the black bottom strips stay put across a drive-mode swap ---------------- */

    /**
     * The black fills over BMW's bottom status row are the same in every mode. A rebuild used to
     * drop them and make them again, and BMW's row could show through for a frame. Kept out of
     * this.widgets (shared/persistent_layers.js, as EVA's), they stay as they are unless their rect,
     * colour, class or z changes, and one cluster-render refused is made again.
     */
    _stripSet() { return this.strips || (this.strips = new PersistentLayers(this.log, 'bottom strip')); }

    _keepStrip(w) {
        this._stripSet().keep(w.id, [w.x, w.y, w.w, w.h, w.color, w.class, w.z].join(','), () => {
            EvaHud.prototype._create.call(this, w);
            const x = this.widgets.get(w.id);
            if (!x) return null;
            this.widgets.delete(w.id);
            return { ref: x.ref, client: this.client };
        });
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

    /** Shows w.photo; the shown one stays below until the new one is all there. */
    _showPhoto(w) {
        if (w.w !== PHOTO_W || w.h !== PHOTO_H || PHOTOS.indexOf(w.photo) < 0 || !this._photoAssets()) return false;
        const cur = this.photo;
        if (cur && cur.name === w.photo) return true;
        if (this.photoFade) this._endFade();          // a swap during a swap: the one coming in is the shown one
        const ref = this.client.effect({ target: this.target, klass: w.class || 'ambient', z: w.z || 0,
            x: w.x, y: w.y, w: w.w, h: w.h, fs: PHOTO_FS });
        if (!ref) return false;
        this.client.bind(ref, 'u_photo', this.photoAssets[w.photo]);
        const name = cur ? this._photoStyle() : 'off', st = PHOTO_STYLES[name];
        this.client.uniform(ref, 'u_size', [PHOTO_W, PHOTO_H]);
        this.client.uniform(ref, 'u_span', [PHOTO_SPAN]);
        this.client.uniform(ref, 'u_style', [st[0]]);
        this.client.uniform(ref, 'u_t', [0]);
        this.client.uniform(ref, 'u_alpha', [st[1] && st[0] === 0 ? 0 : 1]);
        if (this.givingWay) this.client.set(ref, { visible: 0 });
        this.photo = { ref, name: w.photo };
        if (cur) {
            // the change starts once cluster-render has drawn the new photo (or after PHOTO_SHOWN_MS without word)
            this.photoFade = { ref, under: cur.ref, from: null, made: Date.now(), ms: st[1], style: st[0] };
            if (!st[1]) this._endFade();
            else this.log.info('photo change: ' + name);
        }
        return true;
    }

    /** The photoTransition setting, or for Random any moving one but the last. */
    _photoStyle() {
        let name = this.setting('photoTransition');
        if (name === 'random') {
            const pool = PHOTO_RANDOM.filter((n) => n !== this.lastPhotoStyle);
            name = pool[Math.floor(Math.random() * pool.length)];
        }
        if (!PHOTO_STYLES[name]) name = 'wave';
        this.lastPhotoStyle = name;
        return name;
    }

    _endFade() {
        const f = this.photoFade;
        this.photoFade = null;
        if (!f) return;
        this.client.uniform(f.ref, 'u_alpha', [1]);
        this.client.uniform(f.ref, 'u_t', [1]);
        this.client.drop(f.under);
    }

    _stepFade(now) {
        const f = this.photoFade;
        if (!f) return;
        if (f.from === null) {
            const st = this.layerStates.get(f.ref);
            if (!(st && st.state === 'shown') && now - f.made < PHOTO_SHOWN_MS) return;
            f.from = now;
        }
        const t = (now - f.from) / f.ms;
        if (t >= 1) { this._endFade(); return; }
        if (t > 0) this.client.uniform(f.ref, f.style === 0 ? 'u_alpha' : 'u_t', [Math.round(t * 1000) / 1000]);
    }

    _dropPhotos() {
        if (this.photoFade) { this.client.drop(this.photoFade.under); this.photoFade = null; }
        if (this.photo) { this.client.drop(this.photo.ref); this.photo = null; }
        if (this.photoAssets) Object.keys(this.photoAssets).forEach((k) => this.client.drop(this.photoAssets[k]));
        this.photoAssets = null;
    }

    /** cluster-render refused an asset or the photo layer (or the renderer its texture): the rgba photo from then on. */
    _onRefused(op, ref, reason) {
        if (this.strips && this.strips.failed(ref, reason)) return;
        const photoRef = (this.photo && this.photo.ref === ref) || (this.photoFade && this.photoFade.ref === ref) ||
            (this.photoAssets && Object.keys(this.photoAssets).some((k) => this.photoAssets[k] === ref));
        if (photoRef && /pixel memory is full/.test(reason || '')) {
            // out of memory, not an etc2 problem: the rgba photo would need more. Let go; hud.js builds again later.
            this.log.warn('etc2 photo refused for memory: building again when the memory is free');
            this._dropPhotos();
            return;
        }
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
        this._stripSet().setVisible(!hide);
        EvaHud.prototype._showForPopup.call(this, hide, now);
    }

    _tick() {
        if (this.client.ready) this._guard('photo fade', () => this._stepFade(Date.now()));
        EvaHud.prototype._tick.call(this);
    }

    stop() {
        this._dropPhotos();
        if (this.strips) this.strips.dropAll();
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
