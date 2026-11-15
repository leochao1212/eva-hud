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
    constructor(app, socketPath, log, size, fullScreen) {
        super();
        this.app = app;
        this.log = log;
        this.backend = 'mgu-render';
        this.targets = 'panel';
        // the logical space the layout is drawn in (hud.js TARGET_SIZES): panel 1920x720, centre 1280x480.
        this.designW = (size && size[0]) || 1920;
        this.designH = (size && size[1]) || 720;
        // fullScreen: place over the whole screen (centre cockpit), not just the HMI's app area, so the
        // RHMI menu/scrollbar frame is covered. pl holds the place transform for touch<->design mapping.
        this.fullScreen = !!fullScreen;
        this.pl = null;
        this.showTimer = null;       // a re-show after the renderer closed us (the foreground gate)
        this.shownAt = 0; this.showRetry = 0;
        this.errReason = null;       // the last mgu-render error, for the status line
        this.claimDesign = [];       // touch areas in design px; mapped to screen px on claim/reconnect
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
        this.gpu.on('touch', (phase, x, y) => this._onTouch(phase, x, y));   // re-emitted in design px
        // the renderer took us off the screen: claim it back instead of going black for good
        this.gpu.on('closed', () => this._onClosed());
        // mgu-render's only complaint channel; without this the screen just stays empty with no clue why
        this.gpu.on('renderer-error', (m) => this._onRendererError(m));
    }

    /** The renderer closed us (the foreground gate). Show again, but stop if it keeps doing it. */
    _onClosed() {
        this.logInfo('closed by the renderer, showing again');
        const now = Date.now();
        this.showRetry = (now - this.shownAt < 1000) ? this.showRetry + 1 : 0;
        this.shownAt = now;
        if (this.showRetry > 5) {
            try { this.log && this.log.warn && this.log.warn('mgu-render: the renderer keeps closing us (5x); not showing again'); } catch (e) {}
            return;
        }
        clearTimeout(this.showTimer);
        this.showTimer = setTimeout(() => {
            this.showTimer = null;
            if (!this.ready) return;
            try { this.gpu.show(true); this.logInfo('show again'); } catch (e) {}
        }, 500);
        if (this.showTimer.unref) this.showTimer.unref();
    }

    /** A refusal from mgu-render: the native client already logs it; surface it so the status line names the reason. */
    _onRendererError(m) {
        this.errReason = String(m);
        this.emit('refused', 'mgu-render', 0, this.errReason);
    }

    logInfo(m) {
        try { this.log && this.log.info && this.log.info('mgu-render: ' + m); } catch (e) {}
    }

    /** Touch areas, in DESIGN px: mapped to screen px and claimed, re-mapped on every (re)connect. */
    claim(rects) {
        this.claimDesign = (rects || []).slice(0, 16);
        if (this.ready) this.gpu.claim(this._mapClaims());
    }
    _mapClaims() {
        const pl = this.pl || { x: 0, y: 0, ox: 0, oy: 0, scale: 1 };
        return this.claimDesign.map((r) => ({ x: pl.x + pl.ox + r.x * pl.scale, y: pl.y + pl.oy + r.y * pl.scale, w: r.w * pl.scale, h: r.h * pl.scale }));
    }
    /** mgu-render sends touch in screen px; map back to the design space the view hit-tests in. */
    _onTouch(phase, x, y) {
        const pl = this.pl;
        if (!pl) return;
        this.emit('touch', phase, (x - pl.x - pl.ox) / pl.scale, (y - pl.y - pl.oy) / pl.scale);
    }

    connect() { this.gpu.connect(); }
    close() { this.ready = false; this.gpu.close(); }

    _onReady(screen, info) {
        this.screen = screen;
        this.info = info;
        this.gpu.mode('layer');
        // fullScreen covers the whole screen (over the RHMI frame); otherwise fit into the HMI's app area.
        const full = this.fullScreen ? { x: 0, y: 0, w: screen.w, h: screen.h } : null;
        const a = full || ((info && info.appArea && info.appArea.w) ? info.appArea : { x: 0, y: 0, w: screen.w, h: screen.h });
        // EVA draws in a designW x designH logical space; fit it into that area, aspect kept, centred.
        const dw = this.designW, dh = this.designH;
        const scale = Math.min(a.w / dw, a.h / dh);
        const ox = Math.round((a.w - dw * scale) / 2), oy = Math.round((a.h - dh * scale) / 2);
        this.pl = { x: a.x, y: a.y, scale: scale, ox: ox, oy: oy };
        this.gpu.place({ x: a.x, y: a.y, w: a.w, h: a.h, scale: scale, ox: ox, oy: oy });
        if (this.claimDesign.length) this.gpu.claim(this._mapClaims());   // touch areas survive a reconnect
        try { if (this.log && this.log.info) this.log.info('mgu-render place: screen ' + screen.w + 'x' + screen.h + (full ? ' FULLSCREEN' : ' appArea ' + a.w + 'x' + a.h) + ' design ' + dw + 'x' + dh + ' scale ' + scale.toFixed(3) + ' touch=' + !!(info && info.touch)); } catch (e) {}
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
