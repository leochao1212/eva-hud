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
 * Instruments sit in the dark area on the right of each photo. The fade, the diagonal stripe,
 * the segment outlines, the icons and km/h are baked into the photo. This class draws what changes:
 * the speed (the e_rpm atlas, scaled up to the hero box and sheared so it leans like the slogan),
 * the lit rpm segments, the gear badge, and the range, coolant and time.
 * Number glyphs are the same atlases as EVA (e_rpm, e_num, b_gear, e3_time).
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

    /* The hero, the segments and the gear badge are not EVA text parts. */
    _partLook(p, now) {
        if (p.type === 'segs') {
            const rpm = this._raw('rpm');
            const n = p.count || 16;
            const lit = typeof rpm === 'number' && isFinite(rpm) ? Math.max(0, Math.min(n, Math.ceil(rpm / (8000 / n)))) : 0;
            return 'segs|' + lit;
        }
        if (p.type === 'badge') return 'badge|' + this._token('gear');
        return EvaHud.prototype._partLook.call(this, p, now);
    }

    _partPixels(p, look) {
        if (p.type === 'segs') return this._paintSegs(p, Number(look.split('|')[1]) || 0);
        if (p.type === 'badge') return this._paintBadge(p, look.split('|').slice(1).join('|'));
        if (p.hero) return this._paintHero(p, look);
        return EvaHud.prototype._partPixels.call(this, p, look);
    }

    /**
     * The hero is the atlas at its own size, inset so the glow fades out before the quad edge.
     * No upscale and no shear: an italic look comes from an italic atlas (the preview bakes
     * DejaVu Bold Oblique at this size; on the car, e_rpm is whatever atlas was linked).
     */
    _paintHero(p, look) {
        const cut = look.indexOf('|');
        const color = (cut < 0 ? look : look.slice(0, cut)).split(',').map(Number);
        const text = look.slice(cut + 1);
        const pad = p.pad || 36;
        return textRaster.drawText(p.w, p.h, text, {
            font: p.font, color: color, align: 'left', glow: 0.1, x: pad, offsetY: pad,
        });
    }

    _paintSegs(p, lit) {
        const buf = Buffer.alloc(p.w * p.h * 4);
        const accent = this.theme.accent || this.theme.fg;
        const hot = this.theme.hot || [255, 42, 42, 255];
        const quads = p.quads || [];
        for (let i = 0; i < quads.length; i++) {
            if (i >= lit) continue;
            const red = i >= (p.redFrom || 14);
            const c = red ? hot : accent;
            if (red) fillQuad(buf, p.w, p.h, grow(quads[i], 2), [c[0], c[1], c[2], 48]);
            fillQuad(buf, p.w, p.h, quads[i], [c[0], c[1], c[2], 255]);
        }
        return buf;
    }

    _paintBadge(p, gear) {
        const buf = Buffer.alloc(p.w * p.h * 4);
        const accent = this.theme.accent || [255, 92, 0, 255];
        const slant = p.slant || 14;
        const quad = [[slant, 2], [p.w - 2, 2], [p.w - 2 - slant, p.h - 3], [0, p.h - 3]];
        fillQuad(buf, p.w, p.h, quad, [accent[0], accent[1], accent[2], 255]);
        const ink = this.theme.rule && this.theme.name === 'Shadow Comfort' ? [16, 28, 48, 255] : [22, 12, 8, 255];
        const font = textRaster.loadFont(p.font);
        const cell = font.metrics.cellHeight || p.h;
        const tw = Math.max(1, Math.ceil(textRaster.measure(gear || '-', p.font, 0)) + 2);
        const small = textRaster.drawText(tw, cell, gear || '-', { font: p.font, color: ink, align: 'center' });
        let bw = tw, bh = cell, src = small;
        if (bh > p.h - 12 || bw > p.w - slant - 12) {
            const s = Math.min((p.h - 12) / bh, (p.w - slant - 12) / bw);
            bw = Math.max(1, Math.round(tw * s));
            bh = Math.max(1, Math.round(cell * s));
            src = scaleInto(small, tw, cell, bw, bh);
        }
        blit(buf, p.w, p.h, src, bw, bh, Math.round((p.w - slant) / 2 + slant * 0.25 - bw / 2), Math.round((p.h - bh) / 2));
        return buf;
    }
}

/** Bilinear scale of a straight-alpha RGBA buffer. */
function scaleInto(src, sw, sh, dw, dh) {
    const dst = Buffer.alloc(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
        const sy = (y + 0.5) * sh / dh - 0.5;
        const y0 = Math.max(0, Math.floor(sy));
        const y1 = Math.min(sh - 1, y0 + 1);
        const fy = sy - y0;
        for (let x = 0; x < dw; x++) {
            const sx = (x + 0.5) * sw / dw - 0.5;
            const x0 = Math.max(0, Math.floor(sx));
            const x1 = Math.min(sw - 1, x0 + 1);
            const fx = sx - x0;
            const o = (y * dw + x) * 4;
            for (let c = 0; c < 4; c++) {
                const a = src[(y0 * sw + x0) * 4 + c];
                const b = src[(y0 * sw + x1) * 4 + c];
                const d = src[(y1 * sw + x0) * 4 + c];
                const e = src[(y1 * sw + x1) * 4 + c];
                dst[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
            }
        }
    }
    return dst;
}

/** Top of the buffer leans right by `k` pixels per pixel of height. */
function shear(src, w, h, k) {
    if (!k) return src;
    const dst = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        const shift = (h - 1 - y) * k;
        for (let x = 0; x < w; x++) {
            const sx = x - shift;
            const x0 = Math.floor(sx);
            const x1 = x0 + 1;
            const fx = sx - x0;
            if (x1 < 0 || x0 >= w) continue;
            const o = (y * w + x) * 4;
            for (let c = 0; c < 4; c++) {
                const a = x0 >= 0 ? src[(y * w + x0) * 4 + c] : 0;
                const b = x1 < w ? src[(y * w + x1) * 4 + c] : 0;
                dst[o + c] = a * (1 - fx) + b * fx;
            }
        }
    }
    return dst;
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

function grow(quad, px) {
    const cx = quad.reduce((s, p) => s + p[0], 0) / quad.length;
    const cy = quad.reduce((s, p) => s + p[1], 0) / quad.length;
    return quad.map((p) => {
        const dx = p[0] - cx, dy = p[1] - cy;
        const len = Math.hypot(dx, dy) || 1;
        return [p[0] + dx / len * px, p[1] + dy / len * px];
    });
}

function blit(dst, dw, dh, src, sw, sh, dx, dy) {
    for (let y = 0; y < sh; y++) {
        const yy = dy + y;
        if (yy < 0 || yy >= dh) continue;
        for (let x = 0; x < sw; x++) {
            const xx = dx + x;
            if (xx < 0 || xx >= dw) continue;
            const s = (y * sw + x) * 4;
            const a = src[s + 3] / 255;
            if (a <= 0) continue;
            const o = (yy * dw + xx) * 4;
            const ia = 1 - a;
            dst[o] = src[s] * a + dst[o] * ia;
            dst[o + 1] = src[s + 1] * a + dst[o + 1] * ia;
            dst[o + 2] = src[s + 2] * a + dst[o + 2] * ia;
            dst[o + 3] = Math.min(255, src[s + 3] + dst[o + 3] * ia);
        }
    }
}

module.exports = ShadowDash;
