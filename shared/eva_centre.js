'use strict';
/**
 * The EVA centre-screen cockpit: a third EvaHud view, drawn on the CENTRE display through mgu-render
 * (not the cluster's cluster-render). It reuses the HUD's car data, engine unit and alert rules (like
 * eva_dash) and loads hud/layouts/dash_cockpit.json: the EVA-01 hologram, live water/oil/boost and the
 * MAGI verdict. It points at /run/mgu-render/render.sock, so hud.js uses the mgu-render adapter
 * (shared/mgu_render_adapter.js) with the 'centre' target: the cockpit is drawn in a 1280x480 design
 * space scaled into the HMI's app area (fullScreen stays off - covering the RHMI frame makes the HMI
 * fight back and flicker, 0.8.2). The 0.8.6 log line "mgu-render place: screen ... appArea ... scale"
 * is the first thing to read when the centre screen stays empty.
 *
 * Touch settings (replacing the native RHMI settings page): the adapter claims touch areas and emits
 * 'touch' in design px. A gear top-right opens a settings panel drawn here; tapping a row cycles that
 * setting (ctx.settings.cycle, which persists), and "CLOSE" or the gear again closes it. Turning
 * COCKPIT off brings the native screen back, so the native settings stay reachable. The physical iDrive
 * BACK button is always an escape too.
 */
const EvaHud = require('./eva_hud');
const textRaster = require('./hud_text');
const { color } = require('./hud_themes');

const MGU_SOCKET = '/run/mgu-render/render.sock';   // the centre-screen renderer; hud.js picks the adapter for it
const TEXT_MS = 250;
const UI_FONT = 'e_ui';
const PROFILE_KEY = { comfort: 'Comfort', sport: 'Sport', eco: 'Eco' };
const PANEL_TOP = 86;      // first row, from the panel's top
const ROW_H = 54;

/** Alpha-composite a src RGBA buffer (SW x SH) onto dst (DW x DH) at (dx, dy). */
function blit(dst, DW, DH, src, SW, SH, dx, dy) {
    for (let y = 0; y < SH; y++) {
        const ty = dy + y;
        if (ty < 0 || ty >= DH) continue;
        for (let x = 0; x < SW; x++) {
            const tx = dx + x;
            if (tx < 0 || tx >= DW) continue;
            const s = (y * SW + x) * 4, sa = src[s + 3];
            if (!sa) continue;
            const o = (ty * DW + tx) * 4, da = dst[o + 3];
            const a = sa + da * (255 - sa) / 255;
            for (let k = 0; k < 3; k++) dst[o + k] = Math.round((src[s + k] * sa + dst[o + k] * da * (255 - sa) / 255) / (a || 1));
            dst[o + 3] = Math.round(a);
        }
    }
}

class EvaCentre extends EvaHud {
    constructor(ctx, primary) {
        super(ctx, { primary, target: 'centre', statusName: 'CENTRE', clientName: ctx.spec.id + '_centre',
            socketPath: MGU_SOCKET, textRateMs: TEXT_MS, fullScreen: false });
        this.primary = primary;
        this.readings = primary.readings;
        this.settingsOpen = false;
        this._touchWired = false;
    }

    /** One fixed cockpit design, on when the `centre` setting is on. */
    _layoutName() { return this.setting('centre') === 'on' ? 'cockpit' : 'off'; }
    _layoutFile(name) { return name === 'off' ? name : 'dash_' + name; }
    _followsDriveMode() { return false; }
    _isBigImage(w) { return ['evaphoto', 'evacanvas', 'evagear', 'uigear', 'uipanel'].indexOf(w.type) >= 0; }
    _yieldToPopup() { return false; }   // the mgu-render adapter handles the foreground gate itself

    /* the HUD owns the data; mirror eva_dash */
    _setupVehicleData() { this.car = this.view.primary.car; this.score = this.view.primary.score; }
    _startDme() {}
    _startReads() {}
    _liveSetting() {}
    _pedal() { return this.primary._pedal(); }
    _boost() { return this.primary._boost(); }
    _range() { return this.primary._range(); }
    _alertNow() { return this.primary.alertShow; }

    start() {
        super.start();
        this._wireTouch();
    }

    _wireTouch() {
        if (this._touchWired || !this.client || !this.client.on) return;
        this._touchWired = true;
        this.client.on('touch', (phase, x, y) => this._guard('touch', () => this._onTouch(phase, x, y)));
    }

    _rebuildInner() {
        this.settingsOpen = false;      // a fresh layout starts with the panel closed
        super._rebuildInner();
    }

    /* ---------------- the settings rows ---------------- */

    /** The dash-design setting for the current mode and drive profile. */
    _dashKey() {
        const p = PROFILE_KEY[this._driveProfile()] || 'Comfort';
        return (this._screens() === 'both' ? 'bothDash' : 'dash') + p;
    }
    _rows() {
        return [
            { label: 'COCKPIT', key: 'centre' },
            { label: 'MODE', key: 'screens' },
            { label: 'DASH', key: this._dashKey() },
            { label: 'DEMO', key: 'demo' },
        ];
    }
    _valText(key) {
        const v = this.ctx.settings.get(key);
        return (v === undefined || v === null ? '-' : String(v)).toUpperCase();
    }

    /* ---------------- the gear + panel layers ---------------- */

    _create(w) {
        if (w.type === 'uigear' || w.type === 'uipanel') { this._createUi(w); return; }
        super._create(w);
    }
    _update(x, now, force) {
        if (x.w.type === 'uigear') return;              // static icon
        if (x.w.type === 'uipanel') { this._updatePanel(x, force); return; }
        super._update(x, now, force);
    }

    _createUi(w) {
        const base = { target: this.target, klass: w.class || 'overlay', z: w.z || 0, x: w.x, y: w.y, w: w.w, h: w.h, iw: w.w, ih: w.h };
        const ref = this.client.image(base);
        if (!ref) { this.log.warn('ui "' + w.id + '": layer refused'); return; }
        const x = { w, ref, look: null };
        this.widgets.set(w.id, x);
        if (w.type === 'uigear') {
            this.client.pixels(ref, null, this._paintGear(w));
            this.client.set(ref, { visible: 1 });
        } else {
            this.client.set(ref, { visible: this.settingsOpen ? 1 : 0 });
            if (this.settingsOpen) this.client.pixels(ref, null, this._paintPanel(w));
        }
        this._claimUi();
    }

    _updatePanel(x, force) {
        if (!this.settingsOpen) return;
        const look = this._rows().map((r) => r.key + '=' + this._valText(r.key)).join('|');
        if (!force && look === x.look) return;
        x.look = look;
        this.client.pixels(x.ref, null, this._paintPanel(x.w));
    }

    _onTouch(phase, x, y) {
        if (phase !== 'down') return;
        this.log.info('centre touch down ' + Math.round(x) + ',' + Math.round(y) + ' open=' + this.settingsOpen);
        const g = this.widgets.get('uigear');
        if (g && this._hit(g.w, x, y)) { this._toggleSettings(); return; }
        if (!this.settingsOpen) return;
        const p = this.widgets.get('uipanel');
        if (!p || !this._hit(p.w, x, y)) return;        // taps outside the panel do nothing
        const rows = this._rows();
        const i = Math.floor((y - p.w.y - PANEL_TOP) / ROW_H);
        if (y < p.w.y + PANEL_TOP || i < 0) return;
        if (i >= rows.length) { this._toggleSettings(); return; }   // the CLOSE band
        const key = rows[i].key;
        this.ctx.settings.cycle(key);
        this.log.info('centre cycle ' + key + ' -> ' + this.ctx.settings.get(key));
        this._updatePanel(p, true);
    }

    _hit(w, x, y) { return x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h; }

    _toggleSettings() {
        this.settingsOpen = !this.settingsOpen;
        const p = this.widgets.get('uipanel');
        if (p) {
            if (this.settingsOpen) { p.look = null; this.client.pixels(p.ref, null, this._paintPanel(p.w)); }
            this.client.set(p.ref, { visible: this.settingsOpen ? 1 : 0 });
        }
        this._claimUi();
        this.log.info('centre settings ' + (this.settingsOpen ? 'OPEN' : 'closed'));
    }

    _claimUi() {
        // Claim the WHOLE cockpit area so a tap anywhere on it is ours. Otherwise taps fall through to the
        // HMI underneath, which navigates away to its own screen (the "jumps back to the old page" bug).
        // The gear/panel are hit-tested in _onTouch; the top bar and BACK/HOME are outside the app area, so
        // they are not claimed and keep working.
        const rects = [{ x: 0, y: 0, w: this.size[0], h: this.size[1] }];
        if (this.client.claim) this.client.claim(rects);
    }

    /* ---------------- painting ---------------- */

    _paintGear(w) {
        const W = w.w, H = w.h, c = color(this.theme, 'fg');
        const buf = Buffer.alloc(W * H * 4);
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 3, rin = R * 0.4, teeth = 8;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
                const tooth = Math.cos(Math.atan2(dy, dx) * teeth) > 0.1 ? R : R * 0.8;
                if (d <= tooth && d >= rin) {
                    const o = (y * W + x) * 4;
                    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 235;
                }
            }
        }
        return buf;
    }

    _paintPanel(w) {
        const W = w.w, H = w.h, buf = Buffer.alloc(W * H * 4);
        const fg = color(this.theme, 'fg'), ok = color(this.theme, 'ok') || fg, soft = color(this.theme, 'soft') || [170, 180, 185];
        const ch = textRaster.loadFont(UI_FONT).metrics.cellHeight;
        for (let i = 0; i < buf.length; i += 4) { buf[i] = 6; buf[i + 1] = 9; buf[i + 2] = 13; buf[i + 3] = 238; }   // dark ground
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {                                                   // 2px green frame
            if (y < 2 || y >= H - 2 || x < 2 || x >= W - 2) { const o = (y * W + x) * 4; buf[o] = ok[0]; buf[o + 1] = ok[1]; buf[o + 2] = ok[2]; buf[o + 3] = 255; }
        }
        const draw = (text, dx, dy, bw, bh, c, align, glow) => {
            const t = textRaster.drawText(bw, bh, text, { font: UI_FONT, color: c, align: align || 'left', glow: glow ? this.theme.glow : 0, offsetY: Math.round((bh - ch) / 2) });
            blit(buf, W, H, t, bw, bh, dx, dy);
        };
        draw('SETTINGS', 26, 20, 420, 44, fg, 'left', true);
        draw('NERV CONFIG', W - 26 - 300, 24, 300, 36, soft, 'right', false);
        this._rows().forEach((r, i) => {
            const ry = PANEL_TOP + i * ROW_H;
            draw(r.label, 26, ry, 360, ROW_H, soft, 'left', false);
            draw(this._valText(r.key), W - 26 - 440, ry, 440, ROW_H, fg, 'right', true);
            for (let x = 26; x < W - 26; x++) { const o = ((ry + ROW_H - 1) * W + x) * 4; buf[o] = ok[0]; buf[o + 1] = ok[1]; buf[o + 2] = ok[2]; buf[o + 3] = 40; }
        });
        draw('CLOSE', 0, PANEL_TOP + this._rows().length * ROW_H, W, ROW_H, fg, 'center', true);
        return buf;
    }
}

module.exports = EvaCentre;
