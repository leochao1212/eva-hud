'use strict';
/**
 * Render the Shadow cluster from the built app (dist/shadow_dash) the way the bench does:
 * the real layout, the real text raster and the demo-style drive values. The rpm bar is an
 * effect shader on the car; here it is painted from the same uniforms the app sends.
 *
 * The glyphs are the EVA atlases linked from apps/eva_hud/hud/fonts (gitignored).
 *
 *   node tools/render_shadow.js [outDir] [--stills-only]
 */
const { execFileSync } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'dist', 'shadow_dash');
const OUT = process.argv.slice(2).find((s) => !s.startsWith('--')) || path.join(ROOT, 'dist', 'shadow-preview');
const STILLS_ONLY = process.argv.includes('--stills-only');
const W = 1920, H = 720, PHOTO_H = 640;

class FakeClient {
    constructor(name) {
        this.name = name;
        this.ready = false;
        this.backend = 'test';
        this.layers = new Map();
        this.handlers = {};
        this.nextRef = 1;
        this.sent = [];
        this.applied = 0;
        this.buffers = new Map();
        FakeClient.all.push(this);
    }
    on(ev, fn) { this.handlers[ev] = fn; return this; }
    emit(ev, ...a) { if (this.handlers[ev]) this.handlers[ev](...a); }
    connect() { setImmediate(() => { this.ready = true; this.emit('ready'); }); }
    close() { this.ready = false; }
    _add(kind, o) {
        const ref = this.nextRef++;
        this.layers.set(ref, Object.assign({ kind, visible: 1, uniforms: {} }, o));
        if (kind === 'image') this.buffers.set(ref, Buffer.alloc(o.iw * o.ih * 4));
        return ref;
    }
    image(o) { return this._add('image', o); }
    effect(o) { return this._add('effect', o); }
    set(ref, o) { const l = this.layers.get(ref); if (l) Object.assign(l, o); }
    uniform(ref, name, v) { const l = this.layers.get(ref); if (l) l.uniforms[name] = v; }
    pixels(ref, rects, px) { this.sent.push({ ref, rects, px }); }
    drop(ref) { this.layers.delete(ref); this.buffers.delete(ref); }
    absorb() {
        for (let i = this.applied; i < this.sent.length; i++) {
            const s = this.sent[i];
            const buf = this.buffers.get(s.ref);
            const layer = this.layers.get(s.ref);
            if (!buf || !layer) continue;
            if (!s.rects) { s.px.copy(buf); continue; }
            let off = 0;
            s.rects.forEach((r) => {
                for (let y = 0; y < r.h; y++) {
                    s.px.copy(buf, ((r.y + y) * layer.iw + r.x) * 4, off, off + r.w * 4);
                    off += r.w * 4;
                }
            });
        }
        this.applied = this.sent.length;
    }
}
FakeClient.all = [];

const realLoad = Module._load;
let dash = null;
Module._load = function (req) {
    if (/cluster_render_client(\.js)?$/.test(req)) return { ClusterRender: FakeClient, DEFAULT_PATH: '/nonexistent' };
    const m = realLoad.apply(this, arguments);
    if (req === './shadow_dash' && typeof m === 'function' && !m.__wrapped) {
        const Wrapped = class extends m { constructor(...a) { super(...a); dash = this; } };
        Wrapped.__wrapped = true;
        return Wrapped;
    }
    return m;
};

function start(mode) {
    FakeClient.all.length = 0;
    dash = null;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-render-'));
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
        demo: 'off', enabled: true, photoComfort: mode, photoSport: mode, photoEco: mode,
    }));
    const log = { info() {}, warn(s) { console.error(s); }, error(s) { console.error(s); }, debug() {} };
    const { headUnit } = require(path.join(ROOT, 'kit/tools/hu-stub.js'));
    const hu = headUnit(STAGE, { live: true, dataDir, log, image: () => Promise.resolve() });
    Object.keys(require.cache).filter((k) => k.indexOf(STAGE) === 0).forEach((k) => delete require.cache[k]);
    hu.start();
    return hu;
}

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

function drive(hu, name) {
    hu.feed('de.bmw.infotainment.drivingexcitement.FES', 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: name });
}

function show(values) {
    dash.car.data = () => values;
    dash.rpmF = values.rpm;
    dash.rpmShown = values.rpm;
    dash.rangeNow = values.range;
    dash.rangeAt = Date.now();
    dash._now = () => ({ getHours: () => values.hh, getMinutes: () => values.mm });
    const now = Date.now();
    dash._smoothRpm(now);
    dash.widgets.forEach((x) => dash._update(x, now, true));
    FakeClient.all[0].absorb();
}

function over(dst, dx, dy, src, sw, sh) {
    for (let y = 0; y < sh; y++) {
        const dy2 = dy + y;
        if (dy2 < 0 || dy2 >= H) continue;
        for (let x = 0; x < sw; x++) {
            const dx2 = dx + x;
            if (dx2 < 0 || dx2 >= W) continue;
            const si = (y * sw + x) * 4;
            const a = src[si + 3] / 255;
            if (a <= 0) continue;
            const di = (dy2 * W + dx2) * 4;
            if (a >= 1) {
                dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255;
                continue;
            }
            const ia = 1 - a;
            dst[di] = src[si] * a + dst[di] * ia;
            dst[di + 1] = src[si + 1] * a + dst[di + 1] * ia;
            dst[di + 2] = src[si + 2] * a + dst[di + 2] * ia;
            dst[di + 3] = 255;
        }
    }
}

function px(c) { return Math.max(0, Math.min(255, Math.round(c))); }

function paintFill(dst, layer) {
    const u = layer.uniforms;
    if (!u.u_color || !u.u_size || u.u_max) return false;
    const c = u.u_color;
    for (let y = 0; y < layer.h; y++) {
        const yy = layer.y + y;
        if (yy < 0 || yy >= H) continue;
        for (let x = 0; x < layer.w; x++) {
            const xx = layer.x + x;
            if (xx < 0 || xx >= W) continue;
            const di = (yy * W + xx) * 4;
            dst[di] = Math.round(c[0] * 255);
            dst[di + 1] = Math.round(c[1] * 255);
            dst[di + 2] = Math.round(c[2] * 255);
            dst[di + 3] = 255;
        }
    }
    return true;
}

function paintBar(dst, layer) {
    const u = layer.uniforms;
    if (!u.u_max || !u.u_size) return;
    const max = u.u_max[0], value = (u.u_value && u.u_value[0]) || 0, red = (u.u_red && u.u_red[0]) || 7000;
    const top = (u.u_top && u.u_top[0]) || 0, barH = (u.u_barH && u.u_barH[0]) || 30;
    const from = u.u_from || [1, 0.4, 0], to = u.u_to || from, hot = u.u_hot || [1, 0.16, 0.16];
    const track = u.u_track || [1, 0.4, 0, 0.2];
    const bw = layer.w;
    const y0 = layer.y + top;
    for (let y = 0; y < barH; y++) {
        for (let x = 0; x < bw; x++) {
            const rpm = (x / bw) * max;
            let r, g, b, a;
            if (rpm <= value) {
                const f = Math.max(0, Math.min(1, rpm / Math.max(1, red - 300)));
                const hotNow = value >= red - 300;
                const src = hotNow ? hot : [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f];
                r = src[0]; g = src[1]; b = src[2]; a = 1;
            } else if (rpm >= red) {
                r = hot[0]; g = hot[1]; b = hot[2]; a = 0.35;
            } else {
                r = track[0]; g = track[1]; b = track[2]; a = track[3] === undefined ? 1 : track[3];
            }
            const di = ((y0 + y) * W + (layer.x + x)) * 4;
            if (di < 0 || di + 3 >= dst.length) continue;
            const ia = 1 - a;
            dst[di] = px(r * 255) * a + dst[di] * ia;
            dst[di + 1] = px(g * 255) * a + dst[di + 1] * ia;
            dst[di + 2] = px(b * 255) * a + dst[di + 2] * ia;
        }
    }
    if (value > 40) {
        const nx = layer.x + Math.round((value / max) * bw);
        for (let y = 0; y < barH; y++) {
            for (let dx = -1; dx <= 1; dx++) {
                const di = ((y0 + y) * W + nx + dx) * 4;
                if (di < 0 || di + 3 >= dst.length) continue;
                dst[di] = 255; dst[di + 1] = 255; dst[di + 2] = 255; dst[di + 3] = 255;
            }
        }
    }
}

function frame() {
    const client = FakeClient.all[0];
    const dst = Buffer.alloc(W * H * 4, 0);
    for (let i = 0; i < W * H; i++) dst[i * 4 + 3] = 255;
    const layers = Array.from(client.layers.entries()).map(([ref, l]) => Object.assign({ ref }, l));
    layers.sort((a, b) => (a.z || 0) - (b.z || 0));
    layers.forEach((l) => {
        if (l.visible === 0) return;
        if (l.kind === 'image') {
            const buf = client.buffers.get(l.ref);
            if (buf) over(dst, l.x, l.y, buf, l.iw, l.ih);
        } else if (l.kind === 'effect') {
            if (!paintFill(dst, l)) paintBar(dst, l);
        }
    });
    // y=636-720 stays the black the buffer was cleared to. The photo fades to that
    // black in its last rows, so there is no seam and no smeared last-row copy.
    return dst;
}

function sample(t) {
    // 0..8 s: idle in P, pull through the gears to about 120 km/h, then cruise
    const base = { range: 512, coolant: 86, hh: 14, mm: 32, oil: 90 };
    if (t < 0.7) return Object.assign(base, { speed: 0, rpm: 850, gear: 0, stage: 'P', coolant: 78 });
    if (t < 6.4) {
        const u = (t - 0.7) / 5.7;
        const speed = u * 122;
        const bands = [[0, 22, 1, 1400, 6200], [22, 42, 2, 1600, 6400], [42, 64, 3, 1700, 6100], [64, 86, 4, 1800, 5800], [86, 106, 5, 1900, 5200], [106, 130, 6, 2000, 3600]];
        const band = bands.find((b) => speed < b[1]) || bands[bands.length - 1];
        const f = Math.max(0, Math.min(1, (speed - band[0]) / (band[1] - band[0])));
        return Object.assign(base, {
            speed, gear: band[2], stage: 'D',
            rpm: Math.round(band[3] + (band[4] - band[3]) * f),
            coolant: Math.round(78 + u * 12),
            range: Math.round(512 - u * 4),
        });
    }
    return Object.assign(base, { speed: 118, rpm: 2450, gear: 6, stage: 'D', coolant: 91, range: 508 });
}

const MID = { speed: 96, rpm: 4550, gear: 4, stage: 'D', range: 498, coolant: 88, hh: 14, mm: 32, oil: 94 };

async function settle() {
    await wait(250);
    if (dash) dash._tick();
    FakeClient.all[0].absorb();
}

function writeRaw(file, buf) { fs.writeFileSync(file, buf); }

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const frames = path.join(OUT, 'frames');
    if (!STILLS_ONLY) fs.mkdirSync(frames, { recursive: true });
    for (const mode of ['sport', 'comfort', 'eco']) {
        const hu = start(mode);
        await settle();
        const fes = mode === 'sport' ? 'SPORT' : mode === 'eco' ? 'ECO PRO' : 'COMFORT';
        drive(hu, fes);
        await wait(180);
        show(MID);
        writeRaw(path.join(OUT, mode + '.rgba'), frame());
        console.log('still', mode);
        // Exercise real gear atlases at every selector state, including the
        // Eco frame. A gear change must keep an empty, transparent edge.
        const gear = Array.from(dash.widgets.values()).find((x) => x.w.type === 'evagear').w;
        for (const stage of ['D', 'M', 'S', 'P', 'R', 'N', undefined]) {
            for (const digit of [0, 4, 8]) {
                dash.car.data = () => Object.assign({}, MID, { stage, gear: digit });
                const px = dash._paintGear(gear, dash._gearFor());
                assert.ok(px.some((v, i) => i % 4 === 3 && v > 0), 'blank gear '+stage+digit);
                for (let y = 0; y < gear.h; y++) {
                    assert.strictEqual(px[(y*gear.w)*4+3], 0, 'gear clipped left');
                    assert.strictEqual(px[(y*gear.w+gear.w-1)*4+3], 0, 'gear clipped right');
                }
                for (let x = 0; x < gear.w; x++) {
                    assert.strictEqual(px[x*4+3], 0, 'gear clipped top');
                    assert.strictEqual(px[((gear.h-1)*gear.w+x)*4+3], 0, 'gear clipped bottom');
                }
            }
        }
        show(MID);
        if (mode === 'sport' && !STILLS_ONLY) {
            for (let i = 0; i <= 80; i++) {
                show(sample(i / 10));
                writeRaw(path.join(frames, 'f' + String(i).padStart(3, '0') + '.rgba'), frame());
            }
            console.log('frames', 81);
        }
        dash.stop();
    }
    execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
        ['-X', 'utf8', path.join(__dirname, 'shadow_preview.py'), OUT], { stdio: 'inherit' });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
