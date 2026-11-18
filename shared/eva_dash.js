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

const POPUP_SLOT = 0x202;
/*
 * A drive-mode change between two whole-cluster designs: a black honeycomb with orange rims, lit orange only at
 * its front, sweeps in over the old design (an
 * effect layer, no pixels), the old design goes and the new one is built under them while a label names the
 * mode, then the hexagons sweep out. The two designs never exist together: each is 7-11 MB of the service's
 * 16 MB. The label is an asset the hexagons' shader draws, so the change adds one layer (C3 and E3 have seven,
 * and an older cluster-render allows a connection eight).
 */
const TRANSITION = { inMs: 420, holdMinMs: 260, holdMaxMs: 1500, outMs: 420, cell: 22, z: 900 };
const TRANSITION_WORDS = { sport: ['SPORT', '第一種戦闘配置'], comfort: ['COMFORT', '通常態勢'], eco: ['ECO PRO', '活動限界'] };
const TRANSITION_LABEL = { w: 720, h: 132 };
const EVA_ORANGE = [255, 136, 0];
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
        this.stripsSeen = {};
        super._rebuildInner();
        // strips the new design doesn't have (a centre design, or off): only now are they dropped
        Object.keys(this.strips || {}).forEach((id) => { if (!this.stripsSeen[id]) this._dropStrip(id); });
        this.stripsSeen = null;
    }

    _create(w) {
        if (w.type === 'fill' && BOTTOM_STRIP.test(w.id) && this.target === 'panel') { this._keepStrip(w); return; }
        super._create(w);
    }

    /* ---------------- the bottom strips: their own connection, kept across a swap ---------------- */

    _stripClient() {
        if (!this.stripsClient) {
            const name = (this.view.clientName || this.ctx.spec.id) + '_strips';
            const c = new this.client.constructor(name, this.socketPath, this.log, this.size, false);
            c.on('refused', (op, ref, reason) => this.log.warn('refused ' + op + ' on ' + ref + ' [strips]: ' + reason));
            c.on('layer', (ref, state, reason) => { if (state === 'error') this.log.warn('layer ' + ref + ' [strips] error: ' + reason); });
            c.on('disconnected', () => this.log.warn('cluster-render disconnected [strips], client will retry'));
            this.stripsClient = c;
            c.connect();          // layers made before it is up are sent when it is
        }
        return this.stripsClient;
    }

    _keepStrip(w) {
        const key = [w.x, w.y, w.w, w.h, w.color, w.class, w.z].join(',');
        this.strips = this.strips || {};
        if (this.stripsSeen) this.stripsSeen[w.id] = true;
        const kept = this.strips[w.id];
        if (kept && kept.key === key) return;
        if (kept) this._dropStrip(w.id);
        const main = this.client, c = this._stripClient();
        this.client = c;                   // the fill's own code makes it, on the strips' connection
        try { super._create(w); } finally { this.client = main; }
        const x = this.widgets.get(w.id);
        if (!x) return;
        this.widgets.delete(w.id);
        this.strips[w.id] = { ref: x.ref, key };
        if (this.givingWay) c.set(x.ref, { visible: 0 });
    }

    _dropStrip(id) {
        const s = this.strips && this.strips[id];
        if (!s) return;
        this.stripsClient.drop(s.ref);
        delete this.strips[id];
    }

    _showForPopup(hide, now) {
        Object.keys(this.strips || {}).forEach((id) => this.stripsClient.set(this.strips[id].ref, { visible: hide ? 0 : 1 }));
        super._showForPopup(hide, now);
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
        if (this.transition) this._guard('transition', () => this._stepTransition(now));
        super._tick();
    }

    /* ---------------- the drive-mode change: hexagons in, new design, hexagons out ---------------- */

    /** Only between two whole-cluster designs on the panel, with nothing else on top. */
    _canTransition() {
        if (this.transition) return true;          // one under way picks up the newest design when it swaps
        const next = this._layoutName();
        const whole = (n) => n === 'eva' || WHOLE_DESIGNS.indexOf(n) >= 0;
        return this.client.ready && this.setting('dashTransition') !== false && this.target === 'panel' &&
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

    _startTransition(now) {
        const t = this.transition;
        if (t) {
            // a change while sweeping out: sweep back in from where the hexagons are, and swap again
            if (t.phase === 'out') {
                const out = Math.min(1, (now - t.from) / TRANSITION.outMs);
                t.phase = 'in';
                t.from = now - (1 - out) * TRANSITION.inMs;
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
        this.client.uniform(ref, 'u_labelOn', [0]);
        const g = GEAR_LETTER, hx = g[0] - r.x, hy = g[1] - r.y;
        const meets = hx < r.w && hy < r.h && hx + g[2] > 0 && hy + g[3] > 0;
        this.client.uniform(ref, 'u_hole', meets ? [hx, hy, g[2], g[3]] : [0, 0, 0, 0]);
        this.transition = { phase: 'in', from: now, cover: ref, label: null, rect: r };
        this._transitionLabel(this.transition);
        this.log.info('drive-mode change: hexagons over ' + this.activeName + ' -> ' + this._layoutName());
    }

    _stepTransition(now) {
        const t = this.transition;
        if (this.alertKey || this.givingWay) { this._endTransition(); return; }      // an alert or a BMW pop-up goes first
        if (t.phase === 'in') {
            const p = Math.min(1, (now - t.from) / TRANSITION.inMs);
            this.client.uniform(t.cover, 'u_t', [Math.round(p * 1000) / 1000]);
            if (p < 1) return;
            // covered: the new design goes up under the hexagons
            if (this._layoutName() !== this.activeName) this._rebuild();
            this._transitionLabel(t);          // the mode may have changed again during the sweep
            if (t.label) this.client.uniform(t.cover, 'u_labelOn', [1]);
            t.phase = 'hold';
            t.from = now;
        } else if (t.phase === 'hold') {
            const held = now - t.from;
            if (held < TRANSITION.holdMinMs || (held < TRANSITION.holdMaxMs && !this._allShown())) return;
            this.client.uniform(t.cover, 'u_labelOn', [0]);
            t.phase = 'out';
            t.from = now;
        } else {
            const p = Math.min(1, (now - t.from) / TRANSITION.outMs);
            this.client.uniform(t.cover, 'u_t', [1 + Math.round(p * 1000) / 1000]);
            if (p >= 1) this._endTransition();
        }
    }

    /** Every layer of the new design drawn (an image is 'stalled' until its pixels are there). */
    _allShown() {
        let all = true;
        this.widgets.forEach((x) => { const s = this.layerStates.get(x.ref); if (!s || s.state !== 'shown') all = false; });
        return all;
    }

    /**
     * The mode in the middle of the hexagons, DRIVE MODE >> SPORT, 第一種戦闘配置 and a NERV line, as an rgba8
     * asset the hexagons' shader samples. Made once a change, drawn again only if the mode is another by the swap.
     */
    _transitionLabel(t) {
        const mode = this._driveProfile();
        if (t.label && t.labelMode === mode) return;
        const words = TRANSITION_WORDS[mode] || TRANSITION_WORDS.comfort;
        const w = Math.min(TRANSITION_LABEL.w, t.rect.w), h = TRANSITION_LABEL.h;
        if (!t.label) {
            t.label = this.client.asset({ target: 'panel', format: 'rgba8', w, h, sampling: 'nearest' });
            if (!t.label) return;
            this.client.bind(t.cover, 'u_label', t.label);
            this.client.uniform(t.cover, 'u_labelRect', [Math.round((t.rect.w - w) / 2), Math.round((t.rect.h - h) / 2), w, h]);
        }
        t.labelMode = mode;
        const px = Buffer.alloc(w * h * 4);
        for (let i = 0; i < w * h; i++) px[i * 4 + 3] = 225;                          // a black band to read on
        for (const y of [0, 1, h - 2, h - 1]) for (let x = 0; x < w; x++) {          // orange rules top and bottom
            const o = (y * w + x) * 4; px[o] = EVA_ORANGE[0]; px[o + 1] = EVA_ORANGE[1]; px[o + 2] = EVA_ORANGE[2]; px[o + 3] = 255;
        }
        const over = (src) => {
            for (let i = 0; i < w * h; i++) {
                const a = src[i * 4 + 3] / 255;
                if (!a) continue;
                const o = i * 4;
                for (let c = 0; c < 3; c++) px[o + c] = Math.round(src[o + c] * a + px[o + c] * (1 - a));
                px[o + 3] = Math.max(px[o + 3], src[o + 3]);
            }
        };
        over(textRaster.drawText(w, h, 'DRIVE MODE  >>  ' + words[0], { font: 'tr_en', align: 'center', offsetY: 10, color: EVA_ORANGE.concat(255) }));
        over(textRaster.drawText(w, h, words[1], { font: 'tr_jp', align: 'center', offsetY: 56, color: [255, 255, 255, 255] }));
        over(textRaster.drawText(w, h, 'NERV  //  SYNC', { font: 'tr_sub', align: 'right', x: -14, offsetY: h - 26, color: EVA_ORANGE.concat(200) }));
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
        Object.keys(this.strips || {}).forEach((id) => this._dropStrip(id));
        if (this.stripsClient) this.stripsClient.close();
        super.stop();
    }
}

module.exports = EvaDash;
