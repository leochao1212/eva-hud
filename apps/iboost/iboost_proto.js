'use strict';
/**
 * i-BOOST II main-protocol codec (Node 8, no deps).
 *
 * Frame: 02 <55 app | AA box> <6B read | 6D write/reply> <func> <data...> <CRC_lo CRC_hi>
 * CRC-16/MODBUS (poly 0xA001, init 0xFFFF, reflected), appended Lo,Hi (see 藍牙與韌體協定.md §3).
 * Values in streams are uint16 big-endian; 0xFFFF = that item invalid.
 *
 * This file only builds/parses bytes. The transport (BLE) and the app logic are separate.
 */

/* ---- CRC-16/MODBUS ---- */
function crc16(bytes) {
    var reg = 0xFFFF;
    for (var i = 0; i < bytes.length; i++) {
        reg ^= bytes[i] & 0xFF;
        for (var b = 0; b < 8; b++) reg = (reg & 1) ? ((reg >>> 1) ^ 0xA001) : (reg >>> 1);
    }
    return [reg & 0xFF, (reg >>> 8) & 0xFF];     // Lo, Hi (on-wire order)
}

/** body (no CRC) -> full frame Buffer with CRC appended. */
function frame(body) {
    var c = crc16(body);
    return Buffer.from(body.concat(c));
}

/** App read / write frames. func is the function code; data is an array of bytes. */
function read(func, data) { return frame([0x02, 0x55, 0x6B, func].concat(data || [])); }
function write(func, data) { return frame([0x02, 0x55, 0x6D, func].concat(data || [])); }

/* ---- ready-made frames (verified in the doc) ---- */
var CMD = {
    streamOn: Buffer.from([0x02, 0x55, 0x6D, 0x04, 0x00, 0x01, 0x91, 0x58]),
    streamOff: Buffer.from([0x02, 0x55, 0x6D, 0x04, 0x00, 0x00, 0x50, 0x98]),
    scanDtc: Buffer.from([0x02, 0x55, 0x6B, 0x08, 0x00, 0x00, 0x90, 0x13]),
    clearDtc: Buffer.from([0x02, 0x55, 0x6D, 0x08, 0x00, 0x00, 0x90, 0x9B]),
    readMonitorList: Buffer.from([0x02, 0x55, 0x6B, 0x18, 0x00, 0x00, 0x91, 0xD6]),
    readPidScan: Buffer.from([0x02, 0x55, 0x6B, 0x19, 0x00, 0x00, 0xC0, 0x16]),
    readMac: Buffer.from([0x02, 0x55, 0x6B, 0x17, 0x00, 0x00, 0xA1, 0xD5]),
    readPassword: Buffer.from([0x02, 0x55, 0x6B, 0x13, 0x00, 0x00, 0xE0, 0x14]),
    readVersion: read(0x14, [0x00, 0x00]),              // reply 10 47 etc.
    readMode: read(0x02, [0x00, 0x00]),                 // == 02 55 6B 02 00 00 B0 11
    readThreeModes: read(0x16, [0x00, 0x00]),           // 51-byte reply (0x6B 0x16)
    readPressure: read(0x0D, [0x00, 0x00]),             // connection probe; box also streams 0x0D
    warmupOn: Buffer.from([0x02, 0x55, 0x6D, 0x06, 0x01, 0x03, 0xB0, 0xC9])   // verified ON frame (doc §4.12)
};

/* warm-up (0x06): data = [onOff, seconds-or-temp-code]. ON/30s ready frame from the doc. */
function warmup(on, tempC) {
    if (on) return write(0x06, [0x01, (tempC & 0xFF) || 0x3C]);   // temp byte; 0x3C placeholder
    return write(0x06, [0x00, 0x00]);
}

/* factory reset: always send A5 (global), per §V4.7-B. */
function factoryReset() { return write(0x12, [0xA5, 0x00]); }

/* ---- value conversions (§V4.4.8, FD_EVO, on-car verified) ---- */
function conv(pid, raw) {
    if (raw === 0xFFFF) return null;
    switch (pid) {
        case 0x0101: case 0x0102: return (raw - 100) / 100;        // bar (gauge)
        case 0x0005: return raw - 40;                              // coolant C
        case 0x0068: return raw - 40;                              // intake temp C
        case 0x005C: return raw - 40;                              // oil temp C (OBD std)
        case 0x000B: return raw;                                   // IMAP kPa (abs)
        case 0x0033: return raw;                                   // baro kPa
        case 0x000C: return raw / 4;                               // rpm
        case 0x000D: return raw;                                   // km/h
        case 0x000E: return raw / 2 - 64;                          // ignition deg
        case 0x003C: return raw / 10 - 40;                         // exhaust C
        case 0x0044: return (raw * 2 / 65536) * 14.7;              // AFR (lambda*14.7)
        default: return raw;
    }
}

/* ---- status byte (0x0D [5] == 0x04's 01FF low byte) ---- */
function status(b) {
    return {
        can: !!(b & 0x01),           // bit0 CAN seen
        up6s: !!(b & 0x02),          // bit1 booted >6s
        warmup: (b >>> 2) & 0x07,    // bit2..4 ECT warm-up state 0..6
        pressureValid: !!(b & 0x20), // bit5 pressure fields valid (only trust if version >= 10 46)
        calibrated: !!(b & 0x40)     // bit6 calibrated (>= V0.4.7-B)
    };
}

/* ---- parse a notification (one frame from the box) ---- */
function looksPlausible0D(p) {
    // reject stream fragments that happen to start 0x0D (§V4.7-C)
    if (p.length < 12) return false;
    var st = p[5];
    if (st & 0x80) return false;                 // bit7 must be 0
    if (((st >>> 2) & 0x07) === 7) return false; // warm-up state 7 impossible
    return true;
}

function parse(buf) {
    if (!buf || !buf.length) return null;
    var p = Array.prototype.slice.call(buf);

    // 0x0D live pressure (no header, no CRC, 12/13 bytes, first byte 0x0D)
    if (p[0] === 0x0D && looksPlausible0D(p)) {
        var st = status(p[5]);
        return {
            kind: 'pressure',
            boost: (((p[1] << 8) | p[2]) - 100) / 100,
            map: (((p[3] << 8) | p[4]) - 100) / 100,
            status: st, raw: p
        };
    }

    // main protocol frames from the box: 02 AA 6D <func> ...
    if (p[0] === 0x02 && p[1] === 0xAA && p[2] === 0x6D) {
        var func = p[3];
        if (func === 0x04) return parseStream(p);
        if (func === 0x08) return parseDtc(p);
        if (func === 0x14) return { kind: 'version', major: p[4], minor: p[5], raw: p };
        return { kind: 'reply', func: func, data: p.slice(4, p.length - 2), raw: p };
    }
    return { kind: 'unknown', raw: p };
}

/* 0x04 stream: 02 AA 6D 04 <N> [01 FF 00 <status>] <PID_H PID_L v_H v_L>x(N-1) <CRC> */
function parseStream(p) {
    var n = p[4];
    var items = {};
    var st = null;
    var off = 5;
    for (var i = 0; i < n; i++) {
        var pidH = p[off], pidL = p[off + 1], vH = p[off + 2], vL = p[off + 3];
        off += 4;
        var pid = (pidH << 8) | pidL;
        var raw = (vH << 8) | vL;
        if (pid === 0x01FF) { st = status(vL); continue; }   // status item, not a real PID
        items[pid] = { raw: raw, value: conv(pid, raw) };
    }
    return { kind: 'stream', status: st, items: items, raw: p };
}

/* 0x08 DTC: 02 AA 6D 08 <status> <N> <code_H code_L>xN <CRC> */
function parseDtc(p) {
    var statusByte = p[4];      // 0x00 ok, 0xFF scan failed
    var n = p[5];
    var codes = [];
    var off = 6;
    for (var i = 0; i < n; i++) {
        var code = (p[off] << 8) | p[off + 1];
        off += 2;
        codes.push(dtcText(code));
    }
    return { kind: 'dtc', failed: statusByte === 0xFF, codes: codes, raw: p };
}

/* 2-byte DTC -> P0168 style (SAE J2012) */
function dtcText(code) {
    var letter = 'PCBU'[(code >>> 14) & 0x03];
    var d1 = (code >>> 12) & 0x03;
    var d2 = (code >>> 8) & 0x0F;
    var d3 = (code >>> 4) & 0x0F;
    var d4 = code & 0x0F;
    return letter + d1 + d2.toString(16).toUpperCase() + d3.toString(16).toUpperCase() + d4.toString(16).toUpperCase();
}

module.exports = { crc16: crc16, frame: frame, read: read, write: write, CMD: CMD, warmup: warmup, factoryReset: factoryReset, conv: conv, status: status, parse: parse, dtcText: dtcText };
