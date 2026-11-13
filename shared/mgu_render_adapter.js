'use strict';
/**
 * mgu_render_adapter.js - the upstream cluster-render client API (image/pixels/set/drop + ready/
 * disconnected events) served over iDrive 8's mgu-render native client (mgu_render_client.js).
 *
 * Why: on iDrive 8 the renderer is mgu-render, whose own client takes part in the foreground gate
 * (show/state) and draws frame by frame; the upstream JSON client EVA ships does not, so mgu-render
 * drops its connection and nothing shows. This wraps the native client so EVA's image-layer dashes
 * (the Shadow dash: a photo + text canvases) draw unchanged. It is a drop-in for ClusterRender.
 *
 * Only image/asset layers are supported - what the Shadow dash uses. effect() (GLSL shaders, the
 * battle-display widgets) makes an empty layer and uniform() is a no-op, so those designs draw nothing
 * on iDrive 8; the plain dashes do.
 *
 * Model bridge: the upstream API keeps persistent layers the service composites; mgu-render wants a
 * frame of draw ops each TICK. So each layer is a native pixmap (kept and resent on reconnect by the
 * native client), and on every TICK we send one IMAGE op per visible layer, in z order.
 */
const EventEmitter = require('events');
const { RenderClient, imageOp } = require('./mgu_render_client');

const SET_KEYS = ['x', 'y', 'w', 'h', 'z', 'visible', 'opacity', 'rotate', 'sx', 'sy', 'px', 'py'];

/** mgu-render's IMAGE pixmaps are premultiplied RGBA (PROTOCOL.md); EVA draws straight alpha. */
function premultiply(src, dst) {
    for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        if (a === 255) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = 255; }
        else { dst[i] = (src[i] * a + 127) / 255; dst[i + 1] = (src[i + 1] * a + 127) / 255; dst[i + 2] = (src[i + 2] * a + 127) / 255; dst[i + 3] = a; }
    }
}

class ClusterRender extends EventEmitter {
    constructor(app, socketPath, log) {
        super();
        this.app = app;
        this.backend = 'mgu-render';
        this.targets = 'panel';
        this.ready = false;
        this.front = false;
        this.layers = new Map();     // ref -> { kind, x, y, w, h, iw, ih, z, visible, image, pmId, have }
        this.nextRef = 1;
        this.nextPm = 1;
        const shim = { warn: (m) => { try { (log || console).warn && (log || console).warn('mgu-render: ' + m); } catch (e) {} },
                       info: () => {} };
        this.gpu = new RenderClient(app, log && log.warn ? log : shim, {});
        this.gpu.on('ready', (screen, info) => this._onReady(screen, info));
        this.gpu.on('tick', () => this._frame());
        this.gpu.on('state', (s) => { this.front = s.front; this.onScreen = s.onScreen; });
        this.gpu.on('close', () => { if (this.ready) { this.ready = false; this.emit('disconnected'); } });
    }

    connect() { this.gpu.connect(); }
    close() { this.ready = false; this.gpu.close(); }

    _onReady(screen, info) {
        this.screen = screen;
        this.info = info;
        this.gpu.mode('layer');
        const a = (info && info.appArea && info.appArea.w) ? info.appArea : { x: 0, y: 0, w: screen.w, h: screen.h };
        // EVA draws in a 1920x720 logical space; fit it into the app area, aspect kept, centred.
        const scale = Math.min(a.w / 1920, a.h / 720);
        this.gpu.place({ x: a.x, y: a.y, w: a.w, h: a.h, scale: scale, ox: Math.round((a.w - 1920 * scale) / 2), oy: 0 });
        this.gpu.show(true);
        // (re)make the pixmaps; the native client resends their pixels on (re)connect itself
        this.layers.forEach((l) => { if (l.image) this.gpu.pixmap(l.pmId, l.iw, l.ih, 'rgba', 'linear'); });
        this.layers.forEach((l) => { if (l.pm && l.have) this.gpu.pixels(l.pmId, [{ x: 0, y: 0, w: l.iw, h: l.ih }], l.pm); });
        this.ready = true;
        this.emit('ready');
    }

    _add(kind, opts) {
        const o = opts || {};
        const iw = o.iw || o.w, ih = o.ih || o.h;
        if (!(iw > 0 && ih > 0)) return 0;
        const ref = this.nextRef++;
        const l = { kind, x: o.x || 0, y: o.y || 0, w: o.w, h: o.h, iw, ih, z: o.z || 0,
            visible: o.visible !== false, image: null, pmId: this.nextPm++, have: false };
        if (kind === 'image' || kind === 'asset') { l.image = Buffer.alloc(iw * ih * 4); l.pm = Buffer.alloc(iw * ih * 4); }
        this.layers.set(ref, l);
        if (this.ready && l.image) this.gpu.pixmap(l.pmId, iw, ih, 'rgba', 'linear');
        return ref;
    }
    video() { return 0; }
    image(opts) { return this._add('image', opts); }
    effect(opts) { return this._add('effect', opts); }   // no shaders here: this layer draws nothing
    mesh() { return 0; }
    asset(opts) { return this._add('asset', opts); }
    uniform() {}        // effect/mesh only on iDrive 7; no-op here

    set(ref, opts) {
        const l = this.layers.get(ref);
        if (!l) return;
        SET_KEYS.forEach((k) => { if (opts[k] !== undefined) l[k] = opts[k]; });
    }

    pixels(ref, rects, px) {
        const l = this.layers.get(ref);
        if (!l || !l.image) return false;
        const iw = l.iw, bpp = 4;
        if (!rects || !rects.length) {
            if (px.length !== l.image.length) return false;
            px.copy(l.image);
        } else {
            let off = 0;
            for (const r of rects) {
                if (!(r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= iw && r.y + r.h <= l.ih)) return false;
                for (let y = 0; y < r.h; y++) {
                    px.copy(l.image, ((r.y + y) * iw + r.x) * bpp, off, off + r.w * bpp);
                    off += r.w * bpp;
                }
            }
        }
        l.have = true;
        premultiply(l.image, l.pm);
        if (this.ready) this.gpu.pixels(l.pmId, (rects && rects.length) ? rects : [{ x: 0, y: 0, w: l.iw, h: l.ih }], l.pm);
        return true;
    }

    drop(ref) {
        const l = this.layers.get(ref);
        if (!l) return;
        this.layers.delete(ref);
    }

    _frame() {
        if (!this.ready) return;
        const vis = [];
        this.layers.forEach((l) => { if (l.visible && l.have && l.image) vis.push(l); });
        vis.sort((a, b) => (a.z || 0) - (b.z || 0));
        let n = 0;
        const ops = vis.map((l) => { const o = imageOp(l.pmId, l.x, l.y, l.w, l.h, 0); n += o.length; return o; });
        const u = new Uint32Array(n);
        let at = 0;
        ops.forEach((o) => { u.set(o, at); at += o.length; });
        this.gpu.frameWords(u);
    }

    // upstream API no-ops / stubs the dashes do not need on iDrive 8
    frame() { return false; }
    frameBytes() { return 0; }
    status() {}
}

module.exports = { ClusterRender, DEFAULT_PATH: '/run/mgu-render/render.sock' };
