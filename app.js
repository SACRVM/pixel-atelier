/**
 * <app-pixel-atelier> — a pixel and sprite editor as a SACRVM APPKIT app
 * (manifest kind: "view").
 *
 * The successor of BunnyBot's Atelier, rebuilt on the kit's pixel workbench.
 * Every piece of chrome is a kit component; everything about PIXELS lives in
 * a headless document (PixelDoc) with no DOM in it:
 *
 *   kit (view)                      app (document + tools)
 *   ─────────────────────────────   ─────────────────────────────────────
 *   <sac-pixel-canvas>  shows       PixelDoc  frames × layers of RGBA
 *     pixels, reports cells           buffers, composite(), undo snapshots
 *   <sac-toolbox>       tool pick    raster    pencil/eraser/line/rect/
 *   <sac-layer-list>    layers                  ellipse (outline + filled)/fill
 *   <sac-filmstrip>     frames      selection a floating marquee: lift, move,
 *   colour suite        colours                 nudge, flip, trim, clipboard
 *   context.files       open/save   file      PNG strip + a tEXt chunk that
 *   context.fs          autosave                carries layers, fps, palette
 *
 * The file is a plain PNG — one frame per cell of a horizontal strip, so any
 * tool or game reads it — with the editor's own state (layers, fps, palette)
 * riding along in a private `tEXt` chunk. Opened by anything else it is just
 * a picture; opened here it is the document again.
 */
(function () {
    const BASE = sac.app.base();
    const CSS_ID = "app-pixel-atelier-css";

    const UNDO_LIMIT = 60;
    const MAX_SIDE = 512;              // one frame, either edge
    const MAX_FRAMES = 256;
    const CHUNK_KEY = "pixel-atelier"; // the PNG tEXt keyword
    const CLIP_MARK = "pixel-atelier/clip";
    const AUTOSAVE_MS = 1500;

    // DawnBringer 32 — a user's colours, DATA, not theme. A new document
    // starts from it; a saved one carries its own.
    const DEFAULT_PALETTE = [
        "#000000", "#222034", "#45283c", "#663931", "#8f563b", "#df7126", "#d9a066", "#eec39a",
        "#fbf236", "#99e550", "#6abe30", "#37946e", "#4b692f", "#524b24", "#323c39", "#3f3f74",
        "#306082", "#5b6ee1", "#639bff", "#5fcde4", "#cbdbfc", "#ffffff", "#9badb7", "#847e87",
        "#696a6a", "#595652", "#76428a", "#ac3232", "#d95763", "#d77bba", "#8f974a", "#8a6f30",
    ];

    const TOOLS = [
        { id: "pencil",      icon: "pencil",      label: "Pencil",           key: "b" },
        { id: "eraser",      icon: "eraser",      label: "Eraser",           key: "e" },
        { id: "fill",        icon: "bucket",      label: "Fill",             key: "g" },
        { id: "pick",        icon: "eyedropper",  label: "Eyedropper",       key: "i" },
        null,
        { id: "line",        icon: "line",        label: "Line",             key: "l" },
        { id: "rect",        icon: "square",      label: "Rectangle",        key: "r" },
        { id: "rectfill",    icon: "square-fill", label: "Filled rectangle", key: "shift+r" },
        { id: "ellipse",     icon: "circle",      label: "Ellipse",          key: "c" },
        { id: "ellipsefill", icon: "circle-fill", label: "Filled ellipse",   key: "shift+c" },
        null,
        { id: "select",      icon: "marquee",     label: "Select · move",    key: "m" },
    ];
    const SHAPES = new Set(["line", "rect", "rectfill", "ellipse", "ellipsefill"]);
    const BRUSHED = new Set(["pencil", "eraser", "line", "rect", "ellipse"]);

    const hexToRgba = (h) => {
        if (!h || h === "transparent") return [0, 0, 0, 0];
        const n = parseInt(h.slice(1, 7), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length >= 9 ? parseInt(h.slice(7, 9), 16) : 255];
    };
    const rgbaToHex = (c) => c[3] === 0 ? "transparent"
        : "#" + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const isEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

    /* ================================================================
       PixelDoc — the headless document. No DOM.
       ================================================================ */
    class PixelDoc {
        constructor(w, h) {
            this.w = w; this.h = h;
            this.layers = [];          // TOP first: [{ id, name, visible, locked }]
            this.frames = [];          // [{ [layerId]: Uint8ClampedArray(w*h*4) }]
            this.fps = 8;
            this.palette = DEFAULT_PALETTE.slice();
            this._next = 1;
        }
        blank() { return new Uint8ClampedArray(this.w * this.h * 4); }
        addLayer(name, index = 0) {
            const id = "l" + this._next++;
            this.layers.splice(index, 0, { id, name: name || "Layer " + id.slice(1), visible: true, locked: false });
            for (const f of this.frames) f[id] = this.blank();
            return id;
        }
        removeLayer(id) {
            if (this.layers.length < 2) return false;
            this.layers = this.layers.filter((l) => l.id !== id);
            for (const f of this.frames) delete f[id];
            return true;
        }
        duplicateLayer(id) {
            const i = this.layers.findIndex((l) => l.id === id);
            const nid = this.addLayer(this.layers[i].name + " copy", i);
            for (const f of this.frames) f[nid] = f[id].slice();
            return nid;
        }
        addFrame(at, copyOf) {
            const f = {};
            for (const l of this.layers) f[l.id] = copyOf == null ? this.blank() : this.frames[copyOf][l.id].slice();
            this.frames.splice(at, 0, f);
        }
        move(list, from, to) { const [x] = list.splice(from, 1); list.splice(to, 0, x); }

        inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
        get(buf, x, y) { const i = (y * this.w + x) * 4; return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; }
        set(buf, x, y, c) {
            if (!this.inside(x, y)) return;
            const i = (y * this.w + x) * 4;
            buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
        }
        /** Visible layers (or just `only`), bottom to top, "source-over" in integer RGBA. */
        composite(fi, only, bufOf) {
            const out = new ImageData(this.w, this.h), d = out.data, f = this.frames[fi];
            for (let k = this.layers.length - 1; k >= 0; k--) {
                const l = this.layers[k];
                if (only ? l.id !== only : !l.visible) continue;
                const s = bufOf ? bufOf(fi, l.id) : f[l.id];
                for (let i = 0; i < d.length; i += 4) {
                    const a = s[i + 3];
                    if (!a) continue;
                    if (a === 255 || !d[i + 3]) { d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = a; continue; }
                    const t = a / 255, da = d[i + 3] / 255, oa = t + da * (1 - t);
                    for (let c = 0; c < 3; c++) d[i + c] = (s[i + c] * t + d[i + c] * da * (1 - t)) / oa;
                    d[i + 3] = oa * 255;
                }
            }
            return out;
        }
        /** Distinct opaque colours of every frame and layer, most-used first. */
        usedColors() {
            const count = new Map();
            for (const f of this.frames) for (const l of this.layers) {
                const b = f[l.id];
                for (let i = 0; i < b.length; i += 4) {
                    if (!b[i + 3]) continue;
                    const hex = rgbaToHex([b[i], b[i + 1], b[i + 2], 255]);
                    count.set(hex, (count.get(hex) || 0) + 1);
                }
            }
            return [...count.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
        }
        snapshot() {
            return {
                w: this.w, h: this.h,
                layers: this.layers.map((l) => ({ ...l })),
                frames: this.frames.map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.slice()]))),
            };
        }
        restore(s) { this.w = s.w; this.h = s.h; this.layers = s.layers.map((l) => ({ ...l })); this.frames = s.frames; }
    }

    /* Raster helpers — pure functions over one buffer, clipped to the doc. */
    const raster = {
        stamp(doc, buf, x, y, size, c) {
            const o = Math.floor((size - 1) / 2);
            for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) doc.set(buf, x - o + i, y - o + j, c);
        },
        line(doc, buf, a, b, size, c) {
            let x0 = a.x, y0 = a.y;
            const dx = Math.abs(b.x - x0), dy = -Math.abs(b.y - y0), sx = x0 < b.x ? 1 : -1, sy = y0 < b.y ? 1 : -1;
            let err = dx + dy;
            for (;;) {
                raster.stamp(doc, buf, x0, y0, size, c);
                if (x0 === b.x && y0 === b.y) break;
                const e2 = 2 * err;
                if (e2 >= dy) { err += dy; x0 += sx; }
                if (e2 <= dx) { err += dx; y0 += sy; }
            }
        },
        rect(doc, buf, a, b, size, c) {
            const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
            for (let x = x0; x <= x1; x++) { raster.stamp(doc, buf, x, y0, size, c); raster.stamp(doc, buf, x, y1, size, c); }
            for (let y = y0; y <= y1; y++) { raster.stamp(doc, buf, x0, y, size, c); raster.stamp(doc, buf, x1, y, size, c); }
        },
        rectfill(doc, buf, a, b, size, c) {
            const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) doc.set(buf, x, y, c);
        },
        // Gap-free outline: scan columns AND rows for the boundary.
        ellipse(doc, buf, a, b, size, c) {
            const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
            const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
            if (rx < 0.5 || ry < 0.5) return raster.line(doc, buf, a, b, size, c);
            for (let x = x0; x <= x1; x++) {
                const d = (x - cx) / rx, e = ry * Math.sqrt(Math.max(0, 1 - d * d));
                raster.stamp(doc, buf, x, Math.round(cy - e), size, c); raster.stamp(doc, buf, x, Math.round(cy + e), size, c);
            }
            for (let y = y0; y <= y1; y++) {
                const d = (y - cy) / ry, e = rx * Math.sqrt(Math.max(0, 1 - d * d));
                raster.stamp(doc, buf, Math.round(cx - e), y, size, c); raster.stamp(doc, buf, Math.round(cx + e), y, size, c);
            }
        },
        // Filled: each row between its two x-solutions.
        ellipsefill(doc, buf, a, b, size, c) {
            const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
            const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
            if (rx < 0.5 || ry < 0.5) return raster.rectfill(doc, buf, a, b, size, c);
            for (let y = y0; y <= y1; y++) {
                const d = (y - cy) / ry;
                if (Math.abs(d) > 1) continue;
                const e = rx * Math.sqrt(1 - d * d);
                for (let x = Math.round(cx - e); x <= Math.round(cx + e); x++) doc.set(buf, x, y, c);
            }
        },
        fill(doc, buf, x, y, c) {
            const t = doc.get(buf, x, y);
            if (t.every((v, k) => v === c[k])) return;
            const stack = [[x, y]];
            while (stack.length) {
                const [px, py] = stack.pop();
                if (!doc.inside(px, py)) continue;
                const i = (py * doc.w + px) * 4;
                if (buf[i] !== t[0] || buf[i + 1] !== t[1] || buf[i + 2] !== t[2] || buf[i + 3] !== t[3]) continue;
                doc.set(buf, px, py, c);
                stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
            }
        },
        /** A w×h block out of a buffer (or the other way round with `into`). */
        copy(doc, buf, r) {
            const out = new Uint8ClampedArray(r.w * r.h * 4);
            for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
                const x = r.x + i, y = r.y + j;
                if (!doc.inside(x, y)) continue;
                const si = (y * doc.w + x) * 4, di = (j * r.w + i) * 4;
                out[di] = buf[si]; out[di + 1] = buf[si + 1]; out[di + 2] = buf[si + 2]; out[di + 3] = buf[si + 3];
            }
            return out;
        },
        clear(doc, buf, r) {
            for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) doc.set(buf, x, y, [0, 0, 0, 0]);
        },
        /** Bake a block's opaque pixels into a buffer, clipped to the doc. */
        paste(doc, buf, block) {
            const { data, w, h, x, y } = block;
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const di = (j * w + i) * 4;
                if (!data[di + 3]) continue;
                doc.set(buf, x + i, y + j, [data[di], data[di + 1], data[di + 2], data[di + 3]]);
            }
        },
        flip(data, w, h, dir) {
            const src = data.slice();
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const si = dir === "h" ? (j * w + (w - 1 - i)) * 4 : ((h - 1 - j) * w + i) * 4, di = (j * w + i) * 4;
                data[di] = src[si]; data[di + 1] = src[si + 1]; data[di + 2] = src[si + 2]; data[di + 3] = src[si + 3];
            }
        },
    };

    /* ================================================================
       The file: a PNG strip, plus the editor's state in a tEXt chunk.
       ================================================================ */
    const png = (function () {
        const CRC = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC[n] = c >>> 0;
        }
        const crc32 = (bytes) => {
            let c = 0xffffffff;
            for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
            return (c ^ 0xffffffff) >>> 0;
        };
        const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 255);
        const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

        /** Walk the chunks: [{ type, start, end, data }]. */
        function chunks(bytes) {
            if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const out = [];
            for (let p = 8; p + 12 <= bytes.length;) {
                const len = view.getUint32(p);
                const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
                const end = p + 12 + len;
                if (end > bytes.length) break;
                out.push({ type, start: p, end, data: bytes.subarray(p + 8, p + 8 + len) });
                p = end;
            }
            return out;
        }

        return {
            /** The text of our tEXt chunk, or null. */
            readText(bytes) {
                for (const c of chunks(bytes) || []) {
                    if (c.type !== "tEXt") continue;
                    const zero = c.data.indexOf(0);
                    if (zero < 0) continue;
                    const key = String.fromCharCode(...c.data.subarray(0, zero));
                    if (key === CHUNK_KEY) return new TextDecoder("latin1").decode(c.data.subarray(zero + 1));
                }
                return null;
            },
            /** The same PNG with our tEXt chunk inserted before IEND. `text` must be ASCII. */
            withText(bytes, text) {
                const list = chunks(bytes);
                const iend = list && list.find((c) => c.type === "IEND");
                if (!iend) return bytes;
                const body = ascii(CHUNK_KEY + "\0" + text);
                const chunk = new Uint8Array(12 + body.length);
                const view = new DataView(chunk.buffer);
                view.setUint32(0, body.length);
                chunk.set(ascii("tEXt"), 4);
                chunk.set(body, 8);
                view.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)));
                const out = new Uint8Array(bytes.length + chunk.length);
                out.set(bytes.subarray(0, iend.start), 0);
                out.set(chunk, iend.start);
                out.set(bytes.subarray(iend.start), iend.start + chunk.length);
                return out;
            },
        };
    })();

    const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const blobToBase64 = async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
    };
    const base64ToBlob = (b64) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" });
    // JSON with every non-ASCII char escaped, so it is safe in a Latin-1 tEXt chunk.
    const asciiJson = (v) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

    /** Pixels of an image source as one RGBA buffer. */
    function pixelsOf(bmp) {
        const c = canvasOf(bmp.width, bmp.height);
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        return g;
    }

    /** Split a strip (a 2D context) into `n` frames of one layer. */
    function framesFromStrip(g, n, fw, fh) {
        const out = [];
        for (let f = 0; f < n; f++) out.push(new Uint8ClampedArray(g.getImageData(f * fw, 0, fw, fh).data));
        return out;
    }

    /** Encode a document as a PNG strip carrying its state. */
    async function encodeDoc(doc, bufOf) {
        const n = doc.frames.length, strip = canvasOf(doc.w * n, doc.h), g = strip.getContext("2d");
        for (let f = 0; f < n; f++) g.putImageData(doc.composite(f, null, bufOf), f * doc.w, 0);
        const meta = {
            v: 1, w: doc.w, h: doc.h, frames: n, fps: doc.fps, palette: doc.palette,
            layers: doc.layers.map((l) => ({ name: l.name, visible: l.visible, locked: l.locked })),
        };
        // One visible layer IS the picture — no need to store it twice.
        if (doc.layers.length > 1 || !doc.layers[0].visible) {
            meta.data = [];
            for (const l of doc.layers) {
                const c = canvasOf(doc.w * n, doc.h), lg = c.getContext("2d");
                for (let f = 0; f < n; f++) lg.putImageData(new ImageData(bufOf(f, l.id).slice(), doc.w, doc.h), f * doc.w, 0);
                meta.data.push(await blobToBase64(await toBlob(c)));
            }
        }
        const bytes = new Uint8Array(await (await toBlob(strip)).arrayBuffer());
        return new Blob([png.withText(bytes, asciiJson(meta))], { type: "image/png" });
    }

    /**
     * Read a file. → { doc } when it carries our state (or is one frame
     * anyway), else { strip } — a 2D context the caller splits into frames
     * once the user said how many.
     */
    async function decodeFile(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const bmp = await createImageBitmap(file);
        const g = pixelsOf(bmp);
        let meta = null;
        try { const t = png.readText(bytes); meta = t && JSON.parse(t); } catch { meta = null; }
        if (meta && meta.v === 1 && meta.w * meta.frames === bmp.width && meta.h === bmp.height
            && meta.w <= MAX_SIDE && meta.h <= MAX_SIDE) {
            const doc = new PixelDoc(meta.w, meta.h);
            if (Number.isFinite(meta.fps)) doc.fps = clamp(Math.round(meta.fps), 1, 30);
            if (Array.isArray(meta.palette)) doc.palette = meta.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c));
            const layers = Array.isArray(meta.layers) && meta.layers.length ? meta.layers : [{ name: "Layer 1" }];
            const data = Array.isArray(meta.data) && meta.data.length === layers.length ? meta.data : null;
            for (let f = 0; f < meta.frames; f++) doc.frames.push({});
            // addLayer() inserts at the top, so walk bottom → top.
            for (let k = layers.length - 1; k >= 0; k--) {
                const l = layers[k];
                const id = doc.addLayer(String(l.name || "Layer"), 0);
                Object.assign(doc.layers[0], { visible: l.visible !== false, locked: !!l.locked });
                const src = data ? pixelsOf(await createImageBitmap(base64ToBlob(data[k]))) : g;
                framesFromStrip(src, meta.frames, meta.w, meta.h).forEach((buf, f) => { doc.frames[f][id] = buf; });
                if (!data) break;   // no layer data: the picture is the one layer
            }
            return { doc };
        }
        return { strip: g, width: bmp.width, height: bmp.height };
    }

    function docFromStrip(g, width, height, n) {
        const fw = width / n, doc = new PixelDoc(fw, height);
        for (let f = 0; f < n; f++) doc.frames.push({});
        const id = doc.addLayer("Layer 1");
        framesFromStrip(g, n, fw, height).forEach((buf, f) => { doc.frames[f][id] = buf; });
        return doc;
    }

    function blankDoc(w, h, frames) {
        const doc = new PixelDoc(w, h);
        doc.addLayer("Layer 1");
        for (let f = 0; f < frames; f++) doc.addFrame(f);
        return doc;
    }

    /** A dialog built from markup; resolves with { action, dlg } and removes itself. */
    function dialog(title, html, buttons, setup) {
        const dlg = document.createElement("sac-dialog");
        dlg.setAttribute("title", title);
        dlg.buttons = buttons;
        dlg.innerHTML = html;
        document.body.appendChild(dlg);
        if (setup) setup(dlg);
        return new Promise((resolve) => {
            dlg.addEventListener("sac:action", (e) => {
                if (e.target !== dlg) return;
                resolve({ action: e.detail.action, dlg });
                setTimeout(() => dlg.remove(), 150);
            });
            setTimeout(() => dlg.open(), 0);
        });
    }

    /* ================================================================
       The app element — wiring only.
       ================================================================ */
    class AppPixelAtelier extends sac.app.Element {
        build() {
            sac.app.styles(BASE + "app.css", CSS_ID);
            this.innerHTML = `
<sac-nav brand="PIXEL ATELIER" brand-icon="palette" brand-href="#/" host-nav="wide">
    <div slot="context"><span class="pa-docname"></span><sac-theme-toggle></sac-theme-toggle></div>
    <div slot="toolbar" class="toolbar">
        <button type="button" class="nav-icon-btn pa-new" title="New…"><sac-icon name="plus"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-open" title="Open… (Ctrl+O)"><sac-icon name="folder"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-save" title="Save (Ctrl+S)"><sac-icon name="save"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-undo" title="Undo (Ctrl+Z)"><sac-icon name="undo"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-redo" title="Redo (Ctrl+Y)"><sac-icon name="redo"></sac-icon></button>
        <sac-menu class="pa-menu">
            <button slot="trigger" type="button" class="nav-icon-btn" title="Edit"><sac-icon name="more"></sac-icon></button>
            <button data-action="copy"><sac-icon name="copy"></sac-icon> Copy</button>
            <button data-action="cut"><sac-icon name="scissors"></sac-icon> Cut</button>
            <button data-action="paste"><sac-icon name="attachment"></sac-icon> Paste</button>
            <hr>
            <button data-action="flip-h"><sac-icon name="flip-h"></sac-icon> Flip horizontal</button>
            <button data-action="flip-v"><sac-icon name="flip-v"></sac-icon> Flip vertical</button>
            <button data-action="trim"><sac-icon name="marquee"></sac-icon> Trim selection</button>
            <button data-action="select-all"><sac-icon name="fit"></sac-icon> Select whole frame</button>
            <hr>
            <button data-action="save-as"><sac-icon name="save"></sac-icon> Save as…</button>
            <button data-action="export"><sac-icon name="download"></sac-icon> Export PNG…</button>
            <button data-action="revert" data-danger><sac-icon name="undo"></sac-icon> Revert to saved</button>
        </sac-menu>
        <button type="button" class="nav-icon-btn pa-zout" title="Zoom out (−)"><sac-icon name="zoom-out"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-fit" title="Fit"><sac-icon name="fit"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-zin" title="Zoom in (+)"><sac-icon name="zoom-in"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-keys" title="Keyboard shortcuts (?)"><sac-icon name="keyboard"></sac-icon></button>
    </div>
</sac-nav>

<div class="main-layout pa-root">
    <sac-split class="pa-split" position="22%" min-start="232px" min-end="320px"
               aria-label="Resize the side panel">
        <div class="sidebar fill pa-panel" slot="start">
            <sac-section title="Tools">
                <div class="pa-stack">
                    <sac-toolbox class="pa-tools" columns="auto" value="pencil"></sac-toolbox>
                    <div class="pa-row"><label>Brush</label>
                        <sac-stepper class="pa-brush" value="1" min="1" max="4" unit="px" label="Brush size"></sac-stepper></div>
                </div>
            </sac-section>
            <sac-section title="Color">
                <div class="pa-stack">
                    <sac-color-field class="pa-color" label="Current color" value="#000000"></sac-color-field>
                    <sac-segmented-control class="pa-palmode" value="palette">
                        <button data-value="palette">Palette</button>
                        <button data-value="used">Used</button>
                    </sac-segmented-control>
                    <sac-swatch-grid class="pa-palette" columns="8" selectable></sac-swatch-grid>
                    <div class="pa-buttons">
                        <button type="button" class="btn pa-pal-add" title="Add the current color to the palette">Add color</button>
                        <button type="button" class="btn pa-pal-remove" title="Remove the current color from the palette">Remove</button>
                    </div>
                </div>
            </sac-section>
            <sac-section title="Layers">
                <sac-layer-list class="pa-layers" actions pixelated></sac-layer-list>
            </sac-section>
            <sac-section title="Preview">
                <div class="pa-stack">
                    <div class="pa-preview"><sac-pixel-canvas class="pa-pv" static zoom="3"></sac-pixel-canvas></div>
                    <div class="pa-row"><label>Zoom</label>
                        <sac-stepper class="pa-pvzoom" value="3" min="1" max="8" unit="×" label="Preview zoom"></sac-stepper></div>
                    <div class="pa-row"><label>Speed</label>
                        <sac-stepper class="pa-fps" value="8" min="1" max="30" unit="fps" label="Playback speed"></sac-stepper></div>
                    <div class="pa-row"><label>Animate</label>
                        <button type="button" class="icon-btn pa-pvplay active" title="Animate the preview"><sac-icon name="pause"></sac-icon></button></div>
                </div>
            </sac-section>
        </div>

        <div class="pa-work" slot="end">
            <div class="viewport pa-viewport">
                <sac-pixel-canvas class="pa-canvas"></sac-pixel-canvas>
                <sac-hud class="pa-hud" position="top-right"></sac-hud>
            </div>
            <sac-filmstrip class="pa-film" actions reorderable pixelated value="0">
                <div slot="controls" class="pa-film-ctrl">
                    <button type="button" class="icon-btn pa-play" title="Play (P)"><sac-icon name="play"></sac-icon></button>
                    <button type="button" class="icon-btn pa-onion active" title="Onion skin (O)"><sac-icon name="onion"></sac-icon></button>
                </div>
            </sac-filmstrip>
        </div>
    </sac-split>
</div>`;
        }

        /* ------------------------------------------------- app contract --- */

        onMount(context) {
            this._ctx = context;
            const $ = (s) => this.querySelector(s);
            const nav = $("sac-nav");
            if (nav) nav.host = context.host;
            this.$canvas = $(".pa-canvas");
            this.$pv = $(".pa-pv");
            this.$tools = $(".pa-tools");
            this.$layers = $(".pa-layers");
            this.$film = $(".pa-film");
            this.$hud = $(".pa-hud");
            this.$color = $(".pa-color");
            this.$palette = $(".pa-palette");
            this.$name = $(".pa-docname");

            this.tool = "pencil";
            this.brush = 1;
            this.color = [0, 0, 0, 255];
            this.onion = true;
            this.palMode = "palette";
            this.pvZoom = 3;
            this.pvPlaying = true;
            this.clip = null;
            this._visible = false;
            this._offs = [];

            this.$tools.tools = TOOLS;
            this._syncBrushBox();
            this._wire();
            this._load(blankDoc(32, 32, 1), { name: "sprite.png", handle: null }, null);
            this._restore();   // async: the last session, if there is one

            this._io = new IntersectionObserver((es) => this._setVisible(es[es.length - 1].isIntersecting));
            this._io.observe(this);
        }

        onUnmount() {
            this._setVisible(false);
            this._io?.disconnect();
            this._pvStop();
            clearTimeout(this._autosaveT);
        }

        /**
         * On stage / off stage. Hotkeys are global, so they exist only while
         * the app is looked at — including the toolbox's (its `hotkeys`
         * attribute registers / unregisters them).
         */
        _setVisible(v) {
            if (v === this._visible) return;
            this._visible = v;
            if (v) {
                this.$tools.setAttribute("hotkeys", "");
                this._bindKeys();
                if (this.pvPlaying) this._pvStart();
            } else {
                this.$tools.removeAttribute("hotkeys");
                this._offs.forEach((off) => off());
                this._offs = [];
                this._stopPlay();
                this._pvStop();
            }
        }

        _bindKeys() {
            const k = (combo, fn, description, group) =>
                this._offs.push(sac.hotkeys.register(combo, fn, { description, group }));
            k("mod+z", () => this._undo(), "Undo", "Edit");
            k("mod+shift+z", () => this._redo(), "Redo", "Edit");
            k("mod+y", () => this._redo(), "Redo", "Edit");
            k("mod+a", () => this._selectAll(), "Select the whole frame", "Selection");
            k("delete", () => this._deleteSel(), "Clear the selection", "Selection");
            k("backspace", () => this._deleteSel(), "", "Selection");
            k("escape", () => this._deselect(), "Drop the selection (places a floating one)", "Selection");
            k("shift+h", () => this._flip("h"), "Flip horizontal (selection or frame)", "Selection");
            k("shift+v", () => this._flip("v"), "Flip vertical (selection or frame)", "Selection");
            k("up", () => this._nudge(0, -1), "Nudge the selection", "Selection");
            k("down", () => this._nudge(0, 1), "", "Selection");
            k("left", () => this.sel ? this._nudge(-1, 0) : this._setFrame(this.frame - 1), "Previous frame / nudge", "Frames");
            k("right", () => this.sel ? this._nudge(1, 0) : this._setFrame(this.frame + 1), "Next frame / nudge", "Frames");
            for (let n = 1; n <= 10; n++) {
                k(String(n % 10), () => this._setFrame(n - 1, true), n === 1 ? "Go to frame 1 … 10" : "", "Frames");
            }
            k("o", () => this._toggleOnion(), "Onion skin", "Frames");
            k("p", () => this._togglePlay(), "Play / stop", "Frames");
            k("[", () => this._setBrush(this.brush - 1), "Smaller brush", "Tools");
            k("]", () => this._setBrush(this.brush + 1), "Bigger brush", "Tools");
            k("plus", () => this.$canvas.zoomIn(), "Zoom in", "View");
            k("=", () => this.$canvas.zoomIn(), "", "View");
            k("-", () => this.$canvas.zoomOut(), "Zoom out", "View");
            k("mod+o", () => this._open(), "Open…", "File");
            k("mod+s", () => this._save(false), "Save", "File");
            k("mod+shift+s", () => this._save(true), "Save as…", "File");
            k("mod+e", () => this._export(), "Export PNG…", "File");
            this._offs.push(sac.shortcuts.bind());
            this._offs.push(sac.shortcuts.add([
                { group: "View", keys: "Space + drag", description: "Pan" },
                { group: "View", keys: ["Middle-drag"], description: "Pan" },
                { group: "View", keys: ["Wheel"], description: "Zoom at the cursor" },
                { group: "Tools", keys: ["Alt", "click"], description: "Pick a color with any tool" },
                { group: "Tools", keys: ["Shift", "click"], description: "Pencil / eraser: line from the last point" },
                { group: "Selection", keys: ["Ctrl", "C"], description: "Copy" },
                { group: "Selection", keys: ["Ctrl", "X"], description: "Cut" },
                { group: "Selection", keys: ["Ctrl", "V"], description: "Paste in place (also images from other apps)" },
            ]));
            // Clipboard through the native events, not hotkeys: those would
            // swallow Ctrl+C in every text field of the page.
            const clip = (type, fn) => {
                const h = (e) => {
                    if (isEditable(e.composedPath()[0])) return;
                    fn(e);
                };
                document.addEventListener(type, h);
                this._offs.push(() => document.removeEventListener(type, h));
            };
            clip("copy", (e) => { if (this._copy()) this._markClipboard(e); });
            clip("cut", (e) => { if (this._cut()) this._markClipboard(e); });
            clip("paste", (e) => this._pasteEvent(e));
        }

        /* ------------------------------------------------------ wiring ---- */

        _wire() {
            const on = (sel, type, fn) => this.querySelector(sel).addEventListener(type, fn);
            on(".pa-new", "click", () => this._new());
            on(".pa-open", "click", () => this._open());
            on(".pa-save", "click", () => this._save(false));
            on(".pa-undo", "click", () => this._undo());
            on(".pa-redo", "click", () => this._redo());
            on(".pa-zin", "click", () => this.$canvas.zoomIn());
            on(".pa-zout", "click", () => this.$canvas.zoomOut());
            on(".pa-fit", "click", () => this.$canvas.fit());
            on(".pa-keys", "click", () => sac.shortcuts.show({ title: "Pixel Atelier shortcuts" }));
            on(".pa-play", "click", () => this._togglePlay());
            on(".pa-onion", "click", () => this._toggleOnion());
            on(".pa-pvplay", "click", () => this._pvToggle());
            on(".pa-menu", "sac:select", (e) => this._menu(e.detail.action));

            this.$tools.addEventListener("sac:change", (e) => this._setTool(e.detail.value));
            on(".pa-brush", "sac:change", (e) => this._setBrush(Number(e.detail.value)));
            on(".pa-fps", "sac:change", (e) => {
                this.doc.fps = Number(e.detail.value);
                this._touch();
                if (this._timer) { this._stopPlay(); this._togglePlay(); }
                if (this._pvTimer) { this._pvStop(); this._pvStart(); }
            });
            on(".pa-pvzoom", "sac:change", (e) => { this.pvZoom = Number(e.detail.value); this.$pv.setAttribute("zoom", String(this.pvZoom)); this._saveSettings(); });
            this.$color.addEventListener("sac:change", (e) => { if (e.detail) this._setColor(hexToRgba(e.detail.value), "field"); });
            this.$palette.addEventListener("sac:change", (e) => this._setColor(hexToRgba(e.detail.value), "palette"));
            on(".pa-palmode", "sac:change", (e) => { this.palMode = e.detail.value; this._refreshPalette(); this._saveSettings(); });
            on(".pa-pal-add", "click", () => this._paletteAdd());
            on(".pa-pal-remove", "click", () => this._paletteRemove());

            // Canvas: the kit reports cells, the tools below do the pixels.
            const c = this.$canvas;
            c.addEventListener("sac:pixel-down", (e) => this._down(e.detail));
            c.addEventListener("sac:pixel-move", (e) => this._drag(e.detail));
            c.addEventListener("sac:pixel-up", () => this._up());
            c.addEventListener("sac:pixel-cancel", () => this._cancel());
            c.addEventListener("sac:pixel-hover", (e) => this._hud(e.detail));
            c.addEventListener("sac:zoom", () => this._hud(this._lastCell));
            c.addEventListener("contextmenu", (e) => e.preventDefault());

            // Layers.
            const L = this.$layers;
            L.addEventListener("sac:change", (e) => { this._clearSel(); this.layer = e.detail.id; this._refreshAll(); });
            L.addEventListener("sac:toggle", (e) => {
                this._clearSel();
                this._push();
                this.doc.layers.find((x) => x.id === e.detail.id)[e.detail.prop] = e.detail.value;
                this._refreshAll();
            });
            L.addEventListener("sac:rename", (e) => {
                this._push();
                this.doc.layers.find((x) => x.id === e.detail.id).name = e.detail.name;
                this._refreshLayers();
            });
            L.addEventListener("sac:reorder", (e) => {
                this._clearSel();
                this._push();
                this.doc.move(this.doc.layers, e.detail.from, e.detail.to);
                this._refreshAll();
            });
            L.addEventListener("sac:action", (e) => {
                this._clearSel();
                const a = e.detail.action;
                if (a === "delete" && this.doc.layers.length < 2) return;
                this._push();
                if (a === "add") this.layer = this.doc.addLayer(null, Math.max(0, this.doc.layers.findIndex((l) => l.id === this.layer)));
                if (a === "duplicate") this.layer = this.doc.duplicateLayer(this.layer);
                if (a === "delete" && this.doc.removeLayer(this.layer)) this.layer = this.doc.layers[0].id;
                this._refreshAll();
            });

            // Frames.
            const F = this.$film;
            F.addEventListener("sac:change", (e) => this._setFrame(e.detail.index));
            F.addEventListener("sac:reorder", (e) => {
                this._clearSel();
                this._push();
                this.doc.move(this.doc.frames, e.detail.from, e.detail.to);
                this.frame = e.detail.to;
                this._refreshAll(true);
            });
            F.addEventListener("sac:action", (e) => this._frameAction(e.detail.action));
        }

        _menu(action) {
            ({
                copy: () => this._copy(),
                cut: () => this._cut(),
                paste: () => this._paste(),
                "flip-h": () => this._flip("h"),
                "flip-v": () => this._flip("v"),
                trim: () => this._trimSel(),
                "select-all": () => this._selectAll(),
                "save-as": () => this._save(true),
                export: () => this._export(),
                revert: () => this._revert(),
            }[action] || (() => {}))();
        }

        /* ---------------------------------------------------- document ---- */

        /** Take a document in: every piece of per-document state starts over. */
        _load(doc, file, savedBlob) {
            this._stopPlay();
            this.doc = doc;
            this.layer = doc.layers[0].id;
            this.frame = 0;
            this.sel = null; this.float = null;
            this.undo = []; this.redo = [];
            this._stroke = null; this._lastPoint = null;
            this.file = file;
            this.savedBlob = savedBlob;
            this.querySelector(".pa-fps").value = doc.fps;
            this._ctx.setDirty?.(false);
            this._dirty = false;
            this._refreshAll(true);
            this.$canvas.fit();
        }

        _buf() { return this.doc.frames[this.frame][this.layer]; }
        _activeLayer() { return this.doc.layers.find((l) => l.id === this.layer); }
        _paintColor() { return this.tool === "eraser" ? [0, 0, 0, 0] : this.color; }
        _locked() {
            if (!this._activeLayer().locked) return false;
            this._toast("This layer is locked");
            return true;
        }

        /** Buffers as they will be saved: a floating selection baked in (on a copy). */
        _bufOf() {
            const f = this.float;
            return (fi, lid) => {
                const buf = this.doc.frames[fi][lid];
                if (!f || f.frame !== fi || f.layer !== lid) return buf;
                const out = buf.slice();
                raster.paste(this.doc, out, f);
                return out;
            };
        }

        /* ------------------------------------------------------- tools ---- */

        _down(c) {
            if (this._timer) this._stopPlay();
            if (c.button === 2) return;
            // Alt+click or the eyedropper: pick from what you SEE (the composite).
            if (c.altKey || this.tool === "pick") { this._pick(c); this._picking = true; return; }
            if (this.tool === "select") { this._selDown(c); return; }
            if (!c.inside && this.tool === "fill") return;
            if (this._locked()) return;
            this._push();
            const buf = this._buf(), col = this._paintColor();
            this._stroke = { start: c, last: c, base: buf.slice() };
            if (SHAPES.has(this.tool)) raster[this.tool](this.doc, buf, c, c, this.brush, col);
            else if (this.tool === "fill") raster.fill(this.doc, buf, c.x, c.y, col);
            else if (c.shiftKey && this._lastPoint) raster.line(this.doc, buf, this._lastPoint, c, this.brush, col);
            else raster.stamp(this.doc, buf, c.x, c.y, this.brush, col);
            this._refreshCanvas();
        }

        _drag(c) {
            this._hud(c);
            if (this._picking) { this._pick(c); return; }
            if (this._selStart) {
                const a = this._selStart, W = this.doc.w, H = this.doc.h;
                const x0 = clamp(Math.min(a.x, c.x), 0, W - 1), y0 = clamp(Math.min(a.y, c.y), 0, H - 1);
                const x1 = clamp(Math.max(a.x, c.x), 0, W - 1), y1 = clamp(Math.max(a.y, c.y), 0, H - 1);
                this._setSel({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
                return;
            }
            if (this._moving) {
                const m = this._moving;
                this.float.x = m.ox + c.x - m.start.x;
                this.float.y = m.oy + c.y - m.start.y;
                this._setSel({ x: this.float.x, y: this.float.y, w: this.float.w, h: this.float.h });
                this._refreshCanvas();
                return;
            }
            const s = this._stroke;
            if (!s || this.tool === "fill") return;
            const buf = this._buf(), col = this._paintColor();
            if (SHAPES.has(this.tool)) { buf.set(s.base); raster[this.tool](this.doc, buf, s.start, c, this.brush, col); }
            else raster.line(this.doc, buf, s.last, c, this.brush, col);   // fast strokes skip cells
            s.last = c;
            this._refreshCanvas();
        }

        _up() {
            this._picking = false;
            this._selStart = null;
            if (this._moving) { this._moving = null; this._refreshLayers(); this._touch(); return; }
            if (!this._stroke) return;
            this._lastPoint = this._stroke.last;
            this._stroke = null;
            this._refreshAll();
            this._touch();
        }

        /** A second finger turned the stroke into a pinch: roll it back. */
        _cancel() {
            if (this._stroke) { this._buf().set(this._stroke.base); this.undo.pop(); this._stroke = null; this._refreshCanvas(); }
            if (this._moving) {
                this.float.x = this._moving.ox; this.float.y = this._moving.oy;
                this._setSel({ x: this.float.x, y: this.float.y, w: this.float.w, h: this.float.h });
                this._moving = null;
                this._refreshCanvas();
            }
            this._picking = false; this._selStart = null;
        }

        _pick(c) {
            if (!c.inside) return;
            const img = this.doc.composite(this.frame), i = (c.y * this.doc.w + c.x) * 4;
            this._setColor([img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]);
        }

        _setTool(t) {
            if (t !== "select") this._clearSel();
            this.tool = t;
            this.$tools.value = t;
            this.$canvas.style.cursor = t === "pick" ? "copy" : "";
            this._syncBrushBox();
            this._saveSettings();
        }
        _setBrush(n) {
            this.brush = clamp(n || 1, 1, 4);
            this.querySelector(".pa-brush").value = this.brush;
            this._syncBrushBox();
            this._saveSettings();
        }
        /** The hover box shows what a click will touch. */
        _syncBrushBox() { this.$canvas.setAttribute("brush", String(BRUSHED.has(this.tool) ? this.brush : 1)); }

        _setColor(c, from) {
            this.color = c;
            const hex = rgbaToHex(c);
            if (from !== "field" && hex !== "transparent") this.$color.value = hex;
            if (from !== "palette") for (const s of this.$palette.querySelectorAll("sac-swatch")) s.selected = s.value === hex;
        }

        /* --------------------------------------------------- selection ----
           A rectangular marquee whose contents FLOAT once touched: lifted out
           of the layer (the undo point), dragged or nudged freely, and baked
           back in only on commit — click outside, Escape, a tool / frame /
           layer switch, save. Everything is frame-local and on the active
           layer. */

        _setSel(s) { this.sel = s; this.$canvas.selection = s; }
        _inSel(c) { const s = this.sel; return !!s && c.x >= s.x && c.x < s.x + s.w && c.y >= s.y && c.y < s.y + s.h; }

        _selDown(c) {
            if (this._inSel(c)) {
                if (this._locked()) return;
                if (!this.float) this._lift();
                this._moving = { start: c, ox: this.float.x, oy: this.float.y };
                return;
            }
            this._commitFloat();
            const x = clamp(c.x, 0, this.doc.w - 1), y = clamp(c.y, 0, this.doc.h - 1);
            this._selStart = { x, y };
            this._setSel({ x, y, w: 1, h: 1 });
            this._refreshCanvas();
        }

        _lift() {
            this._push();
            const s = this.sel, buf = this._buf();
            this.float = { data: raster.copy(this.doc, buf, s), w: s.w, h: s.h, x: s.x, y: s.y, frame: this.frame, layer: this.layer };
            raster.clear(this.doc, buf, s);
        }

        _commitFloat() {
            const f = this.float;
            if (!f) return;
            this.float = null;
            const frame = this.doc.frames[f.frame];
            if (frame && frame[f.layer]) raster.paste(this.doc, frame[f.layer], f);
            this._refreshAll();
            this._touch();
        }

        /** Commit and drop the marquee. */
        _clearSel() {
            this._commitFloat();
            if (this.sel) { this._setSel(null); this._refreshCanvas(); }
            this._selStart = null; this._moving = null;
        }
        _deselect() { this._clearSel(); }

        _nudge(dx, dy) {
            if (!this.sel || this._locked()) return;
            if (!this.float) this._lift();
            this.float.x += dx; this.float.y += dy;
            this._setSel({ x: this.float.x, y: this.float.y, w: this.float.w, h: this.float.h });
            this._refreshCanvas();
            this._touch();
        }

        /** Delete: drop the floating content, or clear the selected pixels. */
        _deleteSel() {
            if (!this.sel || this._locked()) return;
            if (this.float) { this.float = null; this._refreshAll(); this._touch(); return; }
            this._push();
            raster.clear(this.doc, this._buf(), this.sel);
            this._refreshAll();
            this._touch();
        }

        /** A selection flips as a floating object (what lies below stays); else the whole frame, every layer. */
        _flip(dir) {
            if (this.sel) {
                if (this._locked()) return;
                if (!this.float) this._lift();
                raster.flip(this.float.data, this.float.w, this.float.h, dir);
                this._refreshCanvas();
                this._touch();
                return;
            }
            this._push();
            for (const l of this.doc.layers) if (!l.locked) raster.flip(this.doc.frames[this.frame][l.id], this.doc.w, this.doc.h, dir);
            this._refreshAll();
            this._touch();
        }

        /** Shrink the selection to its opaque content ("only the object"). */
        _trimSel() {
            if (!this.sel) { this._toast("Nothing selected"); return; }
            this._commitFloat();
            const s = this.sel, buf = this._buf();
            let minx = Infinity, miny = Infinity, maxx = -1, maxy = -1;
            for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
                if (!this.doc.inside(x, y) || !buf[(y * this.doc.w + x) * 4 + 3]) continue;
                minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
            }
            this._setSel(maxx < 0 ? null : { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 });
            this._refreshCanvas();
        }

        _selectAll() {
            this._commitFloat();
            this._setTool("select");
            this._setSel({ x: 0, y: 0, w: this.doc.w, h: this.doc.h });
            this._refreshCanvas();
        }

        /** → true when something was copied. */
        _copy() {
            if (this.float) {
                const f = this.float;
                this.clip = { data: f.data.slice(), w: f.w, h: f.h, x: f.x, y: f.y };
            } else if (this.sel) {
                const s = this.sel;
                this.clip = { data: raster.copy(this.doc, this._buf(), s), w: s.w, h: s.h, x: s.x, y: s.y };
            } else return false;
            this._toast("Copied");
            return true;
        }
        _cut() {
            if (!this.sel || this._activeLayer().locked) return false;
            if (!this._copy()) return false;
            this._deleteSel();
            this._setSel(null);
            this._refreshCanvas();
            return true;
        }
        /** Paste as a NEW floating selection, in place (same spot in the frame), clamped inside. */
        _paste(clip = this.clip) {
            if (!clip) { this._toast("Nothing to paste"); return; }
            if (this._locked()) return;
            this._commitFloat();
            const x = clamp(clip.x || 0, 0, Math.max(0, this.doc.w - clip.w));
            const y = clamp(clip.y || 0, 0, Math.max(0, this.doc.h - clip.h));
            this._push();
            this.float = { data: clip.data.slice(), w: clip.w, h: clip.h, x, y, frame: this.frame, layer: this.layer };
            this._setTool("select");
            this._setSel({ x, y, w: clip.w, h: clip.h });
            this._refreshCanvas();
            this._touch();
            this._toast("Pasted — drag or use the arrows to place it");
        }
        /** Our own copy leaves a marker, so a later copy in another app wins on paste. */
        _markClipboard(e) {
            this._clipId = String(Date.now());
            e.clipboardData.setData("text/plain", CLIP_MARK + ":" + this._clipId);
            e.preventDefault();
        }
        async _pasteEvent(e) {
            const text = e.clipboardData.getData("text/plain");
            const image = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (text === CLIP_MARK + ":" + this._clipId || !image) {
                if (!this.clip) return;
                e.preventDefault();
                this._paste();
                return;
            }
            e.preventDefault();
            try {
                const bmp = await createImageBitmap(image);
                const w = Math.min(bmp.width, this.doc.w), h = Math.min(bmp.height, this.doc.h);
                const data = new Uint8ClampedArray(pixelsOf(bmp).getImageData(0, 0, w, h).data);
                this._paste({ data, w, h, x: 0, y: 0 });
            } catch { this._toast("The clipboard image could not be read"); }
        }

        /* ----------------------------------------------------- history ---- */

        _push() {
            this.undo.push(this.doc.snapshot());
            if (this.undo.length > UNDO_LIMIT) this.undo.shift();
            this.redo = [];
            // Every edit goes through here first: the one place to say
            // "unsaved work" — leaving the page now asks.
            this._setDirty(true);
        }
        _undo() {
            this._commitFloat();
            if (!this.undo.length) return;
            this.redo.push(this.doc.snapshot());
            this._restoreSnap(this.undo.pop());
        }
        _redo() {
            this._commitFloat();
            if (!this.redo.length) return;
            this.undo.push(this.doc.snapshot());
            this._restoreSnap(this.redo.pop());
        }
        _restoreSnap(s) {
            this.doc.restore(s);
            this.float = null;
            this._setSel(null);
            if (!this.doc.layers.some((l) => l.id === this.layer)) this.layer = this.doc.layers[0].id;
            this.frame = Math.min(this.frame, this.doc.frames.length - 1);
            this._setDirty(true);
            this._refreshAll(true);
            this._touch();
        }

        /* ------------------------------------------------------ frames ---- */

        _setFrame(i, exact) {
            const n = this.doc.frames.length;
            if (exact && (i < 0 || i >= n)) return;
            this._clearSel();
            this.frame = ((i % n) + n) % n;
            this._refreshAll();
        }
        _frameAction(a) {
            const i = this.frame;
            if (a === "delete" && this.doc.frames.length < 2) return;
            if (a !== "delete" && this.doc.frames.length >= MAX_FRAMES) { this._toast(`At most ${MAX_FRAMES} frames`); return; }
            this._clearSel();
            this._push();
            if (a === "add") { this.doc.addFrame(i + 1); this.frame = i + 1; }
            if (a === "duplicate") { this.doc.addFrame(i + 1, i); this.frame = i + 1; }
            if (a === "delete") { this.doc.frames.splice(i, 1); this.frame = Math.min(i, this.doc.frames.length - 1); }
            this._refreshAll(true);
            this._touch();
        }
        _toggleOnion() {
            this.onion = !this.onion;
            this.querySelector(".pa-onion").classList.toggle("active", this.onion);
            this._refreshCanvas();
            this._saveSettings();
        }
        _togglePlay() {
            if (this._timer) return this._stopPlay();
            if (this.doc.frames.length < 2) return;
            this._clearSel();
            this._setIcon(".pa-play", true, "Stop (P)", "Play (P)");
            this._timer = setInterval(() => {
                this.frame = (this.frame + 1) % this.doc.frames.length;
                this._refreshCanvas();
                this.$film.value = this.frame;
                this._hud(this._lastCell);
            }, 1000 / this.doc.fps);
        }
        _stopPlay() {
            if (!this._timer) return;
            clearInterval(this._timer);
            this._timer = null;
            this._setIcon(".pa-play", false, "Stop (P)", "Play (P)");
            this._refreshAll();
        }
        _setIcon(sel, on, onTitle, offTitle) {
            const b = this.querySelector(sel);
            b.title = on ? onTitle : offTitle;
            b.querySelector("sac-icon").setAttribute("name", on ? "pause" : "play");
        }

        /* ----------------------------------------------------- preview ----
           Edit big, watch small: the preview loops the animation on its own
           clock while you paint. */

        _pvStart() {
            if (this._pvTimer || !this.pvPlaying) return;
            this._pvFrame = this.frame;
            this._pvTimer = setInterval(() => {
                const n = this.doc.frames.length;
                if (n < 2) return;
                this._pvFrame = (this._pvFrame + 1) % n;
                this.$pv.image = this.doc.composite(this._pvFrame, null, this._bufOf());
            }, 1000 / this.doc.fps);
        }
        _pvStop() { clearInterval(this._pvTimer); this._pvTimer = null; }
        _pvToggle() {
            this.pvPlaying = !this.pvPlaying;
            const b = this.querySelector(".pa-pvplay");
            b.classList.toggle("active", this.pvPlaying);
            b.querySelector("sac-icon").setAttribute("name", this.pvPlaying ? "pause" : "play");
            if (this.pvPlaying) this._pvStart(); else { this._pvStop(); this._refreshCanvas(); }
            this._saveSettings();
        }

        /* ---------------------------------------------------- palette ----- */

        _refreshPalette() {
            const hex = rgbaToHex(this.color);
            const colors = this.palMode === "used" ? this.doc.usedColors() : this.doc.palette;
            this.$palette.colors = [{ value: "transparent", label: "Transparent", selected: hex === "transparent" },
                ...colors.map((value) => ({ value, selected: value === hex }))];
            this.querySelector(".pa-palmode").value = this.palMode;
            const inPal = this.doc.palette.includes(hex);
            this.querySelector(".pa-pal-add").disabled = hex === "transparent" || inPal;
            this.querySelector(".pa-pal-remove").disabled = !inPal;
        }
        _paletteAdd() {
            const hex = rgbaToHex(this.color);
            if (hex === "transparent" || this.doc.palette.includes(hex)) return;
            this.doc.palette.push(hex);
            this._touchMeta();
            this._refreshPalette();
        }
        _paletteRemove() {
            const hex = rgbaToHex(this.color);
            const i = this.doc.palette.indexOf(hex);
            if (i < 0) return;
            this.doc.palette.splice(i, 1);
            this._touchMeta();
            this._refreshPalette();
        }

        /* ---------------------------------------------------- refresh ----- */

        _refreshCanvas() {
            const n = this.doc.frames.length, bufOf = this._bufOf();
            const img = this.doc.composite(this.frame);
            const under = [];
            if (this.onion && !this._timer && n > 1) {
                // Onion wraps the loop: the last frame shows the first behind it.
                const prev = (this.frame - 1 + n) % n, next = (this.frame + 1) % n;
                for (const f of new Set([prev, next])) under.push({ image: this.doc.composite(f, null, bufOf), opacity: 0.3 });
            }
            const f = this.float;
            this.$canvas.underlays = under;
            this.$canvas.overlays = f && f.frame === this.frame ? [{ image: new ImageData(f.data.slice(), f.w, f.h), x: f.x, y: f.y }] : [];
            this.$canvas.image = img;
            if (!this._pvTimer || n < 2) this.$pv.image = this.doc.composite(this.frame, null, bufOf);
            // Only the thumbnail of the frame being painted changes.
            const thumb = this._thumbs && this._thumbs[this.frame];
            if (thumb) { thumb.getContext("2d").putImageData(this.doc.composite(this.frame, null, bufOf), 0, 0); this.$film.refresh(this.frame); }
        }
        _rebuildThumbs() {
            const bufOf = this._bufOf();
            this._thumbs = this.doc.frames.map((_, i) => {
                const c = canvasOf(this.doc.w, this.doc.h);
                c.getContext("2d").putImageData(this.doc.composite(i, null, bufOf), 0, 0);
                return c;
            });
            this.$film.frames = this._thumbs;
        }
        _refreshLayers() {
            this.$layers.layers = this.doc.layers.map((l) => ({ ...l, thumb: this.doc.composite(this.frame, l.id, this._bufOf()) }));
            this.$layers.value = this.layer;
        }
        /** `structure`: frames were added, removed, reordered or resized. */
        _refreshAll(structure) {
            if (structure || !this._thumbs || this._thumbs.length !== this.doc.frames.length
                || this._thumbs[0].width !== this.doc.w || this._thumbs[0].height !== this.doc.h) this._rebuildThumbs();
            this._refreshCanvas();
            this._refreshLayers();
            this._refreshPalette();
            this.$film.value = this.frame;
            this._hud(this._lastCell);
            this._syncName();
        }
        _hud(c) {
            this._lastCell = c;
            const pos = c && c.inside ? `${c.x}, ${c.y} · ` : "";
            const n = this.doc.frames.length;
            this.$hud.textContent = `${pos}${this.doc.w}×${this.doc.h} · ${this.$canvas.zoom}× · frame ${this.frame + 1}/${n}`;
        }
        _syncName() {
            this.$name.textContent = this.file ? this.file.name : "";
            this.$name.classList.toggle("dirty", !!this._dirty);
        }
        _toast(msg) { if (window.sac && sac.toast) sac.toast(msg); }

        /* ------------------------------------------ dirty + autosave ------ */

        _setDirty(on) {
            if (on === this._dirty) return;
            this._dirty = on;
            this._ctx.setDirty?.(on);
            this._syncName();
        }
        /** Something changed that is not an undo step (palette, fps). */
        _touchMeta() { this._setDirty(true); this._touch(); }
        /** The document changed: autosave soon. */
        _touch() {
            clearTimeout(this._autosaveT);
            this._autosaveT = setTimeout(() => this._autosave(), AUTOSAVE_MS);
        }
        async _autosave() {
            const fs = this._ctx.fs;
            if (!fs) return;
            try {
                await fs.write("autosave.png", await encodeDoc(this.doc, this._bufOf()));
                await fs.write("session", { name: this.file ? this.file.name : "sprite.png", dirty: !!this._dirty });
            } catch (err) { console.warn("[pixel-atelier] autosave failed:", err); }
        }
        _saveSettings() {
            const fs = this._ctx && this._ctx.fs;
            if (!fs || this._restoring) return;
            fs.write("settings", { tool: this.tool, brush: this.brush, onion: this.onion, palMode: this.palMode, pvZoom: this.pvZoom, pvPlaying: this.pvPlaying })
                .catch(() => {});
        }

        /** Bring back the last session: settings, and the document as it was left. */
        async _restore() {
            const fs = this._ctx.fs;
            if (!fs) return;
            this._restoring = true;
            try {
                const s = await fs.read("settings", null);
                if (s) {
                    if (s.onion === false) this._toggleOnion();
                    if (s.pvPlaying === false) this._pvToggle();
                    if (s.palMode === "used") this.palMode = "used";
                    if (s.pvZoom) { this.pvZoom = clamp(s.pvZoom, 1, 8); this.querySelector(".pa-pvzoom").value = this.pvZoom; this.$pv.setAttribute("zoom", String(this.pvZoom)); }
                    if (s.brush) this._setBrush(s.brush);
                    if (TOOLS.some((t) => t && t.id === s.tool)) this._setTool(s.tool);
                }
                const session = await fs.read("session", null);
                const blob = session && await fs.read("autosave.png", null);
                if (blob instanceof Blob && !this.undo.length) {
                    const res = await decodeFile(blob);
                    if (res.doc) {
                        this._load(res.doc, { name: session.name || "sprite.png", handle: null }, null);
                        if (session.dirty) { this._setDirty(true); this._toast("Restored your unsaved work"); }
                    }
                }
            } catch (err) {
                console.warn("[pixel-atelier] could not restore the last session:", err);
            } finally {
                this._restoring = false;
                this._refreshPalette();
            }
        }

        /* ------------------------------------------------- open / save ---- */

        /** Unsaved work? Ask before throwing it away. → true to go on. */
        async _discardOk() {
            if (!this._dirty) return true;
            const a = await sac.dialog.confirm({
                title: "Discard unsaved changes?",
                message: `${this.file ? this.file.name : "This sprite"} has changes that are not saved.`,
                buttons: [
                    { action: "cancel", label: "Cancel", kind: "default" },
                    { action: "discard", label: "Discard", kind: "destructive" },
                ],
            });
            return a === "discard";
        }

        async _new() {
            if (!(await this._discardOk())) return;
            let dropped = null;
            const { action, dlg } = await dialog("New sprite", `
                <div class="pa-form">
                    <div class="pa-row"><label>Width</label>
                        <sac-stepper class="pa-n-w" value="${this.doc.w}" min="1" max="${MAX_SIDE}" unit="px" label="Width"></sac-stepper></div>
                    <div class="pa-row"><label>Height</label>
                        <sac-stepper class="pa-n-h" value="${this.doc.h}" min="1" max="${MAX_SIDE}" unit="px" label="Height"></sac-stepper></div>
                    <div class="pa-row"><label>Frames</label>
                        <sac-stepper class="pa-n-f" value="1" min="1" max="${MAX_FRAMES}" label="Frames"></sac-stepper></div>
                    <sac-drop-zone accept="image/*" label="…or drop an image to open it" touch-label="…or open an image"></sac-drop-zone>
                </div>`,
            [
                { action: "cancel", label: "Cancel", kind: "default" },
                { action: "create", label: "Create", kind: "primary" },
            ], (d) => d.addEventListener("sac:files", (e) => { dropped = e.detail.files[0]; d.close("drop"); }));
            if (action === "drop" && dropped) {
                this._openFile(dropped, { name: dropped.name, file: dropped, handle: null });
                return;
            }
            if (action !== "create") return;
            const num = (s) => Number(dlg.querySelector(s).value);
            const w = clamp(num(".pa-n-w"), 1, MAX_SIDE), h = clamp(num(".pa-n-h"), 1, MAX_SIDE), f = clamp(num(".pa-n-f"), 1, MAX_FRAMES);
            this._load(blankDoc(w, h, f), { name: "sprite.png", handle: null }, null);
            this._touch();
        }

        async _open() {
            const files = this._ctx.files;
            if (!files) { this._toast("This host offers no files to open."); return; }
            if (!(await this._discardOk())) return;
            const picked = await files.open({ accept: ".png,image/png,image/*", title: "Open a sprite" });
            if (picked) this._openFile(picked.file, picked);
        }

        /** Open any image: ours comes back whole, anything else is split into frames on request. */
        async _openFile(file, ref) {
            let res;
            try { res = await decodeFile(file); }
            catch { this._toast(`${ref.name} is not an image this browser can read.`); return; }
            let doc = res.doc;
            if (!doc) {
                const n = await this._askFrames(res.width, res.height, ref.name);
                if (!n) return;
                if (res.width / n > MAX_SIDE || res.height > MAX_SIDE) {
                    this._toast(`Frames up to ${MAX_SIDE}×${MAX_SIDE} px — this one is ${res.width / n}×${res.height}.`);
                    return;
                }
                doc = docFromStrip(res.strip, res.width, res.height, n);
            }
            // Save writes PNG: a handle to anything else would overwrite it with one.
            const isPng = /\.png$/i.test(ref.name);
            const file2 = { name: isPng ? ref.name : ref.name.replace(/\.[^.]*$/, "") + ".png", handle: isPng ? ref.handle : null };
            this._load(doc, file2, isPng ? file : null);
            this._touch();
            this._toast(`Opened ${ref.name}`);
        }

        /**
         * A foreign picture: how many frames sit side by side in it? A strip
         * of square frames is the likely answer. → a count, or null (cancel).
         */
        async _askFrames(width, height, name) {
            const counts = [];
            for (let n = 1; n <= Math.min(width, MAX_FRAMES); n++) if (width % n === 0) counts.push(n);
            if (counts.length === 1) return 1;
            const guess = width > height && width % height === 0 && counts.includes(width / height) ? width / height : 1;
            const options = counts.map((n) => `<option value="${n}"${n === guess ? " selected" : ""}>${n} × ${width / n}×${height} px</option>`).join("");
            const { action, dlg } = await dialog(`Open ${name}`, `
                <div class="pa-form">
                    <p class="pa-note">${width}×${height} px. Frames sit side by side in a strip — how many are there?</p>
                    <div class="pa-row"><label>Frames</label><span class="select"><select class="pa-o-n">${options}</select></span></div>
                </div>`,
            [
                { action: "cancel", label: "Cancel", kind: "default" },
                { action: "open", label: "Open", kind: "primary" },
            ]);
            return action === "open" ? Number(dlg.querySelector(".pa-o-n").value) : null;
        }

        /** Save = back through the handle; Save as (or no handle yet) asks. */
        async _save(asNew) {
            const files = this._ctx.files;
            if (!files) { this._toast("This host offers no file saving."); return; }
            this._commitFloat();
            const blob = await encodeDoc(this.doc, this._bufOf());
            const saved = await files.save(blob, {
                name: this.file ? this.file.name : "sprite.png",
                handle: asNew || !this.file ? null : this.file.handle,
                accept: ".png",
                type: "image/png",
                title: asNew ? "Save as" : "Save",
            });
            if (!saved) return;
            this.file = saved;
            this.savedBlob = blob;
            this._setDirty(false);
            this._autosave();
            this._toast(files.kind === "browser" && !saved.handle ? `Downloaded ${saved.name}` : `Saved ${saved.name}`);
        }

        /** Back to the last saved (or opened) state. */
        async _revert() {
            if (!this.savedBlob) { this._toast("Nothing saved yet to go back to"); return; }
            const a = await sac.dialog.confirm({
                title: "Revert to saved?",
                message: "Every change since the last save is lost.",
                buttons: [
                    { action: "cancel", label: "Cancel", kind: "default" },
                    { action: "revert", label: "Revert", kind: "destructive" },
                ],
            });
            if (a !== "revert") return;
            const res = await decodeFile(this.savedBlob);
            if (!res.doc) {
                // A foreign file we split on open: split it the same way again.
                const n = this.doc.frames.length;
                res.doc = res.width % n === 0 ? docFromStrip(res.strip, res.width, res.height, n) : docFromStrip(res.strip, res.width, res.height, 1);
            }
            this._load(res.doc, this.file, this.savedBlob);
            this._touch();
            this._toast("Reverted to the saved state");
        }

        /* ------------------------------------------------------ export ---- */

        async _export() {
            const files = this._ctx.files;
            if (!files) { this._toast("This host offers no file saving."); return; }
            const W = this.doc.w, H = this.doc.h, n = this.doc.frames.length;
            const size = (d) => {
                const what = d.querySelector(".pa-x-what").value, s = Number(d.querySelector(".pa-x-scale").value);
                d.querySelector(".pa-x-size").textContent = `${W * (what === "sheet" ? n : 1) * s} × ${H * s} px`;
            };
            const { action, dlg } = await dialog("Export PNG", `
                <div class="pa-form">
                    <div class="pa-row"><label>What</label>
                        <sac-segmented-control class="pa-x-what" value="${n > 1 ? "sheet" : "frame"}">
                            <button data-value="frame">This frame</button>
                            <button data-value="sheet">Sprite sheet</button>
                        </sac-segmented-control></div>
                    <div class="pa-row"><label>Scale</label>
                        <sac-stepper class="pa-x-scale" value="4" min="1" max="32" unit="×" label="Scale"></sac-stepper></div>
                    <p class="pa-note pa-x-size"></p>
                </div>`,
            [
                { action: "cancel", label: "Cancel", kind: "default" },
                { action: "export", label: "Export…", kind: "primary" },
            ], (d) => { d.addEventListener("sac:change", () => size(d)); requestAnimationFrame(() => size(d)); });
            if (action !== "export") return;
            const what = dlg.querySelector(".pa-x-what").value, s = Number(dlg.querySelector(".pa-x-scale").value);
            const bufOf = this._bufOf();
            const list = what === "sheet" ? this.doc.frames.map((_, i) => i) : [this.frame];
            const src = canvasOf(W * list.length, H);
            list.forEach((f, k) => src.getContext("2d").putImageData(this.doc.composite(f, null, bufOf), k * W, 0));
            const out = canvasOf(src.width * s, src.height * s), g = out.getContext("2d");
            g.imageSmoothingEnabled = false;
            g.drawImage(src, 0, 0, out.width, out.height);
            // An export is a copy, never the document: no handle, and the
            // document's own file stays the one Save writes to.
            const base = (this.file ? this.file.name : "sprite.png").replace(/\.png$/i, "");
            const name = what === "sheet" ? `${base}-sheet-${s}x.png` : `${base}-frame-${this.frame + 1}-${s}x.png`;
            await files.save(await toBlob(out), { name, accept: ".png", type: "image/png", title: "Export PNG" });
        }
    }

    sac.app.define("app-pixel-atelier", AppPixelAtelier);
})();
