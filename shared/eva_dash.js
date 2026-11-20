'use strict';
/**
 * The EVA dash: the design of the EVA HUD on the instrument cluster, at the same time as the HUD and from the same app.
 *
 * It is an EvaHud with a connection of its own (cluster-render allows a client 8 layers: 5 normal, 3 in an alert) and
 * its own layouts, hud/layouts/dash_eva.json and dash_alert.json. The car data, the engine unit and the alert rules
 * stay with the HUD, so both screens read the same values and show the same alert. The app's hud.dash points back here.
 *
 * Needs cluster-render's panel target on a scene of its own (panel_scene_id in its local conf): with the default, the
 * shared scene means the HUD and the cluster can't show together, and on this car the HUD can't come back afterwards.
 *
 * The black background (hud/layouts/dash_eva.json, "keepInAlert") hides BMW's gauges and stays through an alert. It stops
 * at y=640, so BMW's own bottom row shows; BMW's seat belt warning and gear also show above it (seen on the car). *
 * The service counts every image twice against 16 MiB (Compositor::add_image, "the service's pixel memory is full"). The
 * dash's big images don't all fit, so it holds either its normal images or its alert's: an alert drops the gear and the
 * text and the alert's end brings them back. The car found this; the HUD's images are small enough to keep.
 *
 * The menu picks a design. The centre designs (A, B, C1, C2, E1, E2) draw on cluster-render's map target, the 1088x480 window under
 * BMW's gauges, so everything of BMW's stays on top and works: the panel over the gauges took BMW's own content away (its on-board
 * computer area, seen on the car). They keep to the shape BMW's digital speed and G meter leave clear (tools/eva_layout.py CLEAR_SHAPE),
 * small enough to keep their images through an alert, so an alert's end sends nothing, and they have a slot of their own, so a BMW
 * pop-up draws over them and they never have to give way.
 * D, C3 and E3, like the original, cover the whole cluster on the panel, with the same alert and the same care for memory and pop-ups.
 *   contend:    takes the slot from BMW's map in Map view (Off leaves the slot free).
 *   guide_hold: 0 keeps cluster-render from holding a second slot to hide BMW's CarPlay turn box. It shows over us.
 */
const EvaHud = require('./eva_hud');
const shaders = require('./shaders');
const textRaster = require('./hud_text');
const PersistentLayers = require('./persistent_layers');

const POPUP_SLOT = 0x202;
/*
 * A drive-mode change between two whole-cluster designs: a dark honeycomb with orange rims, lit at its moving
 * front, covers the old design (an effect layer, no pixels) in the order the style picks, the old design goes and
 * the new one is built under it while a label names the mode, then the honeycomb uncovers it. The two designs never
 * exist together: each is 7-11 MB of the service's 16 MB. The label is an r8 asset (one byte a pixel, at most
 * 1200x300) the hexagons' shader colours and draws, so the change adds one layer (C3 and E3 have six on this
 * connection, and cluster-render allows a connection eight).
 */
const TRANSITION = { cell: 22, z: 900, holdMaxMs: 1500 };
/*
 * The styles (the setting "dashTransitionStyle"; shaders.evahexwipe u_style). Covering slowly, uncovering quicker, so the
 * gauges are back soon. label: the r8 mask's size and place in the layer (x 'c' centred, or a fraction from the left).
 */
const TRANSITION_STYLES = {
    sweep: { style: 0, inMs: 640, holdMinMs: 260, outMs: 420, label: { w: 720, h: 132, x: 'c' } },
    atfield: { style: 1, inMs: 820, holdMinMs: 480, outMs: 480, label: { w: 1000, h: 200, x: 'c' } },
    blue: { style: 2, inMs: 880, holdMinMs: 520, outMs: 520, label: { w: 1100, h: 150, x: 'c' } },
    title: { style: 3, inMs: 760, holdMinMs: 600, outMs: 460, label: { w: 1200, h: 300, x: 0.18 } },
};
const TRANSITION_RANDOM = ['sweep', 'atfield', 'blue', 'title'];
/*
 * The car's low-fuel warning, once per warning (again after a refill): Pattern Blue's hazard-tape band over the whole
 * design with FUEL // 燃料残量警告, held NOTICE_HOLD_MS, only while the car stands (it covers the speed), else at the
 * next stop. The bottom info row (tools/botinfo.py) shows the warning all along.
 */
const NOTICE = { words: ['FUEL', '燃料残量警告', '', 'LOW FUEL  //  REFUEL SOON'], holdMs: 3500, stillKmh: 3 };
const TRANSITION_WORDS = { sport: ['SPORT', '第一種戦闘配置', '弐'], comfort: ['COMFORT', '通常態勢', '壱'], eco: ['ECO PRO', '活動限界', '参'] };
const EVA_ORANGE = [255, 136, 0];
const WHITE = [255, 255, 255];
const GEAR_LETTER = [1380, 660, 80, 60];   // BMW's gear letter: no layer's rect may meet it (the kombi then paints its black box)
/*
 * The whole designs' black bottom strips (botcover_l/_c/_r: three rects around the gear letter, as Shadow's) are the same
 * in every design. They live on a connection of their own (its own 8 layers: C3 and E3 already have seven) and stay
 * up across a drive-mode swap, so BMW's bottom row never shows for a frame while the design is built again.
 */
const BOTTOM_STRIP = /^botcover/;
const CENTRE_DESIGNS = ['a', 'b', 'c1', 'c2', 'e1', 'e2', 'sq', 'sqs', 'sqc', 'sqe'];   // sq*: the ID8 map-target squares (dash_sq*), sqs/sqc/sqe = ID7 HUD's Sport/Comfort/Eco
const WHOLE_DESIGNS = ['d', 'c3', 'e3'];     // besides the original, 'eva'
const TEXT_MS = 250;     // its text rectangles are about four times the HUD's, and share one upload budget with it

class EvaDash extends EvaHud {
    constructor(ctx, primary) {
        super(ctx, { primary, target: 'panel', statusName: 'DASH', clientName: ctx.spec.id + '_dash', textRateMs: TEXT_MS });
        this.primary = primary;
        this.readings = primary.readings;
        // 0.9.0: the on / off switch became a choice of styles; a car that had it off keeps it off
        const v = ctx.settings.values || {};
        if (v.dashTransition === false && !v._trStyleV) { v._trStyleV = 1; ctx.settings.set('dashTransitionStyle', 'off'); }
    }

    _layoutName() {
        const s = this._screens();
        if (s !== 'dash' && s !== 'both') return 'off';
        const design = this._dashDesign();
        if (design === 'off') return 'off';
        // 'shadow' used to be a design in this app. It is the shadow_dash app now. An unknown
        // value, including one setting() did not already replace, is the original whole cluster.
        return CENTRE_DESIGNS.indexOf(design) >= 0 || WHOLE_DESIGNS.indexOf(design) >= 0 ? design : 'eva';
    }
    _layoutFile(name) {
        if (name === 'off') return name;
        if (name === 'alert' && this._isCentre()) return this._layoutName().indexOf('sq') === 0 ? 'dash_sq_alert' : 'dash_centre_alert';
        return 'dash_' + name;
    }
    _layoutLabel(name) { return name === 'eva' ? 'EVA' : 'Design ' + name.toUpperCase(); }
    _isCentre() { return CENTRE_DESIGNS.indexOf(this._layoutName()) >= 0; }
    _followsDriveMode() { const s = this._screens(); return s === 'dash' || s === 'both'; }
    _layerFields() { return this.target === 'map' ? { contend: 1, guide_hold: 0 } : {}; }
    _popupSlot() { return POPUP_SLOT; }

    /* what the HUD owns */
    _setupVehicleData() {
        this.car = this.view.primary.car;
        this.score = this.view.primary.score;
    }
    _startDme() {}
    _startReads() {}
    _liveSetting() {}
    _pedal() { return this.primary._pedal(); }
    _boost() { return this.primary._boost(); }
    _range() { return this.primary._range(); }
    _fuel() { return this.primary._fuel(); }
    _ambient() { return this.primary._ambient(); }
    _alertNow() { return this.primary.alertShow; }

    _isBigImage(w) { return w.type === 'evagear' || w.type === 'evacanvas' || w.type === 'evaphoto'; }

    _yieldToPopup(now) { return this.target === 'map' ? false : super._yieldToPopup(now); }

    _showAlert(key, now) {
        if (this._isCentre()) { super._showAlert(key, now); return; }
        if (key && !this.alertLayers) {
            this.freedWidgets = [];
            this.widgets.forEach((x, id) => {
                if (!this._isBigImage(x.w)) return;
                this.client.drop(x.ref);
                this.layerStates.delete(x.ref);
                this.widgets.delete(id);
                this.freedWidgets.push(x.w);
            });
        } else if (!key && this.alertLayers) {
            const a = this.alertLayers;
            [a.canvas.ref, a.colour, a.white].forEach((ref) => this.client.drop(ref));
            this.alertLayers = null;
            (this.freedWidgets || []).forEach((w) => this._guard('widget ' + w.id, () => this._create(w)));
            this.freedWidgets = [];
        }
        super._showAlert(key, now);
    }

    _rebuildInner() {
        const target = this._isCentre() ? 'map' : 'panel';
        if (target !== this.target) { this.target = target; this.targetState = null; }
        this.freedWidgets = [];
        if (this.transition && (target !== 'panel' || this._layoutName() === 'off')) this._endTransition(true);
        this._stripSet().begin();
        super._rebuildInner();
        // strips the new design doesn't have (a centre design, or off): only now are they dropped
        this._stripSet().end();
    }

    _create(w) {
        if (w.type === 'fill' && BOTTOM_STRIP.test(w.id) && this.target === 'panel') { this._keepStrip(w); return; }
        super._create(w);
    }

    /* ---------------- the bottom strips: their own connection, kept across a swap ---------------- */

    _stripSet() { return this.strips || (this.strips = new PersistentLayers(this.log, 'bottom strip')); }

    _stripClient() {
        if (!this.stripsClient) {
            const name = (this.view.clientName || this.ctx.spec.id) + '_strips';
            const c = new this.client.constructor(name, this.socketPath, this.log, this.size, false);
            // a refused strip is made again (persistent_layers.js): a rebuild alone would keep the dead ref
            c.on('refused', (op, ref, reason) => { this.log.warn('refused ' + op + ' on ' + ref + ' [strips]: ' + reason); this._stripSet().failed(ref, reason); });
            c.on('layer', (ref, state, reason) => {
                if (state === 'error') { this.log.warn('layer ' + ref + ' [strips] error: ' + reason); this._stripSet().failed(ref, reason); }
                else if (state === 'shown') this._stripSet().shown(ref);
            });
            c.on('disconnected', () => this.log.warn('cluster-render disconnected [strips], client will retry'));
            this.stripsClient = c;
            c.connect();          // layers made before it is up are sent when it is
        }
        return this.stripsClient;
    }

    _keepStrip(w) {
        this._stripSet().keep(w.id, [w.x, w.y, w.w, w.h, w.color, w.class, w.z].join(','), () => this._makeStrip(w));
    }

    /** The fill's own code makes it, on the strips' connection; it is kept out of this.widgets. */
    _makeStrip(w) {
        const main = this.client, c = this._stripClient();
        this.client = c;
        try { super._create(w); } finally { this.client = main; }
        const x = this.widgets.get(w.id);
        if (!x) return null;
        this.widgets.delete(w.id);
        return { ref: x.ref, client: c };
    }

    _showForPopup(hide, now) {
        this._stripSet().setVisible(!hide);
        super._showForPopup(hide, now);
    }

    /** The hexagons or their label refused: no cover, so the new design goes up at once (never an empty cluster). */
    _onRefused(op, ref, reason) {
        const t = this.transition;
        if (t && (ref === t.cover || ref === t.label)) {
            this.log.warn('drive-mode change: hexagons refused (' + reason + '), swapping without them');
            this._endTransition();
            return;
        }
        super._onRefused(op, ref, reason);
    }

    /** The drive mode arrives on the HUD's signals. */
    _tick() {
        const now = Date.now();
        const mode = this.primary.driveMode;
        if (mode !== this.driveMode) {
            this.driveMode = mode;
            if (this._layoutName() !== this.activeName) {
                if (this._canTransition()) this._startTransition(now);
                else this._rebuild();
            } else this._status();
        }
        this._guard('low fuel', () => this._lowFuel(now));
        if (this.transition) this._guard('transition', () => this._stepTransition(now));
        super._tick();
    }

    /** The low-fuel notice: armed when the car's warning comes on, shown at the first moment the car stands. */
    _lowFuel(now) {
        const reserve = !!this._fuel().reserve;
        if (!reserve) { this.fuelNotice = null; return; }
        if (!this.fuelNotice) this.fuelNotice = { shown: false };
        if (this.fuelNotice.shown || this.transition || this.setting('fuelNotice') === false) return;
        const speed = this.car && this.car.data().speed;
        if (!(typeof speed === 'number' && speed < NOTICE.stillKmh) || !this._canTransition(true)) return;
        this.fuelNotice.shown = true;
        this._startTransition(now, true);
    }

    /* ---------------- the drive-mode change: hexagons in, new design, hexagons out ---------------- */

    /** Only between two whole-cluster designs on the panel, with nothing else on top. */
    _canTransition(notice) {
        if (this.transition) return true;          // one under way picks up the newest design when it swaps
        const next = this._layoutName();
        const whole = (n) => n === 'eva' || WHOLE_DESIGNS.indexOf(n) >= 0;
        return this.client.ready && (notice || this.setting('dashTransitionStyle') !== 'off') && this.target === 'panel' &&
            whole(this.activeName) && whole(next) && !this.alertKey && !this.alertLayers && !this.givingWay;
    }

    /** The rectangle both designs draw in, so a design's empty edge (BMW's bottom row) stays as it is. */
    _transitionRect(next) {
        const boxes = [];
        this.widgets.forEach((x) => boxes.push(x.w));
        try { (this.layouts.load(this._layoutFile(next)).widgets || []).forEach((w) => boxes.push(w)); } catch (e) { /* the old design's alone */ }
        if (!boxes.length) return null;
        const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)));
        const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)));
        const x1 = Math.min(this.size[0], Math.max(...boxes.map((b) => b.x + b.w)));
        let y1 = Math.min(this.size[1], Math.max(...boxes.map((b) => b.y + b.h)));
        // stop above BMW's gear letter: a rect meeting it gets the kombi's black box (the bottom strips stay up below)
        const g = GEAR_LETTER;
        if (x0 < g[0] + g[2] && x1 > g[0] && y1 > g[1]) y1 = Math.max(y0, g[1]);
        return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    }

    _startTransition(now, notice) {
        const t = this.transition;
        if (t) {
            // a change while sweeping out: sweep back in from where the hexagons are, and swap again
            if (t.phase === 'out') {
                const out = Math.min(1, (now - t.from) / t.st.outMs);
                t.phase = 'in';
                t.from = now - (1 - out) * t.st.inMs;
                this._holdLook(t, -1);
            }
            return;
        }
        const r = this._transitionRect(this._layoutName());
        if (!r) { this._rebuild(); return; }
        const ref = this.client.effect({ target: 'panel', klass: 'alert', z: TRANSITION.z, x: r.x, y: r.y, w: r.w, h: r.h, fs: shaders.evahexwipe });
        if (!ref) { this._rebuild(); return; }
        this.client.uniform(ref, 'u_size', [r.w, r.h]);
        this.client.uniform(ref, 'u_cell', [TRANSITION.cell]);
        this.client.uniform(ref, 'u_color', EVA_ORANGE.map((v) => v / 255));
        this.client.uniform(ref, 'u_dark', [0.02, 0.01, 0.0]);
        this.client.uniform(ref, 'u_t', [0]);
        const name = notice ? 'blue' : this._pickStyle();
        const st = notice ? Object.assign({}, TRANSITION_STYLES.blue, { holdMinMs: NOTICE.holdMs }) : TRANSITION_STYLES[name];
        this.client.uniform(ref, 'u_style', [st.style]);
        this.client.uniform(ref, 'u_labelOn', [0]);
        this.client.uniform(ref, 'u_stretch', [1]);
        this.client.uniform(ref, 'u_flash', [0, 0]);
        this.client.uniform(ref, 'u_dim', [0]);
        this.client.uniform(ref, 'u_band', [0, 0, 0, 0]);
        const g = GEAR_LETTER, hx = g[0] - r.x, hy = g[1] - r.y;
        const meets = hx < r.w && hy < r.h && hx + g[2] > 0 && hy + g[3] > 0;
        this.client.uniform(ref, 'u_hole', meets ? [hx, hy, g[2], g[3]] : [0, 0, 0, 0]);
        this.transition = { phase: 'in', from: now, cover: ref, label: null, rect: r, name, st, words: notice ? NOTICE.words : null };
        this._transitionLabel(this.transition);
        this.log.info(notice ? 'low fuel: the notice over ' + this.activeName : 'drive-mode change (' + name + '): hexagons over ' + this.activeName + ' -> ' + this._layoutName());
    }

    _stepTransition(now) {
        const t = this.transition;
        // an alert or a BMW pop-up goes first: asked now, not after this tick's own pop-up check
        if (this.alertKey || this.givingWay || (this.popups && this.popups.shown(this._popupSlot(), now))) { this._endTransition(); return; }
        if (t.phase === 'in') {
            const p = Math.min(1, (now - t.from) / t.st.inMs);
            this.client.uniform(t.cover, 'u_t', [Math.round(p * 1000) / 1000]);
            if (p < 1) return;
            // covered: the new design goes up under the hexagons
            if (this._layoutName() !== this.activeName) this._rebuild();
            this._transitionLabel(t);          // the mode may have changed again during the sweep
            t.phase = 'hold';
            t.from = now;
            this._holdLook(t, 0);
        } else if (t.phase === 'hold') {
            const held = now - t.from;
            this._holdLook(t, held);
            if (held < t.st.holdMinMs || (held < TRANSITION.holdMaxMs && !this._allShown())) return;
            this._holdLook(t, -1);
            t.phase = 'out';
            t.from = now;
        } else {
            const p = Math.min(1, (now - t.from) / t.st.outMs);
            this.client.uniform(t.cover, 'u_t', [1 + Math.round(p * 1000) / 1000]);
            if (p >= 1) this._endTransition();
        }
    }

    /** The style's own setting, or for Random any but the last one. */
    _pickStyle() {
        let name = this.setting('dashTransitionStyle');
        if (name === 'random') {
            const pool = TRANSITION_RANDOM.filter((n) => n !== this.lastStyle);
            name = pool[Math.floor(Math.random() * pool.length)];
        }
        if (!TRANSITION_STYLES[name]) name = 'atfield';
        this.lastStyle = name;
        return name;
    }

    /**
     * The label's entrance while covered, ms since covered (-1: gone, before uncovering). Sweep: shown. AT field: a white
     * flash and the name snapping in from wide. Pattern Blue: the band slides in from the right, then blinks. Title card:
     * a white line opens down the middle, the honeycomb goes dark, the card shows.
     */
    _holdLook(t, ms) {
        const set = (k, v) => { const key = JSON.stringify(v); if (t.look && t.look[k] === key) return; (t.look = t.look || {})[k] = key; this.client.uniform(t.cover, k, v); };
        const ss = (e0, e1, x) => { const y = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return y * y * (3 - 2 * y); };
        const r2 = (x) => Math.round(x * 100) / 100;
        const on = ms >= 0 && !!t.label;
        const style = t.st.style;
        if (!on) {
            set('u_labelOn', [0]); set('u_stretch', [1]); set('u_flash', [0, 0]); set('u_dim', [0]);
            return;
        }
        if (style === 0) { set('u_labelOn', [1]); return; }
        if (style === 1) {
            set('u_labelOn', [r2(ss(0, 60, ms))]);
            set('u_stretch', [r2(1 + 0.5 * (1 - ss(0, 140, ms)))]);
            set('u_flash', [ms < 60 ? 0.5 : 0, 0]);
        } else if (style === 2) {
            set('u_band', [t.band[0], t.band[1], 2, Math.round((1 - ss(0, 140, ms)) * t.rect.w)]);
            set('u_labelOn', [ms < 260 || Math.floor(ms / 80) % 2 === 0 ? 1 : 0.85]);
        } else {
            set('u_dim', [r2(ss(0, 80, ms))]);
            set('u_flash', ms < 70 ? [1, Math.round(2 + ms * 8)] : [0, 0]);
            set('u_labelOn', [r2(ss(50, 110, ms))]);
        }
    }

    /** Every layer of the new design drawn (an image is 'stalled' until its pixels are there). */
    _allShown() {
        let all = true;
        this.widgets.forEach((x) => { const s = this.layerStates.get(x.ref); if (!s || s.state !== 'shown') all = false; });
        return all;
    }

    /**
     * The mode's name as an r8 mask the hexagons' shader samples and colours (u_c1 / u_c2 either side of u_split).
     * Made once a change, drawn again only if the mode is another by the swap. Each style lays it out its own way.
     */
    _transitionLabel(t) {
        const mode = t.words ? 'notice' : this._driveProfile();
        if (t.label && t.labelMode === mode) return;
        const words = t.words || TRANSITION_WORDS[mode] || TRANSITION_WORDS.comfort;
        const L = t.st.label, w = Math.min(L.w, t.rect.w), h = Math.min(L.h, t.rect.h);
        const col = (c) => c.map((v) => v / 255);
        if (!t.label) {
            t.label = this.client.asset({ target: 'panel', format: 'r8', w, h, sampling: 'nearest' });
            if (!t.label) return;
            this.client.bind(t.cover, 'u_label', t.label);
            const x = L.x === 'c' ? Math.round((t.rect.w - w) / 2) : Math.round(t.rect.w * L.x);
            const y = Math.round((t.rect.h - h) / 2);
            this.client.uniform(t.cover, 'u_labelRect', [x, y, w, h]);
            const split = [[0, 0.42], [0, 0.27], [1, 0.485], [0, 2]][t.st.style];
            const c1 = t.st.style === 2 ? WHITE : t.st.style === 3 ? WHITE : EVA_ORANGE;
            const c2 = t.st.style === 2 ? EVA_ORANGE : WHITE;
            this.client.uniform(t.cover, 'u_split', split);
            this.client.uniform(t.cover, 'u_c1', col(c1));
            this.client.uniform(t.cover, 'u_c2', col(c2));
            if (t.st.style === 0) this.client.uniform(t.cover, 'u_band', [y, y + h, 1, x]);
            t.band = [y, y + h];
        }
        t.labelMode = mode;
        const px = Buffer.alloc(w * h);
        const over = (src) => { for (let i = 0; i < src.length; i++) if (src[i] > px[i]) px[i] = src[i]; };
        const text = (str, o) => over(textRaster.mask(w, h, str, o));
        if (t.st.style === 0) {
            text('DRIVE MODE  >>  ' + words[0], { font: 'tr_en', align: 'center', offsetY: 10 });
            text(words[1], { font: 'tr_jp', align: 'center', offsetY: 64 });
        } else if (t.st.style === 1) {
            text('DRIVE MODE  >>  ' + words[0], { font: 'tr_en', align: 'center', offsetY: 0 });
            text(words[1], { font: 'tr_big', align: 'center', offsetY: 60 });
        } else if (t.st.style === 2) {
            text(words[0], { font: 'tr_hero', align: 'right', x: -Math.round(w * 0.53), offsetY: 4 });
            text(words[1], { font: 'tr_jp', align: 'left', x: Math.round(w * 0.5), offsetY: 22 });
            text(words[3] || 'DRIVE MODE CHANGE  //  MAGI APPROVED', { font: 'tr_sub', align: 'left', x: Math.round(w * 0.5), offsetY: 90 });
        } else {
            text('第 ' + words[2] + ' 話', { font: 'tr_jp', align: 'left', offsetY: 0 });
            text(words[1], { font: 'tr_big', align: 'left', offsetY: 56 });
            text('DRIVE MODE : ' + words[0], { font: 'tr_en', align: 'left', offsetY: 210 });
        }
        this.client.pixels(t.label, null, px);
    }

    /** Drops the hexagons and the label. Cut short before the swap, the new design goes up now (not when inside a rebuild). */
    _endTransition(rebuilding) {
        const t = this.transition;
        this.transition = null;
        if (!t) return;
        this.client.drop(t.cover);
        if (t.label) this.client.drop(t.label);       // after the layer that samples it
        if (!rebuilding && this._layoutName() !== this.activeName) this._rebuild();
    }

    stop() {
        this._endTransition(true);
        if (this.strips) this.strips.dropAll();
        if (this.stripsClient) this.stripsClient.close();
        super.stop();
    }
}

module.exports = EvaDash;
