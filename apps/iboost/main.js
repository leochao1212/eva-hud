'use strict';
/**
 * i-BOOST II: a centre-screen app that talks to the i-BOOST II boost controller over the head unit's
 * Bluetooth (Nordic UART, CRC-16/MODBUS). Shows live boost/temps/RPM/AFR/speed and fault codes, and
 * changes the box's mode and warm-up. Defaults to Demo (mock data) until the real BLE path is verified
 * on the car; switch 資料來源 -> Bluetooth to use the box.
 */
var mgu = require('./kit/mgu');
var IBoost = require('./iboost_app');

mgu.run({
    start: function (ctx) {
        var app;
        try {
            app = new IBoost(ctx);
            app.start();
        } catch (e) {
            ctx.log.error('i-BOOST II failed to start: ' + (e && e.stack || e));
            try { ctx.ui.cells('CONN', 0, { Text2ndCol: '啟動失敗' }); } catch (e2) {}
            return;
        }
        process.on('exit', function () { try { app.stop(); } catch (e) {} });
    }
});
