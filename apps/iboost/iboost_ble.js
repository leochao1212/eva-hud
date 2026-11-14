'use strict';
/**
 * BLE transport for the i-BOOST II box, abstracted behind one interface so the app logic never
 * touches Bluetooth directly:
 *
 *   t.on('connected', () => ...)
 *   t.on('disconnected', () => ...)
 *   t.on('status', (text) => ...)         // human-readable link state
 *   t.on('data', (buf) => ...)            // one notification frame from char 6F400002
 *   t.start();  t.write(buf);  t.stop();
 *
 * Two implementations:
 *   - MockTransport  : a self-contained fake box. Streams plausible 0x04 / 0x0D frames and answers
 *                      scan/clear-DTC writes, so the whole UI + parser runs with no hardware. Default.
 *   - BlueZTransport : real BLE on the head unit (Node 8 + BlueZ). SKELETON — the connect/notify/write
 *                      path is NOT yet verified on the car (can the HU's adapter act as a BLE central
 *                      while BMW uses it? — open question). It fails gracefully; the app keeps running.
 */
var EventEmitter = require('events');
var proto = require('./iboost_proto');

function u16(v) { v = Math.max(0, Math.min(0xFFFF, Math.round(v))); return [(v >>> 8) & 0xFF, v & 0xFF]; }

/* ---------------- Mock ---------------- */
function MockTransport(cfg, log) {
    EventEmitter.call(this);
    this.log = log; this.t = null; this.phase = 0; this.on_ = false;
}
MockTransport.prototype = Object.create(EventEmitter.prototype);
MockTransport.prototype.start = function () {
    var self = this;
    this.emit('status', 'DEMO (模擬資料)');
    setTimeout(function () { self.emit('connected'); self._loop(); }, 300);
};
MockTransport.prototype._loop = function () {
    var self = this;
    this.t = setInterval(function () { self._tick(); }, 100);
};
MockTransport.prototype._tick = function () {
    this.phase += 0.06;
    var s = Math.sin(this.phase), s2 = Math.sin(this.phase * 0.5);
    var boost = Math.max(0, 0.55 + 0.55 * s);              // bar
    var water = 90 + 4 * s2;                               // C
    var oil = 100 + 6 * s2;                                // C
    var rpm = 1600 + 2400 * (0.5 + 0.5 * s);               // rpm
    var afr = 14.7 - 2.2 * Math.max(0, s);                 // richer under boost
    var speed = Math.max(0, 70 + 45 * s2);                 // km/h
    var st = 0x23;                                         // CAN + booted + pressureValid
    // 0x04 stream frame with a status item + 6 PIDs
    var N = 7;
    var body = [0x02, 0xAA, 0x6D, 0x04, N, 0x01, 0xFF].concat(u16(st));   // 01FF status (low byte = st)
    body = body.concat([0x01, 0x01], u16(boost * 100 + 100));             // 0x0101 Boost
    body = body.concat([0x00, 0x05], u16(water + 40));                    // 0x0005 water
    body = body.concat([0x00, 0x5C], u16(oil + 40));                      // 0x005C oil
    body = body.concat([0x00, 0x0C], u16(rpm * 4));                       // 0x000C rpm
    body = body.concat([0x00, 0x44], u16((afr / 14.7) * 32768));          // 0x0044 AFR (lambda*32768)
    body = body.concat([0x00, 0x0D], u16(speed));                         // 0x000D speed
    this.emit('data', proto.frame(body));
};
MockTransport.prototype.write = function (buf) {
    var self = this, p = Array.prototype.slice.call(buf);
    if (p[2] === 0x6B && p[3] === 0x08) {        // scan DTC -> answer with a demo code after ~1s
        setTimeout(function () {
            self.emit('data', proto.frame([0x02, 0xAA, 0x6D, 0x08, 0x00, 0x01, 0x01, 0x68]));   // P0168
        }, 900);
    } else if (p[2] === 0x6D && p[3] === 0x08) { // clear DTC -> answer empty
        setTimeout(function () {
            self.emit('data', proto.frame([0x02, 0xAA, 0x6D, 0x08, 0x00, 0x00]));
        }, 300);
    }
    // other writes: the demo box silently accepts (mirrors "writes don't reply")
};
MockTransport.prototype.stop = function () { if (this.t) clearInterval(this.t); this.t = null; this.emit('disconnected'); };

/* ---------------- BlueZ (real, skeleton) ---------------- */
/**
 * Target: scan for a device whose name/Alias == cfg.deviceName ("I-BOOST II"), connect, find the NUS
 * char whose UUID ends with cfg.nusChar ("6F400002"), StartNotify, and WriteValue (no-response) to send.
 * On a rooted MGU this is BlueZ over D-Bus (org.bluez). Node 8 has no bundled D-Bus binding, so this
 * skeleton shells to `bluetoothctl` for scan/connect and leaves the GATT notify/write path as the
 * integration point to wire + verify on the car. It never throws into the app: on any failure it emits
 * 'status' + 'disconnected' and the UI shows "未連線".
 */
function BlueZTransport(cfg, log) {
    EventEmitter.call(this);
    this.cfg = cfg; this.log = log; this.proc = null; this.connected = false;
}
BlueZTransport.prototype = Object.create(EventEmitter.prototype);
BlueZTransport.prototype.start = function () {
    var self = this;
    this.emit('status', '搜尋 ' + this.cfg.deviceName + ' ...');
    var cp;
    try { cp = require('child_process'); } catch (e) { return this._fail('no child_process: ' + e); }
    // Step 1: power on + scan + connect via bluetoothctl (works where the HU lets us drive the adapter).
    // NOTE: unverified on the car — the adapter may be owned by BMW's stack. Marked as the test point.
    try {
        this.proc = cp.spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return this._fail('bluetoothctl not available: ' + e); }
    var buf = '';
    this.proc.stdout.on('data', function (d) { buf += d.toString(); self._onCtl(buf); });
    this.proc.on('error', function (e) { self._fail('bluetoothctl error: ' + e); });
    this.proc.on('exit', function () { if (!self.connected) self._fail('bluetoothctl exited'); });
    var send = function (line) { try { self.proc.stdin.write(line + '\n'); } catch (e) {} };
    send('power on'); send('menu scan'); send('clear'); send('back');
    send('scan on');
    // once the device shows up with the right name, the _onCtl handler issues connect.
    // GATT notify + write: TODO — subscribe char 6F400002 (StartNotify) and write-without-response.
    // This is the exact spot to finish + test on the unit; until then the box stays "未連線".
    this._fail('BLE GATT path not yet wired on this unit — needs car testing (use Demo for now)');
};
BlueZTransport.prototype._onCtl = function (buf) {
    // Minimal name match: when the target name appears, try to connect by its MAC.
    var self = this;
    var re = new RegExp('Device\\s+([0-9A-F:]{17})\\s+' + this.cfg.deviceName.replace(/ /g, '\\s'), 'i');
    var m = buf.match(re);
    if (m && this.proc && !this.connected) {
        this.mac = m[1];
        try { this.proc.stdin.write('connect ' + this.mac + '\n'); } catch (e) {}
    }
};
BlueZTransport.prototype._fail = function (why) {
    this.log && this.log.warn && this.log.warn('iboost BLE: ' + why);
    this.emit('status', '未連線: ' + why);
    this.emit('disconnected');
};
BlueZTransport.prototype.write = function (buf) { /* TODO: WriteValue on char 6F400002 (no response) */ };
BlueZTransport.prototype.stop = function () {
    if (this.proc) { try { this.proc.stdin.write('scan off\nquit\n'); } catch (e) {} try { this.proc.kill(); } catch (e) {} }
    this.proc = null; this.emit('disconnected');
};

/* ---------------- factory ---------------- */
function create(kind, cfg, log) {
    if (kind === 'ble') return new BlueZTransport(cfg || {}, log);
    return new MockTransport(cfg || {}, log);
}

module.exports = { create: create, MockTransport: MockTransport, BlueZTransport: BlueZTransport };
