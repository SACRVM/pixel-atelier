/**
 * <sac-time-field value="14:30" label="Start" step="15">
 *
 * The compact form-row time input: an optional label and one field made of
 * segments — hour, minute, and an AM/PM segment under hour-cycle="h12" —
 * each focusable on its own, like the operating system's time pickers. Same
 * height, border and radius as <sac-date-field>, so the two sit in one row.
 *
 * Usage:
 *   <sac-time-field label="Start" value="09:00" step="15"></sac-time-field>
 *   <sac-time-field label="Alarm" hour-cycle="h12"></sac-time-field>
 *
 *   field.addEventListener("sac:change", e => plan(e.detail.value));
 *   field.value = "18:45";     // programmatic — updates the UI, fires nothing
 *
 * Attributes:
 *   value       — "HH:MM", 24-hour, whatever the display. Tolerant on the way
 *                 in ("9:5" → "09:05"), REFLECTED normalized. Empty or absent
 *                 = no time. Garbage is rejected: the last valid value is put
 *                 back.
 *   hour-cycle  — "h23" (00–23) or "h12" (01–12 + AM/PM segment). Absent =
 *                 the page-wide sac.regional hour cycle (default "h23"),
 *                 followed live.
 *   step        — minutes the arrows / wheel step the minute segment by
 *                 (default 1; 5, 15 …). Typed minutes are not snapped.
 *   min / max   — "HH:MM" bounds, inclusive. A time outside them shows
 *                 --danger and never commits (focus leaving reverts it).
 *   label       — text above the field, kit form-label styling; also the
 *                 group's accessible name.
 *   placeholder — "hh:mm"-style: the part before and after the ":" is shown
 *                 dim in an empty hour / minute segment. Default "--:--".
 *   disabled    — greys the field out and takes it out of the tab order.
 *   size        — "compact" (default, sac-date-field's compact row) or
 *                 "regular" (the metrics of a plain kit <input>, the UI font
 *                 with tabular digits) — set the same size on a date + time
 *                 pair. Touch sizing is the same for both.
 *
 * Properties:
 *   value — get/set, normalized "HH:MM" or "". Setting is programmatic:
 *           the segments update in place, NO event fires.
 *
 * Events:
 *   sac:change — detail { value } — "HH:MM", or "" when the user cleared it.
 *                On USER changes only, when they COMMIT: focus leaving the
 *                field, or Enter. Stepping and typing inside the field
 *                update the segments live but fire once, on commit — the
 *                same contract as <sac-date-field>. Bubbles, not composed.
 *
 * Keyboard (on a segment):
 *   ↑ / ↓        step the segment (wraps; minutes by `step`); on an empty
 *                segment ↑ starts at the bottom of its range, ↓ at the top.
 *   ← / →        previous / next segment.
 *   digits       fill the segment and advance when it cannot take another
 *                digit ("1" "4" → 14 → minute; "7" → 07 → minute).
 *   a / p        AM / PM (h12).
 *   Backspace / Delete  clear the segment (the value becomes "").
 *   Enter        commit.   Escape  revert to the last committed value.
 *
 * Mouse: the wheel steps the segment under the pointer while the field has
 * focus (a field you merely scroll past never changes). Clicking AM/PM
 * toggles it.
 *
 * Compact/touch: each segment is a real text input with inputmode="numeric",
 * so a tap opens the number pad and typed digits run through the same
 * segment logic. Under (pointer: coarse) the field is 44px tall, segments
 * are at least 44px wide, and type is 16px (no iOS focus zoom). Nothing is
 * hover-only.
 *
 * CSS parts: label, field (the bordered box), segment (each segment), separator.
 */
(function () {

    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    const pad = (n) => String(n).padStart(2, "0");

    /** "9:5" / "09:05" → {h, m} or null. */
    function parse(str) {
        const m = /^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/.exec(String(str == null ? "" : str));
        if (!m) return null;
        const h = +m[1], mi = +m[2];
        if (h > 23 || mi > 59) return null;
        return { h, m: mi };
    }
    /** null = unparseable, "" = empty, else "HH:MM". */
    function normalize(str) {
        if (str == null) return null;
        if (String(str).trim() === "") return "";
        const p = parse(str);
        return p ? `${pad(p.h)}:${pad(p.m)}` : null;
    }

class SacTimeField extends HTMLElement {
    static get observedAttributes() {
        return ["value", "hour-cycle", "step", "min", "max", "label", "placeholder", "disabled"];
    }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._value = "";            // committed "HH:MM" or ""
        this._h = null;              // live segment state, 0–23
        this._m = null;              // 0–59
        this._buffer = "";           // digits typed into the focused segment
        this._reflecting = false;
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) {
            this._render();
            if (Object.prototype.hasOwnProperty.call(this, "value")) {   // set before upgrade
                const v = this.value; delete this.value; this.value = v;
            }
            this._adopt();
        }
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
        if (window.sac && sac.regional && !this._offRegional) {
            this._offRegional = sac.regional.onChange(() => {
                if (!this.hasAttribute("hour-cycle")) this._syncCycle();
            });
        }
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        if (this._offRegional) { this._offRegional(); this._offRegional = null; }
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;
        switch (name) {
            case "value":       this._onValueAttr(); break;
            case "hour-cycle":  this._syncCycle(); break;
            case "min":
            case "max":         this._syncSegments(); break;
            case "label":       this._syncLabel(); break;
            case "placeholder": this._syncSegments(); break;
            case "disabled":    this._syncDisabled(); break;
        }
    }

    get value() { return this._value; }
    set value(v) { this.setAttribute("value", v == null ? "" : String(v)); }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { this.toggleAttribute("disabled", !!v); }

    /* ------------------------------------------------------------- state */

    _h12() {
        const own = this.getAttribute("hour-cycle");
        if (own === "h12" || own === "h23") return own === "h12";
        return !!(window.sac && sac.regional && sac.regional.get().hourCycle === "h12");
    }

    _step() {
        const s = parseInt(this.getAttribute("step"), 10);
        return Number.isFinite(s) && s > 0 && s < 60 ? s : 1;
    }

    /** The live segments as "HH:MM", "" when a segment is empty. */
    _live() {
        return this._h == null || this._m == null ? "" : `${pad(this._h)}:${pad(this._m)}`;
    }

    _inRange(v) {
        const min = normalize(this.getAttribute("min"));
        const max = normalize(this.getAttribute("max"));
        if (min && v < min) return false;
        if (max && v > max) return false;
        return true;
    }

    _adopt() {
        const v = normalize(this.getAttribute("value"));
        this._setCommitted(v == null ? "" : v);
        this._syncLabel();
        this._syncCycle();
        this._syncDisabled();
    }

    _setCommitted(v) {
        this._value = v;
        const p = parse(v);
        this._h = p ? p.h : null;
        this._m = p ? p.m : null;
        this._reflect();
        this._syncSegments();
    }

    _reflect() {
        if (this._value === "" && !this.hasAttribute("value")) return;
        if (this.getAttribute("value") === this._value) return;
        this._reflecting = true;
        this.setAttribute("value", this._value);
        this._reflecting = false;
    }

    _onValueAttr() {
        if (this._reflecting) return;
        const raw = this.getAttribute("value");
        if (raw == null) { this._setCommitted(""); return; }
        const v = normalize(raw);
        if (v == null) { this._reflect(); return; }
        this._setCommitted(v);
    }

    /** Commit the live segments: a user change, so an event when it moved. */
    _commit() {
        this._buffer = "";
        const v = this._live();
        const partial = v === "" && (this._h != null || this._m != null);
        if (partial || (v && !this._inRange(v))) {   // half a time, or out of bounds → back
            this._setCommitted(this._value);
            return;
        }
        if (v === this._value) { this._syncSegments(); return; }
        this._setCommitted(v);
        this.dispatchEvent(new CustomEvent("sac:change", {
            detail: { value: v }, bubbles: true, composed: false,
        }));
    }

    _revert() {
        this._buffer = "";
        this._setCommitted(this._value);
    }

    /* ------------------------------------------------------------- render */

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                *, *::before, *::after { box-sizing: border-box; }
                :host {
                    display: inline-block;
                    max-width: 100%;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    color: var(--text);
                }
                :host([disabled]) { opacity: 0.5; }
                .label {
                    display: block;
                    font-size: 0.7rem;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    margin-bottom: 0.4rem;
                    font-weight: 700;
                    letter-spacing: 0.05em;
                }
                .label[hidden] { display: none; }

                /* The row is as tall as sac-date-field's (its 28px calendar
                   button), so labels and boxes line up side by side. */
                .row { display: flex; align-items: center; min-height: 28px; }

                /* The sac-date-field input recipe: same padding, type,
                   border, radius — the two sit in one row as one family. */
                .field {
                    display: inline-flex;
                    align-items: center;
                    padding: 0.35rem 0.5rem;
                    font-family: var(--font-mono);
                    font-size: 0.78rem;
                    line-height: normal;
                    color: var(--text);
                    background: var(--field);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-m);
                    cursor: text;
                    transition: border-color 150ms var(--ease-smooth);
                }
                .field:hover { border-color: var(--border-strong); }
                .field:focus-within {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 10%, transparent);
                }
                :host([disabled]) .field { cursor: not-allowed; border-color: var(--border); }
                .field.invalid { border-bottom-color: var(--danger); }
                .field.invalid .seg { color: var(--danger-text); }

                .seg {
                    width: 2.2ch;
                    padding: 0;
                    margin: 0;
                    border: 0;
                    border-radius: 3px;
                    background: transparent;
                    font: inherit;
                    color: inherit;
                    text-align: center;
                    caret-color: transparent;
                    font-variant-numeric: tabular-nums;
                }
                .seg::placeholder { color: var(--text-dim); }
                .seg:focus {
                    outline: none;
                    background: color-mix(in srgb, var(--accent) 22%, transparent);
                }
                .seg::selection { background: transparent; }
                .seg.period { width: 3.2ch; margin-left: 0.5ch; cursor: pointer; }
                .seg.period[hidden] { display: none; }
                .sep { color: var(--text-muted); padding: 0 1px; }

                /* size="regular": the plain kit <input> metrics, as in
                   sac-date-field's regular size. */
                :host([size="regular"]) .row { min-height: 0; }
                :host([size="regular"]) .field {
                    padding: 0.6rem;
                    font-family: inherit;
                    font-size: 13.3333px;
                }
                :host([size="regular"]) .seg { width: 2.4ch; }

                @media (pointer: coarse) {
                    .row, :host([size="regular"]) .row { min-height: 44px; }
                    .field, :host([size="regular"]) .field { min-height: 44px; font-size: max(16px, 1rem); padding: 0 0.25rem; }
                    .seg { min-width: 44px; min-height: 40px; }
                }
                @media (prefers-reduced-motion: reduce) { .field { transition: none; } }
            </style>
            <label class="label" part="label" hidden></label>
            <div class="row"><div class="field" part="field" role="group">
                <input class="seg hour" part="segment" data-seg="h" type="text" inputmode="numeric"
                       autocomplete="off" spellcheck="false" role="spinbutton" maxlength="4">
                <span class="sep" part="separator" aria-hidden="true">:</span>
                <input class="seg minute" part="segment" data-seg="m" type="text" inputmode="numeric"
                       autocomplete="off" spellcheck="false" role="spinbutton" maxlength="4">
                <input class="seg period" part="segment" data-seg="p" type="text" inputmode="text"
                       autocomplete="off" spellcheck="false" role="spinbutton" maxlength="4" hidden readonly>
            </div></div>
        `;
        this._labelEl = this.shadowRoot.querySelector(".label");
        this._field = this.shadowRoot.querySelector(".field");
        this._segs = {
            h: this.shadowRoot.querySelector(".hour"),
            m: this.shadowRoot.querySelector(".minute"),
            p: this.shadowRoot.querySelector(".period"),
        };

        for (const [key, el] of Object.entries(this._segs)) {
            el.addEventListener("focus", () => { this._buffer = ""; this._select(el); });
            el.addEventListener("click", () => {
                if (key === "p" && !this.disabled) this._togglePeriod();
                this._select(el);
            });
            el.addEventListener("keydown", (e) => this._onKeydown(e, key));
            // Typed text arrives here on every keyboard, including a phone's
            // number pad (whose keydown says "Unidentified"): take the new
            // characters, run them through the segment logic, re-render.
            el.addEventListener("input", (e) => {
                e.stopPropagation();
                const typed = el.value.replace(/\D/g, "").slice(-1);
                if (key === "p") {
                    const c = el.value.trim().slice(-1).toLowerCase();
                    if (c === "a" || c === "p") this._setPeriod(c === "p");
                } else if (typed) {
                    this._digit(key, typed);
                }
                this._syncSegments();
                this._select(el);
            });
            el.addEventListener("change", (e) => e.stopPropagation());
            el.addEventListener("wheel", (e) => {
                if (this.disabled || !this.shadowRoot.activeElement) return;
                e.preventDefault();
                this._stepSeg(key, e.deltaY < 0 ? 1 : -1);
            }, { passive: false });
        }
        // Clicking the box's padding focuses the hour.
        this._field.addEventListener("mousedown", (e) => {
            if (e.target === this._field && !this.disabled) { e.preventDefault(); this._segs.h.focus(); }
        });
        // Commit when focus leaves the whole field, not when it hops segments.
        this._field.addEventListener("focusout", (e) => {
            if (e.relatedTarget && this.shadowRoot.contains(e.relatedTarget)) return;
            this._commit();
        });
    }

    _select(el) {
        requestAnimationFrame(() => {
            if (this.shadowRoot.activeElement === el) {
                try { el.setSelectionRange(el.value.length, el.value.length); } catch (err) { /* readonly */ }
            }
        });
    }

    /* ------------------------------------------------------------ editing */

    _order() {
        return this._h12() ? ["h", "m", "p"] : ["h", "m"];
    }

    _move(key, dir) {
        const order = this._order();
        const next = order[order.indexOf(key) + dir];
        if (next) this._segs[next].focus();
    }

    _onKeydown(e, key) {
        if (this.disabled) return;
        switch (e.key) {
            case "ArrowUp":    e.preventDefault(); this._stepSeg(key, 1); break;
            case "ArrowDown":  e.preventDefault(); this._stepSeg(key, -1); break;
            case "ArrowLeft":  e.preventDefault(); this._move(key, -1); break;
            case "ArrowRight": e.preventDefault(); this._move(key, 1); break;
            case "Backspace":
            case "Delete":
                e.preventDefault();
                this._buffer = "";
                if (key === "m") this._m = null; else this._h = null;
                this._syncSegments();
                break;
            case "Enter":
                e.preventDefault();
                this._commit();
                break;
            case "Escape":
                if (this._live() !== this._value || this._buffer) { e.preventDefault(); e.stopPropagation(); }
                this._revert();
                break;
            case "a": case "A": case "p": case "P":
                if (this._h12()) { e.preventDefault(); this._setPeriod(e.key.toLowerCase() === "p"); }
                break;
        }
    }

    _stepSeg(key, dir) {
        this._buffer = "";
        if (key === "p") { this._togglePeriod(); return; }
        if (key === "h") {
            if (this._h == null) this._h = dir > 0 ? 0 : 23;
            else this._h = (this._h + dir + 24) % 24;
        } else {
            const step = this._step();
            if (this._m == null) this._m = dir > 0 ? 0 : 60 - step;
            else {
                // Snap to the step grid first, so 07 +15 → 15, not 22.
                const snapped = dir > 0 ? Math.floor(this._m / step) * step + step
                                        : Math.ceil(this._m / step) * step - step;
                this._m = ((snapped % 60) + 60) % 60;
            }
        }
        this._syncSegments();
    }

    _togglePeriod() {
        if (this._h == null) this._h = 12;              // an empty hour: PM → 12
        else this._h = (this._h + 12) % 24;
        this._syncSegments();
    }

    _setPeriod(pm) {
        if (this._h == null) { this._h = pm ? 12 : 0; }
        else if (pm && this._h < 12) this._h += 12;
        else if (!pm && this._h >= 12) this._h -= 12;
        this._syncSegments();
    }

    /** One typed digit into a segment; advance when it can take no more. */
    _digit(key, d) {
        const n = +d;
        const h12 = this._h12();
        if (key === "h") {
            const buf = this._buffer + d;
            const cap = h12 ? 12 : 23;
            let value, done;
            if (this._buffer === "") {
                value = n;
                done = n > (h12 ? 1 : 2);                // "3"+ in h23 can't grow
            } else {
                value = +buf;
                if (value > cap) value = n;              // "29" → 9
                done = true;
            }
            if (h12) {
                // 12-hour digits → 24-hour state, keeping AM/PM ("12" AM = 0).
                const pm = this._h != null && this._h >= 12;
                this._h = (value % 12) + (pm ? 12 : 0);
            } else {
                this._h = value;
            }
            this._buffer = done ? "" : buf;
            if (done) this._move("h", 1);
        } else if (key === "m") {
            if (this._buffer === "") {
                this._m = n;
                if (n > 5) { this._buffer = ""; if (this._h12()) this._move("m", 1); }
                else this._buffer = d;
            } else {
                this._m = +(this._buffer + d);
                this._buffer = "";
                if (this._h12()) this._move("m", 1);
            }
        }
    }

    /* ------------------------------------------------------------ in place */

    _syncSegments() {
        if (!this._segs) return;
        const h12 = this._h12();
        const [phH, phM] = (this.getAttribute("placeholder") || "--:--").split(":");
        const { h: sh, m: sm, p: sp } = this._segs;

        let hourText = "";
        if (this._h != null) {
            hourText = h12 ? pad(this._h % 12 === 0 ? 12 : this._h % 12) : pad(this._h);
            // While a first digit waits for a second, show just that digit.
            if (this._buffer && this.shadowRoot.activeElement === sh) hourText = this._buffer;
        }
        let minText = this._m == null ? "" : pad(this._m);
        if (this._buffer && this.shadowRoot.activeElement === sm) minText = this._buffer;

        sh.value = hourText;
        sm.value = minText;
        sh.placeholder = phH || "--";
        sm.placeholder = phM || "--";
        sp.hidden = !h12;
        const pm = this._h != null && this._h >= 12;
        sp.value = this._h == null ? "" : (pm ? t("time-field.pm", "PM") : t("time-field.am", "AM"));
        sp.placeholder = t("time-field.am", "AM");

        // ARIA: each segment is a spinbutton with its own range.
        sh.setAttribute("aria-valuemin", h12 ? "1" : "0");
        sh.setAttribute("aria-valuemax", h12 ? "12" : "23");
        sm.setAttribute("aria-valuemin", "0");
        sm.setAttribute("aria-valuemax", "59");
        const now = (el, v, text) => {
            if (v == null) { el.removeAttribute("aria-valuenow"); el.setAttribute("aria-valuetext", t("time-field.empty", "empty")); }
            else { el.setAttribute("aria-valuenow", String(v)); el.setAttribute("aria-valuetext", text); }
        };
        now(sh, this._h == null ? null : (h12 ? (this._h % 12 || 12) : this._h), hourText);
        now(sm, this._m, minText);
        now(sp, this._h == null ? null : (pm ? 1 : 0), sp.value);

        const live = this._live();
        this._field.classList.toggle("invalid", !!live && !this._inRange(live));
    }

    _syncCycle() {
        this._syncSegments();
        this._relabel();
    }

    _syncLabel() {
        const text = this.getAttribute("label") || "";
        this._labelEl.textContent = text;
        this._labelEl.hidden = !text;
        this._field.setAttribute("aria-label", text || t("time-field.time", "Time"));
    }

    _relabel() {
        if (!this._segs) return;
        this._syncLabel();
        this._segs.h.setAttribute("aria-label", t("time-field.hours", "Hours"));
        this._segs.m.setAttribute("aria-label", t("time-field.minutes", "Minutes"));
        this._segs.p.setAttribute("aria-label", t("time-field.period", "AM/PM"));
        this._syncSegments();
    }

    _syncDisabled() {
        const off = this.disabled;
        for (const el of Object.values(this._segs)) el.disabled = off;
    }
}

customElements.define("sac-time-field", SacTimeField);
})();
