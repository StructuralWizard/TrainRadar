// Bottom sheets on a phone (≤ 719 px): every `.sheet` section becomes a
// card that sits above the tab bar at one of three heights — peek
// (≈ 160 px), half (≈ 55 %) or full (≈ 92 %) — and can be dragged between
// them by its handle or title, or pulled down from the top of its content.
// Dragging below peek (or pressing Back) closes it. On wider screens this
// does nothing: the sheets stay the desktop side panels.
//
// The rest of the app still opens and closes sheets by toggling `hidden`;
// this module watches that attribute, so nothing else has to change.

export const PHONE_QUERY = "(max-width: 719px)";
const mq = typeof matchMedia === "function" ? matchMedia(PHONE_QUERY) : { matches: false, addEventListener() {} };
export const isPhone = () => mq.matches;

export const PEEK_PX = 160;
export const HALF = 0.55;
export const FULL = 0.92;

/** Height in px of each snap for a screen of `vh` px (tab bar excluded). */
export function snapHeights(vh, tabbar = 0) {
  const room = Math.max(0, vh - tabbar);
  return {
    peek: Math.min(PEEK_PX, room),
    half: Math.round(room * HALF),
    full: Math.round(vh * FULL - tabbar),
  };
}

/**
 * Where a drag released at `h` px (moving at `v` px/ms, + = growing) should
 * settle: the nearest allowed snap, nudged one step in the direction of a
 * flick; "close" when pulled clearly below the lowest snap.
 */
export function settle(h, v, heights, allowed, closable) {
  const order = ["peek", "half", "full"].filter((s) => allowed.includes(s));
  const lowest = heights[order[0]];
  if (closable && (h < lowest * 0.6 || (v < -0.6 && h < lowest + 40))) return "close";
  let best = order[0];
  for (const s of order) if (Math.abs(heights[s] - h) < Math.abs(heights[best] - h)) best = s;
  if (Math.abs(v) > 0.5) {
    const i = order.indexOf(best);
    const up = order.find((s) => heights[s] > h);
    const down = [...order].reverse().find((s) => heights[s] < h);
    if (v > 0 && up) best = up;
    else if (v < 0 && down) best = down;
    else if (v < 0 && closable && i === 0) return "close";
  }
  return best;
}

/**
 * Manage the phone sheets. `home`: the id of the sheet shown (at peek)
 * whenever no other is open, unless the user pulled it down out of the way
 * (then `restore`, a button, brings it back). `onChange({ id, snap })` after each change
 * (id null = only the home sheet); `onSnap` when a drag settles (haptics).
 */
export class Sheets {
  constructor({ home = null, tabbar = null, scrim = null, restore = null, homeHidden = false, onChange = () => {}, onSnap = () => {}, onHomeHidden = () => {} } = {}) {
    this.home = home;
    this.tabbar = tabbar;
    this.scrim = scrim;
    this.onChange = onChange;
    this.onSnap = onSnap;
    this.restore = restore;
    this.homeHidden = homeHidden;
    this.onHomeHidden = onHomeHidden;
    this.restore?.addEventListener("click", () => this.hideHome(false));
    this.opts = new Map(); // id → { el, snaps, initial, closable }
    this.snap = new Map(); // id → current snap
    this.scrim?.addEventListener("click", () => this.back());
    mq.addEventListener?.("change", () => this.layout());
    addEventListener("resize", () => this.apply());
  }

  /** Make a `.sheet` section a phone sheet. */
  add(el, { snaps = ["peek", "half", "full"], initial = "half", closable = true } = {}) {
    const o = { el, snaps, initial, closable, was: el.hidden };
    this.opts.set(el.id, o);
    if (!el.querySelector(":scope > .sheet-handle")) {
      el.prepend(Object.assign(document.createElement("div"), { className: "sheet-handle", ariaHidden: "true" }));
    }
    // Only real changes: writing `hidden` with its current value still
    // queues a record, and this module writes it too.
    new MutationObserver(() => {
      if (el.hidden === o.was) return;
      o.was = el.hidden;
      this.changed(el.id);
    }).observe(el, { attributes: true, attributeFilter: ["hidden"] });
    this.drag(o);
    return this;
  }

  get phone() {
    return isPhone();
  }

  heights() {
    return snapHeights(innerHeight, this.tabbar?.offsetHeight || 0);
  }

  /** The open sheet on top (not the home one), or null. */
  top() {
    for (const [id, o] of this.opts) if (id !== this.home && !o.el.hidden) return id;
    return null;
  }

  /** Show sheet `id` at `snap` (its default if omitted). */
  open(id, snap) {
    const o = this.opts.get(id);
    if (!o) return;
    if (snap) this.snap.set(id, snap);
    if (o.el.hidden) o.el.hidden = false; // → changed()
    else this.changed(id);
  }

  setSnap(id, snap) {
    this.snap.set(id, snap);
    this.apply();
  }

  /** Back button / scrim: close the top sheet, else lower the home one. */
  back() {
    if (!this.phone) return false;
    const top = this.top();
    if (top) {
      this.opts.get(top).el.hidden = true;
      return true;
    }
    if (this.home && (this.snap.get(this.home) || "peek") !== "peek") {
      this.setSnap(this.home, "peek");
      return true;
    }
    return false;
  }

  /** Pull the home sheet out of the way (true) or bring it back at peek. */
  hideHome(hidden) {
    if (this.homeHidden === hidden) return;
    this.homeHidden = hidden;
    if (!hidden) this.snap.set(this.home, "peek");
    this.apply();
    this.onHomeHidden(hidden);
  }

  /** Show or hide a sheet without reacting to it as a user change. */
  setHidden(id, hidden) {
    const o = this.opts.get(id);
    o.was = hidden;
    if (o.el.hidden !== hidden) o.el.hidden = hidden;
  }

  changed(id) {
    const o = this.opts.get(id);
    if (!o.el.hidden && !this.snap.has(id)) this.snap.set(id, o.initial);
    if (o.el.hidden && id !== this.home) this.snap.delete(id);
    this.apply();
  }

  /** Home sheet shown exactly when nothing else is; sizes and the scrim. */
  apply() {
    if (!this.phone) return this.layout();
    const top = this.top();
    if (this.home) {
      this.setHidden(this.home, !!top || this.homeHidden);
      this.homeAuto = !top && !this.homeHidden;
      if (this.restore) this.restore.hidden = !!top || !this.homeHidden;
      if (!top && !this.snap.has(this.home)) this.snap.set(this.home, "peek");
    }
    const hs = this.heights();
    let shown = null;
    for (const [id, o] of this.opts) {
      if (o.el.hidden) continue;
      const snap = this.snap.get(id) || o.initial;
      o.el.style.height = `${hs[snap]}px`;
      o.el.dataset.snap = snap;
      shown = { id, snap, h: hs[snap] };
    }
    const full = shown?.snap === "full";
    if (this.scrim) this.scrim.hidden = !full;
    document.documentElement.style.setProperty("--sheet-h", `${shown ? shown.h : 0}px`);
    document.body.dataset.sheet = shown ? shown.snap : "none";
    this.onChange({ id: top, snap: shown?.snap || null });
  }

  /** Leaving the phone layout: back to the plain side panels. */
  layout() {
    if (this.phone) return this.apply();
    for (const o of this.opts.values()) {
      o.el.style.height = "";
      delete o.el.dataset.snap;
    }
    if (this.home) {
      // Shown only because it was the phone's home sheet: hide it again.
      if (this.homeAuto) {
        this.setHidden(this.home, true);
        this.homeAuto = false;
      }
    }
    if (this.scrim) this.scrim.hidden = true;
    if (this.restore) this.restore.hidden = true;
    document.body.dataset.sheet = "none";
    document.documentElement.style.setProperty("--sheet-h", "0px");
  }

  /** Drag by the handle or title; pull down from the top of the content. */
  drag(o) {
    const el = o.el;
    let d = null; // { y0, h0, last: [{ y, t }] }
    const start = (y) => {
      d = { y0: y, h0: el.getBoundingClientRect().height, last: [{ y, t: performance.now() }] };
      el.classList.add("dragging");
    };
    const move = (y) => {
      if (!d) return;
      const hs = this.heights();
      const h = Math.max(0, Math.min(hs.full, d.h0 + (d.y0 - y)));
      el.style.height = `${h}px`;
      document.documentElement.style.setProperty("--sheet-h", `${h}px`);
      d.last.push({ y, t: performance.now() });
      if (d.last.length > 5) d.last.shift();
    };
    const end = () => {
      if (!d) return;
      el.classList.remove("dragging");
      const a = d.last[0];
      const b = d.last[d.last.length - 1];
      const v = b.t > a.t ? (a.y - b.y) / (b.t - a.t) : 0; // + = growing
      const h = el.getBoundingClientRect().height;
      const moved = Math.abs(h - d.h0) > 6;
      d = null;
      if (!moved) return this.apply();
      const isHome = el.id === this.home;
      // The home sheet "closes" by tucking away behind its restore button.
      const closable = isHome ? !!this.restore : o.closable;
      const to = settle(h, v, this.heights(), o.snaps, closable);
      if (to === "close" && isHome) {
        this.hideHome(true);
      } else if (to === "close") {
        el.hidden = true;
      } else {
        this.snap.set(el.id, to);
        this.apply();
      }
      this.onSnap(to);
    };
    // Handle and title: always drag (they don't scroll).
    el.addEventListener("pointerdown", (e) => {
      if (!this.phone || e.button > 0) return;
      if (!e.target.closest(".sheet-handle, .sheet-head, .sheet-grip")) return;
      if (e.target.closest("button, a, input, select, label")) return;
      start(e.clientY);
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => d && move(e.clientY));
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    // Content: a downward pull while scrolled to the top moves the sheet;
    // an upward one below full grows it before the content scrolls.
    let tc = null;
    el.addEventListener(
      "touchstart",
      (e) => {
        if (!this.phone || d || e.touches.length !== 1) return;
        if (e.target.closest(".sheet-handle, .sheet-head, .sheet-grip, input[type=range]")) return;
        tc = { y: e.touches[0].clientY, taken: false };
      },
      { passive: true },
    );
    el.addEventListener(
      "touchmove",
      (e) => {
        if (!tc) return;
        const y = e.touches[0].clientY;
        if (!tc.taken) {
          const dy = y - tc.y;
          if (Math.abs(dy) < 8) return;
          const atTop = el.scrollTop <= 0;
          const snap = this.snap.get(el.id) || o.initial;
          if ((dy > 0 && atTop) || (dy < 0 && snap !== "full" && o.snaps.includes("full"))) {
            tc.taken = true;
            start(tc.y);
          } else {
            tc = null;
            return;
          }
        }
        e.preventDefault();
        move(y);
      },
      { passive: false },
    );
    const tend = () => {
      if (tc?.taken) end();
      tc = null;
    };
    el.addEventListener("touchend", tend);
    el.addEventListener("touchcancel", tend);
  }
}
