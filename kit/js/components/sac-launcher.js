/**
 * <sac-launcher>  —  User-composed launcher tile grid.
 *
 * Renders one tile per app registered in `sac.apps` (kit/js/lib/apps.js),
 * merged with a per-user layer persisted in localStorage: tile order, hidden
 * apps, and user-added ("custom") apps. The host page registers the built-in
 * apps; the user rearranges, hides and extends them — the launcher is theirs.
 *
 * LIGHT-DOM EXCEPTION: this component intentionally renders into the light
 * DOM, not a shadow root. It is a layout-level pattern host, not a leaf
 * widget: it composes the global `.grid` / `.tile` launcher CSS patterns from
 * ui.css and hosts other sac-* elements inside its tiles. Its few own rules
 * are injected once into document.head, scoped under the `sac-launcher` tag
 * and `.sac-launcher-*` classes.
 *
 * Usage:
 *   <sac-launcher storage="demo-hub"></sac-launcher>
 *
 *   sac.apps.register({ id: "notes", name: "Notes", icon: "note",
 *                       kind: "window", tag: "app-notes", src: "apps/notes.js" });
 *   document.querySelector("sac-launcher").refresh();   // if registered late
 *
 * Attributes:
 *   storage — suffix of the localStorage key `sac.launcher.<storage>` holding
 *             { v: 1, order: [ids], hidden: [ids], custom: [manifests] }.
 *             Without the attribute: pure render of the registry — no
 *             persistence, no edit mode. Persisted ids that no longer exist
 *             are ignored and only dropped from storage the next time the
 *             user changes something. `custom` manifests are (re)registered
 *             into sac.apps on connect — they are the user-added apps.
 *   edit    — presence = edit mode. Toggled by the Edit button; settable by
 *             hand. Ignored (removed) when there is no `storage`.
 *   drag    — drag reorder: absent = in edit mode only (the default),
 *             "always" = also outside edit mode, "none" = buttons only.
 *             Needs `storage` and sac.sortable (kit/js/lib/sortable.js);
 *             without the helper the move buttons are the only path.
 *
 * Methods:
 *   refresh() — re-read sac.apps.list() and re-sync the grid in place. The
 *               component re-syncs itself on every "sac:apps-changed" the
 *               runtime emits (and on DOMContentLoaded), so registering apps
 *               after it connected just works; refresh() remains for hosts
 *               that mutate state outside sac.apps.
 *   setLinks(list) — plain link tiles beside the sac.apps entries, for
 *               anything that already has an address (a sac.router route,
 *               another page): [{ id, name, icon, description, href, badge,
 *               tile, accent, menu }]. No sac.apps registration involved. A
 *               link tile is a real <a href> — a "#/notes" href is an in-SPA
 *               navigation, never a reload. Its key is its `id`, sharing the
 *               key space (and so the persisted order/hidden layout) with the
 *               app tiles; an id that collides with an app tile is skipped
 *               with a warning. Link tiles can be moved and hidden, never
 *               removed (the host owns them). Unordered link tiles come
 *               before unordered app tiles. Replaces the previous list;
 *               `launcher.links` reads it back (assignable too).
 *   setBadge(key, value) — repaint ONE tile's corner pill: a string or
 *               number shows it, null or "" clears it, undefined drops the
 *               override so the manifest's own `badge` shows again. Touches
 *               nothing else (not sac.apps, not order or hidden state), may
 *               be called before the tile exists, and survives re-syncs.
 *   setMenu(key, items) — the tile's corner menu, overriding the entry's own
 *               `menu` (null = no menu, undefined = back to the entry's).
 *
 * Tile keys: an app id, "appId::tileId" for a multi-tile app's tile (see
 * Tiles), or a link tile's id — the same keys `sac:layout` reports.
 *
 * Per-tile menu: `menu` on a manifest, a manifest `tiles` entry, a link, or
 * via setMenu() — [{ id, label, labelKey, icon, danger, disabled, onClick }]
 * with "-" for a separator. It renders a <sac-menu> behind a "…" button in
 * the tile's bottom-right corner, in AND out of edit mode (the edit
 * controls own the top-right corner). On narrow phones (≤480px, where tiles
 * are rows) it sits centred on the right edge and steps aside for the edit
 * controls while editing. `labelKey` relabels the item on a
 * language switch (t(labelKey, label)). onClick(info) gets
 * { key, appId, action, launcher }; `appId` is null for a link tile.
 *
 * Events:
 *   sac:layout — detail { order, hidden, customCount } after every
 *                         user change (move / drag / hide / show / add /
 *                         remove). Bubbles + composed.
 *   sac:tile-action — detail { key, appId, action } when a tile-menu item
 *                         is chosen (action = the item's id, else its
 *                         index). Bubbles + composed; fires after onClick.
 *
 * Tiles:
 *   kind:"page" apps render as real <a> links; window and view apps render
 *   as real <button> tiles calling sac.apps.open(). Every tile looks the
 *   same — what a click does is not encoded in the border. A manifest with
 *   a `tiles` array deploys SEVERAL tiles for one app (each entry may
 *   override name/icon/description/badge/tile and carry `route` — a view
 *   sub-address — `params` for a window, and `accent`). A tile's `accent`
 *   colors the tile (icon, hover ring) AND seeds the app's --accent when
 *   opened through it — tile color = app highlight. Optional manifest
 *   fields shaping any tile: `badge` (short string — the tile's corner
 *   pill, rendered with the global .tile-badge pattern from ui.css) and
 *   `tile` ("medium" default | "wide" spans 2 grid columns | "large" spans
 *   2 columns AND 2 rows; unknown values fall back to medium silently). All
 *   footprints collapse to medium on narrow viewports (≤768px), matching
 *   the .grid pattern — and whenever the grid itself is too narrow for two
 *   columns (a launcher inside a sac-window or split panel on a wide
 *   screen), via a container query on the grid. In edit mode each tile grows keyboard-reachable
 *   controls: move left / move right / hide (or show, on grayed hidden
 *   tiles) and — for custom apps only — remove; the badge hides while
 *   editing so the controls own the corner. Built-in (host-registered)
 *   apps can only be hidden, never removed.
 *   A dashed "Add app" tile opens a <sac-dialog> form: name, icon, tag,
 *   script URL, width, height. The form stays lean by design — user-added
 *   apps are always medium tiles with no badge.
 *
 * Drag reorder (sac.sortable, axis "grid"): mouse/pen lift after 4px, touch
 * after a 250ms long-press (a swipe keeps scrolling the page), Escape puts
 * the tile back. A dashed outline marks the slot the tile will land in. A
 * drop persists exactly like the move buttons (the effective order is
 * stored and sac:layout fires); the buttons stay the keyboard path.
 *
 * Compact/touch: the grid goes single-column below ~584px of its own width
 * (the .grid pattern's 280px minimum), wide/large tiles included — a span-2
 * cell in a one-column grid would otherwise add a phantom column and scroll
 * the page sideways. Under (pointer: coarse) the edit controls grow from 28px
 * to a 36px look with a 44px hit halo (gap 8px, so neighbouring halos just
 * touch and never overlap); the tile-menu button does the same. Under
 * (hover: none) the Add tile's hover tint is
 * off (a tap would leave it stuck). The launcher never positions the windows
 * it opens — sac.apps creates them and sac-window maximizes itself on
 * compact.
 *
 * Portability note: the "Add app" script URL may be a full cross-origin URL —
 * sac.apps injects it as a classic <script> tag, and classic script tags need
 * no CORS. Any origin serving a guarded single-tag web component (the app
 * contract) can be pulled into a user's launcher.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacLauncher extends HTMLElement {
    static get observedAttributes() { return ["storage", "edit", "drag"]; }

    constructor() {
        super();
        this._state = { order: [], hidden: [], custom: [] }; // persisted layer
        this._order = [];        // effective full order (known ids only)
        this._tiles = new Map(); // id → cell element
        this._links = [];        // setLinks() — plain link tiles
        this._badges = new Map(); // key → badge override (setBadge)
        this._menus = new Map();  // key → menu override (setMenu)
        this._sortable = null;
        this._grid = null;
        this._dialog = null;
        this._form = null;
        this._formEl = null;
        this._warned = false;
        this._uid = `sac-launcher-${SacLauncher._instances++}`;
        this._onReady = this._onReady.bind(this);
        this._onDialogKeydown = this._onDialogKeydown.bind(this);
    }

    connectedCallback() {
        if (!this._grid) this._build();
        // Host pages typically register their apps in a DOMContentLoaded
        // handler — i.e. AFTER this component (a deferred script) upgraded.
        // The runtime emits "sac:apps-changed" on every register/remove;
        // re-syncing on it makes registration order irrelevant. The
        // DOMContentLoaded re-sync stays as belt and braces.
        document.addEventListener("sac:apps-changed", this._onReady);
        if (document.readyState !== "complete") {
            document.addEventListener("DOMContentLoaded", this._onReady);
        }
        this._loadState();
        this._sync();
        this._syncEditUI();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
        if (!this._sortable && window.sac && typeof sac.sortable === "function") {
            this._sortable = sac.sortable(this._grid, {
                axis: "grid",
                items: SacLauncher.DRAG_ITEMS,
                ignore: "input, textarea, select, [contenteditable], [data-sortable-ignore], " +
                        ".sac-launcher-controls, sac-menu",
                disabled: () => !this._dragAllowed(),
                onReorder: () => this._onDrop(),
            });
        }
        if (!this._dragObserver) {
            // The live slot of a lifted tile gets the drop outline.
            this._dragObserver = new MutationObserver(() => this._trackDrag());
            this._dragObserver.observe(this._grid, {
                subtree: true, attributes: true, attributeFilter: ["data-sortable-dragging"] });
        }
    }

    disconnectedCallback() {
        if (this._sortable) { this._sortable.destroy(); this._sortable = null; }
        if (this._dragObserver) { this._dragObserver.disconnect(); this._dragObserver = null; }
        this._stopTrack();
        if (this._offLang) { this._offLang(); this._offLang = null; }
        document.removeEventListener("sac:apps-changed", this._onReady);
        document.removeEventListener("DOMContentLoaded", this._onReady);
        document.removeEventListener("keydown", this._onDialogKeydown, true);
        if (this._dialog) { this._dialog.remove(); this._dialog = null; }
    }

    attributeChangedCallback(name, oldV, newV) {
        if (!this._grid || oldV === newV) return;
        if (name === "storage") {
            this._loadState();
            this._sync();
            this._syncEditUI();
        } else if (name === "edit" || name === "drag") {
            this._syncEditUI();
        }
    }

    /**
     * Language switch: every kit string in place — the add tile, the empty
     * note, the Edit/Done button, each tile's control labels and an open (or
     * built) Add dialog. Order, edit mode, focus and typed form values stay.
     */
    _relabel() {
        if (!this._grid) return;
        this._addLabel.textContent = t("launcher.add-app", "Add app");
        this._empty.textContent = t("launcher.no-apps", "No apps registered.");
        this._editBtn.textContent = this.hasAttribute("edit")
            ? t("launcher.done", "Done") : t("launcher.edit", "Edit");
        this._tiles.forEach((cell) => { this._labelCell(cell); this._labelMenu(cell); });
        if (this._dialog) this._labelForm();
    }

    /** Re-read the registry and re-sync the grid (targeted updates only). */
    refresh() { this._sync(); }

    /** Plain link tiles beside the sac.apps entries (see header). */
    setLinks(list) {
        const out = [];
        const seen = new Set();
        (Array.isArray(list) ? list : []).forEach((l) => {
            if (!l || typeof l !== "object" || typeof l.id !== "string" || !l.id || seen.has(l.id)) {
                console.warn("[sac-launcher] setLinks(): skipping a link without a unique string id", l);
                return;
            }
            seen.add(l.id);
            out.push(Object.assign({}, l));
        });
        this._links = out;
        if (this._grid) this._sync();
    }

    get links() { return this._links.map(l => Object.assign({}, l)); }
    set links(list) { this.setLinks(list); }

    /** Repaint one tile's badge — nothing else (see header). */
    setBadge(key, value) {
        if (value === undefined) this._badges.delete(key);
        else this._badges.set(key, value);
        const cell = this._tiles.get(key);
        if (cell) this._paintBadge(cell);
    }

    /** Replace one tile's corner menu (see header). */
    setMenu(key, items) {
        if (items === undefined) this._menus.delete(key);
        else this._menus.set(key, items);
        const cell = this._tiles.get(key);
        if (cell) this._paintMenu(cell);
    }

    _onReady() { this.refresh(); }

    /* ------------------------------------------------------------------ */
    /* Build (once)                                                        */
    /* ------------------------------------------------------------------ */

    _build() {
        SacLauncher._injectStyles();
        this.textContent = "";

        this._grid = document.createElement("div");
        this._grid.className = "grid";

        // The dashed "Add app" tile — always last in the grid, edit mode only.
        this._addCell = document.createElement("div");
        this._addCell.className = "sac-launcher-cell sac-launcher-add-cell";
        this._addBtn = document.createElement("button");
        this._addBtn.type = "button";
        this._addBtn.className = "tile sac-launcher-add";
        const addIcon = document.createElement("sac-icon");
        addIcon.setAttribute("name", "plus");
        const addLabel = document.createElement("span");
        addLabel.textContent = t("launcher.add-app", "Add app");
        this._addLabel = addLabel;
        this._addBtn.append(addIcon, addLabel);
        this._addBtn.addEventListener("click", () => this._openAddDialog());
        this._addCell.appendChild(this._addBtn);
        this._grid.appendChild(this._addCell);

        // Drop indicator: out of the grid flow (absolute), last child — the
        // in-place reorder in _sync() never walks past the Add cell.
        this._dropMark = document.createElement("div");
        this._dropMark.className = "sac-launcher-drop";
        this._dropMark.setAttribute("aria-hidden", "true");
        this._dropMark.hidden = true;
        this._grid.appendChild(this._dropMark);

        this._empty = document.createElement("p");
        this._empty.className = "sac-launcher-empty";
        this._empty.textContent = t("launcher.no-apps", "No apps registered.");
        this._empty.hidden = true;

        this._footer = document.createElement("div");
        this._footer.className = "sac-launcher-footer";
        this._editBtn = document.createElement("button");
        this._editBtn.type = "button";
        this._editBtn.className = "btn sac-launcher-edit";
        this._editBtn.textContent = t("launcher.edit", "Edit");
        this._editBtn.setAttribute("aria-pressed", "false");
        this._editBtn.addEventListener("click", () => this.toggleAttribute("edit"));
        this._footer.appendChild(this._editBtn);

        this.append(this._grid, this._empty, this._footer);
    }

    /* ------------------------------------------------------------------ */
    /* Persistence                                                         */
    /* ------------------------------------------------------------------ */

    _storageKey() {
        const s = this.getAttribute("storage");
        return s ? `sac.launcher.${s}` : null;
    }

    _canEdit() { return this._storageKey() !== null; }

    _loadState() {
        this._state = { order: [], hidden: [], custom: [] };
        const key = this._storageKey();
        if (!key) return;
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const data = JSON.parse(raw);
                if (data && data.v === 1) {
                    if (Array.isArray(data.order))
                        this._state.order = data.order.filter(x => typeof x === "string");
                    if (Array.isArray(data.hidden))
                        this._state.hidden = data.hidden.filter(x => typeof x === "string");
                    if (Array.isArray(data.custom))
                        this._state.custom = data.custom.filter(m =>
                            m && typeof m === "object" && typeof m.id === "string");
                }
            }
        } catch (err) {
            console.warn(`[sac-launcher] could not read ${key}:`, err);
        }
        // Custom manifests are the user's own apps — put them (back) into the
        // registry so sac.apps can open and deep-link them.
        if (window.sac && sac.apps) {
            this._state.custom.forEach(m => sac.apps.register(Object.assign({}, m)));
        }
    }

    _persist() {
        const key = this._storageKey();
        if (!key) return;
        // Stale keys (apps/tiles no longer registered) drop out here — on a
        // user change, never proactively on load. Filter against the ENTRY
        // keys, not app ids: a multi-tile app stores composite "appId::tileId"
        // keys, and matching those against ids alone discards every multi-tile
        // customization on save.
        const known = new Set(this._allEntries().map(e => e.key));
        this._state.order = this._order.filter(id => known.has(id));
        this._state.hidden = this._state.hidden.filter(id => known.has(id));
        try {
            localStorage.setItem(key, JSON.stringify({
                v: 1,
                order: this._state.order,
                hidden: this._state.hidden,
                custom: this._state.custom,
            }));
        } catch (err) {
            console.warn(`[sac-launcher] could not write ${key}:`, err);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Registry → grid sync (in place)                                     */
    /* ------------------------------------------------------------------ */

    _apps() {
        if (!window.sac || !sac.apps) {
            // A links-only launcher is legitimate without the app runtime.
            if (!this._warned && !this._links.length) {
                this._warned = true;
                console.warn("[sac-launcher] sac.apps is not loaded — load kit/js/lib/apps.js before the components.");
            }
            return [];
        }
        return sac.apps.list();
    }

    /**
     * A manifest expands into its launcher tiles: the `tiles` array when
     * present (complex apps deploy several entry points), the manifest
     * itself as the single default tile otherwise. Keys stay backward
     * compatible: a default tile's key IS the app id, so persisted layouts
     * survive the upgrade.
     */
    _entries(apps) {
        const out = [];
        apps.forEach((m) => {
            const kind = m.kind === "page" ? "page" : "window";
            const list = Array.isArray(m.tiles) && m.tiles.length ? m.tiles : null;
            if (!list) {
                out.push({ key: m.id, appId: m.id, kind,
                    name: m.name, icon: m.icon, description: m.description,
                    badge: m.badge, tile: m.tile, accent: m.accent,
                    route: undefined, params: undefined, href: m.href,
                    menu: m.menu });
                return;
            }
            list.forEach((tl, i) => {
                out.push({
                    key: `${m.id}::${tl.id != null ? tl.id : (tl.route != null ? tl.route : i)}`,
                    appId: m.id, kind,
                    name: tl.name || m.name,
                    icon: tl.icon || m.icon,
                    description: tl.description != null ? tl.description : m.description,
                    badge: tl.badge != null ? tl.badge : m.badge,
                    tile: tl.tile || m.tile,
                    accent: tl.accent || m.accent,
                    route: tl.route, params: tl.params,
                    href: tl.href || m.href,
                    menu: tl.menu !== undefined ? tl.menu : m.menu,
                });
            });
        });
        // Link tiles (setLinks) — before the app tiles, so unordered ones
        // come first; an app tile wins a key collision.
        const taken = new Set(out.map(e => e.key));
        const links = [];
        this._links.forEach((l) => {
            if (taken.has(l.id)) {
                if (!this._collided) this._collided = new Set();
                if (!this._collided.has(l.id)) {
                    this._collided.add(l.id);
                    console.warn(`[sac-launcher] link "${l.id}" collides with an app tile key — skipped.`);
                }
                return;
            }
            links.push({ key: l.id, appId: null, link: true, kind: "page",
                name: l.name, icon: l.icon, description: l.description,
                badge: l.badge, tile: l.tile, accent: l.accent,
                route: undefined, params: undefined, href: l.href,
                menu: l.menu });
        });
        return links.concat(out);
    }

    /** Every tile entry: link tiles + the registry's app tiles. */
    _allEntries() { return this._entries(this._apps()); }

    _sync() {
        // A tile in flight owns the DOM order until it lands; catch up then.
        if (this._dragging) { this._syncPending = true; return; }
        const entries = this._allEntries();
        const byKey = new Map(entries.map(e => [e.key, e]));

        // Effective order: persisted order (known keys only, stale keys
        // ignored), then any registry tiles not yet ordered, appended in
        // registration order.
        const ordered = this._state.order.filter(key => byKey.has(key));
        const seen = new Set(ordered);
        entries.forEach(e => { if (!seen.has(e.key)) ordered.push(e.key); });
        this._order = ordered;

        // Drop tiles whose entry disappeared (or whose kind changed).
        for (const [key, cell] of Array.from(this._tiles)) {
            const e = byKey.get(key);
            if (!e || cell._kind !== e.kind) {
                cell.remove();
                this._tiles.delete(key);
            }
        }

        // Create missing tiles, update all in place.
        const customIds = new Set(this._state.custom.map(m => m.id));
        const hidden = new Set(this._state.hidden);
        this._order.forEach((key, i) => {
            const e = byKey.get(key);
            let cell = this._tiles.get(key);
            if (!cell) {
                cell = this._makeCell(e);
                this._tiles.set(key, cell);
            }
            this._updateCell(cell, e, {
                hidden: hidden.has(key),
                custom: customIds.has(e.appId),
                first: i === 0,
                last: i === this._order.length - 1,
            });
        });

        // Minimal reorder: only nodes actually out of place are moved, so an
        // untouched tile (and any focus inside it) is never disturbed.
        const desired = this._order.map(id => this._tiles.get(id));
        desired.push(this._addCell);
        let cursor = this._grid.firstElementChild;
        for (const cell of desired) {
            if (cell === cursor) cursor = cursor.nextElementSibling;
            else this._grid.insertBefore(cell, cursor);
        }

        // In edit mode the Add tile is visible, so the empty hint would lie.
        this._empty.hidden = this._order.length > 0 || this.hasAttribute("edit");
    }

    _makeCell(entry) {
        const kind = entry.kind;

        // Cell wrapper: the tile is a real link/button and the edit controls
        // are real buttons NEXT to it (absolutely positioned on top) — never
        // interactive elements nested inside an interactive element.
        const cell = document.createElement("div");
        cell.className = "sac-launcher-cell";
        cell.dataset.id = entry.key;
        cell._kind = kind;
        cell._entry = entry;

        let tile;
        if (kind === "page") {
            tile = document.createElement("a");
        } else {
            tile = document.createElement("button");
            tile.type = "button";
        }
        tile.className = "tile sac-launcher-tile";
        tile.addEventListener("click", (e) => {
            if (this.hasAttribute("edit")) { e.preventDefault(); return; }
            if (kind !== "page") {
                e.preventDefault();
                // The tile carries what makes it distinct: its route into a
                // view app, its params for a window app, its accent for both.
                // The runtime reports load failures itself (console + toast).
                const t2 = cell._entry;
                if (window.sac && sac.apps) {
                    sac.apps.open(t2.appId, t2.params,
                        { route: t2.route, accent: t2.accent }).catch(() => {});
                }
            }
        });

        // Corner pill — the global .tile-badge pattern from ui.css, in its
        // accent variant (the plain one is the danger-tinted warning pill).
        // Kept in the DOM and toggled via [hidden] so a re-registered
        // manifest can add or drop its badge without a rebuild.
        cell._badge = document.createElement("span");
        cell._badge.className = "tile-badge accent";
        cell._badge.hidden = true;

        cell._icon = document.createElement("sac-icon");
        const body = document.createElement("div");
        body.className = "sac-launcher-tile-body";
        cell._h = document.createElement("h2");
        cell._p = document.createElement("p");
        body.append(cell._h, cell._p);
        tile.append(cell._badge, cell._icon, body);
        cell._tile = tile;
        cell.appendChild(tile);

        const controls = document.createElement("span");
        controls.className = "sac-launcher-controls";
        const mk = (cls, iconName, handler) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `sac-launcher-ctrl ${cls}`;
            const ic = document.createElement("sac-icon");
            ic.setAttribute("name", iconName);
            b.appendChild(ic);
            b.addEventListener("click", handler);
            controls.appendChild(b);
            return b;
        };
        cell._left = mk("left", "chevron-left", () => {
            this._move(entry.key, -1);
            this._moveFocus(cell, -1);
        });
        cell._right = mk("right", "chevron-right", () => {
            this._move(entry.key, +1);
            this._moveFocus(cell, +1);
        });
        cell._vis = mk("vis", "eye-off", () => this._toggleHidden(entry.key));
        cell._del = mk("del", "trash", () => this._removeCustom(cell._entry.appId));
        cell.appendChild(controls);
        return cell;
    }

    _updateCell(cell, entry, f) {
        cell._entry = entry;
        const name = entry.name || entry.appId;
        cell._icon.setAttribute("name", entry.icon || "shapes");
        cell._h.textContent = name;
        cell._p.textContent = entry.description || "";
        cell._p.hidden = !entry.description;
        if (cell._kind === "page") cell._tile.setAttribute("href", entry.href || "#");
        cell.classList.toggle("hidden-app", f.hidden);
        cell.classList.toggle("custom-app", f.custom);

        // The tile's accent seed: icon color, hover ring and glow follow —
        // and the same color rides into the app when opened through it.
        if (entry.accent) cell._tile.style.setProperty("--accent", entry.accent);
        else cell._tile.style.removeProperty("--accent");

        this._paintBadge(cell);
        this._paintMenu(cell);

        // Manifest-declared footprint; unknown values fall back to medium.
        cell.classList.toggle("size-wide", entry.tile === "wide");
        cell.classList.toggle("size-large", entry.tile === "large");

        cell._left.disabled = f.first;
        cell._right.disabled = f.last;
        cell._vis.querySelector("sac-icon").setAttribute("name", f.hidden ? "eye" : "eye-off");
        cell._del.hidden = !f.custom; // built-ins can only be hidden, never removed
        this._labelCell(cell);

        // In edit mode the tiles themselves are inert; keyboard focus goes
        // straight to the controls.
        if (this.hasAttribute("edit")) cell._tile.setAttribute("tabindex", "-1");
        else cell._tile.removeAttribute("tabindex");
    }

    /** The corner pill: a setBadge() override wins over the entry's badge. */
    _paintBadge(cell) {
        const key = cell._entry.key;
        const raw = this._badges.has(key) ? this._badges.get(key) : cell._entry.badge;
        const badge = raw == null ? "" : String(raw).trim();
        cell._badge.textContent = badge;
        cell._badge.hidden = !badge;
    }

    /**
     * The corner menu: a setMenu() override wins over the entry's `menu`.
     * Rebuilt only when the item list itself changes, so a re-sync never
     * closes an open menu under the user's finger.
     */
    _paintMenu(cell) {
        const key = cell._entry.key;
        const src = this._menus.has(key) ? this._menus.get(key) : cell._entry.menu;
        const items = Array.isArray(src) ? src.filter(it => it === "-" || (it && typeof it === "object")) : [];
        const has = items.some(it => it !== "-");
        if (cell._menuSrc === src && !!cell._menu === has) return;
        cell._menuSrc = src;
        cell.classList.toggle("has-menu", has);
        if (!has) {
            if (cell._menu) { cell._menu.remove(); cell._menu = null; }
            return;
        }
        if (!cell._menu) {
            const menu = document.createElement("sac-menu");
            menu.className = "sac-launcher-menu";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.slot = "trigger";
            btn.className = "sac-launcher-ctrl sac-launcher-menu-btn";
            const ic = document.createElement("sac-icon");
            ic.setAttribute("name", "more");
            btn.appendChild(ic);
            menu.appendChild(btn);
            menu.addEventListener("sac:select", (e) => {
                e.stopPropagation();
                this._onMenuSelect(cell, e.detail && e.detail.action);
            });
            cell._menu = menu;
            cell._menuBtn = btn;
            cell.appendChild(menu);
        }
        // Items: replace everything but the trigger.
        Array.from(cell._menu.children).forEach((n) => { if (n !== cell._menuBtn) n.remove(); });
        cell._menuItems = [];
        items.forEach((it, i) => {
            if (it === "-") { cell._menu.appendChild(document.createElement("hr")); return; }
            const b = document.createElement("button");
            b.type = "button";
            b.dataset.action = String(i);
            if (it.danger) b.setAttribute("data-danger", "");
            if (it.disabled) b.disabled = true;
            if (it.icon) {
                const ic = document.createElement("sac-icon");
                ic.setAttribute("name", it.icon);
                b.appendChild(ic);
            }
            const lab = document.createElement("span");
            b.appendChild(lab);
            b._item = it;
            b._label = lab;
            cell._menuItems[i] = it;
            cell._menu.appendChild(b);
        });
        this._labelMenu(cell);
    }

    /** The menu trigger's label and every item's text (host strings via
     *  t(labelKey, label), so a language switch relabels them too). */
    _labelMenu(cell) {
        if (!cell._menu) return;
        const name = cell._entry.name || cell._entry.appId || cell._entry.key;
        cell._menuBtn.setAttribute("aria-label",
            t("launcher.tile-menu", "Actions for {name}").replace("{name}", name));
        cell._menu.querySelectorAll(":scope > button[data-action]").forEach((b) => {
            const it = b._item;
            b._label.textContent = it.labelKey ? t(it.labelKey, it.label || "") : String(it.label || "");
        });
    }

    _onMenuSelect(cell, action) {
        const it = cell._menuItems && cell._menuItems[Number(action)];
        if (!it) return;
        const e = cell._entry;
        const id = it.id != null ? it.id : Number(action);
        const info = { key: e.key, appId: e.appId, action: id, launcher: this };
        if (typeof it.onClick === "function") {
            try { it.onClick(info); }
            catch (err) { console.error("[sac-launcher] tile menu onClick failed:", err); }
        }
        this.dispatchEvent(new CustomEvent("sac:tile-action", {
            bubbles: true, composed: true,
            detail: { key: e.key, appId: e.appId, action: id },
        }));
    }

    /** The edit controls' labels — from the cell's current entry and state. */
    _labelCell(cell) {
        const entry = cell._entry;
        const name = entry.name || entry.appId;
        cell._left.setAttribute("aria-label",
            t("launcher.move-left", "Move {name} left").replace("{name}", name));
        cell._right.setAttribute("aria-label",
            t("launcher.move-right", "Move {name} right").replace("{name}", name));
        cell._vis.setAttribute("aria-label", (cell.classList.contains("hidden-app")
            ? t("launcher.show", "Show {name}")
            : t("launcher.hide", "Hide {name}")).replace("{name}", name));
        cell._del.setAttribute("aria-label",
            t("launcher.remove", "Remove {name}").replace("{name}", name));
    }

    _syncEditUI() {
        if (this.hasAttribute("edit") && !this._canEdit()) {
            this.removeAttribute("edit"); // no storage → no edit mode
            return;
        }
        const editing = this.hasAttribute("edit");
        this._footer.hidden = !this._canEdit();
        this._empty.hidden = this._order.length > 0 || editing;
        this._editBtn.textContent = editing ? t("launcher.done", "Done") : t("launcher.edit", "Edit");
        this._editBtn.setAttribute("aria-pressed", String(editing));
        this._tiles.forEach(cell => {
            if (editing) cell._tile.setAttribute("tabindex", "-1");
            else cell._tile.removeAttribute("tabindex");
        });
        this._grid.classList.toggle("sac-launcher-can-drag", this._dragAllowed());
    }

    /* ------------------------------------------------------------------ */
    /* Drag reorder (sac.sortable does the pointer work)                   */
    /* ------------------------------------------------------------------ */

    _dragAllowed() {
        const mode = this.getAttribute("drag");
        if (!this._canEdit() || mode === "none") return false;
        if (!(window.sac && typeof sac.sortable === "function")) return false;
        return mode === "always" || this.hasAttribute("edit");
    }

    /** Lift / land observed: show the slot outline while a tile is up. */
    _trackDrag() {
        const cell = this._grid.querySelector(":scope > [data-sortable-dragging]");
        if (!cell) { this._stopTrack(); return; }
        if (this._dragging === cell) return;
        this._dragging = cell;
        this._dropMark.hidden = false;
        this._dropMark.classList.remove("placed");   // first frame: no slide-in
        const step = () => {
            if (this._dragging !== cell) return;
            // offset* ignore the transform sortable puts on the lifted cell:
            // they are its slot — exactly where it lands on release.
            const s = this._dropMark.style;
            s.left = `${cell.offsetLeft}px`;
            s.top = `${cell.offsetTop}px`;
            s.width = `${cell.offsetWidth}px`;
            s.height = `${cell.offsetHeight}px`;
            if (!this._dropMark.classList.contains("placed")) {
                requestAnimationFrame(() => this._dropMark.classList.add("placed"));
            }
            this._trackRaf = requestAnimationFrame(step);
        };
        step();
    }

    _stopTrack() {
        const was = this._dragging;
        this._dragging = null;
        if (this._trackRaf) { cancelAnimationFrame(this._trackRaf); this._trackRaf = 0; }
        if (this._dropMark) { this._dropMark.hidden = true; this._dropMark.classList.remove("placed"); }
        if (was && this._syncPending) {
            this._syncPending = false;
            // After sortable's own clean-up (and onReorder) in this task.
            queueMicrotask(() => this._sync());
        }
    }

    /**
     * A drop moved a cell in the DOM. Read the new order straight from the
     * grid (hidden cells keep their places) and persist it exactly like the
     * move buttons do.
     */
    _onDrop() {
        this._dragging = null;          // landed — _sync() may touch the DOM again
        this._syncPending = false;      // _afterChange() re-syncs anyway
        const order = Array.from(this._grid.children)
            .filter(c => c.classList.contains("sac-launcher-cell") && c !== this._addCell)
            .map(c => c.dataset.id);
        if (order.length !== this._order.length) return;
        this._order = order;
        this._state.order = order.slice();
        this._afterChange();
    }

    /* ------------------------------------------------------------------ */
    /* User changes                                                        */
    /* ------------------------------------------------------------------ */

    _move(id, delta) {
        const i = this._order.indexOf(id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= this._order.length) return;
        [this._order[i], this._order[j]] = [this._order[j], this._order[i]];
        this._state.order = this._order.slice();
        this._afterChange();
    }

    _moveFocus(cell, dir) {
        // Reordering moves the cell in the DOM, which drops focus — put it
        // back on the pressed control (or its counterpart at the boundary).
        const btn = dir < 0 ? cell._left : cell._right;
        (btn.disabled ? (dir < 0 ? cell._right : cell._left) : btn).focus();
    }

    _toggleHidden(id) {
        const i = this._state.hidden.indexOf(id);
        if (i >= 0) this._state.hidden.splice(i, 1);
        else this._state.hidden.push(id);
        this._afterChange();
    }

    _removeCustom(id) {
        const i = this._state.custom.findIndex(m => m.id === id);
        if (i < 0) return; // built-in — only hideable
        this._state.custom.splice(i, 1);
        this._state.hidden = this._state.hidden.filter(x => x !== id);
        this._state.order = this._state.order.filter(x => x !== id);
        if (window.sac && sac.apps) sac.apps.remove(id);
        this._afterChange();
    }

    _afterChange() {
        this._sync();
        this._persist();
        this.dispatchEvent(new CustomEvent("sac:layout", {
            bubbles: true,
            composed: true,
            detail: {
                order: this._order.slice(),
                hidden: this._state.hidden.slice(),
                customCount: this._state.custom.length,
            },
        }));
    }

    /* ------------------------------------------------------------------ */
    /* Add-app dialog                                                      */
    /* ------------------------------------------------------------------ */

    _openAddDialog() {
        if (!this._dialog) this._buildDialog();
        if (typeof this._dialog.open !== "function") {
            console.warn("[sac-launcher] <sac-dialog> is not loaded.");
            return;
        }
        this._clearFormErrors();
        this._showDialog();
    }

    _showDialog() {
        // Our keydown listener must register BEFORE the dialog's own (both
        // capture on document; same node fires in registration order) so we
        // can extend its focus trap across the form inputs.
        document.addEventListener("keydown", this._onDialogKeydown, true);
        this._dialog.open();
        const firstBad = this._formEl.querySelector('[aria-invalid="true"]');
        (firstBad || this._form.name).focus();
    }

    _buildDialog() {
        const dlg = document.createElement("sac-dialog");
        dlg.setAttribute("title", t("launcher.add-app", "Add app"));
        // labelKey: the dialog relabels its own buttons on a language switch.
        dlg.buttons = [
            { action: "cancel", label: "Cancel", labelKey: "launcher.cancel", kind: "default" },
            { action: "add", label: "Add", labelKey: "launcher.add", kind: "primary" },
        ];

        this._form = {};
        const form = document.createElement("div");
        form.className = "sac-launcher-form";

        this._formHint = document.createElement("p");
        this._formHint.className = "sac-launcher-form-hint";
        form.appendChild(this._formHint);

        this._formError = document.createElement("p");
        this._formError.className = "sac-launcher-form-error";
        this._formError.setAttribute("role", "alert");
        this._formError.hidden = true;
        form.appendChild(this._formError);

        this._formLabels = {};
        const field = (key) => {
            const wrap = document.createElement("div");
            const lab = document.createElement("label");
            lab.htmlFor = `${this._uid}-${key}`;
            const inp = document.createElement("input");
            inp.type = "text";
            inp.id = `${this._uid}-${key}`;
            wrap.append(lab, inp);
            this._form[key] = inp;
            this._formLabels[key] = lab;
            return wrap;
        };
        form.append(field("name"), field("icon"), field("tag"), field("src"));
        const row = document.createElement("div");
        row.className = "sac-launcher-form-row";
        row.append(field("width"), field("height"));
        form.appendChild(row);
        this._formProblems = [];
        this._dialog = dlg;
        this._labelForm();

        dlg.appendChild(form);
        document.body.appendChild(dlg);
        dlg.addEventListener("sac:action", (e) => this._onDialogAction(e.detail.action));
        this._dialog = dlg;
        this._formEl = form;
    }

    /** Every kit string of the Add dialog — at build and on a language
     *  switch (in place: typed values, focus and the error state survive). */
    _labelForm() {
        this._dialog.setAttribute("title", t("launcher.add-app", "Add app"));
        this._formHint.textContent = t("launcher.add-hint",
            "The script is loaded on first open and must define the tag. Any URL works — including other sites.");
        for (const [key, [label, placeholder]] of Object.entries(SacLauncher.FIELDS)) {
            this._formLabels[key].textContent = t(`launcher.field-${key}`, label);
            this._form[key].placeholder = t(`launcher.placeholder-${key}`, placeholder);
        }
        if (this._formProblems.length) {
            const problems = this._formProblems.map((k) => t(`launcher.error-${k}`, SacLauncher.PROBLEMS[k]));
            this._formError.textContent = t("launcher.error-needs", "An app needs {problems}.")
                .replace("{problems}", problems.join(", "));
        }
    }

    _onDialogKeydown(e) {
        const dlg = this._dialog;
        if (!dlg || !dlg.hasAttribute("open")) return;
        const active = document.activeElement;
        const inForm = this._formEl.contains(active);

        if (e.key === "Enter" && inForm && active.tagName === "INPUT") {
            e.preventDefault();
            e.stopImmediatePropagation();
            dlg.close("add");
            return;
        }
        if (e.key !== "Tab") return;

        // Extend the dialog's focus trap (it only knows its own shadow
        // buttons) to a ring of: form inputs → dialog buttons → form inputs.
        const inputs = Array.from(this._formEl.querySelectorAll("input"));
        const btns = dlg.shadowRoot
            ? Array.from(dlg.shadowRoot.querySelectorAll(".btn"))
            : [];
        const ring = inputs.concat(btns);
        if (ring.length === 0) return;
        let idx = ring.indexOf(active);
        if (idx < 0 && dlg.shadowRoot) idx = ring.indexOf(dlg.shadowRoot.activeElement);
        e.preventDefault();
        e.stopImmediatePropagation(); // the dialog's own trap must not also fire
        let next;
        if (e.shiftKey) next = ring[(idx <= 0 ? ring.length : idx) - 1];
        else next = ring[(idx + 1) % ring.length];
        next.focus();
    }

    _onDialogAction(action) {
        document.removeEventListener("keydown", this._onDialogKeydown, true);
        if (action !== "add") {
            if (this.hasAttribute("edit")) this._addBtn.focus();
            return;
        }

        const f = this._form;
        const name = f.name.value.trim();
        const tag = f.tag.value.trim().toLowerCase();
        const src = f.src.value.trim();
        const badName = !name;
        const badTag = !tag || !tag.includes("-") || /\s/.test(tag);
        const badSrc = !src;

        this._clearFormErrors();
        if (badName || badTag || badSrc) {
            // Kept as keys, so a language switch can re-word the message.
            const problems = this._formProblems = [];
            if (badName) { problems.push("name"); f.name.setAttribute("aria-invalid", "true"); }
            if (badTag) { problems.push("tag"); f.tag.setAttribute("aria-invalid", "true"); }
            if (badSrc) { problems.push("src"); f.src.setAttribute("aria-invalid", "true"); }
            this._labelForm();
            this._formError.hidden = false;
            // Re-open immediately (same task, no repaint between) — the form
            // and its values are light DOM and survive untouched.
            this._showDialog();
            return;
        }

        const size = (v) => {
            v = v.trim();
            if (!v) return null;
            return /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
        };
        const manifest = {
            id: this._uniqueId(name),
            name,
            icon: f.icon.value.trim() || "shapes",
            kind: "window",
            tag,
            src,
        };
        const w = size(f.width.value);
        const h = size(f.height.value);
        if (w) manifest.width = w;
        if (h) manifest.height = h;

        if (window.sac && sac.apps) sac.apps.register(Object.assign({}, manifest));
        this._state.custom.push(manifest);
        this._afterChange();
        this._resetForm();
        if (this.hasAttribute("edit")) this._addBtn.focus();
    }

    _clearFormErrors() {
        if (!this._formEl) return;
        this._formProblems = [];
        this._formError.hidden = true;
        this._formError.textContent = "";
        this._formEl.querySelectorAll("[aria-invalid]").forEach(inp =>
            inp.removeAttribute("aria-invalid"));
    }

    _resetForm() {
        Object.values(this._form).forEach(inp => { inp.value = ""; });
        this._clearFormErrors();
    }

    _uniqueId(name) {
        const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
        const taken = (x) =>
            (window.sac && sac.apps && sac.apps.get(x) !== null) ||
            this._state.custom.some(m => m.id === x);
        let id = base;
        let n = 2;
        while (taken(id)) id = `${base}-${n++}`;
        return id;
    }

    /* ------------------------------------------------------------------ */
    /* Styles (injected once, scoped by tag/class — light-DOM component)   */
    /* ------------------------------------------------------------------ */

    static _injectStyles() {
        if (document.getElementById("sac-launcher-styles")) return;
        const style = document.createElement("style");
        style.id = "sac-launcher-styles";
        style.textContent = `
            sac-launcher { display: block; }

            sac-launcher .sac-launcher-cell { position: relative; }

            /* The grid is its own container: the footprint collapse below
               must follow the width the grid actually has, not the page's.
               On the grid (a full-width block), never on the host — see the
               responsive notes in ui.css section 15. */
            sac-launcher > .grid {
                container: sac-launcher-grid / inline-size;
                position: relative;   /* offset parent of the cells: the drop outline */
            }
            sac-launcher .sac-launcher-cell > .tile { width: 100%; height: 100%; }

            /* Manifest-declared footprint (tile: "wide" | "large"). Spans sit
               on the cell — the grid child — so everything positioned against
               the cell (tile, badge, edit controls) covers the full area for
               free. .grid's auto-rows make the large tile's second row real. */
            sac-launcher .sac-launcher-cell.size-wide,
            sac-launcher .sac-launcher-cell.size-large { grid-column: span 2; }
            sac-launcher .sac-launcher-cell.size-large { grid-row: span 2; }
            @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                /* Narrow viewports: every footprint collapses to medium,
                   matching the .grid pattern's own .tile.large collapse. */
                sac-launcher .sac-launcher-cell.size-wide,
                sac-launcher .sac-launcher-cell.size-large {
                    grid-column: span 1;
                    grid-row: span 1;
                }
            }
            /* Two 280px columns + the 1.5rem gap: below that the grid has one
               column and a span-2 cell would invent a second one. */
            @container sac-launcher-grid (max-width: 583px) {
                sac-launcher .sac-launcher-cell.size-wide,
                sac-launcher .sac-launcher-cell.size-large {
                    grid-column: span 1;
                    grid-row: span 1;
                }
            }

            /* Badge: markup comes from ui.css's .tile-badge; only the toggle
               is ours. In edit mode the move/hide controls own the corner. */
            sac-launcher .tile-badge[hidden] { display: none; }
            sac-launcher[edit] .tile-badge { display: none; }
            sac-launcher button.tile { text-align: left; font-size: inherit; }
            /* Link tiles (<a>) inherit the page's line-height; app tiles
               (<button>) have "normal" — one metric, so titles line up. */
            sac-launcher a.tile { line-height: normal; }
            sac-launcher .sac-launcher-tile:focus-visible,
            sac-launcher .sac-launcher-add:focus-visible {
                outline: 2px solid var(--accent);
                outline-offset: 2px;
            }

            /* Hidden apps: gone in normal mode, grayed in edit mode. */
            sac-launcher:not([edit]) .sac-launcher-cell.hidden-app { display: none; }
            sac-launcher[edit] .hidden-app .sac-launcher-tile {
                opacity: 0.45;
                filter: grayscale(1);
            }

            /* Edit mode: the tile itself goes inert — no launch affordance. */
            sac-launcher[edit] .sac-launcher-tile { cursor: default; }
            sac-launcher[edit] .sac-launcher-tile:hover {
                transform: none;
                box-shadow: none;
                border-color: var(--border-strong);
                background: var(--tile);
            }
            sac-launcher[edit] .sac-launcher-tile:hover sac-icon { transform: none; }

            /* Per-tile edit controls. */
            sac-launcher .sac-launcher-controls {
                position: absolute;
                top: 12px;
                right: 12px;
                display: none;
                gap: 4px;
            }
            sac-launcher[edit] .sac-launcher-controls { display: flex; }
            sac-launcher .sac-launcher-ctrl {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                padding: 0;
                border: 1px solid var(--border-strong);
                border-radius: var(--radius-m);
                background: var(--glass-strong);
                color: var(--text-muted);
                cursor: pointer;
                --icon-size: 14px;
                transition: background 120ms, color 120ms, border-color 120ms;
            }
            sac-launcher .sac-launcher-ctrl:hover:not(:disabled) {
                background: var(--hover-strong);
                color: var(--text);
            }
            sac-launcher .sac-launcher-ctrl.del:hover:not(:disabled) {
                background: color-mix(in srgb, var(--danger) 12%, transparent);
                color: var(--danger);
                border-color: color-mix(in srgb, var(--danger) 30%, transparent);
            }
            sac-launcher .sac-launcher-ctrl:focus-visible {
                outline: 2px solid var(--accent);
                outline-offset: 2px;
            }
            sac-launcher .sac-launcher-ctrl:disabled { opacity: 0.3; cursor: not-allowed; }
            sac-launcher .sac-launcher-ctrl[hidden] { display: none; }
            @media (pointer: coarse) {
                sac-launcher .sac-launcher-controls { gap: 8px; }
                sac-launcher .sac-launcher-ctrl {
                    position: relative;
                    width: 36px;
                    height: 36px;
                    --icon-size: 16px;
                }
                /* 36px look + a halo 4px past each edge = 44px target (the
                   inset counts from the padding box, inside the 1px border). */
                sac-launcher .sac-launcher-ctrl::after {
                    content: "";
                    position: absolute;
                    inset: -5px;
                }
            }

            /* Icons inside our buttons never take the pointer: a press must
               land on the button itself (sac.sortable's ignore list matches
               the pressed node, and sac-icon's svg sits in a shadow root). */
            sac-launcher .sac-launcher-ctrl sac-icon,
            sac-launcher .sac-launcher-menu > button sac-icon { pointer-events: none; }

            /* Per-tile corner menu: bottom-right, in and out of edit mode
               (the edit controls own the top-right corner, the badge too).
               It rides the tile's hover lift so the two stay together. */
            sac-launcher .sac-launcher-menu {
                position: absolute;
                right: 12px;
                bottom: 12px;
                transition: transform 0.4s var(--ease-bounce);
            }
            sac-launcher:not([edit]) .sac-launcher-cell:has(> .sac-launcher-tile:hover) > .sac-launcher-menu {
                transform: translateY(-8px);
            }
            /* The trigger is an edit control (.sac-launcher-ctrl) and keeps
               that look: sac-menu styles only its panel's items. */
            sac-launcher .sac-launcher-menu-btn { --icon-size: 16px; }
            sac-launcher .sac-launcher-menu[open] .sac-launcher-menu-btn { background: var(--hover-strong); }
            sac-launcher .has-menu .sac-launcher-tile-body { padding-right: 28px; }
            @media (hover: none) {
                sac-launcher:not([edit]) .sac-launcher-cell:has(> .sac-launcher-tile:hover) > .sac-launcher-menu {
                    transform: none;
                }
            }
            @media (pointer: coarse) {
                sac-launcher .has-menu .sac-launcher-tile-body { padding-right: 36px; }
                /* sac-menu's touch rule makes every slotted button a 44px
                   row — the trigger keeps its 36px look (the ::after halo
                   makes the 44px target). */
                sac-launcher .sac-launcher-menu-btn { min-height: 0; }
            }
            /* Narrow phones: tiles are rows (ui.css) — too short for a top
               AND a bottom corner. The menu centres on the right edge, the
               badge steps left of it, and in edit mode the controls take
               the edge alone (the menu returns on Done). */
            @media (max-width: 480px) {
                sac-launcher .sac-launcher-menu {
                    top: 50%;
                    bottom: auto;
                    margin-top: -14px;
                }
                sac-launcher .has-menu .tile-badge { right: 52px; }
                sac-launcher[edit] .sac-launcher-menu { display: none; }
            }
            @media (max-width: 480px) and (pointer: coarse) {
                sac-launcher .sac-launcher-menu { margin-top: -18px; }
                sac-launcher .has-menu .tile-badge { right: 60px; }
            }

            /* Drag reorder. Edit mode: the inert tile shows it can be
               grabbed. In flight: lifted look; its slot gets the outline. */
            sac-launcher[edit] .sac-launcher-can-drag > .sac-launcher-cell:not(.sac-launcher-add-cell) > .sac-launcher-tile {
                cursor: grab;
            }
            sac-launcher .sac-launcher-cell[data-sortable-dragging] > .sac-launcher-tile {
                cursor: grabbing;
                border-color: var(--accent);
                box-shadow: var(--shadow-2);
            }
            /* A tile dragged past the grid's side must not widen the page
               (a horizontal scrollbar flashing in and out mid-drag).
               Vertical stays open: the page auto-scrolls on that axis. */
            sac-launcher > .grid:has(> [data-sortable-dragging]) { overflow-x: clip; }
            sac-launcher .sac-launcher-drop {
                position: absolute;
                z-index: 1;
                box-sizing: border-box;
                border: 1px dashed var(--accent);
                border-radius: var(--radius-l);
                background: var(--accent-tint);
                pointer-events: none;
            }
            sac-launcher .sac-launcher-drop[hidden] { display: none; }
            sac-launcher .sac-launcher-drop.placed {
                transition: left 150ms var(--ease-smooth), top 150ms var(--ease-smooth),
                            width 150ms var(--ease-smooth), height 150ms var(--ease-smooth);
            }

            /* The dashed "Add app" tile (edit mode only). */
            sac-launcher .sac-launcher-add-cell { display: none; }
            sac-launcher[edit] .sac-launcher-add-cell { display: block; }
            sac-launcher .sac-launcher-add {
                align-items: center;
                justify-content: center;
                gap: 0.6rem;
                background: transparent;
                border: 1px dashed var(--border-strong);
                color: var(--text-muted);
                font-weight: 600;
                font-size: 0.95rem;
            }
            sac-launcher .sac-launcher-add sac-icon {
                margin-bottom: 0;
                color: var(--text-muted);
                --icon-size: 32px;
            }
            sac-launcher .sac-launcher-add:hover {
                transform: none;
                box-shadow: none;
                background: var(--hover);
                border-color: var(--accent);
                color: var(--accent);
            }
            sac-launcher .sac-launcher-add:hover sac-icon {
                transform: none;
                color: var(--accent);
            }
            @media (hover: none) {
                sac-launcher .sac-launcher-add:hover {
                    background: transparent;
                    border-color: var(--border-strong);
                    color: var(--text-muted);
                }
                sac-launcher .sac-launcher-add:hover sac-icon { color: var(--text-muted); }
            }

            /* Footer: the unobtrusive Edit toggle. */
            sac-launcher .sac-launcher-footer {
                display: flex;
                justify-content: flex-end;
                margin-top: 1rem;
            }
            sac-launcher .sac-launcher-footer[hidden] { display: none; }
            sac-launcher .sac-launcher-edit {
                width: auto;
                padding: 0.4rem 0.9rem;
                color: var(--text-muted);
            }
            sac-launcher .sac-launcher-edit:hover:not(:disabled) { color: var(--text); }
            sac-launcher[edit] .sac-launcher-edit {
                color: var(--accent);
                background: var(--accent-tint);
                border-color: color-mix(in srgb, var(--accent) 35%, transparent);
            }

            sac-launcher .sac-launcher-empty {
                color: var(--text-dim);
                font-size: 0.9rem;
                margin: 0.5rem 0 0;
            }

            /* Add-app form (slotted into <sac-dialog>, lives in light DOM). */
            .sac-launcher-form {
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding-top: 4px;
            }
            .sac-launcher-form-row { display: flex; gap: 12px; }
            .sac-launcher-form-row > div { flex: 1; }
            .sac-launcher-form-hint {
                margin: 0;
                color: var(--text-dim);
                font-size: 0.8rem;
            }
            .sac-launcher-form-error {
                margin: 0;
                color: var(--danger-text);
                font-size: 0.85rem;
            }
            .sac-launcher-form-error[hidden] { display: none; }
            .sac-launcher-form input[aria-invalid="true"] { border-color: var(--danger); }

            @media (prefers-reduced-motion: reduce) {
                sac-launcher .sac-launcher-ctrl,
                sac-launcher .sac-launcher-edit,
                sac-launcher .sac-launcher-add,
                sac-launcher .sac-launcher-menu,
                sac-launcher .sac-launcher-drop.placed { transition: none; }
            }
        `;
        document.head.appendChild(style);
    }
}
SacLauncher._instances = 0;
/** What sac.sortable may lift: every tile cell (never the Add cell) — and,
 *  outside edit mode (drag="always"), only the visible ones. */
SacLauncher.DRAG_ITEMS =
    "sac-launcher[edit] > .grid > .sac-launcher-cell:not(.sac-launcher-add-cell), " +
    "sac-launcher:not([edit]) > .grid > .sac-launcher-cell:not(.sac-launcher-add-cell):not(.hidden-app)";
/** Add-dialog fields: key → [label, placeholder] English fallbacks
 *  (keys launcher.field-<key> / launcher.placeholder-<key>). */
SacLauncher.FIELDS = {
    name:   ["Name", "My App"],
    icon:   ["Icon", "shapes (a sac-icon name)"],
    tag:    ["Tag", "app-my-app"],
    src:    ["Script URL", "apps/my-app.js or https://…"],
    width:  ["Width", "500px"],
    height: ["Height", "600px"],
};
/** Add-dialog validation problems: key → fallback (launcher.error-<key>). */
SacLauncher.PROBLEMS = {
    name: "a name",
    tag:  "a tag containing a dash",
    src:  "a script URL",
};

customElements.define("sac-launcher", SacLauncher);
})();
