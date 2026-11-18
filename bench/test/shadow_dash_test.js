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
const CLEAR_Y = 636;   // instruments stay above BMW's bottom strip
// BMW's gear letter in the bottom strip. Covering it makes the kombi paint a black box on top.
const GEAR_LETTER = [1380, 660, 80, 60];
// art ends left of these x values on the cropped 1920x640 photo
const SAFE_X = { sport: 1190, comfort: 1270, eco: 1460 };
const READINGS = {
    sport: ['{{speed}}', '{{rpm}}', '{{range}}', '{{coolant}}', '{{time}}'],
    comfort: ['{{speed}}', '{{rpm}}', '{{range}}', '{{coolant}}', '{{time}}'],
    eco: ['{{speed}}', '{{rpm}}', '{{range}}', '{{time}}'],
};
const SPEED_FONT = { sport: 'sq_speed', comfort: 'sqs_speed', eco: 'sqs_speed' };
const RPM_FONT = { sport: 'd_num42', comfort: 'd_num42', eco: 'sqs_num64' };
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
        assert.strictEqual(shadow.version, '1.4.2');
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
    _add(kind, o) {
        const ref = this.nextRef++;
        const bytes = kind === 'image' ? o.iw * o.ih * 4 * 2 : 0;
        this.layers.set(ref, Object.assign({ kind, visible: 1, bytes }, o));
        return ref;
    }
    image(o) { return this._add('image', o); }
    effect(o) { return this._add('effect', o); }
    set(ref, o) { const l = this.layers.get(ref); if (l) Object.assign(l, o); }
    uniform() {}
    pixels(ref, rects, px) { this.sent.push({ ref, rects, px }); }
    drop(ref) { this.layers.delete(ref); }
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
            assert.strictEqual(client.layers.size, 6);  // photo, canvas, gear, three black strips
            const photo = Array.from(client.layers.values()).find((l) => l.iw === 1920 && l.ih === 640);
            assert.ok(photo, 'no full-cluster photo');
            const sent = client.sent.find((s) => s.ref && client.layers.get(s.ref) === photo);
            assert.ok(sent && sent.px && sent.px.length === PHOTO_BYTES, 'photo pixels were not uploaded');
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
            a.hu.settings.set('enabled', false);
            await wait(200);
            assert.strictEqual(dash.activeName, 'off');
            assert.strictEqual(client.layers.size, 0);
            dash.stop();
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
