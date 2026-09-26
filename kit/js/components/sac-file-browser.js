/**
 * <sac-file-browser accept=".png,image/*" pixelated></sac-file-browser>
 *
 *   browser.store = sac.fs.shared("files");
 *   browser.addEventListener("sac:choose", (e) => open(e.detail.paths));
 *
 * A folder view over any sac.fs handle — the user's files (sac.fs.shared),
 * an app's own drawer (context.fs), a host's own space, a server-backed
 * store. A path "sprites/hero.png" IS the folder "sprites", so folders are
 * derived from the listing. An empty folder the user created keeps itself
 * alive with a hidden marker entry, "<folder>/.folder" — never listed,
 * removed with the folder. It is the list inside the open/save dialogs of
 * sac.files.virtual(), and on its own the body of a "Files" app — one pane
 * of a two-pane commander included.
 *
 * Rows: folders first, then files — thumbnail (image files) or icon, name,
 * then the meta columns (size and date by default). Files that do not match
 * `accept` are left out. Rows are virtualised: a folder of thousands of
 * entries renders only the rows in view.
 *
 * Store: the required five (list/stat/read/write/remove), plus the optional
 * ones when the store has them — through sac.fs.ops when sac.fs is loaded:
 *   entries(prefix) — one call per folder instead of list() + one stat()
 *                     per file;
 *   url(path)       — thumbnails stream from a URL instead of read()-ing the
 *                     bytes into a Blob;
 *   rename(path, n) / move(from, to) — the built-in rename; without them
 *                     it falls back to read + write + remove.
 *
 * Attributes:
 *   accept        — ".png,image/*" — the file input's grammar: `.ext`
 *                   matches the name suffix, `type/*` the MIME prefix,
 *                   `type/sub` exactly. Absent = every file.
 *   multiple      — presence: marks (below). Ctrl/⌘-click and Shift-click
 *                   select several, as before.
 *   readonly      — presence hides New folder, the per-row delete buttons,
 *                   the Delete/F2 keys, rename() and drops: a view that
 *                   changes nothing (rows can still be dragged out).
 *   pixelated     — presence draws thumbnails with hard pixel edges. Default
 *                   smooth: most images are not pixel art.
 *   no-thumbnails — presence: image files show the image icon, nothing is
 *                   fetched for them.
 *   root-label    — the first breadcrumb. Default "Files".
 *   columns       — the meta columns, in order, from "type size date".
 *                   Default "size date"; "" = the name only.
 *   sort          — "name" (default) | "size" | "date" | "type". Folders
 *                   always come first (by name).
 *   sort-dir      — "asc" (default) | "desc".
 *   header        — presence shows a column header; its labels sort by
 *                   their column (again = reverse) and fire sac:sort.
 *   cursor-style  — "bar": the cursor row is a solid --accent bar with
 *                   --on-accent ink while the list has focus (a hairline
 *                   frame without it), and only marked rows are tinted — the
 *                   commander look. Default: the tinted selected row.
 *
 * Slots:
 *   title — sits in the header row between Up and the breadcrumb: a
 *           workspace menu, a pane caption. Hide the kit's own breadcrumb
 *           with ::part(crumbs) { display: none } when the title replaces it.
 *
 * Marks (`multiple`): a set of rows, folders included, independent of the
 * keyboard cursor. Shift+↑/↓/PgUp/PgDn/Home/End and Shift-click mark the
 * range from the anchor (added to what was marked before); Ctrl/⌘-click
 * and Ctrl/⌘+Space toggle one row; Ctrl/⌘+A marks every row; Esc clears
 * (and only then stops the key — an unmarked Esc still closes a dialog).
 * Plain arrows move the cursor and keep the marks; a plain click clears them.
 * Changing folders clears them.
 *
 * Properties:
 *   store    — the sac.fs handle to browse. Setting it resets to the root
 *              and reloads.
 *   path     — the current folder ("" = root), get/set. Setting navigates.
 *   selected — the selected FILE paths: the marked files when anything is
 *              marked, else the file the user last clicked / arrowed onto.
 *   marked   — the marked paths, folders included (no trailing slash), in
 *              row order; get/set (setting fires nothing; needs `multiple`).
 *   cursor   — the path of the row under the keyboard cursor (file or
 *              folder), get/set. Setting moves it and scrolls it into view.
 *   items    — the rows in view order, read-only: [{ kind, path, name,
 *              stat }] (stat is null for folders) — for a status line.
 *
 * Methods:
 *   refresh()     — re-read the current folder (the cursor stays on its row).
 *   up()          — one folder up; the cursor lands on the folder left.
 *   newFolder()   — an inline name field; Enter creates the folder (its
 *                   ".folder" marker) and goes into it.
 *   rename(path?) — an inline name field on the row (default: the cursor
 *                   row), for the host's own chord; F2 is built in. Enter
 *                   commits, Esc cancels, leaving the field commits a
 *                   changed name. A name starting with "." or one already
 *                   in the folder keeps the field open. The component
 *                   performs it (sac.fs.ops.rename, store.rename/move, or
 *                   read + write + remove), like delete and New folder —
 *                   unless a sac:request-rename listener cancels.
 *   select(path)  — select one file by path (e.g. the name being saved);
 *                   clears the marks.
 *
 * Events (bubble + composed — a dialog around it listens):
 *   sac:select         — { paths }: the selection changed (user action).
 *   sac:mark           — { paths }: the marks changed (user action, or
 *                        cleared by a folder change).
 *   sac:cursor         — { path, kind }: the row under the cursor changed
 *                        (a move, or the folder loading under it).
 *   sac:choose         — { paths }: a file was double-clicked / Enter'd.
 *   sac:navigate       — { path }: the folder changed.
 *   sac:sort           — { key, dir }: a header label changed the sort.
 *   sac:request-remove — CANCELABLE, before anything is deleted:
 *                        { path, folder, permanent, paths } — `permanent` =
 *                        Shift was held (Shift+Delete / Shift-click on the
 *                        trash button); `paths` = every target (the marked
 *                        rows when Delete acts on marks; path/folder = the
 *                        first). preventDefault() skips the built-in confirm
 *                        and delete — the host trashes instead.
 *   sac:remove         — { path, folder }: one per item deleted by the
 *                        built-in path (after its confirm).
 *   sac:request-rename — CANCELABLE: { from, to, folder } before a rename;
 *                        preventDefault() and the host renames (then
 *                        refresh(), cursor = to).
 *   sac:rename         — { from, to, folder }: the built-in rename landed.
 *   sac:drop           — { paths, target, copy, source } rows dragged from a
 *                        sac-file-browser (this one or another; `source` =
 *                        that element, null across documents), or { files,
 *                        target, copy: true } OS files. `target` = the
 *                        folder dropped on, or this browser's folder. `copy`
 *                        = Ctrl (Option on macOS) held. The component moves
 *                        nothing — the host does (sac.fs.ops.move/copy/
 *                        write), then refresh()es. Drops onto the dragged
 *                        rows themselves, into their own subtree, or a move
 *                        into the folder they are already in, are refused
 *                        while the stores match.
 *
 * Keyboard: ↑/↓ PgUp/PgDn Home/End move · Enter opens the folder /
 * chooses the file · Backspace or Alt+↑ goes up · Delete removes the marked
 * rows or the cursor row (asks first; Shift = permanent in the event) ·
 * F2 renames · the mark keys above with `multiple`.
 *
 * Language: every kit string goes through sac.t and follows a runtime
 * switch in place (folder, cursor, marks, an open name field and scroll
 * survive); sizes and dates are formatted in sac.lang.locale().
 *
 * Compact: under a 480px container the meta columns drop out; rows, header
 * labels and buttons are 44px on touch.
 *
 * Theming: tokens only — selected / marked row = --accent-tint ground and
 * --accent-text name; the bar cursor = --accent / --on-accent; the
 * thumbnail checker is --checker-a/--checker-b. Rows expose
 * part="row file|folder [selected] [marked] [cursor]", so a host can style
 * e.g. ::part(marked) itself.
 */
(function () {
    const TAG = "sac-file-browser";
    if (customElements.get(TAG)) return;

    // Keeps an empty folder alive. A dotted name no picker lists.
    const MARKER = ".folder";
    // The dataTransfer type of a row drag between browsers.
    const DRAG_TYPE = "application/x-sac-file-paths";
    // The in-page drag in flight: dataTransfer data is unreadable during
    // dragover, so the paths and source travel here too.
    let dragging = null;

    const META = ["type", "size", "date"];
    const SORTS = ["name", "size", "date", "type"];
    const GAP = 2;          // px between rows
    const PAD = 4;          // the list's own padding
    const OVERSCAN = 8;     // rows rendered beyond the viewport, each side
    const THUMB_JOBS = 4;   // thumbnails fetched at once

    const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const icon = (n) => {
        const p = window.sac && sac.icons ? sac.icons.get(n) : null;
        return p ? `<svg ${ICON_ATTRS} aria-hidden="true">${p}</svg>` : "";
    };
    const t = (key, fallback) => (window.sac && sac.t ? sac.t(key, fallback) : fallback);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const ops = () => (window.sac && sac.fs && sac.fs.ops) || null;
    const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
    const dirName = (p) => { const c = p.lastIndexOf("/"); return c < 0 ? "" : p.slice(0, c); };
    const extOf = (name) => { const m = /\.([^./]+)$/.exec(name || ""); return m && m.index > 0 ? m[1] : ""; };
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

    /** The <input accept> grammar, as one predicate over { name, type }. */
    function acceptTest(accept) {
        const parts = String(accept || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!parts.length) return () => true;
        return ({ name, type }) => {
            const n = String(name || "").toLowerCase();
            const m = String(type || "").toLowerCase();
            return parts.some((p) => p.startsWith(".") ? n.endsWith(p)
                : p.endsWith("/*") ? m.startsWith(p.slice(0, -1))
                : m === p);
        };
    }

    /** The page language's locale for Intl output; the browser's own when
     *  globals.js is not loaded. Read per call — the language can change. */
    const locale = () => (window.sac && sac.lang ? sac.lang.locale() : undefined);

    function formatSize(bytes) {
        if (bytes == null) return "";
        if (bytes < 1024) return `${bytes} B`;
        const num = (v, digits) => v.toLocaleString(locale(),
            { minimumFractionDigits: digits, maximumFractionDigits: digits });
        if (bytes < 1024 * 1024) return `${num(bytes / 1024, bytes < 10240 ? 1 : 0)} KB`;
        return `${num(bytes / 1048576, 1)} MB`;
    }
    function formatDate(ms) {
        if (!ms) return "";
        const d = new Date(ms);
        const today = new Date();
        const sameDay = d.toDateString() === today.toDateString();
        return sameDay
            ? d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric" });
    }
    const typeLabel = (r) => r.kind === "folder"
        ? t("files.type-folder", "Folder")
        : (extOf(r.name).toUpperCase() || t("files.type-file", "File"));

    /** One folder level from list() + stat() — for a store without
     *  entries() when sac.fs (and its ops) is not loaded. */
    async function foldList(store, prefix) {
        const folders = new Set();
        const names = [];
        for (const key of await store.list(prefix)) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            if (!rest) continue;
            const cut = rest.indexOf("/");
            if (cut >= 0) folders.add(prefix + rest.slice(0, cut));
            else if (rest !== MARKER) names.push(key);
        }
        const files = await Promise.all(names.map(async (p) => {
            try { return await store.stat(p); } catch (err) { return null; }
        }));
        return { folders: Array.from(folders), files };
    }

    class SacFileBrowser extends HTMLElement {
        static get observedAttributes() {
            return ["accept", "root-label", "readonly", "multiple", "sort", "sort-dir", "columns", "header", "no-thumbnails"];
        }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            this._store = null;
            this._path = "";
            this._rows = [];          // [{ kind: "folder"|"file", path, name, stat }]
            this._index = new Map();  // path → row index
            this._sel = new Set();    // the file the user last clicked / arrowed onto
            this._marks = new Set();  // marked paths, folders included (`multiple`)
            this._base = null;        // the marks a Shift range adds to
            this._focus = 0;          // index of the keyboard row (the cursor)
            this._anchor = null;      // shift-range anchor
            this._lastCursor = null;  // the cursor path sac:cursor last reported
            this._pendingCursor = null; // a path the cursor lands on after the next load
            this._els = new Map();    // path → live row element (the rendered window)
            this._renaming = null;    // { path, el, cancel } while a rename field is open
            this._thumbs = new Map(); // path → thumbnail src, null = none
            this._urls = [];          // thumbnail object URLs to revoke
            this._queue = [];         // thumbnail paths waiting
            this._jobs = 0;
            this._raf = 0;
            this._loadToken = 0;
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();
            if (this._store) this.refresh();
            if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
            if (!this._ro && window.ResizeObserver) {
                const list = this.shadowRoot.querySelector(".list");
                this._ro = new ResizeObserver(() => { this._gutter(); this._renderWindow(false); });
                this._ro.observe(list);
            }
        }
        disconnectedCallback() {
            this._revoke();
            if (this._offLang) { this._offLang(); this._offLang = null; }
            if (this._ro) { this._ro.disconnect(); this._ro = null; }
        }

        /** Runtime language switch: chrome labels in place, then crumbs, the
         *  header and rows repainted from the component's own state (folder,
         *  cursor, marks) — no reload. Scroll and an open name field survive. */
        _relabel() {
            const sr = this.shadowRoot;
            if (!sr.firstChild) return;
            const label = (sel, text, title) => {
                const el = sr.querySelector(sel);
                if (!el) return;
                el.setAttribute("aria-label", text);
                if (title) el.setAttribute("title", text);
            };
            label(".up", t("files.up", "Up one folder"), true);
            label(".mk", t("files.new-folder", "New folder"), true);
            label(".crumbs", t("files.location", "Location"));
            label(".list", t("files.list", "Files"));
            this._crumbs();
            this._head();
            const list = sr.querySelector(".list");
            const scroll = list.scrollTop;
            const pending = list.querySelector(".new-folder input");
            if (pending) {
                const name = t("files.new-folder-name", "Folder name");
                pending.setAttribute("aria-label", name);
                pending.setAttribute("placeholder", name);
            }
            const field = this._renaming && this._renaming.el.querySelector("input.rename");
            if (field) field.setAttribute("aria-label", t("files.rename-label", "New name"));
            this._paint();
            list.scrollTop = scroll;
        }
        attributeChangedCallback(name, old, value) {
            if (!this.shadowRoot.firstChild || old === value) return;
            switch (name) {
                case "sort":
                case "sort-dir":
                    this._head();
                    this._resort();
                    break;
                case "columns":
                case "header":
                case "no-thumbnails":
                    this._head();
                    this._paint();
                    break;
                case "multiple":
                    if (value == null) this._marks.clear();
                    this._multiAttr();
                    this._paint();
                    break;
                default:                         // accept, root-label, readonly
                    this._crumbs();
                    this._head();
                    if (this._store) this.refresh(); else this._paint();
            }
        }

        get store() { return this._store; }
        set store(handle) {
            this._store = handle || null;
            this._path = "";
            this._sel.clear();
            this._marks.clear();
            this._endRename();
            this._resetScroll();
            if (this.isConnected) this.refresh();
        }

        get path() { return this._path; }
        set path(p) { this._go(String(p || "").replace(/^\/+|\/+$/g, ""), false); }

        get selected() {
            if (this._marks.size) return this._rows.filter((r) => r.kind === "file" && this._marks.has(r.path)).map((r) => r.path);
            return Array.from(this._sel);
        }

        get marked() { return this._rows.filter((r) => this._marks.has(r.path)).map((r) => r.path); }
        set marked(paths) {
            if (!this.hasAttribute("multiple")) return;
            this._marks = new Set(Array.from(paths || [], String));
            this._base = null;
            this._anchor = null;
            this._renderWindow(false);
        }

        get cursor() { const r = this._rows[this._focus]; return r ? r.path : null; }
        set cursor(p) {
            const i = this._index.get(String(p));
            if (i == null) { this._pendingCursor = p == null ? null : String(p); return; }
            this._focus = i;
            this._anchor = i;
            this._base = new Set(this._marks);
            this._lastCursor = this._rows[i].path;
            this._reveal(i);
        }

        get items() {
            return this._rows.map((r) => ({ kind: r.kind, path: r.path, name: r.name, stat: r.stat || null }));
        }

        select(path) {
            this._sel = new Set(path ? [path] : []);
            this._marks.clear();
            const i = this._index.get(path);
            if (i != null) { this._focus = i; this._anchor = i; this._reveal(i); }
            else this._renderWindow(false);
        }

        up() {
            if (!this._path) return;
            const cut = this._path.lastIndexOf("/");
            this._go(cut < 0 ? "" : this._path.slice(0, cut), true, this._path);
        }

        newFolder() {
            const list = this.shadowRoot.querySelector(".list");
            if (list.querySelector(".new-folder")) return;
            const row = document.createElement("div");
            row.className = "row new-folder";
            row.innerHTML = `<span class="box">${icon("folder")}</span>
                <input class="rename" type="text" spellcheck="false"
                       aria-label="${esc(t("files.new-folder-name", "Folder name"))}"
                       placeholder="${esc(t("files.new-folder-name", "Folder name"))}">`;
            list.insertBefore(row, list.querySelector(".canvas"));
            list.scrollTop = 0;
            this._renderWindow(false);
            const input = row.querySelector("input");
            input.focus();
            let settled = false;
            const done = async (commit) => {
                if (settled) return;
                settled = true;
                const name = input.value.trim().replace(/[\\/]+/g, "-");
                row.remove();
                if (!commit || !name || name.startsWith(".") || !this._store) { this._paint(); return; }
                const path = this._path ? `${this._path}/${name}` : name;
                try { await this._store.write(`${path}/${MARKER}`, {}); }
                catch (err) { console.error("[sac-file-browser] could not create the folder:", err); this._paint(); return; }
                this._go(path, true);
            };
            input.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); done(true); }
                if (e.key === "Escape") { e.preventDefault(); done(false); }
            });
            input.addEventListener("blur", () => { if (row.isConnected) done(!!input.value.trim()); });
        }

        rename(path) {
            if (this.hasAttribute("readonly") || !this._store) return false;
            const i = path == null ? this._focus : this._index.get(String(path));
            const r = i == null ? null : this._rows[i];
            if (!r) return false;
            if (this._renaming) {
                if (this._renaming.path === r.path) { this._renaming.el.querySelector("input.rename")?.focus(); return true; }
                this._renaming.cancel();
            }
            this._focus = i;
            this._reveal(i);
            const el = this._els.get(r.path);
            if (!el) return false;
            const list = this.shadowRoot.querySelector(".list");
            const nameEl = el.querySelector(".name");
            const input = document.createElement("input");
            input.className = "rename";
            input.type = "text";
            input.spellcheck = false;
            input.value = r.name;
            input.setAttribute("aria-label", t("files.rename-label", "New name"));
            nameEl.hidden = true;
            nameEl.after(input);
            el.draggable = false;
            el.classList.add("renaming");
            input.focus();
            const dot = r.kind === "file" ? r.name.lastIndexOf(".") : -1;
            input.setSelectionRange(0, dot > 0 ? dot : r.name.length);

            let settled = false;
            const close = () => {
                settled = true;
                input.remove();
                nameEl.hidden = false;
                el.draggable = true;
                el.classList.remove("renaming");
                if (this._renaming && this._renaming.el === el) this._renaming = null;
            };
            const refuse = (how, message) => {
                if (how === "blur") { close(); return; }
                input.setAttribute("aria-invalid", "true");
                input.title = message;
            };
            const done = async (how) => {
                if (settled) return;
                const name = input.value.trim().replace(/[\\/]+/g, "-");
                if (!how || !name || name === r.name) { close(); if (how !== "blur") list.focus({ preventScroll: true }); return; }
                if (name.startsWith(".")) return refuse(how, t("files.rename-dot", "A name cannot start with a dot."));
                const dir = dirName(r.path);
                const to = dir ? `${dir}/${name}` : name;
                if (this._index.has(to)) return refuse(how, t("files.rename-taken", "That name is already taken here."));
                close();
                if (how !== "blur") list.focus({ preventScroll: true });
                await this._doRename(r, to);
            };
            input.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); done("enter"); }
                if (e.key === "Escape") { e.preventDefault(); done(null); }
            });
            input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); input.removeAttribute("title"); });
            input.addEventListener("blur", () => { if (input.isConnected) done("blur"); });
            this._renaming = { path: r.path, el, cancel: close };
            return true;
        }

        async _doRename(r, to) {
            const from = r.path;
            const detail = { from, to, folder: r.kind === "folder" };
            if (!this._emit("sac:request-rename", detail, true)) return;
            const store = this._store;
            try {
                const o = ops();
                if (o && o.rename) await o.rename(store, from, baseName(to));
                else if (typeof store.rename === "function") await store.rename(from, baseName(to));
                else if (typeof store.move === "function") await store.move(from, to);
                else {
                    // The required five only: copy every key over, then drop the old ones.
                    if (from.toLowerCase() !== to.toLowerCase()
                        && ((await store.stat(to)) || (await store.list(to + "/")).length)) {
                        throw new Error(`"${to}" already exists`);
                    }
                    const keys = detail.folder ? await store.list(from + "/") : [from];
                    for (const k of keys) await store.write(to + k.slice(from.length), await store.read(k, null));
                    for (const k of keys) await store.remove(k);
                }
            } catch (err) {
                console.error("[sac-file-browser] rename failed:", err);
                return;
            }
            for (const set of [this._marks, this._sel]) {
                if (set.has(from)) { set.delete(from); set.add(to); }
            }
            this._pendingCursor = to;
            this._emit("sac:rename", detail);
            await this.refresh();
        }

        /* ------------------------------------------------------ loading -- */

        async refresh() {
            if (!this.shadowRoot.firstChild) this._render();
            const store = this._store;
            this._crumbs();
            if (!store) { this._setRows([]); this._paint(); return; }
            const token = ++this._loadToken;
            const prefix = this._path ? this._path + "/" : "";
            const prev = this.cursor;
            let listing;
            try { listing = await this._load(store, prefix); }
            catch (err) { console.error("[sac-file-browser] listing failed:", err); listing = { folders: [], files: [] }; }
            if (token !== this._loadToken) return;       // a newer load won
            // A cursor asked for meanwhile (up(), rename, the setter) wins over the old row.
            const keep = this._pendingCursor != null ? this._pendingCursor : prev;
            this._pendingCursor = null;
            const ok = acceptTest(this.getAttribute("accept"));
            const seen = new Set();
            const folders = [];
            for (let f of listing.folders || []) {
                f = String(f).replace(/\/+$/, "");
                if (!f) continue;
                if (prefix && !f.startsWith(prefix)) f = prefix + f;   // a store that answered with names
                if (seen.has(f)) continue;
                seen.add(f);
                folders.push({ kind: "folder", name: baseName(f), path: f, stat: null });
            }
            const files = (listing.files || [])
                .filter((s) => s && s.path && baseName(s.path) !== MARKER)
                .map((s) => ({ kind: "file", name: s.name || baseName(s.path), path: s.path, stat: s }))
                .filter((r) => ok({ name: r.name, type: r.stat.type }));
            this._setRows(this._sorted(folders, files));
            for (const set of [this._sel, this._marks]) {
                for (const p of Array.from(set)) if (!this._index.has(p)) set.delete(p);
            }
            const i = keep != null ? this._index.get(keep) : undefined;
            this._focus = i != null ? i : Math.min(this._focus, Math.max(0, this._rows.length - 1));
            if (this._anchor != null && this._anchor >= this._rows.length) this._anchor = null;
            this._revoke();
            this._paint();
            if (i != null) this._reveal(i);
            this._emitCursor();
        }

        /** { folders, files: stat[] } for one level — entries() when the
         *  store (or sac.fs.ops) offers it, else list() + stat(). */
        async _load(store, prefix) {
            const o = ops();
            if (o && typeof o.entries === "function") return o.entries(store, prefix);
            if (typeof store.entries === "function") return store.entries(prefix);
            return foldList(store, prefix);
        }

        _setRows(rows) {
            this._rows = rows;
            this._index = new Map(rows.map((r, i) => [r.path, i]));
        }

        _sortState() {
            let key = (this.getAttribute("sort") || "name").trim().toLowerCase();
            if (key === "modified") key = "date";
            if (!SORTS.includes(key)) key = "name";
            return { key, desc: (this.getAttribute("sort-dir") || "").trim().toLowerCase() === "desc" };
        }

        _sorted(folders, files) {
            const { key, desc } = this._sortState();
            const byName = (a, b) => collator.compare(a.name, b.name);
            folders.sort(byName);
            if (key === "name" && desc) folders.reverse();
            const val = {
                size: (r) => r.stat.size || 0,
                date: (r) => r.stat.modified || 0,
            };
            files.sort((a, b) => {
                let d = 0;
                if (key === "type") d = collator.compare(extOf(a.name), extOf(b.name));
                else if (val[key]) d = val[key](a) - val[key](b);
                if (!d) d = byName(a, b);
                return desc ? -d : d;
            });
            return [...folders, ...files];
        }

        _resort() {
            const cur = this.cursor;
            this._setRows(this._sorted(
                this._rows.filter((r) => r.kind === "folder"),
                this._rows.filter((r) => r.kind === "file")));
            const i = cur != null ? this._index.get(cur) : undefined;
            this._focus = i != null ? i : 0;
            this._anchor = null;
            this._paint();
            if (this._rows.length) this._reveal(this._focus);
        }

        _go(path, user, cursorTo = null) {
            if (path === this._path && !user) return;
            const hadMarks = this._marks.size > 0;
            this._endRename();
            this._path = path;
            this._sel.clear();
            this._marks.clear();
            this._base = null;
            this._focus = 0;
            this._anchor = null;
            this._pendingCursor = cursorTo;
            this._resetScroll();
            this.refresh();
            if (user) {
                if (hadMarks) this._emit("sac:mark", { paths: [] });
                this._emit("sac:navigate", { path });
            }
        }

        _resetScroll() {
            const list = this.shadowRoot.querySelector(".list");
            if (list) list.scrollTop = 0;
        }

        _endRename() {
            if (this._renaming) this._renaming.cancel();
        }

        /* ---------------------------------------------------- rendering -- */

        _render() {
            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        display: flex;
                        flex-direction: column;
                        min-width: 0;
                        min-height: 0;
                        container-type: inline-size;
                        color: var(--text);
                        font-size: 0.85rem;
                        --row-h: 36px;
                        --del-w: 28px;
                    }
                    :host([hidden]) { display: none; }
                    .bar {
                        flex: none;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        padding-bottom: 8px;
                        min-width: 0;
                    }
                    ::slotted([slot="title"]) { flex: 0 1 auto; min-width: 0; }
                    .crumbs {
                        flex: 1;
                        min-width: 0;
                        display: flex;
                        align-items: center;
                        gap: 2px;
                        overflow: hidden;
                        white-space: nowrap;
                    }
                    .crumb {
                        font: inherit;
                        font-weight: 600;
                        background: none;
                        border: 0;
                        color: var(--text-muted);
                        padding: 4px 6px;
                        border-radius: var(--radius-m);
                        cursor: pointer;
                        min-width: 0;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        flex-shrink: 1;
                    }
                    .crumb:hover { background: var(--hover); color: var(--text); }
                    .crumb[aria-current] { color: var(--text); cursor: default; background: none; }
                    .crumb:focus-visible, .tool:focus-visible, .del:focus-visible, .hcol:focus-visible {
                        outline: 2px solid var(--accent); outline-offset: -2px;
                    }
                    .sep { color: var(--text-dim); flex: none; }
                    .tool, .del {
                        --icon-size: 16px;
                        flex: none;
                        display: grid;
                        place-items: center;
                        width: 28px;
                        height: 28px;
                        padding: 0;
                        border: 0;
                        border-radius: var(--radius-m);
                        background: none;
                        color: var(--text-muted);
                        cursor: pointer;
                    }
                    .tool svg, .del svg { width: 16px; height: 16px; }
                    .tool:hover:not(:disabled) { background: var(--hover); color: var(--text); }
                    .tool:disabled { opacity: 0.35; cursor: default; }

                    /* Column header — outside the listbox, aligned with the
                       rows: border + padding + the row's own inset, and the
                       list's scrollbar gutter on the right. */
                    .head {
                        flex: none;
                        display: flex;
                        align-items: center;
                        gap: 0.6rem;
                        min-width: 0;
                        padding: 0 calc(${PAD + 5}px + var(--sbw, 0px)) 4px ${PAD + 7}px;
                    }
                    .head[hidden] { display: none; }
                    .head .box { height: auto; }
                    .hcol {
                        font: inherit;
                        font-size: 0.75rem;
                        font-weight: 600;
                        color: var(--text-dim);
                        background: none;
                        border: 0;
                        border-radius: var(--radius-s);
                        padding: 2px 0;
                        min-height: 24px;
                        display: flex;
                        align-items: center;
                        justify-content: flex-end;
                        gap: 2px;
                        cursor: pointer;
                        white-space: nowrap;
                        overflow: hidden;
                    }
                    .hcol.name, .hcol.type { justify-content: flex-start; }
                    .hcol:hover, .hcol[aria-pressed="true"] { color: var(--text); }
                    .hcol svg { flex: none; width: 12px; height: 12px; }
                    .del-sp { flex: none; width: var(--del-w); }

                    .list {
                        position: relative;
                        flex: 1;
                        min-height: 120px;
                        overflow-y: auto;
                        overscroll-behavior-y: contain;
                        display: flex;
                        flex-direction: column;
                        gap: ${GAP}px;
                        padding: ${PAD}px;
                        border: 1px solid var(--border);
                        border-radius: var(--radius-m);
                        background: var(--field);
                        outline: none;
                        scrollbar-width: thin;
                        scrollbar-color: var(--scrollbar-thumb) transparent;
                    }
                    .list:focus-visible { border-color: var(--accent); }
                    .list.drop {
                        border-color: var(--accent);
                        background: color-mix(in srgb, var(--accent) 6%, var(--field));
                    }
                    .canvas { position: relative; flex: none; }
                    .row {
                        box-sizing: border-box;
                        display: flex;
                        align-items: center;
                        gap: 0.6rem;
                        padding: 4px 4px 4px 6px;
                        min-height: var(--row-h);
                        border-radius: var(--radius-m);
                        color: var(--text-muted);
                        cursor: pointer;
                        user-select: none;
                    }
                    .canvas > .row {
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        height: var(--row-h);
                    }
                    .row:hover { background: var(--hover); color: var(--text); }
                    .row.sel { background: var(--accent-tint); color: var(--accent-text); }
                    .row.drop { background: var(--accent-tint); color: var(--accent-text); }
                    .list:focus-visible .row.focus { box-shadow: inset 0 0 0 2px var(--accent); }
                    .box {
                        flex: none;
                        width: 28px;
                        height: 28px;
                        display: grid;
                        place-items: center;
                        border-radius: var(--radius-s);
                        overflow: hidden;
                    }
                    .box svg { width: 18px; height: 18px; }
                    .row[data-kind="folder"] .box { color: var(--accent-text); }
                    .box img {
                        width: 100%;
                        height: 100%;
                        object-fit: contain;
                        image-rendering: auto;
                        background-color: var(--checker-a, color-mix(in srgb, var(--fg) 6%, transparent));
                        background-image: conic-gradient(
                            var(--checker-b, color-mix(in srgb, var(--fg) 12%, transparent)) 90deg,
                            transparent 90deg 180deg,
                            var(--checker-b, color-mix(in srgb, var(--fg) 12%, transparent)) 180deg 270deg,
                            transparent 270deg);
                        background-size: 6px 6px;
                    }
                    :host([pixelated]) .box img { image-rendering: pixelated; }
                    .name {
                        flex: 1;
                        min-width: 0;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                        color: inherit;
                    }
                    .name[hidden] { display: none; }
                    .row:not(.sel) .name { color: var(--text); }
                    .meta {
                        flex: none;
                        width: 5.5rem;
                        text-align: right;
                        font-size: 0.75rem;
                        color: var(--text-dim);
                        font-variant-numeric: tabular-nums;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .meta.date { width: 7rem; }
                    .meta.type { width: 4.5rem; text-align: left; }
                    .del { opacity: 0; }
                    .row:hover .del, .row.focus .del, .del:focus-visible { opacity: 1; }
                    .del:hover { color: var(--danger-text); background: var(--hover); }
                    :host([readonly]) .del,
                    :host([readonly]) .mk { display: none; }
                    .rename {
                        flex: 1;
                        min-width: 0;
                        font: inherit;
                        color: var(--text);
                        background: var(--field);
                        border: 1px solid var(--accent);
                        border-radius: var(--radius-s);
                        padding: 3px 6px;
                        outline: none;
                    }
                    .rename[aria-invalid="true"] { border-color: var(--danger); }
                    .empty {
                        margin: auto;
                        padding: 24px 12px;
                        text-align: center;
                        color: var(--text-dim);
                        font-size: 0.8rem;
                    }
                    .empty[hidden], .new-folder ~ .empty { display: none; }

                    /* cursor-style="bar": the commander cursor. Only marks
                       are tinted; the cursor row is a solid accent bar while
                       the list has focus, a hairline frame without it. */
                    :host([cursor-style="bar"]) .row.sel:not(.mark):not(:hover) { background: none; }
                    :host([cursor-style="bar"]) .row.sel:not(.mark) .name { color: var(--text); }
                    :host([cursor-style="bar"]) .row.focus { box-shadow: inset 0 0 0 1px var(--border-strong); }
                    :host([cursor-style="bar"]) .list:focus-within .row.focus:not(.renaming) {
                        background: var(--accent);
                        color: var(--on-accent);
                        box-shadow: none;
                    }
                    :host([cursor-style="bar"]) .list:focus-within .row.focus:not(.renaming) :is(.name, .meta, .box, .del) {
                        color: var(--on-accent);
                    }

                    @container (max-width: 480px) {
                        .meta { display: none; }
                    }
                    @media (pointer: coarse) {
                        :host { --row-h: 44px; --del-w: 44px; }
                        .tool, .del { width: 44px; height: 44px; }
                        .del { opacity: 1; }
                        .hcol { min-height: 44px; }
                        .rename { font-size: 16px; }
                    }
                </style>
                <div class="bar" part="bar">
                    <button class="tool up" type="button" part="up"
                            title="${esc(t("files.up", "Up one folder"))}"
                            aria-label="${esc(t("files.up", "Up one folder"))}">${icon("chevron-up")}</button>
                    <slot name="title"></slot>
                    <nav class="crumbs" part="crumbs" aria-label="${esc(t("files.location", "Location"))}"></nav>
                    <button class="tool mk" type="button" part="new-folder"
                            title="${esc(t("files.new-folder", "New folder"))}"
                            aria-label="${esc(t("files.new-folder", "New folder"))}">${icon("folder-plus")}</button>
                </div>
                <div class="head" part="header" hidden></div>
                <div class="list" part="list" role="listbox" tabindex="0"
                     aria-label="${esc(t("files.list", "Files"))}"><div class="canvas"></div><div class="empty" hidden></div></div>
            `;
            const sr = this.shadowRoot;
            sr.querySelector(".up").addEventListener("click", () => this.up());
            sr.querySelector(".mk").addEventListener("click", () => this.newFolder());
            sr.querySelector(".head").addEventListener("click", (e) => this._onHead(e));
            const list = sr.querySelector(".list");
            list.addEventListener("click", (e) => this._onClick(e));
            list.addEventListener("dblclick", (e) => {
                if (e.target.closest(".rename, .del")) return;
                const row = e.target.closest(".canvas > .row");
                if (row) this._activate(+row.dataset.i);
            });
            list.addEventListener("keydown", (e) => this._onKey(e));
            list.addEventListener("scroll", () => {
                if (this._raf) return;
                this._raf = requestAnimationFrame(() => { this._raf = 0; this._renderWindow(false); });
            }, { passive: true });
            list.addEventListener("dragstart", (e) => this._dragStart(e));
            list.addEventListener("dragend", () => { dragging = null; this._dropHint(null); });
            list.addEventListener("dragover", (e) => this._dragOver(e));
            list.addEventListener("drop", (e) => this._drop(e));
            this._multiAttr();
            this._head();
        }

        _multiAttr() {
            const list = this.shadowRoot.querySelector(".list");
            if (list) list.setAttribute("aria-multiselectable", String(this.hasAttribute("multiple")));
        }

        _crumbs() {
            const nav = this.shadowRoot.querySelector(".crumbs");
            if (!nav) return;
            const segs = this._path ? this._path.split("/") : [];
            const rootLabel = this.getAttribute("root-label") || t("files.root", "Files");
            const parts = [`<button class="crumb" type="button" data-p=""${segs.length ? "" : " aria-current=\"location\""}>${esc(rootLabel)}</button>`];
            segs.forEach((s, i) => {
                const p = segs.slice(0, i + 1).join("/");
                parts.push(`<span class="sep" aria-hidden="true">/</span>`);
                parts.push(`<button class="crumb" type="button" data-p="${esc(p)}"${i === segs.length - 1 ? " aria-current=\"location\"" : ""}>${esc(s)}</button>`);
            });
            nav.innerHTML = parts.join("");
            nav.querySelectorAll(".crumb").forEach((b) => b.addEventListener("click", () => {
                if (!b.hasAttribute("aria-current")) this._go(b.dataset.p, true);
            }));
            this.shadowRoot.querySelector(".up").disabled = !this._path;
        }

        /** The meta columns, in order. */
        _cols() {
            const attr = this.getAttribute("columns");
            if (attr == null) return ["size", "date"];
            return Array.from(new Set(attr.toLowerCase().split(/[\s,]+/).filter((c) => META.includes(c))));
        }

        _colLabel(c) {
            return c === "name" ? t("files.col-name", "Name")
                : c === "type" ? t("files.col-type", "Type")
                : c === "size" ? t("files.col-size", "Size")
                : t("files.col-modified", "Modified");
        }

        _head() {
            const head = this.shadowRoot.querySelector(".head");
            if (!head) return;
            head.hidden = !this.hasAttribute("header");
            if (head.hidden) { head.innerHTML = ""; return; }
            const { key, desc } = this._sortState();
            const col = (c) => {
                const label = this._colLabel(c);
                const on = c === key;
                return `<button class="hcol ${c === "name" ? "name" : `meta ${c}`}" type="button" data-sort="${c}"
                                aria-pressed="${on}"
                                title="${esc(t("files.sort-by", "Sort by {column}").replace("{column}", label))}"><span>${esc(label)}</span>${on ? icon(desc ? "chevron-down" : "chevron-up") : ""}</button>`;
            };
            head.innerHTML = `<span class="box" aria-hidden="true"></span>${col("name")}${this._cols().map(col).join("")}`
                + (this.hasAttribute("readonly") ? "" : `<span class="del-sp" aria-hidden="true"></span>`);
            this._gutter();
        }

        /** The header's right inset follows the list's scrollbar width. */
        _gutter() {
            const list = this.shadowRoot.querySelector(".list");
            const head = this.shadowRoot.querySelector(".head");
            if (!list || !head || head.hidden) return;
            head.style.setProperty("--sbw", `${Math.max(0, list.offsetWidth - list.clientWidth - 2)}px`);
        }

        _onHead(e) {
            const b = e.target.closest(".hcol");
            if (!b) return;
            const k = b.dataset.sort;
            const { key, desc } = this._sortState();
            const d = k === key ? !desc : false;
            this.setAttribute("sort", k);
            if (d) this.setAttribute("sort-dir", "desc"); else this.removeAttribute("sort-dir");
            this._emit("sac:sort", { key: k, dir: d ? "desc" : "asc" });
        }

        /** Row pitch in px: the row height plus the gap. */
        _pitch() {
            const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
            return (coarse ? 44 : 36) + GAP;
        }

        /** The rows changed (a load, a sort, a language switch, columns):
         *  size the canvas and rebuild the rendered window. */
        _paint() {
            const sr = this.shadowRoot;
            const list = sr.querySelector(".list");
            if (!list) return;
            const n = this._rows.length;
            sr.querySelector(".canvas").style.height = n ? `${n * this._pitch() - GAP}px` : "0px";
            const empty = sr.querySelector(".empty");
            empty.hidden = n > 0;
            if (!n) {
                empty.textContent = this._path
                    ? t("files.empty-folder", "This folder is empty.")
                    : t("files.empty", "Nothing here yet.");
            }
            if (this._renaming && !this._index.has(this._renaming.path)) this._renaming.cancel();
            this._renderWindow(true);
        }

        /**
         * Render the rows in view (plus overscan, the cursor row and a row
         * being renamed), reusing live elements by path; `rebuild` recreates
         * them all (except the one being renamed). Also the cheap path for
         * state-only changes — cursor, selection, marks.
         */
        _renderWindow(rebuild) {
            const sr = this.shadowRoot;
            const list = sr.querySelector(".list");
            if (!list) return;
            const canvas = sr.querySelector(".canvas");
            const rows = this._rows;
            const n = rows.length;
            const keepPath = this._renaming ? this._renaming.path : null;
            if (rebuild) {
                for (const [p, el] of this._els) {
                    if (p === keepPath) continue;
                    el.remove();
                    this._els.delete(p);
                }
            }
            const pitch = this._pitch();
            const top = list.scrollTop - canvas.offsetTop;
            const first = Math.max(0, Math.floor(top / pitch) - OVERSCAN);
            const last = Math.min(n, Math.ceil((top + list.clientHeight) / pitch) + OVERSCAN);
            const want = new Map();
            for (let i = first; i < last; i++) want.set(rows[i].path, i);
            if (rows[this._focus]) want.set(rows[this._focus].path, this._focus);
            if (keepPath && this._index.has(keepPath)) want.set(keepPath, this._index.get(keepPath));
            for (const [p, el] of this._els) {
                if (!want.has(p)) { el.remove(); this._els.delete(p); }
            }
            const shown = this._marks.size ? this._marks : this._sel;
            for (const [p, i] of want) {
                const r = rows[i];
                let el = this._els.get(p);
                if (!el) {
                    el = this._rowEl(r);
                    canvas.appendChild(el);
                    this._els.set(p, el);
                }
                const sel = shown.has(p);
                const mark = this._marks.has(p);
                const cur = i === this._focus;
                el.id = `r${i}`;
                el.dataset.i = i;
                el.style.transform = `translateY(${i * pitch}px)`;
                el.classList.toggle("sel", sel);
                el.classList.toggle("mark", mark);
                el.classList.toggle("focus", cur);
                el.setAttribute("aria-selected", String(sel));
                el.setAttribute("aria-posinset", i + 1);
                el.setAttribute("aria-setsize", n);
                el.setAttribute("part", ["row", r.kind, sel && "selected", mark && "marked", cur && "cursor"].filter(Boolean).join(" "));
            }
            if (rows[this._focus]) list.setAttribute("aria-activedescendant", `r${this._focus}`);
            else list.removeAttribute("aria-activedescendant");
            this._pump();
        }

        _rowEl(r) {
            const el = document.createElement("div");
            el.className = "row";
            el.setAttribute("role", "option");
            el.dataset.kind = r.kind;
            el.draggable = true;
            const image = r.kind === "file" && /^image\//.test(r.stat.type || "");
            const kindIcon = r.kind === "folder" ? "folder" : image ? "image" : "document";
            const cell = (c) => {
                if (c === "type") return esc(typeLabel(r));
                if (r.kind !== "file") return "";
                return esc(c === "size" ? formatSize(r.stat.size) : formatDate(r.stat.modified));
            };
            const del = this.hasAttribute("readonly") ? ""
                : `<button class="del" type="button" tabindex="-1"
                           title="${esc(t("files.delete", "Delete"))}"
                           aria-label="${esc(t("files.delete", "Delete"))} ${esc(r.name)}">${icon("trash")}</button>`;
            el.innerHTML = `<span class="box">${icon(kindIcon)}</span>
                <span class="name" title="${esc(r.name)}">${esc(r.name)}</span>
                ${this._cols().map((c) => `<span class="meta ${c}">${cell(c)}</span>`).join("")}
                ${del}`;
            if (image && !this.hasAttribute("no-thumbnails")) {
                const src = this._thumbs.get(r.path);
                if (src) el.querySelector(".box").innerHTML = `<img alt="" decoding="async" src="${esc(src)}">`;
                else if (src === undefined) this._queueThumb(r.path);
            }
            return el;
        }

        /* --------------------------------------------------- thumbnails -- */

        /** Image files get their own picture as the icon — only rows that
         *  are rendered, a few at a time, skipped once scrolled away. */
        _queueThumb(path) {
            if (!this._queue.includes(path)) this._queue.push(path);
        }

        _pump() {
            while (this._jobs < THUMB_JOBS && this._queue.length) {
                const path = this._queue.shift();
                if (!this._els.has(path) || this._thumbs.has(path)) continue;
                this._jobs++;
                this._thumb(path, this._loadToken).finally(() => { this._jobs--; this._pump(); });
            }
        }

        async _thumb(path, token) {
            const store = this._store;
            const i = this._index.get(path);
            const r = i == null ? null : this._rows[i];
            if (!store || !r) return;
            let src = null;
            let objectUrl = false;
            try {
                const o = ops();
                src = o && o.url ? await o.url(store, path)
                    : typeof store.url === "function" ? await store.url(path) : null;
            } catch (err) { src = null; }
            if (!src && r.stat.binary) {
                try {
                    const file = await store.read(path, null);
                    if (file instanceof Blob) { src = URL.createObjectURL(file); objectUrl = true; }
                } catch (err) { /* no picture — the icon stays */ }
            }
            if (token !== this._loadToken) { if (objectUrl) URL.revokeObjectURL(src); return; }
            if (objectUrl) this._urls.push(src);
            this._thumbs.set(path, src || null);
            const el = this._els.get(path);
            if (src && el) el.querySelector(".box").innerHTML = `<img alt="" decoding="async" src="${esc(src)}">`;
        }

        _revoke() {
            this._urls.forEach((u) => URL.revokeObjectURL(u));
            this._urls = [];
            this._thumbs.clear();
            this._queue = [];
        }

        /* -------------------------------------------------- interaction -- */

        /** Scroll row i into view (below the list's padding) and render. */
        _reveal(i) {
            const sr = this.shadowRoot;
            const list = sr.querySelector(".list");
            if (!list) return;
            const pitch = this._pitch();
            const top = sr.querySelector(".canvas").offsetTop + i * pitch;
            const bottom = top + pitch - GAP;
            if (top - PAD < list.scrollTop) list.scrollTop = top - PAD;
            else if (bottom + PAD > list.scrollTop + list.clientHeight) list.scrollTop = bottom + PAD - list.clientHeight;
            this._renderWindow(false);
        }

        _snapshot() {
            return { sel: this.selected.join("\n"), marks: this.marked.join("\n") };
        }

        /** Tell the host what a gesture changed: cursor, marks, selection.
         *  `forceSelect` keeps the old contract — a plain click or arrow onto
         *  a file always reports sac:select. */
        _after(snap, forceSelect) {
            this._emitCursor();
            const now = this._snapshot();
            if (now.marks !== snap.marks) this._emit("sac:mark", { paths: this.marked });
            if (forceSelect || now.sel !== snap.sel) this._emit("sac:select", { paths: this.selected });
        }

        _emitCursor() {
            const r = this._rows[this._focus];
            const p = r ? r.path : null;
            if (p === this._lastCursor) return;
            this._lastCursor = p;
            this._emit("sac:cursor", { path: p, kind: r ? r.kind : null });
        }

        /** Marks = the marks before the range began + the range. */
        _markRange(a, b) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            this._marks = new Set(this._base || []);
            for (let i = lo; i <= hi; i++) this._marks.add(this._rows[i].path);
        }

        /** A toggle on empty marks starts from the selected file, as a
         *  Ctrl-click after a plain click always has. */
        _toggleMark(path) {
            if (!this._marks.size) for (const p of this._sel) if (this._index.has(p)) this._marks.add(p);
            if (this._marks.has(path)) this._marks.delete(path); else this._marks.add(path);
        }

        _onClick(e) {
            if (e.target.closest(".rename")) return;
            const del = e.target.closest(".del");
            if (del) {
                e.stopPropagation();
                const r = this._rows[+del.closest(".row").dataset.i];
                if (r) this._remove([r], e.shiftKey);
                return;
            }
            const row = e.target.closest(".canvas > .row");
            if (!row) return;
            const i = +row.dataset.i;
            const r = this._rows[i];
            if (!r) return;
            const list = this.shadowRoot.querySelector(".list");
            const snap = this._snapshot();
            const multi = this.hasAttribute("multiple");
            if (multi && (e.ctrlKey || e.metaKey)) {
                this._toggleMark(r.path);
                this._focus = this._anchor = i;
                this._base = new Set(this._marks);
            } else if (multi && e.shiftKey && this._anchor != null) {
                this._focus = i;
                this._markRange(this._anchor, i);
            } else {
                if (r.kind === "folder") {
                    // Folders open on a single click — nothing to select there.
                    this._focus = i;
                    this._go(r.path, true);
                    return;
                }
                this._marks.clear();
                this._focus = this._anchor = i;
                this._base = new Set();
                this._sel = new Set([r.path]);
                this._renderWindow(false);
                list.focus({ preventScroll: true });
                this._after(snap, true);
                return;
            }
            this._renderWindow(false);
            list.focus({ preventScroll: true });
            this._after(snap, false);
        }

        _activate(i) {
            const r = this._rows[i];
            if (!r) return;
            if (r.kind === "folder") { this._go(r.path, true); return; }
            if (!this._marks.has(r.path)) {
                const snap = this._snapshot();
                this._marks.clear();
                if (!this._sel.has(r.path)) this._sel = new Set([r.path]);
                this._renderWindow(false);
                this._after(snap, false);
            }
            this._emit("sac:choose", { paths: this.selected });
        }

        _onKey(e) {
            const n = this._rows.length;
            const multi = this.hasAttribute("multiple");
            const mod = e.ctrlKey || e.metaKey;
            const snap = this._snapshot();
            const list = this.shadowRoot.querySelector(".list");
            const page = Math.max(1, Math.floor(list.clientHeight / this._pitch()) - 1);
            const move = (to) => {
                e.preventDefault();
                if (!n) return;
                const i = Math.max(0, Math.min(n - 1, to));
                const r = this._rows[i];
                let force = false;
                if (multi && e.shiftKey) {
                    if (this._anchor == null) { this._anchor = this._focus; this._base = new Set(this._marks); }
                    this._focus = i;
                    this._markRange(this._anchor, i);
                } else {
                    this._focus = this._anchor = i;
                    this._base = new Set(this._marks);
                    if (r.kind === "file") {
                        this._sel = new Set([r.path]);
                        force = !this._marks.size;
                    }
                }
                this._reveal(i);
                this._after(snap, force);
            };
            const marks = (fn) => {
                e.preventDefault();
                fn();
                this._renderWindow(false);
                this._after(snap, false);
            };
            switch (e.key) {
                case "ArrowDown": if (!e.altKey) move(this._focus + 1); break;
                case "ArrowUp":
                    if (e.altKey) { e.preventDefault(); this.up(); }
                    else move(this._focus - 1);
                    break;
                case "PageDown":  move(this._focus + page); break;
                case "PageUp":    move(this._focus - page); break;
                case "Home":      move(0); break;
                case "End":       move(n - 1); break;
                case "Enter":     e.preventDefault(); this._activate(this._focus); break;
                case "Backspace": e.preventDefault(); this.up(); break;
                case "Delete": {
                    if (this.hasAttribute("readonly")) return;
                    e.preventDefault();
                    const targets = this._marks.size
                        ? this._rows.filter((r) => this._marks.has(r.path))
                        : [this._rows[this._focus]].filter(Boolean);
                    if (targets.length) this._remove(targets, e.shiftKey);
                    break;
                }
                case "F2":
                    if (this.hasAttribute("readonly")) return;
                    e.preventDefault();
                    this.rename();
                    break;
                case "Escape":
                    // Only a clear stops the key — an unmarked Esc closes the dialog around.
                    if (!this._marks.size) return;
                    e.stopPropagation();
                    marks(() => { this._marks.clear(); this._base = new Set(); this._anchor = this._focus; });
                    break;
                case "a":
                case "A":
                    if (!multi || !mod || e.altKey || e.shiftKey || !n) return;
                    marks(() => { this._marks = new Set(this._rows.map((r) => r.path)); this._base = new Set(this._marks); });
                    break;
                case " ":
                    if (!multi || !mod || !this._rows[this._focus]) return;
                    marks(() => {
                        this._toggleMark(this._rows[this._focus].path);
                        this._anchor = this._focus;
                        this._base = new Set(this._marks);
                    });
                    break;
            }
        }

        /** Delete rows — after a cancelable sac:request-remove, and then the
         *  built-in armed confirm that says how much goes. */
        async _remove(targets, permanent) {
            if (!targets.length || !this._store) return;
            const first = targets[0];
            const go = this._emit("sac:request-remove", {
                path: first.path,
                folder: first.kind === "folder",
                permanent: !!permanent,
                paths: targets.map((r) => r.path),
            }, true);
            if (!go) return;
            const store = this._store;
            // A folder goes with everything in it — say how much.
            const inside = async (r) => r.kind === "folder"
                ? (await store.list(r.path + "/")).filter((k) => !k.endsWith("/" + MARKER))
                : [];
            let answer = "delete";
            if (window.sac && sac.dialog) {
                let title, message;
                if (targets.length === 1) {
                    const folder = first.kind === "folder";
                    const n = (await inside(first)).length;
                    title = folder ? t("files.delete-folder-title", "Delete this folder?")
                                   : t("files.delete-title", "Delete this file?");
                    message = !folder
                        ? `“${first.name}” ${t("files.delete-message", "will be permanently deleted.")}`
                        : n
                            ? `“${first.name}” ${t("files.delete-folder-message", "and the {n} file(s) in it will be permanently deleted.")
                                .replace("{n}", n)}`
                            : `“${first.name}” ${t("files.delete-folder-empty", "is empty and will be removed.")}`;
                } else {
                    let files = 0;
                    for (const r of targets) files += r.kind === "folder" ? (await inside(r)).length : 1;
                    title = t("files.delete-many-title", "Delete {n} items?").replace("{n}", targets.length);
                    message = t("files.delete-many-message", "{n} items, {files} file(s) in all, will be permanently deleted.")
                        .replace("{n}", targets.length).replace("{files}", files);
                }
                answer = await sac.dialog.confirm({
                    title,
                    message,
                    buttons: [
                        // labelKey: the buttons follow a language switch in place.
                        { action: "cancel", label: "Cancel", labelKey: "files.cancel" },
                        { action: "delete", label: "Delete", labelKey: "files.delete", kind: "destructive", armAfterMs: 1200 },
                    ],
                });
            }
            if (answer !== "delete") return;
            const snap = this._snapshot();
            for (const r of targets) {
                const folder = r.kind === "folder";
                try {
                    if (folder) {
                        for (const key of await store.list(r.path + "/")) await store.remove(key);
                    } else {
                        await store.remove(r.path);
                    }
                } catch (err) { console.error("[sac-file-browser] remove() failed:", err); break; }
                this._sel.delete(r.path);
                this._marks.delete(r.path);
                this._emit("sac:remove", { path: r.path, folder });
            }
            if (this._snapshot().marks !== snap.marks) this._emit("sac:mark", { paths: this.marked });
            await this.refresh();
            this.shadowRoot.querySelector(".list").focus({ preventScroll: true });
        }

        /* ---------------------------------------------------- drag/drop -- */

        _dragStart(e) {
            const row = e.target.closest && e.target.closest(".canvas > .row");
            const r = row ? this._rows[+row.dataset.i] : null;
            if (!r || this._renaming || !e.dataTransfer) { if (row) e.preventDefault(); return; }
            const paths = this._marks.has(r.path) ? this.marked : [r.path];
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ paths }));
            e.dataTransfer.setData("text/plain", paths.join("\n"));
            e.dataTransfer.effectAllowed = "copyMove";
            dragging = { source: this, paths };
        }

        /** Where a drag over this list would land, or null when it may not. */
        _dropTarget(e) {
            const dt = e.dataTransfer;
            if (!dt || !this._store || this.hasAttribute("readonly")) return null;
            const types = Array.from(dt.types || []);
            const internal = types.includes(DRAG_TYPE);
            if (!internal && !types.includes("Files")) return null;
            const row = e.target.closest && e.target.closest(".canvas > .row");
            const r = row ? this._rows[+row.dataset.i] : null;
            const onFolder = r && r.kind === "folder";
            const target = onFolder ? r.path : this._path;
            const copy = !internal || e.ctrlKey || e.altKey;
            if (internal && dragging && (dragging.source === this || dragging.source._store === this._store)) {
                const paths = dragging.paths;
                if (paths.some((p) => target === p || target.startsWith(p + "/"))) return null;
                if (!copy && paths.every((p) => dirName(p) === target)) return null;
            }
            return { internal, target, copy, row: onFolder ? row : null };
        }

        _dropHint(el) {
            const list = this.shadowRoot.querySelector(".list");
            list.classList.toggle("drop", el === list);
            list.querySelectorAll(".row.drop").forEach((r) => { if (r !== el) r.classList.remove("drop"); });
            if (el && el !== list) el.classList.add("drop");
            clearTimeout(this._dropTimer);
            // dragleave is noisy across child elements; a hint not renewed by
            // dragover within a beat goes away on its own.
            if (el) this._dropTimer = setTimeout(() => this._dropHint(null), 150);
        }

        _dragOver(e) {
            const d = this._dropTarget(e);
            if (!d) { this._dropHint(null); return; }
            e.preventDefault();
            e.dataTransfer.dropEffect = d.copy ? "copy" : "move";
            this._dropHint(d.row || this.shadowRoot.querySelector(".list"));
        }

        _drop(e) {
            const d = this._dropTarget(e);
            this._dropHint(null);
            if (!d) return;
            e.preventDefault();
            if (d.internal) {
                let paths = null;
                try { paths = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)).paths; } catch (err) { /* below */ }
                if (!Array.isArray(paths)) paths = dragging ? dragging.paths : [];
                this._emit("sac:drop", { paths, target: d.target, copy: d.copy, source: dragging ? dragging.source : null });
            } else {
                this._emit("sac:drop", { files: Array.from(e.dataTransfer.files || []), target: d.target, copy: true });
            }
            dragging = null;
        }

        /** Dispatch; a cancelable event answers false when prevented. */
        _emit(name, detail, cancelable = false) {
            return this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable }));
        }
    }

    customElements.define(TAG, SacFileBrowser);
})();
