'use strict';
/**
 * The mgu-render adapter (shared/mgu_render_adapter.js), against a fake mgu-render on a temporary unix socket:
 * the handshake, the appArea placement, the per-TICK frames, and the two things 0.8.6 added — showing again
 * after the renderer closes us (the foreground gate), and surfacing a renderer error so the status line names
 * the reason the centre screen is empty.
 *
 * Needs neither the app build nor the fonts, so it runs anywhere. The native client reads its socket list at
 * load time, hence MGU_RENDERD_SOCKET before the require.
 *   node bench/test/eva_centre_client_test.js
 */
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakemgu-'));
const SOCK = path.join(dir, 'render.sock');
process.env.MGU_RENDERD_SOCKET = SOCK;
const { ClusterRender } = require('../../shared/mgu_render_adapter');

// the wire (shared/mgu_render_client.js): u32 type, u32 payload length, payload, padded to 4
const M_PLACE = 2, M_SHOW = 3, M_FRAME = 7, X_PIXMAP = 0x4d520003;
const X_READY = 0x4d520101, E_READY = 101, E_TICK = 102, E_ERROR = 103, E_CLOSED = 106;
const SCREEN = [2240, 896], AREA = [280, 120, 1680, 640];    // what the HMI's app area looks like on ID8

function msg(type, payload) {
    const len = payload ? payload.length : 0;
    const b = Buffer.alloc(8 + len + ((4 - (len & 3)) & 3));
    b.writeUInt32LE(type, 0); b.writeUInt32LE(b.length - 8, 4);
    if (len) payload.copy(b, 8);
    return b;
}
const words = (arr) => { const u = new Uint32Array(arr); return Buffer.from(u.buffer, u.byteOffset, u.byteLength); };

const seen = { hello: 0, show: [], place: 0, frames: 0, pixmap: 0, claim: 0 };
let conn = null, ticker = null;

const quiet = { info: (m) => { seen.log = (seen.log || []).concat(['info: ' + m]); },
    warn: (m) => { seen.log = (seen.log || []).concat(['warn: ' + m]); }, error: () => {} };

function fakeRenderer(s) {
    conn = s;
    s.on('error', () => {});
    s.on('data', (d) => {
        let off = 0;
        while (off + 8 <= d.length) {
            const type = d.readUInt32LE(off), len = d.readUInt32LE(off + 4);
            if (off + 8 + len > d.length) break;
            const p = d.slice(off + 8, off + 8 + len);
            off += 8 + len;
            if (type === 1) seen.hello++;
            else if (type === M_SHOW) seen.show.push(p.readUInt32LE(0));
            else if (type === M_PLACE) seen.place++;
            else if (type === M_FRAME) seen.frames++;
            else if (type === X_PIXMAP) seen.pixmap++;
            else if (type === 9) seen.claim++;
        }
    });
    // X_READY: version, mode mask, caps, embedBox, appArea, pixmapSide, refreshMhz
    const r = Buffer.alloc(52);
    r.writeUInt32LE(1, 0); r.writeUInt32LE(1, 4); r.writeUInt32LE(1 | 4 | 8, 8);   // layer, touch, frontGate, pixmap
    [0, 0, SCREEN[0], SCREEN[1]].forEach((v, i) => r.writeUInt32LE(v, 12 + i * 4));
    AREA.forEach((v, i) => r.writeUInt32LE(v, 28 + i * 4));
    r.writeUInt32LE(2048, 44); r.writeUInt32LE(60, 48);
    s.write(msg(X_READY, r));
    s.write(msg(E_READY, words([0, SCREEN[0], SCREEN[1], 0])));
    let n = 0;
    ticker = setInterval(() => {
        try { s.write(msg(E_TICK, words([++n, 16]))); } catch (e) { clearInterval(ticker); }
    }, 40);
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor(fn, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await wait(20); }
    return false;
}

(async () => {
    let failed = 0, total = 0;
    const check = (name, ok, extra) => {
        total++;
        if (ok) console.log('ok    ' + name);
        else { failed++; console.log('FAIL  ' + name + (extra ? '\n      ' + extra : '')); }
    };
    const server = net.createServer(fakeRenderer);
    await new Promise((res) => server.listen(SOCK, res));

    const events = { ready: 0, refused: [], disconnected: 0, touch: [] };
    // size/design space = the centre cockpit's, fullScreen off (the app area, as 0.8.2 fixed it)
    const c = new ClusterRender('test_centre', SOCK, quiet, [1280, 480], false);
    c.on('ready', () => events.ready++);
    c.on('refused', (op, ref, why) => events.refused.push(op + ': ' + why));
    c.on('disconnected', () => events.disconnected++);
    c.on('touch', (phase, x, y) => events.touch.push([phase, x, y]));
    c.connect();
    c.claim([{ x: 0, y: 0, w: 1280, h: 480 }]);      // the centre cockpit claims the whole design area

    await waitFor(() => events.ready > 0, 3000);
    check('the handshake reaches the renderer', seen.hello === 1, 'hello=' + seen.hello);
    check("'ready' is emitted once both READYs arrive", events.ready === 1, 'ready=' + events.ready);
    check('it places into the app area, not the whole screen', seen.place === 1, 'place=' + seen.place);
    check('it shows itself', seen.show[0] === 1, JSON.stringify(seen.show));
    check('the touch area is claimed in screen px', seen.claim === 1, 'claim=' + seen.claim);

    const ref = c.image({ x: 0, y: 0, w: 1280, h: 480, iw: 1280, ih: 480, z: 0 });
    check('an image layer is accepted', !!ref, 'ref=' + ref);
    check('its pixels are stored', c.pixels(ref, null, Buffer.alloc(1280 * 480 * 4, 0x40)) === true);
    check('a pixmap is announced for it', await waitFor(() => seen.pixmap >= 1, 2000), 'pixmap=' + seen.pixmap);
    check('it draws a frame on every TICK', await waitFor(() => seen.frames > 3, 2000), 'frames=' + seen.frames);

    // the renderer closes us: 0.8.6 claims the screen back instead of going black for good
    const shown = seen.show.length;
    conn.write(msg(E_CLOSED, words([1, 0])));
    check("'closed' makes it show itself again", await waitFor(() => seen.show.length > shown, 3000),
        'shows: ' + JSON.stringify(seen.show));

    // a renderer error: 0.8.6 surfaces it (before, it was silently swallowed by the adapter)
    conn.write(msg(E_ERROR, Buffer.from('pixel memory is full')));
    check('a renderer error is surfaced as a refusal', await waitFor(() => events.refused.length > 0, 2000),
        JSON.stringify(events.refused));
    check('the reason is kept', /pixel memory/.test(c.errReason || ''), String(c.errReason));

    clearInterval(ticker);
    c.close();
    await wait(50);
    server.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    console.log('\n' + (total - failed) + ' of ' + total + ' passed');
    process.exit(failed ? 1 : 0);
})();
