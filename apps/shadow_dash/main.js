'use strict';
/**
 * Shadow: a customer photo cluster for iDrive 7 (ID7 MGU, whole-cluster panel).
 * Sport, Comfort and Eco Pro each show that mode's photo. This is not an iDrive 8 app.
 *
 * The center screen is the settings page. Drawing keeps running after the page is closed.
 */
const mgu = require('./kit/mgu');
const ShadowDash = require('./shadow_dash');

mgu.run({
    start(ctx) {
        const hmi = (ctx.spec && ctx.spec.hmi) || ['ID7'];
        if (hmi.indexOf('ID7') < 0) {
            ctx.log.error('Shadow is iDrive 7 only (got ' + hmi.join(',') + ')');
            ctx.ui.text('STATUS', 'Shadow is for iDrive 7 only');
            return;
        }
        let dash;
        try {
            dash = new ShadowDash(ctx);
        } catch (e) {
            ctx.log.error('Shadow failed to start: ' + (e && e.stack || e));
            ctx.ui.text('STATUS', 'Shadow failed to start: ' + (e && e.message || e));
            return;
        }
        dash.onStatus((text) => ctx.ui.text('STATUS', text));
        dash.start();
        process.on('exit', () => { try { dash.stop(); } catch (e) { /* exiting anyway */ } });
    },
});
