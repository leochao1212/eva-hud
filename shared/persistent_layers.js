'use strict';
/**
 * persistent_layers.js - layers kept across rebuilds: the black bottom strips over BMW's status row (eva_dash.js on the
 * strips' own connection, shadow_dash.js on its one). A rebuild that would drop and make them again lets BMW's row show
 * for a frame, so they are made once and kept while their key (rect, colour, class, z) stays the same.
 *
 * cluster-render refuses a layer after the client has its ref (the answer comes later, as 'refused' or a layer 'error'),
 * so a kept layer may be one the service never drew. failed(ref) forgets it and makes it again after a pause (2 s, then
 * longer), so a strip refused while memory or layers were short comes back once they are free.
 *
 *   const set = new PersistentLayers(log, 'bottom strip');
 *   set.begin();  ...set.keep(id, key, () => ({ ref, client }))...  set.end();     // in a rebuild: unseen ones go
 *   client.on('refused', (op, ref, reason) => set.failed(ref, reason));
 *
 * Plain Node 8 (the car's 8.16.2).
 */
const RETRY_MS = [2000, 5000, 15000, 30000, 60000];

class PersistentLayers {
    constructor(log, label) {
        this.log = log; this.label = label || 'layer';
        this.items = {};          // id -> { ref, client, key, make }
        this.seen = null;         // ids kept during a rebuild (begin .. end)
        this.timers = {};         // id -> the timer that makes a refused one again
        this.fails = {};          // id -> refusals in a row
        this.hidden = false;      // under a BMW pop-up
    }

    begin() { this.seen = {}; }
    /** After a rebuild: the ones it did not keep go (a centre design, off). */
    end() {
        const seen = this.seen || {};
        Object.keys(this.items).concat(Object.keys(this.timers)).forEach((id) => { if (!seen[id]) this.drop(id); });
        this.seen = null;
    }

    /** Keep id: made by make() -> { ref, client } (or null), unless it is there with the same key. */
    keep(id, key, make) {
        if (this.seen) this.seen[id] = true;
        const it = this.items[id];
        if (it && it.key === key) return;
        if (it) this.drop(id);
        clearTimeout(this.timers[id]); delete this.timers[id];
        const made = make();
        if (!made || !made.ref) return;
        this.items[id] = { ref: made.ref, client: made.client, key, make };
        if (this.hidden) made.client.set(made.ref, { visible: 0 });
    }

    drop(id) {
        clearTimeout(this.timers[id]); delete this.timers[id];
        delete this.fails[id];
        const it = this.items[id];
        if (!it) return;
        delete this.items[id];
        try { it.client.drop(it.ref); } catch (e) { /* the connection went */ }
    }
    dropAll() { Object.keys(this.items).concat(Object.keys(this.timers)).forEach((id) => this.drop(id)); }

    setVisible(on) {
        this.hidden = !on;
        Object.keys(this.items).forEach((id) => { const it = this.items[id]; it.client.set(it.ref, { visible: on ? 1 : 0 }); });
    }

    has(ref) { return Object.keys(this.items).some((id) => this.items[id].ref === ref); }
    refs() { return Object.keys(this.items).map((id) => this.items[id].ref); }

    /** The service drew ref: its refusals in a row start again from the short pause. */
    shown(ref) { Object.keys(this.items).forEach((id) => { if (this.items[id].ref === ref) delete this.fails[id]; }); }

    /** cluster-render refused ref (or its layer went to error): forget it, make it again later. True when it was ours. */
    failed(ref, reason) {
        const id = Object.keys(this.items).find((k) => this.items[k].ref === ref);
        if (!id) return false;
        const it = this.items[id];
        delete this.items[id];
        try { it.client.drop(it.ref); } catch (e) { /* the connection went */ }
        const n = this.fails[id] = (this.fails[id] || 0) + 1;
        const ms = RETRY_MS[Math.min(n - 1, RETRY_MS.length - 1)];
        this.log.warn(this.label + ' ' + id + ' refused (' + (reason || '?') + '): made again in ' + (ms / 1000) + ' s');
        clearTimeout(this.timers[id]);
        this.timers[id] = setTimeout(() => {
            delete this.timers[id];
            if (this.items[id]) return;
            const fails = this.fails[id];
            this.keep(id, it.key, it.make);
            this.fails[id] = fails;          // keep() clears nothing of it; the count goes on until shown()
        }, ms);
        return true;
    }
}

module.exports = PersistentLayers;
