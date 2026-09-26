/**
 * SACRVM APPKIT — hash-based SPA router (+ multi-page nav registry).
 *
 * SPA use:
 *   sac.router.register("#/notes", "my-notes-view", { label: "Notes", icon: "note" });
 *   sac.router.mount("#app-root");
 *   // options.palette: the Ctrl-K palette group the route lists under — a
 *   // string, or a function returning one (resolved on every open, so it can
 *   // follow the language); false keeps the route out of the palette.
 *   // Default: "Views".
 *   // On hashchange the mount point's innerHTML is swapped to the matching
 *   // tag — views are custom elements; connectedCallback is the lifecycle
 *   // hook and disconnectedCallback is where listeners get removed.
 *
 * Prefix routes: a hash ending in "/*" owns everything below it, and the
 * view stays mounted while only the part below changes:
 *   sac.router.register("#/files/*", "my-files-view", { label: "Files", icon: "folder" });
 *   // "#/files", "#/files/Photos", "#/files/Photos/2026" all show ONE
 *   // <my-files-view>. Moving between them does not remount it — the view
 *   // reads sac.router.subpath() on connect ("" / "Photos" / "Photos/2026",
 *   // decoded, no leading slash) and listens for `sac:route` on itself:
 *   //   this.addEventListener("sac:route", (e) => this.show(e.detail.subpath));
 *   //   e.detail = { hash, subpath, previous }  (previous = the old subpath)
 *   // The route lists as "#/files" in routes() (with prefix: true), so the
 *   // nav and the Ctrl-K palette link to the prefix itself. A prefix route
 *   // also owns its bare base hash; an exact route on a longer hash
 *   // ("#/files/settings") still wins over the prefix, and the longest
 *   // matching prefix wins over a shorter one.
 *
 * Multi-page use:
 *   Register plain hrefs and never call mount(); <sac-nav> renders the
 *   entries as ordinary links and derives the active one from
 *   location.pathname:
 *   sac.router.register("/svg-to-world/", null, { label: "SVG to World", icon: "shapes" });
 *
 * Scoped workspaces: when scope.js is loaded, a `#/scope/SLUG/...` prefix is
 * stripped before route lookup, so one registration serves both the root and
 * any scoped workspace (see scope.js). A prefix route's sub-path is read
 * after the strip, and a scope switch keeps the view mounted (it gets a
 * `sac:route` with the new hash, and sac:scope-changed as always).
 */
(function () {
    if (!window.sac) { console.warn("[sac.router] globals.js must load first — router unavailable."); return; }
    // "#/notes" → { tag, label, icon, palette, prefix }. A prefix route
    // ("#/files/*") is stored under its base hash ("#/files") with prefix: true.
    const routes = new Map();
    let rootElement = null;
    let mounted = null;      // { entry, el, subpath, hash } of the mounted view

    function currentHash() {
        return window.location.hash || "#/";
    }

    // With scope.js loaded, "#/scope/SLUG/notes" → "#/notes"; otherwise the
    // hash passes through unchanged.
    function resourceHash() {
        const hash = currentHash();
        return sac.scope ? sac.scope.stripPrefix(hash) : hash;
    }

    function decode(part) {
        try { return decodeURIComponent(part); } catch (_) { return part; }
    }

    /** Resolve a root-scope hash to { entry, subpath }: an exact route first,
     *  then the longest prefix route that owns it, then "#/". The subpath is
     *  "" for an exact route (and for a prefix route's bare base). */
    function match(key) {
        const exact = routes.get(key);
        if (exact && !exact.prefix) return { entry: exact, subpath: "" };
        let best = null, bestLen = -1;
        for (const [base, entry] of routes) {
            if (!entry.prefix || base.length <= bestLen) continue;
            if (key === base || key.startsWith(base.endsWith("/") ? base : base + "/")) {
                best = { entry, subpath: decode(key.slice(base.length).replace(/^\/+/, "")) };
                bestLen = base.length;
            }
        }
        if (best) return best;
        return { entry: routes.get("#/") || null, subpath: "" };
    }

    function render() {
        if (!rootElement) return;
        const hash = currentHash();
        const { entry, subpath } = match(resourceHash());
        // Same prefix route, view still in place: tell it, don't remount.
        if (entry && entry.prefix && mounted && mounted.entry === entry &&
            mounted.el.parentNode === rootElement) {
            if (mounted.hash === hash) return;
            const previous = mounted.subpath;
            mounted.subpath = subpath;
            mounted.hash = hash;
            mounted.el.dispatchEvent(new CustomEvent("sac:route", {
                detail: { hash, subpath, previous }, bubbles: true,
            }));
            return;
        }
        if (!entry || !entry.tag) { rootElement.innerHTML = ""; mounted = null; return; }
        // Record before the swap: the view's connectedCallback runs inside
        // the innerHTML assignment and may already call subpath().
        mounted = { entry, el: null, subpath, hash };
        rootElement.innerHTML = `<${entry.tag}></${entry.tag}>`;
        mounted.el = rootElement.firstElementChild;
        // A view swap is a page change — don't inherit the old view's scroll.
        window.scrollTo(0, 0);
    }

    sac.router = {
        register(hash, tagName, options = {}) {
            // "#/files/*" → base "#/files", flagged as a prefix route.
            const prefix = /\/\*$/.test(hash);
            if (prefix) hash = hash.slice(0, -2) || "#/";
            routes.set(hash, {
                tag: tagName || null,
                label: options.label || tagName || hash,
                icon:  options.icon  || null,
                palette: options.palette === undefined ? null : options.palette,
                prefix,
            });
            // Notify listeners (e.g. <sac-nav>) that the route table changed.
            // Needed because nav components are instantiated before view
            // scripts register, so their first render sees an empty map.
            window.dispatchEvent(new CustomEvent("sac:route-registered", {
                detail: { hash, tag: tagName, prefix }
            }));
            // Re-render when the new route now owns the current hash. The
            // mounted record is dropped first: a re-registered route is a
            // new entry and gets a fresh view.
            if (rootElement && match(resourceHash()).entry === routes.get(hash)) {
                mounted = null;
                render();
            }
        },
        // Every route as { hash, tag, label, icon, palette, prefix }. A prefix
        // route lists under its base hash ("#/files"), so a link to it lands
        // on the prefix itself.
        routes() {
            return Array.from(routes.entries()).map(([hash, info]) => ({ hash, ...info }));
        },
        current() {
            return currentHash();
        },
        // Returns the root-scope hash of the currently-active view, with any
        // scope prefix stripped. Useful for "am I on #/notes?" checks that
        // should succeed in every scope.
        currentResource() {
            return resourceHash();
        },
        // The part of the current hash below the matched prefix route,
        // decoded, no leading slash: "#/files/Photos/2026" under "#/files/*"
        // → "Photos/2026". "" on the bare prefix and on exact routes. Works
        // without mount() too (it resolves the current hash on every call).
        subpath() {
            return match(resourceHash()).subpath;
        },
        navigate(hash) {
            window.location.hash = hash;
        },
        mount(selector) {
            rootElement = document.querySelector(selector);
            if (!rootElement) {
                console.error(`[sac.router] mount: no element matches ${selector}`);
                return;
            }
            window.addEventListener("hashchange", render);
            render();
        }
    };
})();
