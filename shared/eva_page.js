'use strict';
/**
 * eva_page.js - EVA's own centre-screen page on iDrive 7, in place of BMW's settings list, as tabs in the kit's header:
 * the NERV cockpit (EVA-01's hologram, water / oil / boost, MAGI's three votes), the cluster, the HUD, the alerts and
 * the system settings. The cluster and the HUD each have an on / off switch (together they are the "screens" Mode) and
 * one design per drive mode, whatever the other screen does (a pick sets the Dash only and the HUD + Dash key alike).
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
const sheets = require('./kit/sheet');
const rec = require('./kit/record');
const themes = require('./kit/themes');
const hudData = require('./hud_data');
const path = require('path');

// the page speaks Traditional Chinese (the kit's own text is fixed to the build's language, English): the kit's
// zh-TW catalog, which the native settings list uses on a zh_TW head unit too
let ZH = {};
try { ZH = require(path.join(__dirname, 'kit', 'locales', 'zh-TW.json')); } catch (e) { /* English then */ }
const KEEP_EN = ['Comfort', 'Sport', 'Eco Pro'];       // the drive modes stay in English, as BMW writes them
const tr = (s) => (KEEP_EN.indexOf(s) < 0 && Object.prototype.hasOwnProperty.call(ZH, s) ? ZH[s] : s);

const W = 1600, H = 520;
const A = G.withAlpha;
const C = {
    bg: '#040506', orange: '#ff8800', orangeDim: '#a85a00', text: '#f2ece4', dim: '#9a8b78', label: '#76695a',
    line: '#ff880033', green: '#4fe39a', red: '#ff3b30', glass: '#0b0907',
};
const TABS = [['cockpit', '駕駛艙'], ['dash', '儀表'], ['hud', 'HUD'], ['alerts', '警示'], ['system', '系統']];
const HOLO = { id: 0x45564101, x: 30, y: 10, w: 352, h: 456 };     // EVA-01 cut from hud/photos/cockpit.rgba (1280x480)
const VOTE = { ok: ['承認', C.green], no: ['否決', C.red], wait: ['審議中', C.orange] };
const MODES = [['Comfort', 'comfort'], ['Sport', 'sport'], ['Eco', 'eco']];
const MODE_NAME = { Comfort: 'Comfort', Sport: 'Sport', Eco: 'Eco Pro' };
const LIMIT_KEYS = ['limitHeat', 'limitBoost', 'limitKnock', 'limitFuel', 'limitAfrLow', 'limitAfrHigh'];
// the alert limits say which way they trip (the settings' own names are for the native list)
const LIMIT_LABEL = { limitHeat: '水溫 ≥', limitBoost: '增壓 ≥', limitKnock: '爆震點火延遲 ≥', limitFuel: '燃油軌壓 ≤', limitAfrLow: '空燃比（過濃）≤', limitAfrHigh: '空燃比（過稀）≥' };
const PSI_PER_BAR = 14.5038;
// MAGI's three, each with what it watches: the reason first, the vote under it
const MAGI = [
    ['MELCHIOR·1', 'melchior', { ok: '油溫正常', wait: '油溫未達溫', no: '油溫過高' }],
    ['BALTHASAR·2', 'balthasar', { ok: '水溫正常', wait: '水溫未達溫', no: '水溫過高' }],
    ['CASPER·3', 'casper', { ok: '行駛就緒', wait: '停車／待機', no: '轉速過高' }],
];
const SYSTEM_KEYS = ['motto', 'gmtOffset', 'redline', 'shiftBefore', 'coldGuard', 'demo'];
const T = { row: 26, value: 24, pick: 24 };     // text sizes (page px; the kit scales the page up to the screen)

// the kit's own chrome (header, bar, settings sheet) in NERV orange
function nervChrome(t) { Object.assign(t, { sel: C.orange, selText: '#ffffff', accent: C.orange, accent2: '#ffb347', bg: C.bg, tabSize: 28 }); }

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
        if (s.type === 'number') return String(v) + (s.unit ? ' ' + s.unit : '');
        return this.optLabel(k, v);
    }
    /** A setting's choices as [value, label], without iDrive 8's designs on this page. */
    choices(k) {
        const s = this.item(k);
        if (!s) return [];
        if (s.type === 'number') return (s.steps || []).map((v) => [v, String(v) + (s.unit ? ' ' + s.unit : '')]);
        return (s.options || []).filter((o) => !/ID8/.test(o[1])).map((o) => [o[0], tr(o[1])]);
    }

    /**
     * A setting's list of choices. With the Store's renderer the kit's sheet shows it (sheet.js: the controller turns
     * along the choices only, a press picks, tilting left or Back closes it); without it (the HMI's picture, the bench)
     * the list is drawn over the page here.
     */
    openChoices(p) {
        const d = this.ctx.display;
        if (d && d.openSheet && d.canSheet && d.canSheet() && d.openSheet(choiceSheet(this, p))) return;
        this.picker = p;
        this.kick();
    }

    /* the Mode, as two switches: the HUD (hud, both, grid) and the cluster (dash, both) */
    dashOn() { const m = this.get('screens'); return m === 'dash' || m === 'both'; }
    hudOn() { const m = this.get('screens'); return m === 'hud' || m === 'both' || m === 'grid'; }
    setScreens(hud, dash) {
        // the designs showing now go to the other Mode's keys first, so a switch never changes what the other screen shows
        ['Hud', 'Dash'].forEach((what) => MODES.forEach(([mode]) => this.pickDesign(what, mode, this.get(this.designKey(what, mode)))));
        this.set('screens', hud && dash ? 'both' : hud ? 'hud' : dash ? 'dash' : 'off');
    }
    /** The key a drive mode's design is read from now, and every key a pick goes to (where that design exists). */
    designKey(what, mode) { return (this.get('screens') === 'both' ? 'both' + what : what.toLowerCase()) + mode; }
    pickDesign(what, mode, v) {
        [what.toLowerCase() + mode, 'both' + what + mode].forEach((k) => {
            const s = this.item(k);
            if (s && (s.options || []).some((o) => o[0] === v) && this.ctx.settings.get(k) !== v) this.set(k, v);
        });
    }

    /* ---------- drawing ---------- */
    render() {
        const cv = this.ctx.canvas(W, H);
        const bottom = G.pageBottom(cv);
        cv.clear(C.bg);
        cv.gradientRect(0, 0, W, bottom + 8, [[0, '#120a02'], [0.5, '#070605'], [1, C.bg]]);
        const dd = this.hud.car && this.hud.car.data();
        G.frame(cv, this.ctx.theme(), TABS.map((x) => x[1]), TABS.findIndex((x) => x[0] === this.tab), [
            dd && dd.demo ? { text: 'DEMO', color: '#ffb020' } : null,
            screenBadge('HUD', this.hud, this.hudOn()),
            screenBadge('儀表', this.hud.dash, this.dashOn()),
        ]);
        const target = cv.target;
        if (this.picker) cv.target = function () { return this; };     // the list over the page takes the taps
        const body = { cockpit: this.cockpitTab, dash: this.dashTab, hud: this.hudTab, alerts: this.alertsTab, system: this.systemTab }[this.tab];
        (body || this.cockpitTab).call(this, cv, bottom);
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
        cv.text('SYNC ' + sync + '%', x0 + hw - 10, top + hh - 14, 18, C.dim, { align: 'right', font: 'bold', literal: true });     // a theme line (from the revs)

        // readouts
        const L = x0 + hw + 36, R = W - 16, colW = (R - L) / 3;
        const d = (this.hud.car && this.hud.car.data()) || {};
        const boost = this.hud._boost ? this.hud._boost() : null;
        const num = (v, digits) => (typeof v === 'number' && isFinite(v) ? v.toFixed(digits) : '--');
        const reads = [
            ['水溫', 'WATER', num(d.coolant, 0), '°C'],
            ['油溫', 'OIL', num(d.oil, 0), '°C'],
            ['增壓', 'BOOST', num(typeof boost === 'number' ? boost * PSI_PER_BAR : null, 1), 'PSI'],
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
        const cy = my + 40, chh = bottom - cy - 34;
        MAGI.forEach(([name, who, why], i) => {
            const vote = m[who] || 'wait', x = L + i * colW, w = colW - 18, v = VOTE[vote] || VOTE.wait;
            cv.card(x, cy, w, chh, 14, [[0, A(v[1], 0.16)], [1, A(v[1], 0.03)]]);
            cv.strokeRoundRect(x, cy, w, chh, 14, 2, A(v[1], 0.85));
            cv.text(name, x + 16, cy + 28, 17, C.dim, { font: 'bold', literal: true, spacing: 1.5 });
            cv.text(v[0], x + w - 16, cy + 28, 20, v[1], { align: 'right', literal: true });
            cv.text(why[vote] || why.wait, x + w / 2, cy + chh / 2 + 22, 40, v[1], { align: 'center', literal: true });
        });
        cv.text(m.sub || '', R - 4, bottom - 8, 16, C.label, { align: 'right', literal: true });
    }

    /* ---------- the cluster and the HUD: a switch, then one design per drive mode ---------- */
    dashTab(cv, bottom) {
        const on = this.dashOn();
        this.switchCard(cv, 24, 54, W - 48, '儀表顯示', on ? 'EVA 儀表已啟用' : '關閉：顯示 BMW 原廠儀表', on,
            () => this.setScreens(this.hudOn(), !on), 'switch:dash');
        this.modeCards(cv, 'Dash', on, 150, 206);
        this.pickRow(cv, 24, 372, W - 48, 'dashTransitionStyle', 70);
    }
    hudTab(cv, bottom) {
        const on = this.hudOn();
        this.switchCard(cv, 24, 54, W - 48, 'HUD 顯示', on ? 'EVA HUD 已啟用' : '關閉：顯示 BMW 原廠 HUD', on,
            () => this.setScreens(!on, this.dashOn()), 'switch:hud');
        this.modeCards(cv, 'Hud', on, 150, 206);
    }
    /** Three cards, Comfort / Sport / Eco Pro: the design each drive mode shows; the one driven now is marked. */
    modeCards(cv, what, on, y, h) {
        const L = 24, gap = 20, w = (W - 48 - gap * 2) / 3, now = this.hud.driveMode;
        MODES.forEach(([mode, drive], i) => {
            const x = L + i * (w + gap), k = this.designKey(what, mode), cur = now === drive;
            cv.card(x, y, w, h, 16, [[0, A(C.orange, cur ? 0.20 : 0.08)], [1, '#ffffff05']]);
            cv.strokeRoundRect(x, y, w, h, 16, cur ? 2 : 1, cur ? C.orange : C.line);
            cv.text(MODE_NAME[mode], x + 28, y + 56, 40, on ? C.text : C.dim, { font: 'bold', literal: true });
            if (cur) cv.text('目前模式', x + w - 28, y + 52, 22, C.orange, { align: 'right', literal: true });
            cv.text(this.valueText(k), x + 28, y + 128, 30, on ? C.orange : C.dim, { literal: true });
            cv.text('點一下更換', x + 28, y + h - 26, 20, C.label, { literal: true });
            chevron(cv, x + w - 30, y + h - 34, on ? C.orange : C.dim);
            cv.target(x, y, w, h, () => this.openChoices({ key: k, title: MODE_NAME[mode] + ' · ' + (what === 'Dash' ? '儀表版面' : 'HUD 版面'), set: (v) => this.pickDesign(what, mode, v) }), 'mode:' + what + ':' + mode, 16);
        });
    }

    /* ---------- the alerts and the system: rows in two columns ---------- */
    alertsTab(cv, bottom) {
        const L = 24, gap = 24, colW = (W - 48 - gap) / 2, top = 54, h = 66, pitch = 76;
        this.toggleRow(cv, L, top, colW, 'alertsOn', h);
        // "hide the alerts showing now" is a one-off action (eva_hud.js turns the setting back off): a button
        const done = this.dismissedAt && Date.now() - this.dismissedAt < 2500;
        glass(cv, L, top + pitch, colW, h);
        cv.roundRect(L, top + pitch + 12, 3, h - 24, 1.5, C.orange);
        cv.text('隱藏目前警示', L + 24, top + pitch + h / 2 + 9, T.row, C.text, { literal: true });
        const bw = 150, bx = L + colW - bw - 16, by = top + pitch + 12;
        cv.roundRect(bx, by, bw, h - 24, (h - 24) / 2, done ? '#ffffff22' : C.orange);
        cv.text(done ? '已隱藏' : '隱藏', bx + bw / 2, by + (h - 24) / 2 + 8, 22, done ? C.dim : '#000000', { align: 'center', literal: true });
        cv.target(L, top + pitch, colW, h, () => { this.dismissedAt = Date.now(); this.set('dismissAlert', true); setTimeout(() => this.kick(), 2600); }, 'button:dismissAlert', 12);
        this.pickRow(cv, L, top + 2 * pitch, colW, 'alertPreview', h);
        if (this.item('fuelNotice')) this.toggleRow(cv, L, top + 3 * pitch, colW, 'fuelNotice', h);
        cv.text('警示會在解除後自動恢復；預覽和低油量提示只在停車時顯示。', L + 4, top + 4 * pitch + 30, 20, C.dim, { literal: true });
        const rx = L + colW + gap;
        cv.text('警示門檻', rx + 4, top + 26, 22, C.orange, { literal: true });
        const rh = Math.min(62, Math.floor((bottom - top - 50) / LIMIT_KEYS.length) - 8);
        LIMIT_KEYS.forEach((k, i) => this.pickRow(cv, rx, top + 40 + i * (rh + 8), colW, k, rh, LIMIT_LABEL[k]));
    }
    systemTab(cv, bottom) {
        const end = this.rowGrid(cv, SYSTEM_KEYS, bottom);
        // the kit's full list (every setting, in English): the bar's All settings, here too
        const x = 24, y = end, w = (W - 72) / 2, h = 70;
        if (y + h <= bottom - 24) {
            glass(cv, x, y, w, h);
            cv.text('全部設定', x + 24, y + h / 2 + 9, T.row, C.text, { literal: true });
            cv.text('完整清單（英文）', x + w - 44, y + h / 2 + 8, 20, C.dim, { align: 'right', literal: true });
            chevron(cv, x + w - 24, y + h / 2, C.orange);
            cv.target(x, y, w, h, () => { const d = this.ctx.display; if (d && d._click) d._click('BTN_SETTINGS'); }, 'all-settings', 12);
        }
        this.statusLines(cv, end + (y + h <= bottom - 24 ? h + 14 : 0), bottom);
    }
    /** keys as rows, two columns, from the top; returns the y under the left column. */
    rowGrid(cv, keys, bottom) {
        keys = keys.filter((k) => this.item(k));
        const L = 24, gap = 24, colW = (W - 48 - gap) / 2, per = Math.ceil(keys.length / 2), top = 54;
        const h = Math.min(70, Math.floor((bottom - top - 30) / per) - 10), pitch = h + 10;
        keys.forEach((k, i) => {
            const x = L + (i < per ? 0 : colW + gap), y = top + (i % per) * pitch;
            if (this.item(k).type === 'bool') this.toggleRow(cv, x, y, colW, k, h);
            else this.pickRow(cv, x, y, colW, k, h);
        });
        return top + per * pitch;
    }
    /** What each screen's engine says it does (layers, memory, why nothing shows): for checking on the car. */
    statusLines(cv, y, bottom) {
        const x = 24 + (W - 72) / 2 + 24;
        [['HUD', this.hud.lastStatus], ['儀表', this.hud.dash && this.hud.dash.lastStatus]].forEach(([name, text], i) => {
            const ly = y - 60 + i * 30;
            if (!text || ly > bottom - 4) return;
            cv.text(name, x, ly, 18, C.orange, { literal: true });
            let t = String(text);
            while (t.length > 8 && cv.textWidth(t, 17, { literal: true }) > W - 24 - x - 60) t = t.slice(0, -1);
            cv.text(t, x + 60, ly, 17, C.dim, { literal: true });
        });
    }

    /* ---------- pieces ---------- */
    switchCard(cv, x, y, w, name, sub, on, run, key) {
        const h = 80;
        glass(cv, x, y, w, h);
        cv.roundRect(x, y + 14, 4, h - 28, 2, on ? C.orange : C.dim);
        cv.text(name, x + 28, y + 50, 32, C.text, { literal: true });
        cv.text(sub, x + 260, y + 48, 22, on ? C.orange : C.dim, { literal: true });
        toggle(cv, x + w - 108, y + (h - 40) / 2, 84, 40, on);
        cv.target(x, y, w, h, run, key, 14);
    }
    rowBox(cv, x, y, w, k, h, label) {
        glass(cv, x, y, w, h);
        cv.roundRect(x, y + 12, 3, h - 24, 1.5, C.orange);
        const base = y + h / 2 + 9;
        cv.text(label || tr(this.item(k).label), x + 24, base, T.row, C.text, { literal: true });
        return base;
    }
    pickRow(cv, x, y, w, k, h, label) {
        const base = this.rowBox(cv, x, y, w, k, h, label);
        cv.text(this.valueText(k), x + w - 44, base, T.value, C.orange, { align: 'right', literal: true });
        chevron(cv, x + w - 24, y + h / 2, C.orange);
        cv.target(x, y, w, h, () => this.openChoices({ key: k, title: label || tr(this.item(k).label) }), 'row:' + k, 12);
    }
    toggleRow(cv, x, y, w, k, h) {
        this.rowBox(cv, x, y, w, k, h);
        const on = !!this.get(k);
        toggle(cv, x + w - 92, y + (h - 34) / 2, 70, 34, on);
        cv.target(x, y, w, h, () => this.set(k, !on), 'toggle:' + k, 12);
    }
    /** The open list of a setting's choices, over the page; a tap beside it closes it. */
    drawPicker(cv, bottom) {
        const p = this.picker, opts = this.choices(p.key), v = this.get(p.key);
        cv.fillRect(0, 36, W, bottom + 20, '#000000c8');
        const cols = opts.length > 12 ? 3 : opts.length > 6 ? 2 : 1, per = Math.ceil(opts.length / cols);
        const rh = Math.min(66, Math.floor((bottom - 44 - 90) / per));          // every choice on the screen
        const w = [700, 1140, 1520][cols - 1], h = 84 + per * rh, x = (W - w) / 2, y = Math.max(44, (bottom + 44 - h) / 2);
        cv.card(x, y, w, h, 18, [[0, '#1d1206'], [1, '#0a0705']]);
        cv.strokeRoundRect(x, y, w, h, 18, 1.5, A(C.orange, 0.55));
        cv.text(p.title, x + 28, y + 48, 26, C.orange, { literal: true });
        const cw = (w - 24) / cols, size = Math.min(T.pick, rh - 22);
        opts.forEach((o, i) => {
            const cx = x + 12 + Math.floor(i / per) * cw, ry = y + 66 + (i % per) * rh, sel = o[0] === v;
            if (sel) cv.roundRect(cx, ry, cw - 8, rh - 6, 12, A(C.orange, 0.32));
            cv.text(o[1], cx + 20, ry + rh / 2 + size / 3, size, sel ? '#ffffff' : C.text, { font: sel ? 'bold' : 'label', literal: true });
            cv.target(cx, ry, cw - 8, rh - 6, () => { this.picker = null; if (p.set) p.set(o[0]); else this.set(p.key, o[0]); this.kick(); }, 'pick:' + p.key + ':' + o[0], 12);
        });
        cv.target(0, 36, W, bottom, () => { this.picker = null; this.kick(); }, 'pick:close');
    }
}

/* ---------- small pieces ---------- */
/**
 * A header badge for one screen: off when its switch is off (or the drive mode's design is BMW's own), waiting while
 * cluster-render is not there yet, trouble when something was refused or a layout is bad, else on.
 */
function screenBadge(name, h, wanted) {
    if (!h) return null;
    if (!wanted || h.activeName === 'off') return { text: name + ' 關', color: C.dim };
    if (!h.client || !h.client.ready || !h.activeName) return { text: name + ' 等待', color: C.dim };
    if (h.refused || h.problem) return { text: name + ' 異常', color: C.orange };
    return { text: name + ' 運作', color: C.green };
}

/**
 * The kit's sheet (sheet.js) for one setting's choices, on the Store's renderer: radio rows the controller turns
 * along (a press picks and closes), Back top right, tilting left closes. As listSheet's value list, in EVA's words.
 */
function choiceSheet(page, p) {
    const opts = page.choices(p.key), key = 'eva_' + p.key;
    const cur = () => page.get(p.key);
    return {
        title: p.title,
        sub: Math.max(0, opts.findIndex((o) => o[0] === cur())),
        controller: false,
        rows() { const c = cur(); return opts.map((o) => ({ label: o[1], kind: 'radio', on: o[0] === c })); },
        draw(r, t) {
            r.clear(t.bg);
            r.text(p.title, 44, sheets.TOP + 40, 32, t.text, { font: 'bold', literal: true });
            const bw = 150, bx = W - 40 - bw, by = sheets.TOP + 8;
            sheets.pill(r, t, bx, by, bw, 46, '返回', this.controller && this.sub === -1);
            const targets = [{ x: bx - 10, y: by - 6, w: bw + 20, h: 58, act: () => 'close' }];
            sheets.list(r, t, key, this.rows(), this.sub, sheets.TOP + 74, this.controller)
                .forEach((q) => targets.push(Object.assign(q, { act: () => { this.sub = q.i; return this.choose(); } })));
            return targets;
        },
        key() { return key; },
        top() { return this.sub === -1; },
        scroll(dy) { const st = sheets.list.scroll[key]; if (st) { st.y += dy; st.drag = true; } },
        release() { const st = sheets.list.scroll[key]; if (st) st.drag = false; },
        move(d) { this.controller = true; this.sub = Math.max(-1, Math.min(opts.length - 1, this.sub + d)); },
        press() { this.controller = true; return this.sub === -1 ? 'close' : this.choose(); },
        choose() {
            const o = opts[this.sub];
            if (o) { if (p.set) p.set(o[0]); else page.set(p.key, o[0]); }
            return 'close';
        },
        back() { return 'close'; },
    };
}
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
function toggle(cv, x, y, w, h, on) {
    cv.roundRect(x, y, w, h, h / 2, on ? C.orange : '#ffffff22');
    cv.circle(on ? x + w - h / 2 : x + h / 2, y + h / 2, h / 2 - 5, on ? '#000000' : C.dim);
}
function chevron(cv, x, y, c) { cv.line(x - 6, y - 9, x + 3, y, 3, c); cv.line(x + 3, y, x - 6, y + 9, 3, c); }

module.exports = EvaPage;
