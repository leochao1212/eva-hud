'use strict';
/**
 * EVA: the NERV battle display on the iDrive 7 windshield HUD and instrument cluster, drawn through cluster-render.
 *
 * The center screen: on iDrive 7 the app's own page (shared/eva_page.js on the kit's canvas screen: the NERV cockpit
 * and the settings; app.json MAIN "kind": "canvas"). The iDrive 8 build keeps 0.8's menu (a status line and the
 * settings list) with its cockpit drawn by shared/eva_centre.js (app.json hmiOverrides.ID8). The drawing keeps running
 * after the page is closed. The HUD is in shared/eva_hud.js and the cluster in shared/eva_dash.js. A dash that can't
 * start leaves the HUD.
 */
const mgu = require('./kit/mgu');
const EvaHud = require('./eva_hud');

mgu.run({
    start(ctx) {
        let hud, dash = null, centre = null;
        try {
            hud = new EvaHud(ctx);
        } catch (e) {
            // no HUD, but stay up: an exit here would count as a crash on the car
            ctx.log.error('HUD failed to start: ' + (e && e.stack || e));
            ctx.ui.text('STATUS', 'HUD failed to start: ' + (e && e.message || e));
            return;
        }
        try {
            const EvaDash = require('./eva_dash');
            dash = new EvaDash(ctx, hud);
            hud.dash = dash;
        } catch (e) {
            dash = null;
            ctx.log.error('dash failed to start, the HUD carries on: ' + (e && e.stack || e));
        }
        const main = ((ctx.spec && ctx.spec.screens) || []).find((s) => s.name === 'MAIN');
        const canvas = !!(main && main.kind === 'canvas');
        let page = null;
        try {
            if (canvas) page = new (require('./eva_page'))(ctx, hud);
            else centre = new (require('./eva_centre'))(ctx, hud);
        } catch (e) {
            centre = null; page = null;
            ctx.log.error('centre screen failed to start, the rest carries on: ' + (e && e.stack || e));
        }
        const show = () => {
            if (page) page.kick();       // the page draws the status line itself; STATUS (the menu's row) for the iDrive 8 build and the tests
            ctx.ui.text('STATUS', [hud.lastStatus, dash && dash.lastStatus, centre && centre.lastStatus].filter(Boolean).join('  /  '));
        };
        hud.onStatus(show);
        if (dash) dash.onStatus(show);
        if (centre) centre.onStatus(show);
        hud.start();
        if (dash) dash.start();
        if (centre) centre.start();
        if (page) page.start();
        process.on('exit', () => {
            try { hud.stop(); } catch (e) { /* exiting anyway */ }
            try { if (dash) dash.stop(); } catch (e) { /* exiting anyway */ }
            try { if (centre) centre.stop(); } catch (e) { /* exiting anyway */ }
        });
    },
});
