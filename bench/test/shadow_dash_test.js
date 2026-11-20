'use strict';
/**
 * The Shadow app's layouts, and the app on the head-unit stub: one cluster connection, a photo per
 * drive mode, and no iDrive 8 build.
 *   node bench/test/shadow_dash_test.js
 */
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HUD = path.join(ROOT, 'apps/shadow_dash/hud');
const STAGE = path.join(ROOT, 'dist', 'shadow_dash');
const THEMES = require(path.join(ROOT, 'shared/hud_themes')).THEMES;
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const load = (name) => JSON.parse(fs.readFileSync(path.join(HUD, 'layouts', name + '.json'), 'utf8'));

const PHOTO_BYTES = 1920 * 640 * 4;
const PIXEL_MEMORY = 16 * 1000 * 1000;   // cluster-render's, shared by all clients (PROTOCOL.md)
const ETC2_BYTES = 1920 * 640;           // etc2rgba: 1 byte a pixel
const CLEAR_Y = 636;   // instruments stay above BMW's bottom strip
// BMW's gear letter in the bottom strip. Covering it makes the kombi paint a black box on top.
const GEAR_LETTER = [1380, 660, 80, 60];
// art ends left of these x values on the cropped 1920x640 photo
const SAFE_X = { sport: 1190, comfort: 1270, eco: 1260 };
const READINGS = {
    sport: ['{{speed}}', '{{rpm}}', '{{range}}', '{{coolant}}', '{{time}}'],
    comfort: ['{{speed}}', '{{rpm}}', '{{range}}', '{{coolant}}', '{{time}}'],
    eco: ['{{speed}}', '{{rpm}}', '{{range}}', '{{coolant}}', '{{time}}'],
};
const SPEED_FONT = { sport: 'sq_speed', comfort: 'sqs_speed', eco: 'sqs_speed' };
const RPM_FONT = { sport: 'd_num42', comfort: 'd_num42', eco: 'd_num42' };
function build(hmi) {
    return execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
        ['-X', 'utf8', 'kit/tools/build.py', 'shadow_dash'], {
            cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, hmi ? { MGU_HMI: hmi } : {}),
        });
}

function layoutTests() {
    const tests = {};
    ['sport', 'comfort', 'eco'].forEach((mode) => {
        tests[mode + ' layout keeps the instruments in the dark right-hand field'] = () => {
            const layout = load('dash_shadow_' + mode);
            assert.strictEqual(layout.schemaVersion, 2);
            assert.strictEqual(layout.theme, 'shadow_' + mode);
            const theme = THEMES[layout.theme];
            assert.ok(theme, 'no theme ' + layout.theme);
            assert.ok(theme.accent[0] > 200 && theme.accent[1] < 160 && theme.accent[2] < 40, mode + ' accent is orange');
            assert.deepStrictEqual(theme.fg.slice(0, 3), [217, 101, 26], mode + ' deep EVA amber');
            assert.ok(theme.dim[0] < theme.fg[0] && theme.dim[1] < theme.fg[1], 'secondary text is dimmer');
            const photo = layout.widgets.find((w) => w.type === 'evaphoto');
            const canvas = layout.widgets.find((w) => w.type === 'evacanvas');
            assert.ok(photo && canvas, 'photo or canvas missing');
            assert.ok(!layout.widgets.some((w) => w.type === 'revbar'), 'the flat rpm bar is still there');
            assert.strictEqual(photo.photo, mode);
            assert.deepStrictEqual([photo.x, photo.y, photo.w, photo.h], [0, 0, 1920, 640]);
            const segs = canvas.parts.find((p) => p.type === 'segs');
            const speed = canvas.parts.find((p) => p.id === 'spd');
            const gear = layout.widgets.find((w) => w.type === 'evagear');
            assert.ok(segs && segs.count === 32 && segs.redFrom === 28, 'exact 7000 rpm redline');
            assert.strictEqual(segs.w, canvas.w, 'rpm bar uses the full data field');
            assert.ok(segs.h >= 30, 'rpm bar is readable');
            assert.ok(!canvas.parts.some((p) => p.type === 'badge'), 'no filled gear badge');
            assert.ok(speed && speed.glow && speed.offsetY >= 18 && speed.font === SPEED_FONT[mode], 'speed atlas');
            assert.strictEqual(canvas.parts.find((p) => p.id === 'rpm').font, RPM_FONT[mode]);
            assert.strictEqual(canvas.parts.find((p) => p.id === 'spd_l').font, 'd_label');
            assert.strictEqual(canvas.parts.find((p) => p.id === 'spd_u').font, 'd_unit');
            assert.ok(gear && gear.driveLetter && gear.fontPrefix === '', 'EVA gear with drive letter');
            assert.ok(canvas.parts.some((p) => p.type === 'hazard'), 'EVA hazard detail');
            assert.ok(canvas.parts.some((p) => p.text === '{{gearcapjp}}'), 'bilingual gear caption');
            const live = canvas.parts.filter((p) => p.text && READINGS[mode].indexOf(p.text) >= 0);
            assert.deepStrictEqual(live.map((p) => p.text), READINGS[mode]);
            assert.strictEqual(canvas.parts.filter((p) => /^s\d$/.test(p.id)).length, 0, 'the 0-8 ticks are gone');
            const boxes = layout.widgets.filter((w) => w.id !== 'bg' && w.id.indexOf('strip_') !== 0).map((w) => [w.x, w.y, w.w, w.h]);
            canvas.parts.forEach((p) => boxes.push([canvas.x + p.x, canvas.y + p.y, p.w, p.h]));
            boxes.forEach((b) => {
                assert.ok(b[0] >= SAFE_X[mode], mode + ' covers the art at x ' + b[0]);
                assert.ok(b[0] + b[2] <= 1920 && b[1] >= 0, mode + ' runs off the cluster');
                assert.ok(b[1] + b[3] <= CLEAR_Y, mode + ' reaches BMW\'s warning row');
            });
            const rgba = fs.readFileSync(path.join(HUD, 'photos', mode + '.rgba'));
            assert.strictEqual(rgba.length, PHOTO_BYTES);
            for (let i = CLEAR_Y * 1920 * 4; i < rgba.length; i += 4) {
                assert.strictEqual(rgba[i] | rgba[i+1] | rgba[i+2], 0, 'photo bottom must be pure black');
            }
        };
    });
    tests['the bottom strip is covered except for BMW\'s gear letter'] = () => {
        const hits = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
        ['sport', 'comfort', 'eco'].forEach((mode) => {
            const layout = load('dash_shadow_' + mode);
            const strips = layout.widgets.filter((w) => w.id.indexOf('strip_') === 0);
            strips.forEach((s) => {
                assert.strictEqual(s.type, 'fill', mode + ' ' + s.id + ' is a fill');
                assert.strictEqual(s.color, 'black', mode + ' ' + s.id + ' is black');
                assert.ok(!hits([s.x, s.y, s.w, s.h], GEAR_LETTER), mode + ' ' + s.id + ' covers the gear letter');
            });
            // every pixel from the photo's bottom edge (y=640) to the panel's (y=720) is either
            // under the photo, under a black strip, or inside BMW's gear-letter cell
            const covers = (x, y, r) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
            for (let y = 640; y < 720; y += 1) {
                for (let x = 0; x < 1920; x += 4) {
                    const open = covers(x, y, GEAR_LETTER) || strips.some((s) => covers(x, y, [s.x, s.y, s.w, s.h]));
                    assert.ok(open, mode + ' bottom strip uncovered at ' + x + ',' + y);
                }
            }
            const rects = [];
            layout.widgets.forEach((w) => { if (w.id.indexOf('strip_') !== 0) rects.push([w.x, w.y, w.w, w.h, w.id]); });
            const canvas = layout.widgets.find((w) => w.type === 'evacanvas');
            canvas.parts.forEach((p) => rects.push([canvas.x + p.x, canvas.y + p.y, p.w, p.h, p.id]));
            rects.forEach((r) => assert.ok(!hits(r, GEAR_LETTER), mode + ' ' + r[4] + ' covers the gear letter'));
            const gear = layout.widgets.find((w) => w.type === 'evagear');
            assert.ok(gear.x >= 1440, mode + ' gear is back in the right-hand column');
        });
    };
    tests['EVA no longer ships the Shadow photos or the Shadow menu row'] = () => {
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/eva_hud/app.json'), 'utf8'));
        spec.settings.forEach((s) => (s.options || []).forEach((o) => assert.notStrictEqual(o[0], 'shadow', s.key)));
        ['sport', 'comfort', 'eco'].forEach((mode) => {
            assert.ok(!fs.existsSync(path.join(ROOT, 'apps/eva_hud/hud/photos', mode + '.rgba')), mode);
            assert.ok(!fs.existsSync(path.join(ROOT, 'apps/eva_hud/hud/layouts/dash_shadow_' + mode + '.json')), mode);
        });
        assert.ok(fs.existsSync(path.join(ROOT, 'apps/eva_hud/hud/photos/cockpit.rgba')), 'the cockpit photo stays with EVA');
        const shadow = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/shadow_dash/app.json'), 'utf8'));
        assert.strictEqual(shadow.version, '1.5.0');
        assert.strictEqual(shadow.id, 'shadow_dash');
        assert.deepStrictEqual(shadow.mguHmi, ['ID7']);
        assert.strictEqual(shadow.id7Only, true);
        assert.notStrictEqual(shadow.id, spec.id);
        assert.notStrictEqual(shadow.loggingId, spec.loggingId);
    };
    return tests;
}

class FakeClient {
    constructor(name) {
        this.name = name;
        this.ready = false;
        this.backend = 'test';
        this.layers = new Map();
        this.handlers = {};
        this.nextRef = 1;
        this.sent = [];
        FakeClient.all.push(this);
    }
    on(ev, fn) { this.handlers[ev] = fn; return this; }
    emit(ev, ...a) { if (this.handlers[ev]) this.handlers[ev](...a); }
    connect() { setImmediate(() => { this.ready = true; this.emit('ready'); }); }
    close() { this.ready = false; }
    // cluster-render's pixel memory, shared by every client (PROTOCOL.md "Choosing a pixel format"):
    // image layers and rgba assets count twice their size, compressed assets once. Past 16 MB the
    // layer or asset is refused, as on the car.
    _add(kind, o) {
        const ref = this.nextRef++;
        let bytes = 0;
        if (kind === 'image') bytes = o.iw * o.ih * 4 * 2;
        if (kind === 'asset') bytes = /^etc2/.test(o.format) ? o.w * o.h * (o.format === 'etc2rgb' ? 0.5 : 1) : o.w * o.h * (o.format === 'r8' ? 1 : 4) * 2;
        this.layers.set(ref, Object.assign({ kind, visible: 1, bytes, uniforms: {}, binds: {} }, o));
        if (this.usedBytes() + (this.reserved || 0) > PIXEL_MEMORY) {
            this.layers.delete(ref);
            setImmediate(() => this.emit('refused', kind === 'asset' ? 'asset' : 'layer', ref, "the service's pixel memory is full"));
            return ref;    // the real client hands out the ref; the service refuses it later
        }
        this.peakBytes = Math.max(this.peakBytes || 0, this.usedBytes());
        // an effect layer has no pixels to wait for: the service says it is drawn straight away (an image, once its pixels came)
        if (kind === 'effect') setImmediate(() => { if (this.layers.has(ref)) this.emit('layer', ref, 'shown'); });
        return ref;
    }
    usedBytes() { let n = 0; this.layers.forEach((l) => { n += l.bytes || 0; }); return n; }
    image(o) { return this._add('image', o); }
    effect(o) { return this._add('effect', o); }
    asset(o) { return this._add('asset', o); }
    set(ref, o) { const l = this.layers.get(ref); if (l) Object.assign(l, o); }
    uniform(ref, name, v) { const l = this.layers.get(ref); if (l) l.uniforms[name] = v; }
    bind(ref, sampler, asset) { const l = this.layers.get(ref); if (l) l.binds[sampler] = asset; }
    pixels(ref, rects, px) { this.sent.push({ ref, rects, px }); }
    drop(ref) { this.layers.delete(ref); }
    photos() { return Array.from(this.layers.entries()).filter(([, l]) => l.kind === 'effect' && l.binds.u_photo); }
    targets() { return Array.from(new Set(Array.from(this.layers.values()).map((l) => l.target))); }
}
FakeClient.all = [];

const realLoad = Module._load;
const dashes = [];
Module._load = function (req) {
    if (/cluster_render_client(\.js)?$/.test(req)) return { ClusterRender: FakeClient, DEFAULT_PATH: '/nonexistent' };
    const m = realLoad.apply(this, arguments);
    if (req === './shadow_dash' && typeof m === 'function') {
        return class extends m { constructor(...a) { super(...a); dashes.push(this); } };
    }
    return m;
};

function startApp(values) {
    FakeClient.all.length = 0;
    dashes.length = 0;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-dash-'));
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(Object.assign({ demo: 'off' }, values)));
    const quiet = () => {};
    const lines = [];
    const log = { info: quiet, warn: (s) => lines.push(String(s)), error: (s) => lines.push('ERROR ' + (s && s.stack || s)), debug: quiet };
    const { headUnit } = require(path.join(ROOT, 'kit/tools/hu-stub.js'));
    const hu = headUnit(STAGE, { live: true, dataDir, log, image: () => Promise.resolve() });
    Object.keys(require.cache).filter((k) => k.indexOf(STAGE) === 0).forEach((k) => delete require.cache[k]);
    hu.start();
    const drive = (mode) => hu.feed('de.bmw.infotainment.drivingexcitement.FES', 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: mode });
    return { hu, lines, drive, dash: () => dashes[0], client: () => FakeClient.all[0] };
}

const SETTLE_MS = 400;

function runtimeTests() {
    return {
        async 'the cluster follows the drive mode, and each mode can pick another photo'() {
            const a = startApp({});
            await wait(SETTLE_MS);
            const dash = a.dash(), client = a.client();
            assert.strictEqual(client.name, 'shadow_dash_cluster');
            assert.strictEqual(dash.target, 'panel');
            assert.strictEqual(dash.activeName, 'shadow_comfort');
            assert.deepStrictEqual(client.targets(), ['panel']);
            // three etc2rgba photo assets, then photo (an effect), canvas, gear, three black strips
            const assets = Array.from(client.layers.entries()).filter(([, l]) => l.kind === 'asset');
            assert.deepStrictEqual(assets.map(([, l]) => [l.format, l.w, l.h]), [0, 1, 2].map(() => ['etc2rgba', 1920, 640]));
            assets.forEach(([ref]) => {
                const sent = client.sent.filter((s) => s.ref === ref);
                assert.ok(sent.length === 1 && !sent[0].rects && sent[0].px.length === ETC2_BYTES, 'each photo goes up once, whole');
            });
            assert.strictEqual(client.layers.size, 9);
            assert.ok(!Array.from(client.layers.values()).some((l) => l.kind === 'image' && l.iw === 1920 && l.ih === 640), 'no rgba photo');
            assert.strictEqual(client.photos().length, 1, 'one photo layer');
            const [, photo] = client.photos()[0];
            assert.strictEqual(photo.klass, 'ambient');
            assert.deepStrictEqual([photo.x, photo.y, photo.w, photo.h], [0, 0, 1920, 640]);
            assert.deepStrictEqual(photo.uniforms.u_alpha, [1]);
            assert.ok(client.usedBytes() <= 8e6, 'Shadow uses ' + (client.usedBytes() / 1e6).toFixed(1) + ' MB of the 16');
            a.drive('SPORT');
            await wait(200);
            assert.strictEqual(dash.activeName, 'shadow_sport');
            assert.strictEqual(dash.theme.name, 'Shadow Sport');
            a.hu.settings.set('photoSport', 'eco');
            await wait(200);
            assert.strictEqual(dash.activeName, 'shadow_eco');
            a.drive('ECO PRO');
            await wait(200);
            assert.strictEqual(dash.activeName, 'shadow_eco');
            // every swap included: Shadow alone must leave room in the 16 MB for EVA and the other apps
            assert.ok(client.peakBytes <= PIXEL_MEMORY, 'pixel memory peak ' + (client.peakBytes / 1e6).toFixed(1) + ' MB > 16 MB');
            a.hu.settings.set('enabled', false);
            await wait(200);
            assert.strictEqual(dash.activeName, 'off');
            assert.strictEqual(client.layers.size, 0);
            dash.stop();
        },
        async 'a drive-mode swap fades the new photo in over the old one, with nothing uploaded'() {
            const a = startApp({ photoTransition: 'fade' });
            await wait(SETTLE_MS);
            const dash = a.dash(), client = a.client();
            try {
                const assetOf = {};
                Array.from(client.layers.entries()).filter(([, l]) => l.kind === 'asset').forEach(([ref], i) => { assetOf[['sport', 'comfort', 'eco'][i]] = ref; });
                const [[oldRef, old]] = client.photos();
                assert.strictEqual(old.binds.u_photo, assetOf.comfort);
                const sentBefore = client.sent.length;
                const strips = () => Array.from(client.layers.entries()).filter(([, l]) => l.kind === 'effect' && l.uniforms.u_hole).map(([r]) => r).sort();
                const stripRefs = strips();
                assert.strictEqual(stripRefs.length, 3, 'three black strips');
                const dropped = [];
                const drop = client.drop.bind(client);
                client.drop = (ref) => { dropped.push(ref); drop(ref); };
                const alphas = [];
                const uniform = client.uniform.bind(client);
                client.uniform = (ref, name, v) => { if (name === 'u_alpha') alphas.push([ref, v[0]]); uniform(ref, name, v); };
                a.drive('SPORT');
                await wait(30);
                const both = client.photos();
                assert.strictEqual(both.length, 2, 'the old photo stays under the new one');
                const [newRef, fresh] = both.find(([r]) => r !== oldRef);
                assert.ok(newRef > oldRef, 'the new photo is the newer layer: on top at the same z');
                assert.strictEqual(fresh.z, old.z);
                assert.strictEqual(fresh.binds.u_photo, assetOf.sport);
                await wait(400);
                assert.deepStrictEqual(client.photos().map(([r]) => r), [newRef], 'the old photo is dropped after the fade');
                const fade = alphas.filter(([r]) => r === newRef).map(([, v]) => v);
                assert.ok(fade[0] === 0 && fade[fade.length - 1] === 1 && fade.length >= 4, 'fades 0 -> 1: ' + fade);
                assert.ok(fade.every((v, i) => !i || v >= fade[i - 1]), 'monotonic: ' + fade);
                const photoUploads = client.sent.slice(sentBefore).filter((s) => s.px && s.px.length >= ETC2_BYTES);
                assert.strictEqual(photoUploads.length, 0, 'no photo pixels sent on a swap');
                // the black strips over BMW's status row are never dropped on a swap: not even for a frame
                assert.deepStrictEqual(strips(), stripRefs, 'the same three strip layers');
                assert.ok(!dropped.some((r) => stripRefs.indexOf(r) >= 0), 'a strip was dropped during the swap');
                // two swaps faster than the fade: never more than two photo layers
                a.drive('ECO PRO');
                await wait(60);
                a.drive('COMFORT');
                await wait(20);
                assert.ok(client.photos().length <= 2, client.photos().length + ' photo layers');
                await wait(400);
                assert.strictEqual(client.photos().length, 1);
                assert.strictEqual(client.photos()[0][1].binds.u_photo, assetOf.comfort);
                assert.ok(client.peakBytes <= 8e6, 'peak ' + (client.peakBytes / 1e6).toFixed(1) + ' MB');
                assert.deepStrictEqual(strips(), stripRefs, 'strips still the same after three swaps');
                // off: no layer and no asset left, so EVA gets the panel and the memory
                a.hu.settings.set('enabled', false);
                await wait(200);
                assert.strictEqual(client.layers.size, 0);
                a.hu.settings.set('enabled', true);
                await wait(200);
                assert.strictEqual(client.photos().length, 1, 'back on: the photo again');
                assert.strictEqual(Array.from(client.layers.values()).filter((l) => l.kind === 'asset').length, 3);
            } finally { dash.stop(); }
        },
        async 'each photo change animation runs to the end, swaps without a rebuild, and Random varies'() {
            const a = startApp({});
            await wait(SETTLE_MS);
            const dash = a.dash(), client = a.client();
            try {
                const styleOf = { wave: 1, stripes: 2, sheen: 3 };
                const seen = [];
                const uniform = client.uniform.bind(client);
                const ts = [];
                client.uniform = (ref, name, v) => { if (name === 'u_style') seen.push(v[0]); if (name === 'u_t') ts.push(v[0]); uniform(ref, name, v); };
                const modes = ['SPORT', 'ECO PRO', 'COMFORT'];
                let n = 0;
                for (const style of ['wave', 'stripes', 'sheen', 'off']) {
                    const built = dash.widgets.size;
                    a.hu.settings.set('photoTransition', style);
                    seen.length = 0; ts.length = 0;
                    a.drive(modes[n++ % 3]);
                    await wait(60);
                    if (style !== 'off') {
                        assert.strictEqual(client.photos().length, 2, style + ': the old photo under the new one');
                        assert.deepStrictEqual(seen, [styleOf[style]], style);
                        const [, fresh] = client.photos().find(([r]) => r === Math.max(...client.photos().map(([x]) => x)));
                        assert.deepStrictEqual(fresh.uniforms.u_span, [1240]);
                        assert.deepStrictEqual(fresh.uniforms.u_alpha, [1], style + ': the shader masks it, not the alpha');
                    }
                    await wait(1250);
                    assert.strictEqual(client.photos().length, 1, style + ': done, the old photo dropped');
                    if (style !== 'off') assert.ok(ts.length >= 6 && ts[ts.length - 1] === 1, style + ': u_t to 1: ' + ts.slice(-3));
                    assert.ok(dash.widgets.size >= built - 1, style);
                }
                a.hu.settings.set('photoTransition', 'random');
                const picked = [];
                for (let i = 0; i < 4; i++) {
                    seen.length = 0;
                    a.drive(modes[n++ % 3]);
                    await wait(1250);
                    picked.push(seen[0]);
                }
                assert.ok(picked.every((v) => v >= 1 && v <= 3), 'moving styles only: ' + picked);
                assert.ok(picked.every((v, i) => !i || v !== picked[i - 1]), 'never the same twice running: ' + picked);
                assert.ok(client.peakBytes <= 8e6, 'peak ' + (client.peakBytes / 1e6).toFixed(1) + ' MB');
            } finally { dash.stop(); }
        },
        async 'a refused etc2 photo falls back to the rgba photo'() {
            const a = startApp({});
            await wait(SETTLE_MS);
            const dash = a.dash(), client = a.client();
            try {
                const asset = Array.from(client.layers.entries()).find(([, l]) => l.kind === 'asset')[0];
                client.emit('layer', asset, 'error', 'asset ' + asset + ': the renderer refused its 1920x640 etc2rgba texture');
                await wait(200);
                assert.strictEqual(client.photos().length, 0);
                assert.ok(!Array.from(client.layers.values()).some((l) => l.kind === 'asset'), 'assets dropped');
                const rgba = Array.from(client.layers.values()).filter((l) => l.kind === 'image' && l.iw === 1920 && l.ih === 640);
                assert.strictEqual(rgba.length, 1, 'the rgba photo instead');
                assert.ok(a.lines.some((l) => /etc2 photo refused/.test(l)), 'logged');
            } finally { dash.stop(); }
        },
        async 'a photo refused for memory is not taken for an etc2 problem: no rgba photo'() {
            const a = startApp({});
            await wait(SETTLE_MS);
            const dash = a.dash(), client = a.client();
            try {
                const asset = Array.from(client.layers.entries()).find(([, l]) => l.kind === 'asset')[0];
                client.emit('refused', 'asset', asset, "the service's pixel memory is full");
                await wait(200);
                assert.ok(!dash.etc2Broken, 'etc2 still in use');
                assert.ok(!Array.from(client.layers.values()).some((l) => l.kind === 'image' && l.iw === 1920 && l.ih === 640), 'no 9.8 MB rgba photo');
            } finally { dash.stop(); }
        },
        async 'a bottom strip refused is made again, the others stay'() {
            const a = startApp({});
            await wait(SETTLE_MS);
            const dash = a.dash(), client = a.client();
            try {
                const strips = () => Array.from(client.layers.entries()).filter(([, l]) => l.kind === 'effect' && l.uniforms.u_hole).map(([r]) => r);
                const before = strips();
                assert.strictEqual(before.length, 3);
                client.layers.delete(before[0]);
                client.emit('refused', 'layer', before[0], 'too many layers');
                await wait(300);
                assert.strictEqual(strips().length, 2);
                await wait(2000);
                assert.strictEqual(strips().length, 3, 'made again');
                assert.ok(before.slice(1).every((r) => strips().indexOf(r) >= 0), 'the other two untouched');
            } finally { dash.stop(); }
        },
        async 'a layer refused for pixel memory is built again a few seconds later'() {
            const a = startApp({});
            await wait(SETTLE_MS);
            const dash = a.dash(), client = a.client();
            try {
                client.reserved = 15e6;     // another app holds most of the memory
                a.drive('SPORT');
                await wait(100);
                assert.ok(a.lines.some((l) => /pixel memory is full/.test(l)), 'a refusal was seen');
                assert.ok(dash.memRetry.timer, 'a rebuild is scheduled');
                client.reserved = 0;        // that app lets go
                await wait(5400);
                assert.ok(!dash.memRetry.timer || dash.memRetry.n >= 1, 'it built again');
                const canvas = Array.from(client.layers.values()).find((l) => l.kind === 'image' && l.iw === 658);
                assert.ok(canvas, 'the Sport canvas is there after the retry');
            } finally { dash.stop(); }
        },
        async 'an iDrive 8 build is refused'() {
            const out = build('ID8');
            assert.ok(/iDrive 7 only, not built/.test(out), out);
            const spec = JSON.parse(fs.readFileSync(path.join(STAGE, 'source/javascript/kit/app-spec.json'), 'utf8'));
            assert.deepStrictEqual(spec.hmi, ['ID7']);
            assert.strictEqual(spec.id, 'shadow_dash');
        },
        async 'drive letters survive shifts and red is reserved for the exact redline zone'() {
            const a = startApp({});
            await wait(SETTLE_MS);
            const dash = a.dash();
            try {
                a.hu.feed('de.bmw.infrastructure.VehicleInformation', 'statusGearboxDrive', {
                    statusActualStageDrive: 'M', statusActualGearDrive: 6,
                });
                assert.strictEqual(dash.car.data().stage, 'M', 'manual stage survives the vehicle parser');
                assert.strictEqual(dash._gearFor().text, 'M4');
                for (const stage of ['D', 'M', 'P', 'R', 'N']) {
                    dash.car.data = () => ({ stage, gear: 4, speed: 96, rpm: 7800 });
                    const st = dash._gearFor();
                    assert.strictEqual(st.text, /^[DM]$/.test(stage) ? stage+'4' : stage);
                    assert.strictEqual(st.kind, 'cluster', 'gear must not inherit shift red/blink/scale');
                }
                dash.car.data = () => ({ stage: 'D', gear: 1, speed: 0 });
                assert.strictEqual(dash._gearFor().text, 'D1', 'drive letter also appears at rest');
                dash.car.data = () => ({ gear: 4, speed: 96 });
                assert.strictEqual(dash._gearFor().text, '4', 'a missing selector must not hide a known gear');
                const p = load('dash_shadow_comfort').widgets.find((w) => w.type === 'evacanvas').parts.find((p) => p.type === 'segs');
                for (const lit of [0, 19, 28, 29, 32]) {
                    const pixels = dash._paintSegs(p, lit);
                    let red = 0;
                    for (let o = 0; o < pixels.length; o += 4) {
                        if (pixels[o] === 255 && pixels[o+1] === 17 && pixels[o+2] === 0 && pixels[o+3]) {
                            red++;
                            assert.ok((o/4)%p.w >= p.w*0.875, 'red pixel before 7000 rpm');
                        }
                    }
                    assert.strictEqual(red > 0, lit > 28, 'red only when a redline segment lights');
                }
            } finally { dash.stop(); }
        },
    };
}

(async () => {
    const skip = build('ID8');
    if (!/iDrive 7 only, not built/.test(skip)) {
        console.log('FAIL  ID8 build was not skipped\n      ' + skip.split('\n')[0]);
        process.exit(1);
    }
    build();
    const tests = Object.assign(layoutTests(), runtimeTests());
    let failed = 0;
    for (const name of Object.keys(tests)) {
        try { await tests[name](); console.log('ok    ' + name); }
        catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e && e.stack || e).split('\n')[0]); }
    }
    console.log('\n' + (Object.keys(tests).length - failed) + ' of ' + Object.keys(tests).length + ' passed');
    process.exit(failed ? 1 : 0);
})();
