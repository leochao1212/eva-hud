'use strict';
/**
 * eva_page.js - EVA's own centre-screen page on iDrive 7, in place of BMW's settings list: the NERV cockpit (EVA-01's
 * hologram, water / oil / boost, MAGI's three votes) and the settings, as two tabs in the kit's header.
 *
 * Drawn on the kit's canvas screen (app.json MAIN "kind": "canvas"; kit/runtime/display.js), the way bimmer-lab's
 * Cluster Themes draws its page (shared/page.js there, MIT): on the Store's renderer (mgu-render/1) the kit runs the
 * screen itself - every tap and controller press lands on a target (cv.target), the header's tabs take the
 * controller, and the renderer says when the app is in front - and without it the same drawing goes to the HMI as a
 * picture. This replaces 0.8.x's cockpit, a cluster-render style layer pushed onto mgu-render (eva_centre.js), whose
 * taps leaked through to the HMI. The kit's own settings sheet stays one tap away (the bar's All settings).
 *
 *   new EvaPage(ctx, hud).start();
 *
 * Text: the kit's atlases, baked from EVA's type by tools/bake_kit_fonts.py (Barlow Condensed; Matisse for CJK).
 * Plain Node 8 (the car's 8.16.2).
 */
const G = require('./kit/gauges');
const rec = require('./kit/record');
const themes = require('./kit/themes');
const hudData = require('./hud_data');
const path = require('path');

// the page speaks Traditional Chinese (the kit's own text is fixed to the build's language, English): the kit's
// zh-TW catalog, which the native settings list uses on a zh_TW head unit too
let ZH = {};
try { ZH = require(path.join(__dirname, 'kit', 'locales', 'zh-TW.json')); } catch (e) { /* English then */ }
const tr = (s) => (Object.prototype.hasOwnProperty.call(ZH, s) ? ZH[s] : s);

const W = 1600, H = 520;
const A = G.withAlpha;
const C = {
    bg: '#040506', orange: '#ff8800', orangeDim: '#a85a00', text: '#f2ece4', dim: '#9a8b78', label: '#76695a',
    line: '#ff880033', green: '#4fe39a', red: '#ff3b30', glass: '#0b0907',
};
const TABS = [['cockpit', '駕駛艙'], ['settings', '設定']];
const HOLO = { id: 0x45564101, x: 30, y: 10, w: 352, h: 456 };     // EVA-01 cut from hud/photos/cockpit.rgba (1280x480)
const VOTE = { ok: ['承認', C.green], no: ['否決', C.red], wait: ['審議中', C.orange] };
// the Settings tab's rows: the Mode, then the designs the Mode uses, then these
const ALWAYS = ['dashTransitionStyle', 'alertsOn', 'motto', 'demo'];
const PER_MODE = ['hudComfort', 'hudSport', 'hudEco', 'dashComfort', 'dashSport', 'dashEco',
    'bothHudComfort', 'bothHudSport', 'bothHudEco', 'bothDashComfort', 'bothDashSport', 'bothDashEco'];

// the kit's own chrome (header, bar, settings sheet) in NERV orange
function nervChrome(t) { Object.assign(t, { sel: C.orange, selText: '#ffffff', accent: C.orange, accent2: '#ffb347', bg: C.bg }); }

class EvaPage {
    constructor(ctx, hud) {
        this.ctx = ctx; this.hud = hud;
        this.tab = 'cockpit';
        this.picker = null;          // a setting's key while its list of choices is open over the page
        this.loop = null;
        this.holo = this._holo();
        Object.keys(themes.THEMES).forEach((k) => nervChrome(themes.THEMES[k]));
    }

    start() {
        const ctx = this.ctx;
        if (ctx.onTab) ctx.onTab((i) => { if (TABS[i]) { this.tab = TABS[i][0]; this.picker = null; this.kick(); } });
        this.loop = ctx.loop('MAIN', 10, () => this.render());
        ctx.settings.onChange(() => this.kick());
        if (ctx.onLayout) ctx.onLayout(() => this.kick());
        this.render();
    }
    kick() { if (this.loop && this.loop.kick) this.loop.kick(); }

    /** EVA-01 alone, out of the 0.8 cockpit picture: its baked captions blacked out (the page draws its own). */
    _holo() {
        const src = hudData.bytes && hudData.bytes('photos/cockpit.rgba');
        if (!src || src.length !== 1280 * 480 * 4) return null;
        const { x, y, w, h } = HOLO, px = Buffer.alloc(w * h * 4);
        for (let r = 0; r < h; r++) src.copy(px, r * w * 4, ((y + r) * 1280 + x) * 4, ((y + r) * 1280 + x + w) * 4);
        const black = (x0, y0, x1, y1) => {
            for (let r = Math.max(0, y0 - y); r < Math.min(h, y1 - y); r++) {
                for (let c = Math.max(0, x0 - x); c < Math.min(w, x1 - x); c++) { const o = (r * w + c) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
            }
        };
        black(0, 436, 160, 480);       // 変速機 UNIT-01
        black(270, 436, 330, 480);     // SYNC
        rec.setImage(HOLO.id, w, h, px);
        return { w, h };
    }

    /* ---------- settings ---------- */
    get(k) { return this.hud.setting(k); }
    item(k) { return this.ctx.settings.item(k); }
    set(k, v) { if (this.ctx.settings.get(k) !== v) this.ctx.settings.set(k, v); this.kick(); }
    optLabel(k, v) { const s = this.item(k), o = s && (s.options || []).find((x) => x[0] === v); return o ? tr(o[1]) : String(v); }
    valueText(k) {
        const s = this.item(k), v = this.get(k);
        if (!s) return '';
        if (s.type === 'bool') return tr(v ? 'On' : 'Off');
        return this.optLabel(k, v);
    }
    /** As the kit's lists: shown when any one of the item's showWhen conditions holds (none: always). */
    shown(k) {
        const s = this.item(k);
        if (!s) return false;
        const when = s.showWhen;
        if (!when || !when.length) return true;
        return when.some((c) => Object.keys(c).every((key) => this.get(key) === c[key]));
    }
    rows() { return ['screens'].concat(PER_MODE, ALWAYS).filter((k) => this.shown(k)); }

    /* ---------- drawing ---------- */
    render() {
        const cv = this.ctx.canvas(W, H);
        const bottom = G.pageBottom(cv);
        cv.clear(C.bg);
        cv.gradientRect(0, 0, W, bottom + 8, [[0, '#120a02'], [0.5, '#070605'], [1, C.bg]]);
        const dd = this.hud.car && this.hud.car.data();
        const on = this.hud.activeName && this.hud.activeName !== 'off';
        G.frame(cv, this.ctx.theme(), TABS.map((x) => x[1]), TABS.findIndex((x) => x[0] === this.tab), [
            dd && dd.demo ? { text: 'DEMO', color: '#ffb020' } : null,
            { text: on ? 'NERV // 同期中' : 'NERV // 待機', color: on ? C.green : C.dim },
        ]);
        const target = cv.target;
        if (this.picker) cv.target = function () { return this; };     // the list over the page takes the taps
        if (this.tab === 'settings') this.settingsTab(cv, bottom); else this.cockpitTab(cv, bottom);
        cv.target = target;
        if (this.picker) this.drawPicker(cv, bottom);
        return this.ctx.ui.image('MAIN_GFX', cv);
    }

    /* ---------- the cockpit ---------- */
    cockpitTab(cv, bottom) {
        const top = 48, hh = bottom - top - 8;
        // EVA-01, in its orange corner brackets
        let x0 = 16, hw = 0;
        if (this.holo) {
            hw = Math.round(this.holo.w * hh / this.holo.h);
            cv.image(HOLO.id, x0, top, hw, hh);
        } else hw = Math.round(hh * 0.77);
        brackets(cv, x0 - 6, top - 4, hw + 12, hh + 8, 26, C.orange);
        cv.text('初号機', x0 + 10, top + hh - 14, 20, C.dim);
        cv.text('UNIT-01', x0 + 84, top + hh - 14, 18, C.dim, { font: 'label', literal: true });
        const sync = this.hud._token ? this.hud._token('sync') : '--';
        cv.text('SYNC ' + sync + '%', x0 + hw - 10, top + hh - 14, 18, C.orange, { align: 'right', font: 'bold', literal: true });

        // readouts
        const L = x0 + hw + 36, R = W - 16, colW = (R - L) / 3;
        const d = (this.hud.car && this.hud.car.data()) || {};
        const boost = this.hud._boost ? this.hud._boost() : null;
        const num = (v, digits) => (typeof v === 'number' && isFinite(v) ? v.toFixed(digits) : '--');
        const reads = [
            ['水温', 'WATER', num(d.coolant, 0), '°C'],
            ['油温', 'OIL', num(d.oil, 0), '°C'],
            ['増圧', 'BOOST', num(boost, 2), 'BAR'],
        ];
        reads.forEach((r, i) => {
            const x = L + i * colW, y = top + 4, w = colW - 18, h = 168;
            glass(cv, x, y, w, h);
            cv.text(r[0], x + 20, y + 40, 28, C.orange);
            cv.text(r[1], x + 88, y + 38, 18, C.dim, { font: 'label', literal: true, spacing: 2 });
            cv.text(r[2], x + w - 76, y + 140, 96, C.text, { align: 'right', font: 'num', literal: true });
            cv.text(r[3], x + w - 18, y + 140, 22, C.dim, { align: 'right', font: 'bold', literal: true });
        });

        // MAGI
        const m = this.hud._magi ? this.hud._magi() : { melchior: 'wait', balthasar: 'wait', casper: 'wait', tone: 'wait', word: '審議中', sub: '' };
        const my = top + 196;
        cv.text('MAGI SYSTEM', L, my + 22, 24, C.dim, { font: 'bold', literal: true, spacing: 2 });
        cv.text('出撃判定', L + 200, my + 22, 22, C.label);
        const toneC = (VOTE[m.tone] || VOTE.wait)[1];
        cv.text(m.word, R - 4, my + 26, 30, toneC, { align: 'right' });
        const cards = [['MELCHIOR·1', '油温', m.melchior], ['BALTHASAR·2', '水温', m.balthasar], ['CASPER·3', '駆動', m.casper]];
        const cy = my + 40, chh = bottom - cy - 34;
        cards.forEach((c, i) => {
            const x = L + i * colW, w = colW - 18, v = VOTE[c[2]] || VOTE.wait;
            cv.card(x, cy, w, chh, 14, [[0, A(v[1], 0.16)], [1, A(v[1], 0.03)]]);
            cv.strokeRoundRect(x, cy, w, chh, 14, 2, A(v[1], 0.85));
            cv.text(c[0], x + 16, cy + 28, 17, v[1], { font: 'bold', literal: true, spacing: 1.5 });
            cv.text(v[0], x + w / 2, cy + chh / 2 + 18, 46, v[1], { align: 'center' });
            cv.text(c[1], x + w / 2, cy + chh - 14, 18, C.dim, { align: 'center' });
        });
        cv.text(m.sub || '', R - 4, bottom - 8, 16, C.label, { align: 'right', literal: true });
    }

    /* ---------- the settings ---------- */
    settingsTab(cv, bottom) {
        const keys = this.rows();
        const L = 24, R = W - 24, colW = (R - L - 24) / 2, per = Math.ceil(keys.length / 2);
        const top = 56, fits = (pitch) => top + per * pitch <= bottom - 30;
        const h = fits(64) ? 56 : 46, pitch = h === 56 ? 64 : 52;
        keys.forEach((k, i) => {
            const x = L + (i < per ? 0 : colW + 24), y = top + (i % per) * pitch;
            if (y + h > bottom) return;
            const s = this.item(k);
            if (s.type === 'bool') this.toggleRow(cv, x, y, colW, k, h);
            else this.pickRow(cv, x, y, colW, k, h);
        });
        cv.text([this.hud.lastStatus, this.hud.dash && this.hud.dash.lastStatus].filter(Boolean).join('  /  '), L, bottom - 8, 15, C.label, { literal: true });
    }
    rowBox(cv, x, y, w, k, h) {
        glass(cv, x, y, w, h);
        cv.roundRect(x, y + 10, 3, h - 20, 1.5, C.orange);
        const base = y + h / 2 + 7;
        cv.text(tr(this.item(k).label), x + 20, base, 20, C.text, { literal: true });
        return base;
    }
    pickRow(cv, x, y, w, k, h) {
        const base = this.rowBox(cv, x, y, w, k, h);
        cv.text(this.valueText(k), x + w - 40, base, 19, C.orange, { align: 'right', literal: true });
        chevron(cv, x + w - 22, y + h / 2, C.orange);
        cv.target(x, y, w, h, () => { this.picker = k; this.kick(); }, 'row:' + k, 12);
    }
    toggleRow(cv, x, y, w, k, h) {
        this.rowBox(cv, x, y, w, k, h);
        const on = !!this.get(k), sw = 58, sh = 30, sx = x + w - sw - 18, sy = y + (h - sh) / 2;
        cv.roundRect(sx, sy, sw, sh, sh / 2, on ? C.orange : '#ffffff22');
        cv.circle(on ? sx + sw - sh / 2 : sx + sh / 2, sy + sh / 2, sh / 2 - 4, on ? '#000000' : C.dim);
        cv.target(x, y, w, h, () => this.set(k, !on), 'toggle:' + k, 12);
    }
    drawPicker(cv, bottom) {
        const k = this.picker, s = this.item(k), opts = (s && s.options) || [];
        cv.fillRect(0, 36, W, bottom + 20, '#000000c0');
        const cols = opts.length > 12 ? 3 : opts.length > 6 ? 2 : 1, per = Math.ceil(opts.length / cols);
        const rh = Math.min(54, Math.floor((bottom - 44 - 86) / per));          // every choice on the screen
        const w = [620, 1040, 1440][cols - 1], h = 76 + per * rh, x = (W - w) / 2, y = Math.max(44, (bottom + 44 - h) / 2);
        cv.card(x, y, w, h, 16, [[0, '#1d1206'], [1, '#0a0705']]);
        cv.strokeRoundRect(x, y, w, h, 16, 1.5, A(C.orange, 0.5));
        cv.text(tr(s.label), x + 26, y + 42, 18, C.orange, { literal: true });
        const v = this.get(k), cw = (w - 24) / cols;
        opts.forEach((o, i) => {
            const cx = x + 12 + Math.floor(i / per) * cw, ry = y + 58 + (i % per) * rh, sel = o[0] === v;
            if (sel) cv.roundRect(cx, ry, cw - 8, rh - 6, 10, A(C.orange, 0.30));
            cv.text(tr(o[1]), cx + 18, ry + rh / 2 + 6, 19, sel ? '#ffffff' : C.text, { font: sel ? 'bold' : 'label', literal: true });
            cv.target(cx, ry, cw - 8, rh - 6, () => { this.picker = null; this.set(k, o[0]); }, 'pick:' + k + ':' + o[0], 10);
        });
        cv.target(0, 36, W, bottom, () => { this.picker = null; this.kick(); }, 'pick:close');
    }
}

/* ---------- small pieces ---------- */
function glass(cv, x, y, w, h) {
    cv.card(x, y, w, h, 12, [[0, '#ffffff10'], [1, '#ffffff05']]);
    cv.strokeRoundRect(x, y, w, h, 12, 1, C.line);
}
/** NERV's corner brackets round x, y, w, h: arms of length a. */
function brackets(cv, x, y, w, h, a, c) {
    const t = 4;
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([px, py, sx, sy]) => {
        cv.fillRect(sx > 0 ? px : px - a, sy > 0 ? py : py - t, a, t, c);
        cv.fillRect(sx > 0 ? px : px - t, sy > 0 ? py : py - a, t, a, c);
    });
}
function chevron(cv, x, y, c) { cv.line(x - 5, y - 7, x + 2, y, 2.5, c); cv.line(x + 2, y, x - 5, y + 7, 2.5, c); }

module.exports = EvaPage;
