/**
 * <app-pixel-atelier> — the Atelier's sprite editor as a SACRVM APPKIT app
 * (manifest kind: "view").
 *
 * The editor of BunnyBot's Atelier, taken out of its game, with its studio
 * layout intact: the canvas fills the screen, and TOOLS, PALETTE and PREVIEW
 * are floating, draggable, closable windows over it — brought back from the
 * top bar, so everything is one short reach from the pixels. The frames sit
 * in the bar at the bottom.
 *
 * Every piece of chrome is a kit component; everything about PIXELS lives in
 * a headless document (SpriteDoc) with no DOM in it:
 *
 *   <sac-pixel-canvas>   the viewport       SpriteDoc  frames of RGBA, undo
 *   <sac-window> ×4      floating windows   raster     pencil … ellipse, fill
 *   <sac-toolbox>        tools              selection  a floating marquee
 *   <sac-swatch-grid>    palette            file       PNG strip + tEXt chunk
 *   context.files / fs   open, save, autosave
 *
 * A sprite is saved as a plain PNG — one frame per cell of a horizontal
 * strip — so any tool or game reads it; fps and palette ride along in a
 * private `tEXt` chunk.
 */
(function () {
    const BASE = sac.app.base();
    const CSS_ID = "app-pixel-atelier-css";

    const UNDO_LIMIT = 80;
    const MAX_SIDE = 512;              // one frame, either edge
    const MAX_FRAMES = 256;
    const CHUNK_KEY = "pixel-atelier"; // the PNG tEXt keyword
    const CLIP_MARK = "pixel-atelier/clip";
    const AUTOSAVE_MS = 1500;

    // DawnBringer 32 — a user's colours, DATA, not theme. A file may carry its own.
    const DEFAULT_PALETTE = [
        "#000000", "#222034", "#45283c", "#663931", "#8f563b", "#df7126", "#d9a066", "#eec39a",
        "#fbf236", "#99e550", "#6abe30", "#37946e", "#4b692f", "#524b24", "#323c39", "#3f3f74",
        "#306082", "#5b6ee1", "#639bff", "#5fcde4", "#cbdbfc", "#ffffff", "#9badb7", "#847e87",
        "#696a6a", "#595652", "#76428a", "#ac3232", "#d95763", "#d77bba", "#8f974a", "#8a6f30",
    ];

    // The Atelier's tool box, in its order.
    const TOOLS = [
        { id: "pencil",      icon: "pencil",      label: "Pencil",                key: "b" },
        { id: "eraser",      icon: "eraser",      label: "Eraser",                key: "e" },
        { id: "line",        icon: "line",        label: "Line",                  key: "l" },
        { id: "rect",        icon: "square",      label: "Rectangle",             key: "r" },
        { id: "rectfill",    icon: "square-fill", label: "Filled rectangle" },
        { id: "ellipse",     icon: "circle",      label: "Ellipse",               key: "c" },
        { id: "ellipsefill", icon: "circle-fill", label: "Filled ellipse" },
        { id: "fill",        icon: "bucket",      label: "Fill",                  key: "g" },
        { id: "pick",        icon: "eyedropper",  label: "Eyedropper",            key: "i" },
        { id: "select",      icon: "marquee",     label: "Select · move",         key: "m" },
    ];
    // Paste and crop are not in the kit's icon set yet — requested from the
    // appkit; registered through its documented extension point until then.
    if (!sac.icons.has("paste")) {
        sac.icons.register("paste", '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>');
    }
    if (!sac.icons.has("crop")) {
        sac.icons.register("crop", '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>');
    }
    const SHAPES = new Set(["line", "rect", "rectfill", "ellipse", "ellipsefill"]);
    const BRUSHED = new Set(["pencil", "eraser", "line", "rect", "rectfill", "ellipse", "ellipsefill"]);

    const hexToRgba = (h) => {
        if (!h || h === "transparent") return [0, 0, 0, 0];
        const n = parseInt(h.slice(1, 7), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
    };
    const rgbaToHex = (c) => c[3] === 0 ? "transparent"
        : "#" + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    const eqRgba = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const isEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    /* ================================================================
       SpriteDoc — the headless document: w×h frames of RGBA. No DOM.
       ================================================================ */
    class SpriteDoc {
        constructor(w, h) {
            this.w = w; this.h = h;
            this.frames = [];          // [Uint8ClampedArray(w*h*4)]
            this.fps = 8;
            this.palette = DEFAULT_PALETTE.slice();
        }
        blank() { return new Uint8ClampedArray(this.w * this.h * 4); }
        inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
        get(buf, x, y) { const i = (y * this.w + x) * 4; return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; }
        set(buf, x, y, c) {
            if (!this.inside(x, y)) return;
            const i = (y * this.w + x) * 4;
            buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
        }
        image(fi, buf) { return new ImageData((buf || this.frames[fi]).slice(), this.w, this.h); }
        /** Distinct opaque colours of every frame, most-used first. */
        usedColors() {
            const count = new Map();
            for (const b of this.frames) for (let i = 0; i < b.length; i += 4) {
                if (!b[i + 3]) continue;
                const hex = rgbaToHex([b[i], b[i + 1], b[i + 2], 255]);
                count.set(hex, (count.get(hex) || 0) + 1);
            }
            return [...count.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
        }
        snapshot() { return { w: this.w, h: this.h, frames: this.frames.map((f) => f.slice()) }; }
        restore(s) { this.w = s.w; this.h = s.h; this.frames = s.frames; }
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
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) raster.stamp(doc, buf, x, y, size, c);
        },
        // Gap-free outline: scan every column AND every row for the boundary.
        ellipse(doc, buf, a, b, size, c) {
            const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
            const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
            if (rx < 0.5) { for (let y = y0; y <= y1; y++) raster.stamp(doc, buf, Math.round(cx), y, size, c); return; }
            if (ry < 0.5) { for (let x = x0; x <= x1; x++) raster.stamp(doc, buf, x, Math.round(cy), size, c); return; }
            for (let x = x0; x <= x1; x++) {
                const d = (x - cx) / rx; if (Math.abs(d) > 1) continue;
                const e = ry * Math.sqrt(1 - d * d);
                raster.stamp(doc, buf, x, Math.round(cy - e), size, c); raster.stamp(doc, buf, x, Math.round(cy + e), size, c);
            }
            for (let y = y0; y <= y1; y++) {
                const d = (y - cy) / ry; if (Math.abs(d) > 1) continue;
                const e = rx * Math.sqrt(1 - d * d);
                raster.stamp(doc, buf, Math.round(cx - e), y, size, c); raster.stamp(doc, buf, Math.round(cx + e), y, size, c);
            }
        },
        // Filled: each row between its two x-solutions.
        ellipsefill(doc, buf, a, b, size, c) {
            const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
            const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
            if (rx < 0.5 || ry < 0.5) return raster.ellipse(doc, buf, a, b, size, c);
            for (let y = y0; y <= y1; y++) {
                const d = (y - cy) / ry; if (Math.abs(d) > 1) continue;
                const e = rx * Math.sqrt(1 - d * d);
                for (let x = Math.round(cx - e); x <= Math.round(cx + e); x++) raster.stamp(doc, buf, x, y, size, c);
            }
        },
        fill(doc, buf, x, y, c) {
            const t = doc.get(buf, x, y);
            if (eqRgba(t, c)) return;
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
        /** A w×h block out of a buffer. */
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
       The file: a PNG strip, plus fps and palette in a tEXt chunk.
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

        /** Walk the chunks: [{ type, start, data }]. */
        function chunks(bytes) {
            if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const out = [];
            for (let p = 8; p + 12 <= bytes.length;) {
                const len = view.getUint32(p);
                const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
                const end = p + 12 + len;
                if (end > bytes.length) break;
                out.push({ type, start: p, data: bytes.subarray(p + 8, p + 8 + len) });
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
                    if (String.fromCharCode(...c.data.subarray(0, zero)) === CHUNK_KEY) {
                        return String.fromCharCode(...c.data.subarray(zero + 1));
                    }
                }
                return null;
            },
            /** The same PNG with our tEXt chunk inserted before IEND. `text` must be ASCII. */
            withText(bytes, text) {
                const iend = (chunks(bytes) || []).find((c) => c.type === "IEND");
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

    /** Encode a sprite as a PNG strip carrying fps + palette. */
    async function encodeDoc(doc, bufOf) {
        const n = doc.frames.length, strip = canvasOf(doc.w * n, doc.h), g = strip.getContext("2d");
        for (let f = 0; f < n; f++) g.putImageData(doc.image(f, bufOf(f)), f * doc.w, 0);
        const meta = { v: 1, w: doc.w, h: doc.h, frames: n, fps: doc.fps, palette: doc.palette };
        const bytes = new Uint8Array(await (await toBlob(strip)).arrayBuffer());
        return new Blob([png.withText(bytes, JSON.stringify(meta))], { type: "image/png" });
    }

    /**
     * Read a file → { g, width, height, meta } — the pixels as a 2D context,
     * plus our chunk's data when it fits the picture (else meta is null).
     */
    async function decodeFile(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const bmp = await createImageBitmap(file);
        const c = canvasOf(bmp.width, bmp.height), g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        let meta = null;
        try { const t = png.readText(bytes); meta = t && JSON.parse(t); } catch { meta = null; }
        if (!(meta && meta.v === 1 && meta.w * meta.frames === bmp.width && meta.h === bmp.height)) meta = null;
        return { g, width: bmp.width, height: bmp.height, meta };
    }

    function docFromStrip(res, n) {
        const fw = res.width / n, doc = new SpriteDoc(fw, res.height);
        for (let f = 0; f < n; f++) doc.frames.push(new Uint8ClampedArray(res.g.getImageData(f * fw, 0, fw, res.height).data));
        const m = res.meta;
        if (m) {
            if (Number.isFinite(m.fps)) doc.fps = clamp(Math.round(m.fps), 1, 30);
            if (Array.isArray(m.palette)) {
                const pal = m.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c));
                if (pal.length) doc.palette = pal;
            }
        }
        return doc;
    }

    function blankDoc(w, h, frames) {
        const doc = new SpriteDoc(w, h);
        for (let f = 0; f < frames; f++) doc.frames.push(doc.blank());
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
    <div slot="toolbar" class="toolbar">
        <button type="button" class="nav-icon-btn pa-toggle active" data-win="tools" title="Tools"><sac-icon name="pencil"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-toggle active" data-win="selection" title="Selection"><sac-icon name="marquee"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-toggle active" data-win="palette" title="Palette"><sac-icon name="palette"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-toggle active" data-win="preview" title="Preview"><sac-icon name="eye"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-undo" title="Undo (Ctrl+Z)"><sac-icon name="undo"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-redo" title="Redo (Ctrl+Y)"><sac-icon name="redo"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-zout" title="Zoom out (−)"><sac-icon name="zoom-out"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-fit" title="Fit"><sac-icon name="fit"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-zin" title="Zoom in (+)"><sac-icon name="zoom-in"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-new" title="New sprite…"><sac-icon name="plus"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-open" title="Open… (Ctrl+O)"><sac-icon name="folder"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-save" title="Save (Ctrl+S)"><sac-icon name="save"></sac-icon></button>
        <button type="button" class="nav-icon-btn pa-keys" title="Keyboard shortcuts (?)"><sac-icon name="keyboard"></sac-icon></button>
        <sac-menu class="pa-menu">
            <button slot="trigger" type="button" class="nav-icon-btn" title="More"><sac-icon name="more"></sac-icon></button>
            <button data-action="save-as"><sac-icon name="save"></sac-icon> Save as…</button>
            <button data-action="revert" data-danger><sac-icon name="undo"></sac-icon> Revert to saved</button>
        </sac-menu>
    </div>
</sac-nav>

<div class="pa-root">
    <div class="pa-body">
        <sac-pixel-canvas class="pa-canvas"></sac-pixel-canvas>
        <sac-hud class="pa-hud" position="bottom-left"><span class="pa-meta"></span><span class="pa-coords"></span></sac-hud>

        <sac-window class="pa-win" data-win="tools" title="Tools"
                    width="252px" height="auto" controls="close" open>
            <div class="pa-winbody">
                <sac-toolbox class="pa-tools" columns="auto" group="Tools" value="pencil"></sac-toolbox>
                <div class="pa-row"><span class="pa-lbl">Brush</span>
                    <sac-segmented-control class="pa-brush" value="1">
                        <button data-value="1">1</button><button data-value="2">2</button><button data-value="3">3</button><button data-value="4">4</button>
                    </sac-segmented-control></div>
            </div>
        </sac-window>

        <sac-window class="pa-win" data-win="selection" title="Selection"
                    width="252px" height="auto" controls="close" open>
            <div class="pa-winbody">
                <div class="pa-icons">
                    <button type="button" class="icon-btn pa-fliph" title="Flip horizontal (Shift+H)"><sac-icon name="flip-h"></sac-icon></button>
                    <button type="button" class="icon-btn pa-flipv" title="Flip vertical (Shift+V)"><sac-icon name="flip-v"></sac-icon></button>
                    <button type="button" class="icon-btn pa-copyb" title="Copy (Ctrl+C)"><sac-icon name="copy"></sac-icon></button>
                    <button type="button" class="icon-btn pa-cutb" title="Cut (Ctrl+X)"><sac-icon name="scissors"></sac-icon></button>
                    <button type="button" class="icon-btn pa-pasteb" title="Paste in place (Ctrl+V)"><sac-icon name="paste"></sac-icon></button>
                    <button type="button" class="icon-btn pa-trimb" title="Trim the selection to its object"><sac-icon name="crop"></sac-icon></button>
                </div>
            </div>
        </sac-window>

        <sac-window class="pa-win" data-win="palette" title="Palette"
                    width="232px" height="auto" controls="close" open>
            <div class="pa-winbody">
                <sac-segmented-control class="pa-palmode" value="all">
                    <button data-value="all">All</button>
                    <button data-value="used">Used</button>
                </sac-segmented-control>
                <sac-swatch-grid class="pa-palette" columns="6" selectable></sac-swatch-grid>
            </div>
        </sac-window>

        <sac-window class="pa-win" data-win="preview" title="Preview"
                    width="280px" height="auto" controls="close" open>
            <div class="pa-winbody">
                <div class="pa-pvstage"><sac-pixel-canvas class="pa-pv" static zoom="3"></sac-pixel-canvas></div>
                <div class="pa-row pa-pvrow">
                    <button type="button" class="icon-btn pa-pvplay" title="Play"><sac-icon name="play"></sac-icon></button>
                    <sac-segmented-control class="pa-pvzoom" value="3">
                        <button data-value="1">1×</button><button data-value="2">2×</button><button data-value="3">3×</button><button data-value="4">4×</button><button data-value="5">5×</button>
                    </sac-segmented-control>
                </div>
            </div>
        </sac-window>
    </div>

    <sac-filmstrip class="pa-film" actions reorderable pixelated value="0">
        <div slot="controls" class="pa-film-ctrl">
            <button type="button" class="icon-btn pa-play" title="Play"><sac-icon name="play"></sac-icon></button>
            <button type="button" class="icon-btn pa-onion active" title="Onion skin (O)"><sac-icon name="onion"></sac-icon></button>
        </div>
    </sac-filmstrip>
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
            this.$palette = $(".pa-palette");
            this.$film = $(".pa-film");

            this.tool = "pencil";
            this.brush = 1;
            this.color = hexToRgba(DEFAULT_PALETTE[0]);
            this.onion = true;
            this.palMode = "all";
            this.pvZoom = 3;
            this.clip = null;
            this._pvWanted = true;
            this._visible = false;
            this._offs = [];

            this.$tools.tools = TOOLS;
            this._wire();
            this._load(blankDoc(32, 32, 1), null, null);
            this._setTool("pencil");
            this._setBrush(1);
            this._restore();   // async: the last session, if there is one

            // The Atelier's places: tools top-left, palette top-right,
            // preview bottom-right of the canvas.
            requestAnimationFrame(() => this._placeWindows());

            this._io = new IntersectionObserver((es) => this._setVisible(es[es.length - 1].isIntersecting));
            this._io.observe(this);
        }

        onUnmount() {
            this._setVisible(false);
            this._io?.disconnect();
            clearTimeout(this._autosaveT);
        }

        /** Hotkeys are global, so they exist only while the app is looked at. */
        _setVisible(v) {
            if (v === this._visible) return;
            this._visible = v;
            if (v) {
                this.$tools.setAttribute("hotkeys", "");
                this._bindKeys();
                if (this._pvWanted) this._pvStart();
            } else {
                this.$tools.removeAttribute("hotkeys");
                this._offs.forEach((off) => off());
                this._offs = [];
                this._stopPlay();
                this._pvStop(true);
            }
        }

        _bindKeys() {
            const k = (combo, fn, description, group) =>
                this._offs.push(sac.hotkeys.register(combo, fn, { description, group }));
            k("mod+z", () => this._undo(), "Undo", "Edit");
            k("mod+shift+z", () => this._redo(), "Redo", "Edit");
            k("mod+y", () => this._redo(), "Redo", "Edit");
            k("mod+s", () => this._save(false), "Save", "File");
            k("mod+shift+s", () => this._save(true), "Save as…", "File");
            k("mod+o", () => this._open(), "Open…", "File");
            k("mod+a", () => this._selectAllFrame(), "Select the whole frame", "Selection");
            k("shift+h", () => this._flip("h"), "Flip horizontal", "Selection");
            k("shift+v", () => this._flip("v"), "Flip vertical", "Selection");
            k("escape", () => this._escape(), "Drop the selection", "Selection");
            k("delete", () => this._deleteSel(), "Clear the selection", "Selection");
            k("backspace", () => this._deleteSel(), "", "Selection");
            k("plus", () => this.$canvas.zoomIn(), "Zoom in", "View");
            k("=", () => this.$canvas.zoomIn(), "", "View");
            k("-", () => this.$canvas.zoomOut(), "Zoom out", "View");
            k("[", () => this._setBrush(this.brush - 1), "Smaller brush", "Tools");
            k("]", () => this._setBrush(this.brush + 1), "Bigger brush", "Tools");
            // Arrows: nudge a selection, else step through the frames.
            k("up", () => this._nudge(0, -1), "Nudge the selection", "Selection");
            k("down", () => this._nudge(0, 1), "", "Selection");
            k("left", () => this.sel ? this._nudge(-1, 0) : this._setFrame(this.frame - 1), "Previous frame", "Frames");
            k("right", () => this.sel ? this._nudge(1, 0) : this._setFrame(this.frame + 1), "Next frame", "Frames");
            for (let n = 1; n <= 10; n++) {
                k(String(n % 10), () => { if (n - 1 < this.doc.frames.length) this._setFrame(n - 1); }, n === 1 ? "Frame 1 … 10" : "", "Frames");
            }
            k("o", () => this._toggleOnion(), "Onion skin", "Frames");
            this._offs.push(sac.shortcuts.bind());
            this._offs.push(sac.shortcuts.add([
                { group: "View", keys: "Space + drag", description: "Pan" },
                { group: "View", keys: ["Middle-drag"], description: "Pan" },
                { group: "View", keys: ["Wheel"], description: "Zoom at the cursor" },
                { group: "Tools", keys: ["Alt", "click"], description: "Pick a color with any tool" },
                { group: "Tools", keys: ["Shift", "click"], description: "Pencil / eraser: line from the last point" },
                { group: "Selection", keys: ["Ctrl", "C"], description: "Copy" },
                { group: "Selection", keys: ["Ctrl", "X"], description: "Cut" },
                { group: "Selection", keys: ["Ctrl", "V"], description: "Paste in place, also images from other apps" },
            ]));
            // Clipboard through the native events, not hotkeys: those would
            // swallow Ctrl+C in every text field of the page.
            const clip = (type, fn) => {
                const h = (e) => { if (!isEditable(e.composedPath()[0])) fn(e); };
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
            on(".pa-undo", "click", () => this._undo());
            on(".pa-redo", "click", () => this._redo());
            on(".pa-zin", "click", () => this.$canvas.zoomIn());
            on(".pa-zout", "click", () => this.$canvas.zoomOut());
            on(".pa-fit", "click", () => this.$canvas.fit());
            on(".pa-new", "click", () => this._new());
            on(".pa-open", "click", () => this._open());
            on(".pa-save", "click", () => this._save(false));
            on(".pa-menu", "sac:select", (e) => {
                if (e.detail.action === "save-as") this._save(true);
                if (e.detail.action === "revert") this._revert();
            });

            for (const b of this.querySelectorAll(".pa-toggle")) {
                b.addEventListener("click", () => this._showWin(b.dataset.win, !this._win(b.dataset.win).hasAttribute("open")));
            }
            for (const w of this.querySelectorAll(".pa-win")) {
                w.addEventListener("sac:close", (e) => { if (e.target === w) { this._syncToggle(w.dataset.win); this._saveSettings(); } });
            }

            this.$tools.addEventListener("sac:change", (e) => this._setTool(e.detail.value));
            on(".pa-brush", "sac:change", (e) => this._setBrush(Number(e.detail.value)));
            on(".pa-fliph", "click", () => this._flip("h"));
            on(".pa-flipv", "click", () => this._flip("v"));
            on(".pa-copyb", "click", () => this._copy());
            on(".pa-cutb", "click", () => this._cut());
            on(".pa-pasteb", "click", () => this._paste());
            on(".pa-trimb", "click", () => this._trimSel());

            this.$palette.addEventListener("sac:change", (e) => this._setColor(hexToRgba(e.detail.value), "palette"));
            on(".pa-palmode", "sac:change", (e) => { this.palMode = e.detail.value; this._buildPalette(); this._saveSettings(); });

            on(".pa-pvplay", "click", () => this._pvToggle());
            on(".pa-pvzoom", "sac:change", (e) => this._setPvZoom(Number(e.detail.value)));

            on(".pa-play", "click", () => this._togglePlay());
            on(".pa-keys", "click", () => sac.shortcuts.show({ title: "Pixel Atelier shortcuts" }));
            const FRAME_ACTIONS = { add: () => this._addFrame(), duplicate: () => this._dupFrame(), delete: () => this._deleteFrame() };
            this.$film.addEventListener("sac:change", (e) => this._setFrame(e.detail.index));
            this.$film.addEventListener("sac:action", (e) => FRAME_ACTIONS[e.detail.action]?.());
            this.$film.addEventListener("sac:reorder", (e) => this._moveFrame(e.detail.from, e.detail.to));
            on(".pa-onion", "click", () => this._toggleOnion());

            // Canvas: the kit reports cells, the tools below do the pixels.
            const c = this.$canvas;
            c.addEventListener("sac:pixel-down", (e) => this._down(e.detail));
            c.addEventListener("sac:pixel-move", (e) => this._drag(e.detail));
            c.addEventListener("sac:pixel-up", () => this._up());
            c.addEventListener("sac:pixel-cancel", () => this._cancel());
            c.addEventListener("sac:pixel-hover", (e) => this._hover(e.detail));
            c.addEventListener("sac:zoom", () => this._syncMeta());
            // The Atelier's right-click menu waits on the kit (a <sac-menu>
            // that opens at a point); until then the browser menu stays off.
            c.addEventListener("contextmenu", (e) => e.preventDefault());
        }

        /* ---------------------------------------------- floating windows -- */

        _win(name) { return this.querySelector(`.pa-win[data-win="${name}"]`); }
        _showWin(name, on) {
            const w = this._win(name);
            if (on) { w.open(); w.bringToFront(); } else w.close();
            this._syncToggle(name);
            this._saveSettings();
        }
        _syncToggle(name) {
            const open = this._win(name).hasAttribute("open");
            this.querySelector(`.pa-toggle[data-win="${name}"]`).classList.toggle("active", open);
            if (name === "preview") {
                if (open && this._pvWanted) this._pvStart(); else this._pvStop(true);
                this._renderPreview();
            }
        }
        /** First placement: tools and selection top-left, palette top-right, preview bottom-right of the canvas area. */
        _placeWindows() {
            // The nav ribbon is fixed and overlays the top of the body.
            const r = this.querySelector(".pa-body").getBoundingClientRect(), pad = 14;
            const top = Math.max(r.top, this.querySelector("sac-nav").getBoundingClientRect().bottom);
            const put = (name, left, top) => {
                const w = this._win(name);
                w.setAttribute("left", Math.round(left) + "px");
                w.setAttribute("top", Math.round(top) + "px");
            };
            const pw = this._win("palette").offsetWidth || 232, vw = this._win("preview").offsetWidth || 280;
            const ph = this._win("preview").offsetHeight || 220;
            put("tools", r.left + pad, top + pad);
            put("selection", r.left + pad, top + pad + (this._win("tools").offsetHeight || 160) + pad);
            put("palette", r.right - pw - pad, top + pad);
            put("preview", r.right - vw - pad, Math.max(top + pad, r.bottom - ph - pad));
        }

        /* ---------------------------------------------------- document ---- */

        /** Take a sprite in: every piece of per-document state starts over. */
        _load(doc, file, savedBlob) {
            this._stopPlay();
            this.doc = doc;
            this.frame = 0;
            this.sel = null; this.float = null;
            this.undo = []; this.redo = [];
            this._stroke = null; this._lastPaint = null;
            this.file = file;
            this.savedBlob = savedBlob;
            this._dirty = false;
            this._ctx.setDirty?.(false);
            this.$canvas.selection = null;
            this._buildPalette();
            this._buildFilm();
            this._render();
            this.$canvas.fit();
            this._syncMeta();
            if (this._pvTimer) { this._pvStop(true); this._pvStart(); }
        }

        _buf() { return this.doc.frames[this.frame]; }
        _paintColor() { return this.tool === "eraser" ? [0, 0, 0, 0] : this.color; }
        /** Frame buffers as they will be saved: a floating selection baked in (on a copy). */
        _bufOf() {
            const f = this.float;
            return (fi) => {
                const buf = this.doc.frames[fi];
                if (!f || f.frame !== fi) return buf;
                const out = buf.slice();
                raster.paste(this.doc, out, f);
                return out;
            };
        }

        /* ------------------------------------------------------- tools ---- */

        _down(c) {
            if (this._playing) return;
            if (c.button === 2) return;
            // Alt+click or the eyedropper: pick what you SEE.
            if (c.altKey || this.tool === "pick") { this._picking = true; this._pickAt(c); return; }
            if (this.tool === "select") { this._selDown(c); return; }
            if (c.button !== 0 || (!c.inside && this.tool === "fill")) return;
            this._pushUndo();
            const buf = this._buf(), col = this._paintColor();
            this._stroke = { start: c, last: c, base: buf.slice() };
            if (SHAPES.has(this.tool)) raster[this.tool](this.doc, buf, c, c, this.brush, col);
            else if (this.tool === "fill") raster.fill(this.doc, buf, c.x, c.y, col);
            else if (c.shiftKey && this._lastPaint) raster.line(this.doc, buf, this._lastPaint, c, this.brush, col);
            else raster.stamp(this.doc, buf, c.x, c.y, this.brush, col);
            this._render();
        }

        _drag(c) {
            this._hover(c);
            if (this._picking) { this._pickAt(c); return; }
            if (this._selStart) { this._selDrag(c); return; }
            if (this._moving) { this._dragMove(c); return; }
            const s = this._stroke;
            if (!s || this.tool === "fill") return;
            const buf = this._buf(), col = this._paintColor();
            if (SHAPES.has(this.tool)) { buf.set(s.base); raster[this.tool](this.doc, buf, s.start, c, this.brush, col); }
            else raster.line(this.doc, buf, s.last, c, this.brush, col);   // fast strokes skip cells
            s.last = c;
            this._render();
        }

        _up() {
            this._picking = false;
            if (this._selStart) { this._selStart = null; return; }
            if (this._moving) { this._moving = null; this._refreshAfterEdit(); return; }
            if (!this._stroke) return;
            this._lastPaint = this._stroke.last;
            this._stroke = null;
            this._refreshAfterEdit();
        }

        /** A second finger turned the stroke into a pinch: roll it back. */
        _cancel() {
            if (this._stroke) { this._buf().set(this._stroke.base); this.undo.pop(); this._stroke = null; this._render(); }
            if (this._moving) { this._dragMove(this._moving.start); this._moving = null; }
            this._picking = false; this._selStart = null;
        }

        _pickAt(c) {
            if (!c.inside) return;
            const d = this._bufOf()(this.frame), i = (c.y * this.doc.w + c.x) * 4;
            this._setColor([d[i], d[i + 1], d[i + 2], d[i + 3]]);
        }

        _setTool(t) {
            if (t !== "select" && this.sel) this._clearSel();
            this.tool = t;
            this.$tools.value = t;
            this.$canvas.style.cursor = t === "pick" ? "copy" : "";
            this._syncBrushBox();
            this._saveSettings();
        }
        _setBrush(n) {
            this.brush = clamp(n || 1, 1, 4);
            this.querySelector(".pa-brush").value = String(this.brush);
            this._syncBrushBox();
            this._saveSettings();
        }
        /** The hover box shows what a click will touch. */
        _syncBrushBox() { this.$canvas.setAttribute("brush", String(BRUSHED.has(this.tool) ? this.brush : 1)); }

        _setColor(c, from) { this.color = c; this._markSwatch(from); }
        _markSwatch(from) {
            const hex = rgbaToHex(this.color);
            if (from !== "palette") for (const s of this.$palette.querySelectorAll("sac-swatch")) s.selected = s.value === hex;
        }

        /* --------------------------------------------------- selection ----
           A rectangular marquee whose contents FLOAT once touched: lifted out
           of the frame (the undo point), dragged or nudged freely, and baked
           back in only on commit — click outside, Esc, tool switch, frame
           switch, save, a new paste. Paste lands in place, frame-local. */

        _setSel(s) { this.sel = s; this.$canvas.selection = s; }
        _inSel(c) { const s = this.sel; return !!s && c.x >= s.x && c.x < s.x + s.w && c.y >= s.y && c.y < s.y + s.h; }

        _selDown(c) {
            if (this._inSel(c)) {                                  // pick up / keep moving the selection
                if (!this.float) this._lift();
                this._moving = { start: c, ox: this.float.x, oy: this.float.y };
                return;
            }
            this._commitFloat();                                   // start a new marquee
            const x = clamp(c.x, 0, this.doc.w - 1), y = clamp(c.y, 0, this.doc.h - 1);
            this._selStart = { x, y };
            this._setSel({ x, y, w: 1, h: 1 });
            this._render();
        }
        _selDrag(c) {
            const a = this._selStart, W = this.doc.w, H = this.doc.h;
            const x0 = clamp(Math.min(a.x, c.x), 0, W - 1), x1 = clamp(Math.max(a.x, c.x), 0, W - 1);
            const y0 = clamp(Math.min(a.y, c.y), 0, H - 1), y1 = clamp(Math.max(a.y, c.y), 0, H - 1);
            this._setSel({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
        }
        _dragMove(c) {
            const m = this._moving;
            this.float.x = m.ox + (c.x - m.start.x);
            this.float.y = m.oy + (c.y - m.start.y);
            this._setSel({ x: this.float.x, y: this.float.y, w: this.float.w, h: this.float.h });
            this._render();
        }
        _lift() {                                                  // cut the selection into a floating layer (the undo point)
            this._pushUndo();
            const s = this.sel, buf = this._buf();
            this.float = { data: raster.copy(this.doc, buf, s), w: s.w, h: s.h, x: s.x, y: s.y, frame: this.frame };
            raster.clear(this.doc, buf, s);
        }
        _commitFloat() {                                           // bake the float's opaque pixels in, clipped to the frame
            const f = this.float;
            if (!f) return;
            this.float = null;
            if (this.doc.frames[f.frame]) raster.paste(this.doc, this.doc.frames[f.frame], f);
            this._refreshAfterEdit();
        }
        _nudge(dx, dy) {                                           // arrow-key move of the floating selection (no bake)
            if (!this.sel) return;
            if (!this.float) this._lift();
            this.float.x += dx; this.float.y += dy;
            this._setSel({ x: this.float.x, y: this.float.y, w: this.float.w, h: this.float.h });
            this._render();
            this._touch();
        }
        _deleteSel() {                                             // Del: drop floating content, or clear the selected pixels
            if (!this.sel) return;
            if (this.float) { this.float = null; this._refreshAfterEdit(); return; }
            this._pushUndo();
            raster.clear(this.doc, this._buf(), this.sel);
            this._refreshAfterEdit();
        }
        _clearSel() { this._commitFloat(); this._setSel(null); this._selStart = null; this._moving = null; this._render(); }
        _escape() { if (this.sel) this._clearSel(); }

        /* ---- flip / trim / clipboard ------------------------------------ */

        _flip(dir) {
            if (this.sel && !this.float) this._lift();             // a selection flips as a FLOATING object → underground stays intact
            if (this.float) {
                raster.flip(this.float.data, this.float.w, this.float.h, dir);
                this._render();
                this._touch();
                return;
            }
            this._pushUndo();                                      // no selection → flip the whole frame in place
            raster.flip(this._buf(), this.doc.w, this.doc.h, dir);
            this._refreshAfterEdit();
        }
        _trimSel() {                                               // shrink the selection to opaque content ("only the object")
            if (!this.sel) return;
            this._commitFloat();
            const s = this.sel, buf = this._buf();
            let minx = Infinity, miny = Infinity, maxx = -1, maxy = -1;
            for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
                if (!this.doc.inside(x, y) || !buf[(y * this.doc.w + x) * 4 + 3]) continue;
                minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
            }
            this._setSel(maxx < 0 ? null : { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 });
            this._render();
        }
        _selectAllFrame() {
            this._commitFloat();
            this._setTool("select");
            this._setSel({ x: 0, y: 0, w: this.doc.w, h: this.doc.h });
            this._render();
        }
        /** Copy selection or float (frame-local, non-destructive). → true when something was copied. */
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
            if (!this.sel || !this._copy()) return false;
            this._deleteSel();
            this._setSel(null);
            this._render();
            return true;
        }
        /** Paste as a NEW floating selection, IN PLACE (same spot in the frame), clamped inside. */
        _paste(clip = this.clip) {
            if (!clip) return;
            this._commitFloat();
            const x = clamp(clip.x || 0, 0, Math.max(0, this.doc.w - clip.w));
            const y = clamp(clip.y || 0, 0, Math.max(0, this.doc.h - clip.h));
            this._pushUndo();
            this.float = { data: clip.data.slice(), w: clip.w, h: clip.h, x, y, frame: this.frame };
            this._setTool("select");
            this._setSel({ x, y, w: clip.w, h: clip.h });
            this._render();
            this._touch();
            this._toast("Pasted — drag it or use the arrows to place it");
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
                const res = await decodeFile(image);
                const w = Math.min(res.width, this.doc.w), h = Math.min(res.height, this.doc.h);
                this._paste({ data: new Uint8ClampedArray(res.g.getImageData(0, 0, w, h).data), w, h, x: 0, y: 0 });
            } catch { this._toast("The image could not be read"); }
        }

        /* ---------------------------------------------------- frames ------ */

        _setFrame(i) {
            this._clearSel();
            this._stopPlay();
            const n = this.doc.frames.length;
            this.frame = ((i % n) + n) % n;
            this._render();
            this._syncFilm();
            this._hover(null);
        }
        /** Rebuild the frame list from old indices (null = a blank frame), then show `frame`. */
        _applyFrames(list, frame, toast) {
            this._clearSel();
            this._pushUndo();
            this.doc.frames = list.map((s) => s == null ? this.doc.blank() : this.doc.frames[s].slice());
            this.frame = clamp(frame, 0, this.doc.frames.length - 1);
            this._buildFilm();
            this._refreshAfterEdit();
            this._toast(toast);
        }
        _addFrame() {
            if (this.doc.frames.length >= MAX_FRAMES) return;
            const l = [...this.doc.frames.keys(), null];
            this._applyFrames(l, l.length - 1, "Frame added");
        }
        _dupFrame() {
            if (this.doc.frames.length >= MAX_FRAMES) return;
            const l = [...this.doc.frames.keys()];
            l.splice(this.frame + 1, 0, this.frame);
            this._applyFrames(l, this.frame + 1, "Frame duplicated");
        }
        _deleteFrame() {
            if (this.doc.frames.length <= 1) return;
            const l = [...this.doc.frames.keys()];
            l.splice(this.frame, 1);
            this._applyFrames(l, this.frame, "Frame deleted");
        }
        _toggleOnion() {
            this.onion = !this.onion;
            this.querySelector(".pa-onion").classList.toggle("active", this.onion);
            this._render();
            this._saveSettings();
        }
        _togglePlay() {
            if (this._playing) return this._stopPlay();
            if (this.doc.frames.length < 2) return;
            this._clearSel();
            this._playing = true;
            this._playIcon(".pa-play", true);
            this._playTimer = setInterval(() => {
                this.frame = (this.frame + 1) % this.doc.frames.length;
                this._render();
                this._syncFilm();
            }, 1000 / this.doc.fps);
        }
        _stopPlay() {
            if (!this._playing) return;
            clearInterval(this._playTimer);
            this._playTimer = null;
            this._playing = false;
            this._playIcon(".pa-play", false);
            this._render();
        }
        _playIcon(sel, on) {
            const b = this.querySelector(sel);
            b.querySelector("sac-icon").setAttribute("name", on ? "pause" : "play");
            b.title = on ? "Pause" : "Play";
        }
        /** Move a frame (the filmstrip has already moved its thumbnail). */
        _moveFrame(from, to) {
            this._clearSel();
            this._pushUndo();
            const [f] = this.doc.frames.splice(from, 1);
            this.doc.frames.splice(to, 0, f);
            this.frame = to;
            this._buildFilm();
            this._refreshAfterEdit();
        }
        /** One thumbnail canvas per frame; the strip holds them by reference. */
        _buildFilm() {
            this._thumbs = this.doc.frames.map(() => canvasOf(this.doc.w, this.doc.h));
            this._thumbs.forEach((c, i) => c.getContext("2d").putImageData(this.doc.image(i), 0, 0));
            this.$film.frames = this._thumbs;
            this._syncFilm();
        }
        _syncFilm() {
            this.$film.value = this.frame;
            this._syncMeta();
        }

        /* ----------------------------------------------------- preview ----
           Edit big, watch small: the preview loops the animation on its own
           clock while you paint. */

        _renderPreview() {
            if (!this._win("preview").hasAttribute("open")) return;
            const f = this._pvTimer ? this._pvFrame : this.frame;
            this.$pv.image = this.doc.image(f, this._bufOf()(f));
        }
        _pvStart() {
            this._pvWanted = true;
            this._pvIcon();
            if (this._pvTimer || this.doc.frames.length < 2 || !this._visible || !this._win("preview").hasAttribute("open")) return;
            this._pvFrame = this.frame;
            this._pvTimer = setInterval(() => {
                this._pvFrame = (this._pvFrame + 1) % this.doc.frames.length;
                this._renderPreview();
            }, 1000 / this.doc.fps);
        }
        /** `keepWish`: paused by the app (hidden, closed, reloaded), not by the user. */
        _pvStop(keepWish) {
            if (!keepWish) this._pvWanted = false;
            clearInterval(this._pvTimer);
            this._pvTimer = null;
            this._pvIcon();
        }
        _pvToggle() {
            if (this._pvWanted) this._pvStop(); else this._pvStart();
            this._renderPreview();
            this._saveSettings();
        }
        _pvIcon() { this._playIcon(".pa-pvplay", !!this._pvWanted && this.doc && this.doc.frames.length > 1); }
        _setPvZoom(z) {
            this.pvZoom = clamp(z, 1, 5);
            this.querySelector(".pa-pvzoom").value = String(this.pvZoom);
            this.$pv.setAttribute("zoom", String(this.pvZoom));
            this._saveSettings();
        }

        /* ---------------------------------------------------- palette ----- */

        _buildPalette() {
            const colors = this.palMode === "used" ? this.doc.usedColors() : this.doc.palette;
            this.$palette.colors = [{ value: "transparent", label: "Transparent (eraser color)" },
                ...colors.map((value) => ({ value }))];
            this.querySelector(".pa-palmode").value = this.palMode;
            this._markSwatch();
        }

        /* ---------------------------------------------------- refresh ----- */

        _render() {
            const n = this.doc.frames.length, f = this.float;
            const under = [];
            if (this.onion && !this._playing && n > 1) {
                // Onion respects the LOOP: previous + next neighbour, wrapping —
                // the last frame shows the first behind it (and frame 0 the last).
                const bufOf = this._bufOf(), prev = (this.frame - 1 + n) % n, next = (this.frame + 1) % n;
                for (const i of new Set([prev, next])) under.push({ image: this.doc.image(i, bufOf(i)), opacity: 0.3 });
            }
            this.$canvas.underlays = under;
            this.$canvas.overlays = f && f.frame === this.frame ? [{ image: new ImageData(f.data.slice(), f.w, f.h), x: f.x, y: f.y }] : [];
            this.$canvas.image = this.doc.image(this.frame);
            // Only the thumbnail of the frame being painted changes.
            const thumb = this._thumbs && this._thumbs[this.frame];
            if (thumb && !this._playing) {
                thumb.getContext("2d").putImageData(this.doc.image(this.frame, this._bufOf()(this.frame)), 0, 0);
                this.$film.refresh(this.frame);
            }
            if (!this._pvTimer) this._renderPreview();
        }
        /** After an edit is finished: palette "used", meta, autosave. */
        _refreshAfterEdit() {
            this._render();
            if (this.palMode === "used") this._buildPalette();
            this._syncMeta();
            this._touch();
        }
        _hover(c) {
            this.querySelector(".pa-coords").textContent =
                c && c.inside ? ` · ${c.x}, ${c.y}` + (this.doc.frames.length > 1 ? ` · f${this.frame}` : "") : "";
        }
        /** The canvas overlay: the file's name (once it has one), size, frames, zoom; • = unsaved. */
        _syncMeta() {
            const d = this.doc, n = d.frames.length;
            const parts = [this.file && this.file.name, `${d.w}×${d.h}`, n > 1 && `${n} frames`, `${this.$canvas.zoom}×`];
            this.querySelector(".pa-meta").textContent = parts.filter(Boolean).join(" · ") + (this._dirty ? " •" : "");
        }
        _toast(msg) { if (window.sac && sac.toast) sac.toast(msg); }

        /* ---------------------------------------------------- history ----- */

        _pushUndo() {
            this.undo.push(this.doc.snapshot());
            if (this.undo.length > UNDO_LIMIT) this.undo.shift();
            this.redo.length = 0;
            this._setDirty(true);
        }
        _undo() { this._commitFloat(); if (!this.undo.length) return; this.redo.push(this.doc.snapshot()); this._history(this.undo.pop()); }
        _redo() { this._commitFloat(); if (!this.redo.length) return; this.undo.push(this.doc.snapshot()); this._history(this.redo.pop()); }
        _history(s) {
            this.doc.restore(s);
            if (this.frame >= this.doc.frames.length) this.frame = this.doc.frames.length - 1;
            this.float = null;
            this._setSel(null);
            this._setDirty(true);
            this._buildFilm();
            this._refreshAfterEdit();
        }

        /* ------------------------------------------ dirty + autosave ------ */

        _setDirty(on) {
            if (on === this._dirty) return;
            this._dirty = on;
            this._ctx.setDirty?.(on);
            this._syncMeta();
        }
        /** The sprite changed: autosave into the app's own drawer, soon. */
        _touch() {
            clearTimeout(this._autosaveT);
            this._autosaveT = setTimeout(() => this._autosave(), AUTOSAVE_MS);
        }
        async _autosave() {
            const fs = this._ctx.fs;
            if (!fs) return;
            try {
                await fs.write("autosave.png", await encodeDoc(this.doc, this._bufOf()));
                await fs.write("session", { name: this.file ? this.file.name : null, dirty: !!this._dirty });
            } catch (err) { console.warn("[pixel-atelier] autosave failed:", err); }
        }
        _saveSettings() {
            const fs = this._ctx && this._ctx.fs;
            if (!fs || this._restoring) return;
            const wins = {};
            for (const w of this.querySelectorAll(".pa-win")) wins[w.dataset.win] = w.hasAttribute("open");
            fs.write("settings", {
                tool: this.tool, brush: this.brush, onion: this.onion, palMode: this.palMode,
                pvZoom: this.pvZoom, pvPlaying: !!this._pvWanted, wins,
            }).catch(() => {});
        }

        /** Bring back the last session: settings, and the sprite as it was left. */
        async _restore() {
            const fs = this._ctx.fs;
            if (!fs) return;
            this._restoring = true;
            try {
                const s = await fs.read("settings", null);
                if (s) {
                    if (s.onion === false) this._toggleOnion();
                    if (s.palMode === "used") { this.palMode = "used"; this._buildPalette(); }
                    if (s.pvZoom) this._setPvZoom(s.pvZoom);
                    if (s.brush) this._setBrush(s.brush);
                    if (TOOLS.some((t) => t.id === s.tool)) this._setTool(s.tool);
                    for (const [name, open] of Object.entries(s.wins || {})) if (!open && this._win(name)) this._showWin(name, false);
                    if (s.pvPlaying === false) this._pvStop();
                }
                const session = await fs.read("session", null);
                const blob = session && await fs.read("autosave.png", null);
                if (blob instanceof Blob && !this.undo.length) {
                    const res = await decodeFile(blob);
                    if (res.meta) {
                        this._load(docFromStrip(res, res.meta.frames), session.name ? { name: session.name, handle: null } : null, null);
                        if (session.dirty) { this._setDirty(true); this._toast("Unsaved work restored"); }
                    }
                }
            } catch (err) {
                console.warn("[pixel-atelier] could not restore the last session:", err);
            } finally {
                this._restoring = false;
            }
        }

        /* ------------------------------------------------- open / save ---- */

        /** Unsaved work? Ask before throwing it away. → true to go on. */
        async _discardOk() {
            if (!this._dirty) return true;
            const a = await sac.dialog.confirm({
                title: "Discard unsaved changes?",
                message: this.file ? this.file.name : "This sprite has not been saved yet.",
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
                    <sac-drop-zone accept="image/*" label="…or drop an image here to open it"
                                   touch-label="…or open an image"></sac-drop-zone>
                </div>`,
            [
                { action: "cancel", label: "Cancel", kind: "default" },
                { action: "create", label: "Create", kind: "primary" },
            ], (d) => d.addEventListener("sac:files", (e) => { dropped = e.detail.files[0]; d.close("drop"); }));
            if (action === "drop" && dropped) { this._openFile(dropped, { name: dropped.name, handle: null }); return; }
            if (action !== "create") return;
            const num = (s) => Number(dlg.querySelector(s).value);
            this._load(blankDoc(clamp(num(".pa-n-w"), 1, MAX_SIDE), clamp(num(".pa-n-h"), 1, MAX_SIDE), clamp(num(".pa-n-f"), 1, MAX_FRAMES)), null, null);
            this._touch();
        }

        async _open() {
            const files = this._ctx.files;
            if (!files) { this._toast("This host offers no files."); return; }
            if (!(await this._discardOk())) return;
            const picked = await files.open({ accept: ".png,image/png,image/*", title: "Open a sprite" });
            if (picked) this._openFile(picked.file, picked);
        }

        /** Open any image: ours comes back whole, anything else is split into frames on request. */
        async _openFile(file, ref) {
            let res;
            try { res = await decodeFile(file); } catch { this._toast("The image could not be read"); return; }
            const n = res.meta ? res.meta.frames : await this._askFrames(res.width, res.height, ref.name);
            if (!n) return;
            if (res.width / n > MAX_SIDE || res.height > MAX_SIDE) {
                this._toast(`Frames can be at most ${MAX_SIDE}×${MAX_SIDE} px`);
                return;
            }
            // Save writes PNG: a handle to anything else would overwrite it with one.
            const isPng = /\.png$/i.test(ref.name);
            const name = isPng ? ref.name : ref.name.replace(/\.[^.]*$/, "") + ".png";
            this._load(docFromStrip(res, n), { name, handle: isPng ? ref.handle : null }, isPng ? file : null);
            this._savedFrames = n;
            this._touch();
        }

        /** A foreign picture: how many frames sit side by side in it? → a count, or null. */
        async _askFrames(width, height, name) {
            const counts = [];
            for (let n = 1; n <= Math.min(width, MAX_FRAMES); n++) if (width % n === 0) counts.push(n);
            if (counts.length === 1) return 1;
            const guess = width > height && counts.includes(width / height) ? width / height : 1;
            const options = counts.map((n) => `<option value="${n}"${n === guess ? " selected" : ""}>${n} × ${width / n}×${height} px</option>`).join("");
            const { action, dlg } = await dialog(name, `
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
            if (!files) { this._toast("This host offers no files."); return; }
            this._commitFloat();
            const blob = await encodeDoc(this.doc, this._bufOf());
            const saved = await files.save(blob, {
                name: this.file ? this.file.name : "sprite.png",
                handle: asNew || !this.file ? null : this.file.handle,
                accept: ".png",
                type: "image/png",
            });
            if (!saved) return;
            this.file = saved;
            this.savedBlob = blob;
            this._savedFrames = this.doc.frames.length;
            this._setDirty(false);
            this._syncMeta();
            this._autosave();
            this._toast(files.kind === "browser" && !saved.handle ? `Downloaded ${saved.name}` : `Saved ${saved.name}`);
        }

        /** Back to the last saved (or opened) state. */
        async _revert() {
            if (!this.savedBlob) { this._toast("Nothing saved yet"); return; }
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
            const n = res.meta ? res.meta.frames : (this._savedFrames || 1);
            this._load(docFromStrip(res, n), this.file, this.savedBlob);
            this._touch();
            this._toast("Reverted to the saved state");
        }
    }

    sac.app.define("app-pixel-atelier", AppPixelAtelier);
})();
