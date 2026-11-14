'use strict';
/**
 * i-BOOST II centre-screen controller: wires the kit UI <- the BLE transport <- the protocol codec.
 * Reads are solid (stream -> live readouts, 0x08 -> DTCs). Writes marked (inferred) are best-effort
 * and only sent on the real BLE transport; in Demo they are cosmetic.
 */
var proto = require('./iboost_proto');
var ble = require('./iboost_ble');

var UI_MS = 250;   // throttle RHMI pushes (stream is 100 ms)

function IBoost(ctx) {
    this.ctx = ctx;
    this.cfg = (ctx.spec && ctx.spec.config) || { deviceName: 'I-BOOST II', nusChar: '6F400002' };
    this.transport = null;
    this.lastUi = 0;
    this.pending = null;   // latest parsed values waiting to be shown
    this.link = '—';
    this.dtc = '—';
}

IBoost.prototype.start = function () {
    var self = this, s = this.ctx.settings;
    this._setConn('啟動中 …');
    this._row('DTC', '—');
    this._setTransport(s.get('transport') || 'demo');
    s.onChange(function (key, value) { self._onSetting(key, value); });
    // periodic UI flush (also keeps the screen alive if frames pause)
    this.flush = setInterval(function () { self._flush(); }, UI_MS);
};

IBoost.prototype.stop = function () {
    if (this.flush) clearInterval(this.flush);
    if (this.transport) try { this.transport.stop(); } catch (e) {}
};

IBoost.prototype._setTransport = function (kind) {
    var self = this;
    if (this.transport) { try { this.transport.stop(); } catch (e) {} this.transport = null; }
    var t = ble.create(kind, this.cfg, this.ctx.log);
    this.transport = t;
    t.on('status', function (txt) { self._setConn(txt); });
    t.on('connected', function () {
        self._setConn(kind === 'ble' ? '已連線' : 'DEMO 已連線');
        try { t.write(proto.CMD.streamOn); } catch (e) {}
    });
    t.on('disconnected', function () { self._setConn('未連線'); });
    t.on('data', function (buf) { self._onData(buf); });
    try { t.start(); } catch (e) { this._setConn('啟動失敗: ' + (e && e.message || e)); }
};

IBoost.prototype._onData = function (buf) {
    var msg;
    try { msg = proto.parse(buf); } catch (e) { return; }
    if (!msg) return;
    if (msg.kind === 'stream') {
        this.pending = this.pending || {};
        var it = msg.items;
        if (it[0x0101]) this.pending.boost = it[0x0101].value;
        if (it[0x0005]) this.pending.water = it[0x0005].value;
        if (it[0x005C]) this.pending.oil = it[0x005C].value;
        if (it[0x000C]) this.pending.rpm = it[0x000C].value;
        if (it[0x0044]) this.pending.afr = it[0x0044].value;
        if (it[0x000D]) this.pending.speed = it[0x000D].value;
        if (msg.status) this.pending.status = msg.status;
    } else if (msg.kind === 'pressure') {
        this.pending = this.pending || {};
        this.pending.boost = msg.boost;
        if (msg.status) this.pending.status = msg.status;
    } else if (msg.kind === 'dtc') {
        if (msg.failed) this.dtc = '掃描失敗';
        else if (!msg.codes.length) this.dtc = '無故障碼';
        else this.dtc = msg.codes.join('  ');
        this._row('DTC', this.dtc);
    }
};

IBoost.prototype._flush = function () {
    if (!this.pending) return;
    var p = this.pending; this.pending = null;
    if (p.boost != null) this._row('BOOST', p.boost.toFixed(2) + ' bar');
    if (p.water != null) this._row('WATER', Math.round(p.water) + ' ℃');
    if (p.oil != null) this._row('OIL', Math.round(p.oil) + ' ℃');
    if (p.rpm != null) this._row('RPM', Math.round(p.rpm) + ' rpm');
    if (p.afr != null) this._row('AFR', p.afr.toFixed(1));
    if (p.speed != null) this._row('SPEED', Math.round(p.speed) + ' km/h');
    if (p.status) {
        var extra = (p.status.can ? 'CAN' : '無CAN') + (p.status.warmup === 2 ? ' · 暖車中' : '') + (p.status.calibrated ? ' · 已校正' : '');
        this._setConn(this.link.split('  ·')[0] + '  · ' + extra);
    }
};

IBoost.prototype._onSetting = function (key, value) {
    var t = this.transport, real = (this.ctx.settings.get('transport') === 'ble');
    if (key === 'transport') { this._setTransport(value); return; }
    if (!t) return;
    if (key === 'warmup' || key === 'warmupTemp') {
        var on = this.ctx.settings.get('warmup');
        // 0x06 ON uses the verified ready frame; OFF is the write builder. Target-temp byte unverified.
        try { t.write(on ? proto.CMD.warmupOn : proto.warmup(false)); } catch (e) {}
    } else if (key === 'mode') {
        // inferred write: 6D 02 <modeByte>; mirror of read 6B 02. Only sent on real BLE.
        var map = { street: 0, sport: 1, race: 2 };
        if (real) { try { t.write(proto.write(0x02, [map[value] || 0, 0x00])); this.ctx.log.info('iboost: mode -> ' + value + ' (inferred 6D 02)'); } catch (e) {} }
    } else if (key === 'scanDtc') {
        if (value) { try { t.write(proto.CMD.scanDtc); } catch (e) {} this.ctx.settings.set('scanDtc', false); this._row('DTC', '掃描中 …'); }
    } else if (key === 'clearDtc') {
        if (value) { try { t.write(proto.CMD.clearDtc); } catch (e) {} this.ctx.settings.set('clearDtc', false); this._row('DTC', '已清除'); }
    }
};

IBoost.prototype._setConn = function (txt) { this.link = txt; this._row('CONN', txt); };
IBoost.prototype._row = function (name, value) {
    try { this.ctx.ui.cells(name, 0, { Text2ndCol: value }); } catch (e) {}
};

module.exports = IBoost;
