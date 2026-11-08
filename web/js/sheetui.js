// Train and station details for the phone's bottom sheet (≤ 719 px). The
// desktop keeps the map popups (ui.js trainPopup / stationPopup). Feed text
// (names, lines, notices) only ever goes into textContent.
import { t } from "./i18n.js";
import { formatAgo, formatClock, formatCount, formatDistance } from "./format.js";
import { icon } from "./icons.js";
import { el, historyBox, minutesUntil, trainAlerts, trainRows, trainTitle } from "./ui.js";

/** "ok" < 5 min, "minor" 5–14, "major" 15+, "none" unknown. */
export function delayTone(secs) {
  if (secs === null || secs === undefined) return "none";
  return secs < 300 ? "ok" : secs < 900 ? "minor" : "major";
}

/** Whole minutes late, rounded (negative = early). */
export const delayMinutes = (secs) => Math.round(secs / 60);

/** Short delay for pills: "+12", "A su hora", "—". */
export function delayShort(lang, secs) {
  if (secs === null || secs === undefined) return "—";
  const m = delayMinutes(secs);
  return m <= 0 ? t(lang, "onTime") : `+${formatCount(lang, m)}`;
}

/** A GTFS route colour, only if it is one ("#RRGGBB"); else null. */
export function cleanColor(c) {
  if (typeof c !== "string") return null;
  const m = c.trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** Dark or white text for a background colour, whichever reads better. */
export function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.32 ? "#111827" : "#ffffff";
}

/** A line's badge ("C5" on its colour); grey when the colour is unknown. */
export function lineBadge(route, color) {
  if (!route) return null;
  const c = cleanColor(color);
  return el("span", { class: "line-badge", style: c ? `background:${c};color:${textOn(c)}` : null }, route);
}

/** The delay as a tinted pill. */
export function delayPill(lang, secs, canceled = false) {
  if (canceled) return el("span", { class: "delay-pill tone-major" }, t(lang, "canceled"));
  return el("span", { class: `delay-pill tone-${delayTone(secs)}` }, delayShort(lang, secs));
}

/**
 * The stops still ahead of a train (engine.tripJson's `stops`: name and
 * expected time), each with its timetable time: [{ name, sched, expected }].
 */
export function upcomingStops(stops, nextStop, delaySecs, nowSecs) {
  if (!Array.isArray(stops) || !stops.length) return [];
  const d = delaySecs || 0;
  // The next stop by name (closest in time if a name repeats), else the
  // first one not yet reached.
  let from = -1;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].name !== nextStop) continue;
    if (from < 0 || Math.abs(stops[i].time - nowSecs) < Math.abs(stops[from].time - nowSecs)) from = i;
  }
  if (from < 0) from = stops.findIndex((s) => s.time >= nowSecs - 30);
  if (from < 0) return [];
  return stops.slice(from).map((s) => ({ name: s.name, expected: s.time, sched: s.time - d }));
}

function closeButton(lang, onClose) {
  return el(
    "button",
    { class: "icon-btn", type: "button", id: "detail-close", "aria-label": t(lang, "close"), onclick: onClose },
    icon("close", 20),
  );
}

/** One action of the train's 4-button grid. */
function action(ic, label, onclick, { id, pressed, cls = "", href } = {}) {
  const attrs = { class: `act ${cls}`.trim(), type: "button", id, "aria-pressed": pressed === undefined ? null : String(pressed), onclick };
  if (href) return el("a", { class: attrs.class, id, href, target: "_blank", rel: "noopener" }, icon(ic, 20), el("span", {}, label));
  return el("button", attrs, icon(ic, 20), el("span", {}, label));
}

let allStopsFor = ""; // trip whose full stop list is open

/** The notices link with a warning icon instead of the "⚠" character. */
function withIcons(rows) {
  for (const r of rows) {
    if (!r.classList?.contains("warn")) continue;
    const text = r.textContent.replace(/^⚠\s*/u, "");
    r.replaceChildren(icon("warning", 16), el("span", {}, text));
    r.classList.add("with-icon");
  }
  return rows;
}

/**
 * The train sheet. `o`: { regionName, lineColor, stops (tripJson), now (ms),
 * onClose, fav {on, onToggle}, notify {on, onToggle} | {href}, onShare,
 * onHistory, trip {on, pro, onToggle}, onIncidents, history, rows (trainRows
 * options), redraw }.
 */
export function trainSheet(lang, info, o = {}) {
  const now = (o.now ?? Date.now()) / 1000;
  const route = info.route || info.line || "";
  const tone = delayTone(info.delay);
  const mins = info.delay === null || info.delay === undefined ? null : delayMinutes(info.delay);
  const badge =
    info.canceled
      ? el("div", { class: "delay-badge tone-major" }, el("span", { class: "delay-badge-text" }, t(lang, "canceled")))
      : mins === null
        ? el("div", { class: "delay-badge tone-none" }, el("span", { class: "delay-badge-n" }, "—"))
        : mins <= 0
          ? el("div", { class: "delay-badge tone-ok" }, el("span", { class: "delay-badge-text" }, t(lang, "onTime")))
          : el(
              "div",
              { class: `delay-badge tone-${tone}`, "aria-label": t(lang, "late", { m: mins }) },
              el("span", { class: "delay-badge-n" }, `+${formatCount(lang, mins)}`),
              el("span", { class: "delay-badge-u" }, t(lang, "delayMinUnit")),
            );
  const meta = [];
  if (info.platform) meta.push(t(lang, "platform", { p: info.platform }));
  if (!info.timetable_only) {
    const age = formatAgo(lang, info.fix_age);
    meta.push(info.position === "gps" || info.fix_age < 60 ? t(lang, "gpsAgo", { age }) : t(lang, "estimatedPos", { age }));
  }
  if (info.speed_kmh !== null && info.speed_kmh !== undefined && (info.speed_measured || info.speed_kmh > 0)) {
    meta.push(info.speed_measured ? t(lang, "speedMeasured", { v: info.speed_kmh }) : `≈ ${info.speed_kmh} km/h`);
  }
  if (info.accessible) meta.push(t(lang, info.accessible === "yes" ? "accessibleYes" : "accessibleNo").replace(/^♿\s*/u, ""));
  if (info.feed === "vp_cer" && o.regionName) meta.unshift(t(lang, "cercanias", { region: o.regionName }));

  const acts = [];
  if (o.fav) acts.push(action("star", t(lang, o.fav.on ? "favOn" : "favAdd"), o.fav.onToggle, { cls: "fav-btn", pressed: o.fav.on }));
  if (o.notify?.href) acts.push(action("bell", t(lang, "actNotify"), null, { href: o.notify.href, id: "notify-btn" }));
  else if (o.notify) acts.push(action("bell", t(lang, o.notify.on ? "actNotifyOn" : "actNotify"), o.notify.onToggle, { id: "notify-btn", pressed: o.notify.on }));
  if (o.onShare) acts.push(action("share", t(lang, "share"), o.onShare, { id: "share-btn" }));
  if (o.onHistory) acts.push(action("chart", t(lang, "actHistory"), o.onHistory, { id: "history-btn" }));

  // Next stops.
  const up = upcomingStops(o.stops, info.next_stop, info.delay, now);
  const key = `${info.trip_id}|${info.number}`;
  const showAll = allStopsFor === key;
  const shown = showAll ? up : up.slice(0, 5);
  const stopRow = (s, i) => {
    const late = Math.abs(s.expected - s.sched) >= 60;
    return el(
      "li",
      { class: i === 0 ? "stop stop-next" : "stop" },
      el("span", { class: `stop-dot${i === 0 ? ` tone-${tone}` : ""}` }),
      el("span", { class: "stop-name" }, s.name),
      el(
        "span",
        { class: "stop-time" },
        late ? el("s", {}, formatClock(s.sched)) : null,
        late ? " " : null,
        el("b", { class: late ? `tone-text-${tone}` : "" }, formatClock(late ? s.expected : s.sched)),
      ),
    );
  };
  const stops = info.origin
    ? [
        el("h3", { class: "sheet-h3" }, t(lang, "nextStops")),
        up.length ? el("ol", { class: "stops" }, shown.map(stopRow)) : el("p", { class: "muted small" }, t(lang, "noStops")),
        up.length > 5 && !showAll
          ? el(
              "button",
              {
                class: "link more-stops",
                type: "button",
                onclick: () => {
                  allStopsFor = key;
                  o.redraw?.();
                },
              },
              t(lang, "allStops", { n: up.length }),
            )
          : null,
      ]
    : [];

  const details = trainRows(lang, info, o.onIncidents, o.rows || {}, new Set(["alerts", "next", "delay", "history", "speed", "accessible", "position"]));

  return el(
    "div",
    { class: "popup sheet-train" },
    el(
      "div",
      { class: "ts-head sheet-grip" },
      el(
        "div",
        { class: "ts-main" },
        el("div", { class: "ts-line popup-title" }, lineBadge(route, o.lineColor), el("span", {}, t(lang, "trainNo", { n: info.number || trainTitle(info) }))),
        el("h2", { class: "ts-dest" }, info.destination ? t(lang, "toDest", { dest: info.destination }) : trainTitle(info)),
      ),
      badge,
      closeButton(lang, o.onClose),
    ),
    meta.length ? el("p", { class: "ts-meta" }, meta.join(" · ")) : null,
    withIcons(trainAlerts(lang, info, o.onIncidents)),
    acts.length ? el("div", { class: "act-grid", style: `grid-template-columns:repeat(${acts.length},minmax(0,1fr))` }, acts) : null,
    o.fav?.full ? el("p", { class: "small muted fav-full" }, t(lang, "favFull", { n: o.fav.limit })) : null,
    o.trip && info.origin
      ? el(
          "button",
          { class: "pill trip-btn wide", type: "button", "aria-pressed": String(o.trip.on), onclick: o.trip.onToggle },
          icon("suitcase", 18),
          ` ${o.trip.on ? t(lang, "tripOn") : t(lang, o.trip.pro ? "tripStart" : "tripStartPro")}`,
        )
      : null,
    stops,
    o.history && info.origin ? historyBox(lang, o.history, o.rows?.appUrl, o.rows?.proLink, o.onHistory) : null,
    details.length ? [el("h3", { class: "sheet-h3" }, t(lang, "detailsTitle")), el("div", { class: "ts-details" }, details)] : null,
  );
}

/**
 * The station sheet. `o`: { sub, board (stationBoardJson), approaching,
 * tab "dep" | "arr", onTab, onDeparture(row), onTrain(info), onClose, fav,
 * onHistory, onShare, commute, lineColor(route) }.
 */
export function stationSheet(lang, station, o = {}) {
  const chip = (ic, label, onclick, attrs = {}) =>
    el("button", { class: "chip-btn", type: "button", onclick, ...attrs }, ic ? icon(ic, 16) : null, label);
  const chips = [];
  if (o.fav) chips.push(chip("star", t(lang, o.fav.on ? "favOn" : "favAdd"), o.fav.onToggle, { class: "chip-btn fav-btn", "aria-pressed": String(o.fav.on) }));
  if (o.onHistory) chips.push(chip("chart", t(lang, "histStation"), o.onHistory, { id: "station-history" }));
  if (o.onShare) chips.push(chip("share", t(lang, "share"), o.onShare));
  if (o.commute) {
    chips.push(chip(null, t(lang, o.commute.isFrom ? "commuteIsFrom" : "commuteFrom"), o.commute.setFrom, { id: "commute-from" }));
    chips.push(chip(null, t(lang, o.commute.isTo ? "commuteIsTo" : "commuteTo"), o.commute.setTo, { id: "commute-to" }));
  }
  const tab = o.tab === "arr" ? "arr" : "dep";
  const seg = (id, label) =>
    el("button", { type: "button", role: "tab", class: "seg-btn", id: `seg-${id}`, "aria-selected": String(tab === id), onclick: () => o.onTab?.(id) }, label);

  const board = o.board || [];
  const depRows = board.map((r) => {
    const late = r.delay !== null && Math.abs(r.delay) >= 60;
    const small = [t(lang, "trainNo", { n: r.number })];
    if (late && !r.canceled) small.push(t(lang, r.terminates ? "arrivesAt" : "leavesAt", { time: formatClock(r.expected) }));
    return el(
      "li",
      { class: r.canceled ? "canceled" : "" },
      el(
        "button",
        { class: "dep-row", type: "button", onclick: () => o.onDeparture?.(r) },
        el("span", { class: "dep-time" }, formatClock(r.sched)),
        el(
          "span",
          { class: "dep-main" },
          el(
            "span",
            { class: "dep-line" },
            lineBadge(r.route, o.lineColor?.(r.route)),
            el("span", { class: "dep-dest" }, r.terminates ? t(lang, "fromOrigin", { origin: r.other_end }) : r.other_end),
          ),
          el("span", { class: "dep-sub" }, small.join(" · ")),
        ),
        delayPill(lang, r.delay, r.canceled),
      ),
    );
  });
  const arrRows = (o.approaching || []).map((a) =>
    el(
      "li",
      {},
      el(
        "button",
        { class: "dep-row", type: "button", onclick: () => o.onTrain?.(a) },
        el("span", { class: "dep-time" }, formatClock(a.eta)),
        el(
          "span",
          { class: "dep-main" },
          el(
            "span",
            { class: "dep-line" },
            lineBadge(a.route || a.line, o.lineColor?.(a.route || a.line)),
            el("span", { class: "dep-dest" }, a.destination || trainTitle(a)),
          ),
          el("span", { class: "dep-sub" }, [t(lang, "trainNo", { n: a.number }), minutesUntil(lang, a.eta), formatDistance(lang, a.distance_m)].join(" · ")),
        ),
        delayPill(lang, a.delay),
      ),
    ),
  );
  const list =
    tab === "dep"
      ? depRows.length
        ? el("ul", { class: "dep-list" }, depRows)
        : el("p", { class: "muted small" }, t(lang, "noTrainsSoon"))
      : arrRows.length
        ? el("ul", { class: "dep-list" }, arrRows)
        : el("p", { class: "muted small" }, t(lang, "noneApproaching"));

  return el(
    "div",
    { class: "popup sheet-station" },
    el(
      "div",
      { class: "ss-head sheet-grip" },
      el("div", { class: "ss-main" }, el("h2", { class: "popup-title" }, station.name), o.sub ? el("p", { class: "ts-meta" }, o.sub) : null),
      closeButton(lang, o.onClose),
    ),
    chips.length ? el("div", { class: "chip-row" }, chips) : null,
    o.fav?.full ? el("p", { class: "small muted fav-full" }, t(lang, "favFull", { n: o.fav.limit })) : null,
    el("div", { class: "seg", role: "tablist", "aria-label": t(lang, "boardLabel") }, seg("dep", t(lang, "tabDepartures")), seg("arr", t(lang, "tabArriving"))),
    list,
  );
}

/**
 * The network picker. `o`: { query, near: { name, onPick } | { onLocate }
 * | null, spain: { trains, onPick }, networks: [{ code, name, median }],
 * onPick(code), onQuery(q), onClose }. `median` in seconds or null.
 */
export function networksSheet(lang, o) {
  const fold = (x) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = fold(o.query || "");
  const list = (o.networks || []).filter((n) => !q || fold(n.name).includes(q));
  const near = o.near;
  const nearCard = el(
    "button",
    { class: "net-card net-card-near", type: "button", id: "net-near", onclick: near?.onPick || near?.onLocate },
    el("span", { class: "net-card-k" }, icon("locate", 14), t(lang, "netNear")),
    el("span", { class: "net-card-v" }, near?.name || (near?.onLocate ? t(lang, "netNearOff") : t(lang, "netNearNone"))),
  );
  if (!near?.onPick && !near?.onLocate) nearCard.disabled = true;
  const spainCard = el(
    "button",
    { class: "net-card", type: "button", id: "net-spain", onclick: o.spain?.onPick },
    el("span", { class: "net-card-k" }, t(lang, "netTrains", { n: formatCount(lang, o.spain?.trains || 0) })),
    el("span", { class: "net-card-v" }, t(lang, "allSpain")),
  );
  const median = (m) => {
    if (m === null || m === undefined) return el("span", { class: "net-median muted" }, t(lang, "netNoData"));
    const tone = delayTone(m);
    return el("span", { class: `net-median tone-text-${tone}` }, t(lang, "netMedian", { delay: delayShortMin(lang, m) }));
  };
  const input = el("input", {
    id: "net-q",
    type: "search",
    inputmode: "search",
    autocomplete: "off",
    placeholder: t(lang, "netSearch"),
    "aria-label": t(lang, "netSearch"),
    value: o.query || "",
    oninput: (e) => o.onQuery?.(e.target.value),
  });
  return [
    el("label", { class: "net-search" }, icon("search", 18), input),
    q ? null : el("div", { class: "net-cards" }, nearCard, spainCard),
    el("h3", { class: "group-h" }, t(lang, "netGroup")),
    list.length
      ? el(
          "ul",
          { class: "net-list" },
          list.map((n) =>
            el("li", {}, el("button", { class: "net-row", type: "button", "data-code": n.code, onclick: () => o.onPick?.(n.code) }, el("span", { class: "net-name" }, n.name), median(n.median))),
          ),
        )
      : el("p", { class: "muted small" }, t(lang, "netNone")),
  ];
}

/** "+2 min" / "0 min" for a median (no "A su hora"). */
function delayShortMin(lang, secs) {
  const m = Math.round(secs / 60);
  return m > 0 ? `+${formatCount(lang, m)} min` : `${formatCount(lang, m)} min`;
}

const NS = "http://www.w3.org/2000/svg";
function art(parts) {
  const s = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ width: "100%", height: "64", viewBox: "0 0 160 64", preserveAspectRatio: "none", "aria-hidden": "true" })) s.setAttribute(k, v);
  for (const [tag, a] of parts) {
    const p = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) p.setAttribute(k, String(v));
    s.append(p);
  }
  return s;
}
const BASE_ART = {
  standard: [
    ["rect", { width: 160, height: 64, fill: "#ebe8e3" }],
    ["path", { d: "M0 40 C 50 20 90 50 160 24", stroke: "#ffffff", "stroke-width": 6, fill: "none" }],
    ["path", { d: "M20 64 C 60 30 100 20 160 50", stroke: "#4338ca", "stroke-width": 3, fill: "none" }],
  ],
  satellite: [
    ["rect", { width: 160, height: 64, fill: "#4b5a3a" }],
    ["rect", { x: 20, y: 8, width: 50, height: 30, fill: "#6b7a52" }],
    ["rect", { x: 90, y: 30, width: 60, height: 26, fill: "#7b6b52" }],
    ["path", { d: "M20 64 C 60 30 100 20 160 50", stroke: "#a5b4fc", "stroke-width": 3, fill: "none" }],
  ],
};

/**
 * Layers. `o`: { base: "standard" | "satellite", onBase(v), groups:
 * [{ title, items: [{ id, label, hint, on, onChange(checked) }] }] }.
 */
export function layersSheet(lang, o) {
  const card = (v, label) =>
    el(
      "button",
      { class: "base-card", type: "button", id: `base-${v}`, "aria-pressed": String(o.base === v), onclick: () => o.onBase?.(v) },
      art(BASE_ART[v]),
      el("span", {}, label),
    );
  return [
    el("div", { class: "base-cards" }, card("standard", t(lang, "baseCardStandard")), card("satellite", t(lang, "baseSatellite"))),
    ...o.groups.map((g) => [
      el("h3", { class: "group-h" }, g.title),
      el(
        "ul",
        { class: "switch-list" },
        g.items.map((it) =>
          el(
            "li",
            {},
            el(
              "label",
              { class: "switch-row" },
              el("span", { class: "switch-text" }, it.label, it.hint ? el("small", {}, it.hint) : null),
              el("input", {
                type: "checkbox",
                role: "switch",
                class: "switch",
                id: `sw-${it.id}`,
                checked: it.on,
                onchange: (e) => it.onChange(e.target.checked),
              }),
            ),
          ),
        ),
      ),
    ]),
  ];
}
