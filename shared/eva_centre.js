'use strict';
/**
 * The EVA centre-screen cockpit: a third EvaHud view, drawn on the CENTRE display through mgu-render
 * (not the cluster's cluster-render). It reuses the HUD's car data, engine unit and alert rules (like
 * eva_dash) and loads hud/layouts/dash_cockpit.json: the EVA-01 hologram, live water/oil/boost and the
 * MAGI verdict. It points at /run/mgu-render/render.sock, so hud.js uses the mgu-render adapter
 * (shared/mgu_render_adapter.js) that already draws EVA on the centre screen on iDrive 8.
 *
 * First pass, drawn blind for iDrive 7 (cannot test with the car asleep). Enable with the `centre`
 * setting. Touch, the settings page on this screen, the per-plate MAGI red and the alarm red-flash are
 * NOT done here yet - that is the next round, to iterate on the car.
 */
const EvaHud = require('./eva_hud');

const MGU_SOCKET = '/run/mgu-render/render.sock';   // the centre-screen renderer; hud.js picks the adapter for it
const TEXT_MS = 250;

class EvaCentre extends EvaHud {
    constructor(ctx, primary) {
        super(ctx, { primary, target: 'panel', statusName: 'CENTRE', clientName: ctx.spec.id + '_centre',
            socketPath: MGU_SOCKET, textRateMs: TEXT_MS });
        this.primary = primary;
        this.readings = primary.readings;
    }

    /** One fixed cockpit design, on when the `centre` setting is on. */
    _layoutName() { return this.setting('centre') === 'on' ? 'cockpit' : 'off'; }
    _layoutFile(name) { return name === 'off' ? name : 'dash_' + name; }
    _followsDriveMode() { return false; }
    _isBigImage(w) { return w.type === 'evaphoto' || w.type === 'evacanvas' || w.type === 'evagear'; }
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
}

module.exports = EvaCentre;
