'use strict';
/**
 * The Shadow app's layouts, and the app on the head-unit stub: one cluster connection, a photo per
 * drive mode, and no iDrive 8 build.
 *   node bench/test/shadow_dash_test.js
 */
const assert = require('assert');
const { execSync } = require('child_process');
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
const READINGS = ['{{speed}}', '{{rpm}}', '{{gear}}', '{{range}}', '{{coolant}}'];
const FONTS = { spd: 'e_rpm', rpm: 'e_num', gear: 'b_gear', rng: 'e_num', wat: 'e_num' };

function layoutTests() {
    const tests = {};
    ['sport', 'comfort', 'eco'].forEach((mode) => {
        tests[mode + ' layout is a panel photo plus the five live numbers'] = () => {
            const layout = load('dash_shadow_' + mode);
            assert.strictEqual(layout.schemaVersion, 2);
            assert.strictEqual(layout.theme, 'shadow_' + mode);
            assert.ok(THEMES[layout.theme], 'no theme ' + layout.theme);
            const photo = layout.widgets.find((w) => w.type === 'evaphoto');
            const canvas = layout.widgets.find((w) => w.type === 'evacanvas');
            assert.ok(photo && canvas);
            assert.strictEqual(photo.photo, mode);
            assert.deepStrictEqual([photo.x, photo.y, photo.w, photo.h], [0, 0, 1920, 640]);
            layout.widgets.forEach((w) => {
                assert.ok(w.x >= 0 && w.y >= 0 && w.x + w.w <= 1920 && w.y + w.h <= 720, w.id + ' runs off the cluster');
            });
            const texts = canvas.parts.filter((p) => p.type === 'text').map((p) => p.text);
            assert.deepStrictEqual(texts, READINGS);
            canvas.parts.forEach((p) => assert.strictEqual(p.font, FONTS[p.id], p.id));
            const rgba = fs.readFileSync(path.join(HUD, 'photos', mode + '.rgba'));
            assert.strictEqual(rgba.length, PHOTO_BYTES);
        };
    });
    tests['EVA no longer ships the Shadow photos or the Shadow menu row'] = () => {
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/eva_hud/app.json'), 'utf8'));
        spec.settings.forEach((s) => (s.options || []).forEach((o) => assert.notStrictEqual(o[0], 'shadow', s.key)));
        ['sport', 'comfort', 'eco'].forEach((mode) => {
            assert.ok(!fs.existsSync(path.join(ROOT, 'apps/eva_hud/hud/photos', mode + '.rgba')), mode);
            assert.ok(!fs.existsSync(path.join(ROOT, 'apps/eva_hud/hud/layouts/dash_shadow_' + mode + '.json')), mode);
        });
        assert.ok(fs.existsSync(path.join(ROOT, 'apps/eva_hud/hud/photos/cockpit.rgba')), 'the cockpit photo stays with EVA');
        const shadow = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/shadow_dash/app.json'), 'utf8'));
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
            assert.strictEqual(client.layers.size, 2);
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
            const out = execSync('MGU_HMI=ID8 python3 kit/tools/build.py shadow_dash', { cwd: ROOT, encoding: 'utf8' });
            assert.ok(/iDrive 7 only, not built/.test(out), out);
            const spec = JSON.parse(fs.readFileSync(path.join(STAGE, 'source/javascript/kit/app-spec.json'), 'utf8'));
            assert.deepStrictEqual(spec.hmi, ['ID7']);
            assert.strictEqual(spec.id, 'shadow_dash');
        },
    };
}

(async () => {
    const skip = execSync('MGU_HMI=ID8 python3 kit/tools/build.py shadow_dash', { cwd: ROOT, encoding: 'utf8' });
    if (!/iDrive 7 only, not built/.test(skip)) {
        console.log('FAIL  ID8 build was not skipped\n      ' + skip.split('\n')[0]);
        process.exit(1);
    }
    execSync('python3 kit/tools/build.py shadow_dash', { cwd: ROOT, stdio: 'ignore' });
    const tests = Object.assign(layoutTests(), runtimeTests());
    let failed = 0;
    for (const name of Object.keys(tests)) {
        try { await tests[name](); console.log('ok    ' + name); }
        catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e && e.stack || e).split('\n')[0]); }
    }
    console.log('\n' + (Object.keys(tests).length - failed) + ' of ' + Object.keys(tests).length + ' passed');
    process.exit(failed ? 1 : 0);
})();
