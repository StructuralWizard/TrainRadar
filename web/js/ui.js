// DOM for the stats bar, legend, delayed list and train popup. Feed text is
// untrusted: it only ever goes into textContent, never innerHTML.
import { t } from "./i18n.js";
import {
  formatAgo,
  formatClock,
  formatCount,
  formatDay,
  formatDelay,
  formatDistance,
  formatDuration,
} from "./format.js";
import { COLORS, SCHEDULED_COLOR } from "./map.js";

/** Create an element: el("div", { class: "x", onclick }, child, "text"). */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function statsText(lang, stats) {
  const parts = [t(lang, "trains", { n: formatCount(lang, stats.trains) })];
  parts.push(t(lang, "delayed", { n: formatCount(lang, stats.delayed) }));
  if (stats.median_delay !== null) {
    parts.push(t(lang, "median", { delay: formatDelay(lang, stats.median_delay) }));
  }
  return parts.join(" · ");
}

export function legend(lang) {
  const items = [
    [COLORS[0], "legendOnTime"],
    [COLORS[1], "legendMinor"],
    [COLORS[2], "legendMajor"],
    [COLORS[3], "legendUnknown"],
  ];
  return items.map(([c, k]) =>
    el("span", { class: "legend-item" }, el("i", { style: `background:${c}` }), t(lang, k)),
  );
}

/** "AVE 03071", "C3 · 20015", or just the number. */
export function trainTitle(info) {
  const route = info.route || info.line;
  return route ? `${route} ${info.number}`.trim() : info.number || info.trip_id;
}

function row(label, ...value) {
  return el("div", { class: "row" }, el("span", { class: "label" }, label), el("span", { class: "value" }, ...value));
}

/** "C3 20111 · 2 min · 3,2 km", the train name a button when we can show it. */
function gapText(lang, g, onTrain) {
  if (!g) return t(lang, "none");
  const s = t(lang, "gap", { time: formatDuration(lang, g.time_secs), dist: formatDistance(lang, g.distance_m) });
  const rest = `${g.estimated ? "≈ " : ""}${s}`;
  if (!g.title) return rest;
  const name = g.i !== undefined && onTrain ? el("button", { class: "link", onclick: () => onTrain(g.i) }, g.title) : g.title;
  return [name, ` · ${rest}`];
}

/** Next train the other way: "AVE 03112 · cruce en ≈ 4 min · 9,1 km". */
function oncomingText(lang, o, onTrain) {
  const name = onTrain ? el("button", { class: "link", onclick: () => onTrain(o.i) }, o.title || "?") : o.title;
  const when = o.time_secs !== undefined && o.time_secs !== null
    ? t(lang, "meetIn", { time: formatDuration(lang, o.time_secs) })
    : "";
  return [name, ` · ${[when, formatDistance(lang, o.distance_m)].filter(Boolean).join(" · ")}`];
}

/** Where each figure in the popup comes from, and the official live page. */
function sourceNote(lang, info) {
  const parts = [];
  parts.push(t(lang, info.feed === "vp_cer" ? "srcPosCer" : "srcPosLd"));
  if (info.delay_source === "renfe") parts.push(t(lang, "srcDelayRenfe"));
  else if (info.delay_source) parts.push(t(lang, "srcDelayEstimated"));
  if (info.origin) parts.push(t(lang, "srcTimetable"));
  const site = info.feed === "vp_cer" ? "https://tiempo-real.renfe.com/" : "https://tiempo-real.largorecorrido.renfe.com/";
  return [
    el(
      "details",
      { class: "small muted sources" },
      el("summary", {}, t(lang, "dataSources")),
      parts.join(" "),
    ),
    el("a", { class: "small", href: site, target: "_blank", rel: "noopener" }, t(lang, info.feed === "vp_cer" ? "linkRenfe" : "linkRenfeLd") + " ↗"),
  ];
}

/** Official pages for live information we can't reuse. */
export const OFFICIAL_LINKS = [
  ["linkAdif", "https://www.adif.es/viajeros/estado-de-la-red"],
  ["linkRenfe", "https://tiempo-real.renfe.com/"],
  ["linkRenfeLd", "https://tiempo-real.largorecorrido.renfe.com/"],
  ["linkOuigo", "https://www.ouigo.com/es/"],
  ["linkIryo", "https://iryo.eu/es"],
  ["linkAdifMap", "https://www.adif.es/sobre-adif/red-ferroviaria/mapa"],
];
const OPERATOR_SITES = { OUIGO: "https://www.ouigo.com/es/" };

export function officialLinks(lang) {
  return [
    el("h3", {}, t(lang, "otherSources")),
    el(
      "ul",
      { class: "links" },
      OFFICIAL_LINKS.map(([k, href]) =>
        el("li", {}, el("a", { href, target: "_blank", rel: "noopener" }, `${t(lang, k)} ↗`)),
      ),
    ),
  ];
}

function gaugeName(lang, mm) {
  return { 1668: "gaugeIberian", 1435: "gaugeStandard", 1000: "gaugeMetric", 1: "gaugeDual" }[mm];
}

/** Popup body for one train (engine.trainJson). */
/** Required by the Copernicus WorldDEM-30 licence for modified data. */
export const COPERNICUS_NOTICE =
  "Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 " +
  "provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge " +
  "of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.";

/** Gradient label: "+12 ‰ uphill", "−8 ‰ downhill", "level". */
function gradeText(lang, g) {
  if (Math.abs(g) < 2) return t(lang, "gradeLevel");
  return t(lang, g > 0 ? "gradeUp" : "gradeDown", { v: Math.abs(g) });
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs, ...children) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) if (c) e.append(c);
  return e;
}

/** Small height-profile chart of the trip with the train's position. */
export function profileChart(lang, p) {
  if (!p || !p.km?.length) return null;
  const known = p.h.filter((h) => h !== null);
  if (known.length < 2) return null;
  const W = 260, H = 64, pad = 2;
  const lo = Math.min(...known), hi = Math.max(...known);
  const span = Math.max(hi - lo, 50); // don't blow 5 m of noise up into cliffs
  const total = p.km[p.km.length - 1] || 1;
  const x = (km) => pad + (km / total) * (W - 2 * pad);
  const y = (h) => H - pad - ((h - lo) / span) * (H - 2 * pad - 10);
  let d = "";
  let pen = false;
  p.km.forEach((km, i) => {
    const h = p.h[i];
    if (h === null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(km).toFixed(1)},${y(h).toFixed(1)}`;
    pen = true;
  });
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "profile", role: "img", "aria-label": t(lang, "profile") });
  chart.append(svg("path", { d, class: "profile-line" }));
  if (p.at !== null && p.at !== undefined) {
    const i = Math.max(0, p.km.findIndex((k) => k >= p.at));
    const h = p.h[i];
    if (h !== null) chart.append(svg("circle", { cx: x(p.at).toFixed(1), cy: y(h).toFixed(1), r: 3.5, class: "profile-train" }));
  }
  return el(
    "div",
    { class: "profile-box" },
    chart,
    el("div", { class: "small muted profile-scale" },
      el("span", {}, `${Math.round(lo)}–${Math.round(hi)} m`),
      el("span", {}, `${Math.round(total)} km`)),
  );
}

/** About panel: what TrainRadar is, where the live data comes from, legal
 * pages, licences, and (when configured) the app and coffee links. The
 * coffee link is web only, never inside the Android app. */
export function aboutPanel(lang, { playUrl = "", coffeeUrl = "", platform = "web", feedMode = "fallback", onSettings = null, version = "dev" } = {}) {
  const link = (href, text) => el("a", { href, target: "_blank", rel: "noopener" }, text);
  const out = [el("p", {}, t(lang, "aboutText"))];
  if (onSettings) {
    out.push(el("p", {}, el("button", { class: "pill", type: "button", id: "settings-btn", onclick: onSettings }, `⚙ ${t(lang, platform === "android" ? "settingsPro" : "settings")}`)));
  }
  if (playUrl && platform === "web") out.push(el("p", {}, el("a", { class: "pill pill-strong", href: playUrl, target: "_blank", rel: "noopener" }, t(lang, "getApp"))));
  if (coffeeUrl && platform === "web") out.push(el("p", {}, link(coffeeUrl, `☕ ${t(lang, "coffee")}`)));
  out.push(el("p", { class: "small muted" }, t(lang, "feedSource", { source: t(lang, feedMode === "live" ? "feedLive" : "feedProxy") })));
  out.push(el("h3", {}, t(lang, "legal")));
  out.push(
    el(
      "ul",
      { class: "links" },
      [
        ["legal/privacy.html", "legalPrivacy"],
        ["legal/terms.html", "legalTerms"],
        ["legal/provider.html", "legalProvider"],
        ["legal/licences.html", "legalLicences"],
      ].map(([href, k]) => el("li", {}, link(href, t(lang, k)))),
    ),
  );
  out.push(...officialLinks(lang));
  out.push(el("p", { class: "small" }, link("https://github.com/StructuralWizard/TrainRadar", `${t(lang, "sourceCode")} ↗`)));
  out.push(el("p", { class: "small muted", id: "about-version" }, t(lang, "aboutBy", { v: version })));
  return out;
}

export function trainPopup(
  lang,
  info,
  regionName,
  onIncidents,
  { napDate, profile, onTrain, appUrl, history, enthusiast = true, fav = null, onShare = null, proLink = null, trip = null, onHistory = null } = {},
) {
  const title = el(
    "div",
    { class: "popup-title", style: info.timetable_only ? `color:${SCHEDULED_COLOR}` : null },
    trainTitle(info),
  );
  const sub = [];
  if (info.feed === "vp_cer" && regionName) sub.push(t(lang, "cercanias", { region: regionName }));
  if (info.platform) sub.push(t(lang, "platform", { p: info.platform }));
  const rows = [];
  if (info.canceled) rows.push(el("div", { class: "badge badge-red" }, t(lang, "canceled")));
  if (info.timetable_only) {
    rows.push(el("div", { class: "notice-box" }, t(lang, "timetableOnly", { op: info.operator })));
  }
  if (info.stopped) {
    const vars = { a: info.stopped.after, b: info.stopped.before, t: formatDuration(lang, Date.now() / 1000 - info.stopped.since) };
    rows.push(el("div", { class: "badge badge-red" }, t(lang, info.stopped.confirmed ? "stoppedConfirmed" : "stoppedLikely", vars)));
  }
  // Notices first: they matter more than the details below, and the end of
  // a long popup can sit behind the bottom buttons on a phone.
  if (info.incidents > 0 && onIncidents) {
    rows.push(
      el(
        "button",
        { class: "link warn", onclick: () => onIncidents(info) },
        info.incidents === 1 ? t(lang, "trainIncident") : t(lang, "trainIncidents", { n: info.incidents }),
      ),
    );
  }
  if (info.origin) {
    rows.push(row(t(lang, "from"), info.origin));
    rows.push(row(t(lang, "to"), info.destination));
  } else {
    rows.push(el("div", { class: "muted" }, t(lang, "unmatched")));
  }
  if (info.next_stop) {
    rows.push(
      row(
        t(lang, "nextStop"),
        info.next_stop,
        info.next_arrival ? ` ${t(lang, "at", { time: formatClock(info.next_arrival) })}` : "",
      ),
    );
  }
  const cls = info.delay === null ? 3 : info.delay < 300 ? 0 : info.delay < 900 ? 1 : 2;
  rows.push(
    row(
      t(lang, "delay"),
      el("strong", { style: `color:${COLORS[cls]}` }, formatDelay(lang, info.delay)),
      info.delay_source
        ? el("span", { class: "muted" }, ` (${t(lang, info.delay_source === "renfe" ? "sourceRenfe" : "sourceEstimated")})`)
        : "",
    ),
  );
  if (history && info.origin) rows.push(historyBox(lang, history, appUrl, proLink, onHistory));
  // A timetabled 0 km/h just means "dwelling at a station": not worth a row.
  if (info.speed_kmh !== null && info.speed_kmh !== undefined && (info.speed_measured || info.speed_kmh > 0)) {
    rows.push(
      row(t(lang, "speed"), t(lang, info.speed_measured ? "speedMeasured" : "speedScheduled", { v: info.speed_kmh })),
    );
  }
  if (enthusiast && (info.gauge_mm || info.max_kmh || info.tracks || info.electrified)) {
    const parts = [];
    if (info.tracks) parts.push(t(lang, info.tracks === 1 ? "trackSingle" : info.tracks === 2 ? "trackDouble" : "trackMany", { n: info.tracks }));
    if (info.electrified) parts.push(t(lang, info.electrified === 2 ? "electrified" : "notElectrified"));
    const g = gaugeName(lang, info.gauge_mm);
    if (g) parts.push(t(lang, g));
    if (info.max_kmh) parts.push(t(lang, "maxSpeed", { v: info.max_kmh }));
    const src = info.tracks || info.electrified ? "trackSourceIgn" : "trackSource";
    rows.push(row(t(lang, "track"), parts.join(" · "), el("span", { class: "muted" }, ` ${t(lang, src)}`)));
  }
  if (enthusiast && info.grade_permille !== undefined) {
    rows.push(
      row(
        t(lang, "grade"),
        gradeText(lang, info.grade_permille),
        el("span", { class: "muted" }, ` · ${t(lang, "altitude", { v: info.altitude_m })}`),
      ),
    );
    const chart = profileChart(lang, profile);
    if (chart) rows.push(chart);
    rows.push(el("details", { class: "small muted" }, el("summary", {}, t(lang, "gradeSource")), COPERNICUS_NOTICE));
  }
  if (info.accessible) rows.push(el("div", { class: "small" }, t(lang, info.accessible === "yes" ? "accessibleYes" : "accessibleNo")));
  const age = formatAgo(lang, info.fix_age);
  if (info.timetable_only) {
    const site = OPERATOR_SITES[info.operator];
    if (napDate) rows.push(el("div", { class: "small muted" }, t(lang, "timetableSource", { date: formatDay(lang, napDate) })));
    if (site) rows.push(el("a", { class: "small", href: site, target: "_blank", rel: "noopener" }, t(lang, "operatorLive", { op: info.operator })));
    rows.push(el("a", { class: "small", href: "https://www.transportes.gob.es/", target: "_blank", rel: "noopener" }, "Powered by MITRAMS"));
  }
  if (!info.timetable_only) rows.push(
    row(
      t(lang, "position"),
      // Under a minute old, the dot is effectively at the GPS fix.
      info.position === "gps" || info.fix_age < 60 ? t(lang, "gpsAgo", { age }) : t(lang, "estimatedPos", { age }),
    ),
  );
  if (enthusiast && info.origin) {
    rows.push(row(t(lang, "ahead"), gapText(lang, info.ahead, onTrain)));
    rows.push(row(t(lang, "behind"), gapText(lang, info.behind, onTrain)));
    if (info.oncoming) rows.push(row(t(lang, "oncoming"), oncomingText(lang, info.oncoming, onTrain)));
  }
  if (!info.timetable_only) rows.push(...sourceNote(lang, info));
  if (appUrl && info.origin) {
    rows.push(el("a", { class: "small app-link", href: appUrl, target: "_blank", rel: "noopener" }, `🔔 ${t(lang, "appAlerts")}`));
  }
  return el(
    "div",
    { class: "popup" },
    title,
    sub.length ? el("div", { class: "muted" }, sub.join(" · ")) : null,
    popupActions(lang, fav, onShare),
    trip && info.origin
      ? el(
          "div",
          { class: "popup-actions" },
          el(
            "button",
            { class: "pill small trip-btn", type: "button", "aria-pressed": String(trip.on), onclick: trip.onToggle },
            trip.on ? `🧳 ${t(lang, "tripOn")}` : `🧳 ${t(lang, trip.pro ? "tripStart" : "tripStartPro")}`,
          ),
        )
      : null,
    rows,
  );
}

/** ☆ Save / ★ Saved and Share buttons under a popup's title. */
function popupActions(lang, fav, onShare) {
  if (!fav && !onShare) return null;
  return el(
    "div",
    { class: "popup-actions" },
    fav
      ? el(
          "button",
          { class: "pill small fav-btn", type: "button", "aria-pressed": String(fav.on), onclick: fav.onToggle },
          fav.on ? `★ ${t(lang, "favOn")}` : `☆ ${t(lang, "favAdd")}`,
        )
      : null,
    onShare ? el("button", { class: "pill small", type: "button", onclick: onShare }, t(lang, "share")) : null,
    fav?.full ? el("div", { class: "small muted fav-full" }, t(lang, "favFull", { n: fav.limit })) : null,
  );
}

/** Settings: TrainRadar Pro and tips (Android app), backup of the user's
 * own data (both). `pro`: entitlement.decide()'s result; `catalogue`:
 * Billing.catalogue() (null outside the app or before Play answers). */
export function settingsPanel(lang, { platform, pro, catalogue, message, onBuy, onRestore, onManage, onExport, onImport, onDelete, onTrips = null, alerts = null, onCommute = null }) {
  const out = [];
  if (platform === "android") {
    const sub = catalogue?.find((p) => p.kind === "subscription");
    out.push(el("h3", {}, "TrainRadar Pro"));
    out.push(el("p", { class: pro?.pro ? "pro-on" : "muted", id: "pro-state" }, t(lang, `proState_${pro?.state || "none"}`)));
    out.push(el("p", { class: "small" }, t(lang, "proIncludes")));
    out.push(el("ul", { class: "small pro-features" }, ["proFavourites", "proDetails", "proTrips", "proAlerts", "proWidget", "proHistory", "proCommute"].map((k) => el("li", {}, t(lang, k)))));
    if (pro?.pro && onTrips) out.push(el("p", {}, el("button", { class: "pill", type: "button", id: "trips-btn", onclick: onTrips }, `🧳 ${t(lang, "tripsTitle")}`)));
    if (pro?.pro && onCommute) out.push(el("p", {}, el("button", { class: "pill", type: "button", id: "commute-btn", onclick: onCommute }, `🏠 ${t(lang, "commuteTitle")}`)));
    if (pro?.pro && alerts) {
      out.push(
        el(
          "p",
          {},
          el("button", { class: "pill", type: "button", id: "alerts-btn", "aria-pressed": String(alerts.on), onclick: alerts.onToggle }, `🔔 ${t(lang, alerts.on ? "alertsOn" : "alertsOff")}`),
        ),
        el("p", { class: "small muted" }, t(lang, "alertsNote")),
      );
    }
    out.push(el("p", { class: "small muted" }, t(lang, "proSoon")));
    if (!pro?.pro) {
      out.push(
        el(
          "p",
          {},
          sub?.canBuy
            ? el("button", { class: "pill pill-strong", type: "button", id: "pro-buy", onclick: () => onBuy(sub.id) }, t(lang, "proBuy", { price: sub.price || "" }))
            : el("span", { class: "small muted" }, t(lang, catalogue ? "proUnavailable" : "proLoading")),
        ),
      );
      out.push(el("p", { class: "small muted" }, t(lang, "proTerms")));
    }
    out.push(
      el(
        "p",
        { class: "popup-actions" },
        el("button", { class: "pill small", type: "button", id: "pro-restore", onclick: onRestore }, t(lang, "proRestore")),
        pro?.pro ? el("button", { class: "pill small", type: "button", onclick: onManage }, t(lang, "proManage")) : null,
      ),
    );
    const tips = (catalogue || []).filter((p) => p.kind === "tip" && p.canBuy);
    if (tips.length) {
      out.push(el("h3", {}, t(lang, "tipsTitle")));
      out.push(el("p", { class: "small" }, t(lang, "tipsText")));
      out.push(el("p", { class: "popup-actions" }, tips.map((p) => el("button", { class: "pill small", type: "button", onclick: () => onBuy(p.id) }, `${t(lang, `tip_${p.id}`)} · ${p.price || ""}`))));
    }
  }
  out.push(el("h3", {}, t(lang, "backupTitle")));
  out.push(el("p", { class: "small" }, t(lang, platform === "android" ? "backupAuto" : "backupWeb")));
  const file = el("input", { type: "file", accept: "application/json,.json", id: "import-file", hidden: true, onchange: (e) => e.target.files?.[0] && onImport(e.target.files[0]) });
  out.push(
    el(
      "p",
      { class: "popup-actions" },
      el("button", { class: "pill small", type: "button", id: "backup-export", onclick: onExport }, t(lang, "backupExport")),
      el("button", { class: "pill small", type: "button", id: "backup-import", onclick: () => file.click() }, t(lang, "backupImport")),
      file,
    ),
  );
  out.push(el("p", {}, el("button", { class: "pill small danger", type: "button", id: "delete-all", onclick: onDelete }, t(lang, "deleteAll"))));
  if (message) out.push(el("p", { class: "small notice-box", id: "settings-msg", role: "status" }, message));
  return out;
}


/** Bars of on-time share per day (green ≥ 80 %, amber ≥ 60 %, red below). */
export function punctualityChart(lang, series) {
  const w = 300;
  const h = 90;
  const n = Math.max(series.length, 1);
  const bw = w / n;
  const color = (p) => (p >= 80 ? "#16a34a" : p >= 60 ? "#f59e0b" : "#dc2626");
  const bars = series.map((d, i) => {
    const bh = Math.max(1, (d.onTimePct / 100) * h);
    return svg("rect", { x: (i * bw).toFixed(2), y: (h - bh).toFixed(2), width: Math.max(bw - (n > 60 ? 0 : 1), 0.5).toFixed(2), height: bh.toFixed(2), fill: color(d.onTimePct) },
      svg("title", {}, document.createTextNode(`${d.date}: ${d.onTimePct} % ${t(lang, "histOnTime")}`)));
  });
  return svg("svg", { viewBox: `0 0 ${w} ${h + 14}`, class: "history-chart", role: "img", "aria-label": t(lang, "histChart") },
    svg("line", { x1: 0, y1: h * 0.2, x2: w, y2: h * 0.2, stroke: "#cbd5e1", "stroke-dasharray": "3 3" }),
    ...bars,
    svg("text", { x: 0, y: h + 12, "font-size": 9, fill: "#64748b" }, document.createTextNode(series[0]?.date || "")),
    svg("text", { x: w, y: h + 12, "font-size": 9, fill: "#64748b", "text-anchor": "end" }, document.createTextNode(series[series.length - 1]?.date || "")));
}

/** The history screen: range buttons (longer ranges with Pro), the chart of
 * the line or station, and for a train its runs. */
export function historyPanel(lang, { title, series, runs, days, ranges, onRange, onPro, state }) {
  const out = [el("p", {}, el("strong", {}, title))];
  out.push(
    el(
      "p",
      { class: "popup-actions" },
      ranges.map((r) =>
        el(
          "button",
          { class: "pill small", type: "button", "aria-pressed": String(r.days === days), onclick: () => (r.locked ? onPro?.() : onRange(r.days)) },
          `${t(lang, "histDays", { n: r.days })}${r.locked ? " 🔒" : ""}`,
        ),
      ),
    ),
  );
  if (state === "loading") return [...out, el("p", { class: "muted" }, t(lang, "loading"))];
  if (state === "error") return [...out, el("p", { class: "muted" }, t(lang, "histUnavailable"))];
  if (!series.length && !(runs || []).length) return [...out, el("p", { class: "muted" }, t(lang, "histNone"))];
  if (series.length) {
    const avg = Math.round(series.reduce((a, d) => a + d.onTimePct, 0) / series.length);
    out.push(el("p", { class: "small" }, t(lang, "histAvg", { p: avg, d: series.length })), punctualityChart(lang, series));
  }
  if (runs?.length) {
    out.push(el("h3", {}, t(lang, "histRuns2")));
    out.push(
      el(
        "ul",
        { class: "board" },
        [...runs].reverse().slice(0, 30).map((r) => {
          const d = r.arr_delay_min ?? r.last_delay_min ?? null;
          return el(
            "li",
            {},
            el("span", {}, r.date.split("-").reverse().join("/")),
            " ",
            el("span", { class: "board-delay" }, r.cancelled ? t(lang, "canceled") : d === null ? "—" : formatDelay(lang, d * 60)),
          );
        }),
      ),
    );
  }
  out.push(el("p", { class: "small muted" }, t(lang, "histNote")));
  return out;
}

/** Commute mode (Pro): the next trains from one saved station to another. */
export function commutePanel(lang, { from, to, rows, list = [], active = -1, draft = null, note = "", onSelect = () => {}, onTrain, onSwap, onClear }) {
  const out = [];
  if (note) out.push(el("p", { class: "small" }, note));
  // Saved commutes as tabs when there's more than one.
  if (list.length > 1) {
    out.push(
      el(
        "p",
        { class: "commute-tabs" },
        list.map((c, i) =>
          el(
            "button",
            { class: i === active ? "pill small pill-strong" : "pill small", type: "button", "aria-pressed": String(i === active), onclick: () => onSelect(i) },
            `${c.from.name} → ${c.to.name}`,
          ),
        ),
      ),
    );
  }
  const help = el("p", { class: "small muted" }, draft ? t(lang, "commuteDraft", { station: draft.name }) : t(lang, list.length ? "commuteAddHelp" : "commuteHelp"));
  if (!from || !to) return [...out, help];
  const clock = (u) => formatClock(u);
  out.push(el("p", {}, el("strong", {}, `${from.name} → ${to.name}`)));
  out.push(
    rows.length
      ? el(
          "ul",
          { class: "board" },
          rows.map((r) =>
            el(
              "li",
              {},
              el("span", { class: "board-time" }, clock(r.expected_dep)),
              " ",
              r.live ? el("button", { class: "link", onclick: () => onTrain(r) }, el("strong", {}, `${r.route} ${r.number}`)) : el("strong", {}, `${r.route} ${r.number}`),
              el("span", { class: "board-main muted" }, ` ${t(lang, "commuteArrives", { time: clock(r.expected_arr) })}`),
              " ",
              el("span", { class: "board-delay" }, r.canceled ? t(lang, "canceled") : formatDelay(lang, r.delay)),
            ),
          ),
        )
      : el("p", { class: "muted" }, t(lang, "commuteNone")),
  );
  out.push(
    el(
      "p",
      { class: "popup-actions" },
      el("button", { class: "pill small", type: "button", onclick: onSwap }, t(lang, "commuteSwap")),
      el("button", { class: "pill small", type: "button", onclick: onClear }, t(lang, "commuteClear")),
    ),
  );
  out.push(help);
  return out;
}

/** My trips (Pro): monthly figures, then each trip with its claim summary,
 * image card and delete. */
export function tripsPanel(lang, { trips, stats, onClaim, onCard, onDelete, onCsv, onDeleteAll }) {
  if (!trips.length) return [el("p", { class: "muted" }, t(lang, "tripsEmpty"))];
  const out = [];
  if (stats.length) {
    out.push(
      el(
        "table",
        { class: "small trips-stats" },
        el("tr", {}, ["tripsMonth", "tripsCount", "tripsLate", "tripsAvg"].map((k) => el("th", {}, t(lang, k)))),
        stats.map((m) => el("tr", {}, el("td", {}, m.month), el("td", {}, String(m.trips)), el("td", {}, m.latePct === null ? "—" : `${m.latePct} %`), el("td", {}, m.avgDelay === null ? "—" : `${m.avgDelay} min`))),
      ),
    );
  }
  const list = [...trips].sort((a, b) => b.startedAt - a.startedAt);
  out.push(
    el(
      "ul",
      { class: "board trips-list" },
      list.map((tr) => {
        const d = tr.arrDelayMin ?? tr.lastDelayMin;
        return el(
          "li",
          {},
          el("strong", {}, tr.label),
          el("span", { class: "board-main muted" }, ` ${tr.day.split("-").reverse().join("/")} · ${tr.origin} → ${tr.destination}`),
          " ",
          el("span", { class: "board-delay" }, tr.endedAt ? (d === null ? "—" : formatDelay(lang, d * 60)) : t(lang, "tripLive")),
          tr.estimated ? el("span", { class: "small muted" }, ` ${t(lang, "tripEstimated")}`) : null,
          el(
            "div",
            { class: "popup-actions" },
            tr.endedAt ? el("button", { class: "pill small", type: "button", onclick: () => onClaim(tr) }, t(lang, "tripClaim")) : null,
            tr.endedAt ? el("button", { class: "pill small", type: "button", onclick: () => onCard(tr) }, t(lang, "tripCard")) : null,
            el("button", { class: "pill small", type: "button", "aria-label": t(lang, "tripDelete"), onclick: () => onDelete(tr) }, "✕"),
          ),
        );
      }),
    ),
  );
  out.push(el("p", { class: "small muted" }, t(lang, "tripsNote")));
  out.push(
    el(
      "p",
      { class: "popup-actions" },
      el("button", { class: "pill small", type: "button", id: "trips-csv", onclick: onCsv }, t(lang, "tripsCsv")),
      el("button", { class: "pill small danger", type: "button", onclick: onDeleteAll }, t(lang, "tripsDeleteAll")),
    ),
  );
  return out;
}

/** The claim helper: the facts, a copy button and Renfe's official page. */
export function claimBox(lang, text, url, onCopy) {
  return [
    el("p", { class: "small" }, t(lang, "claimIntro")),
    el("pre", { class: "claim-text", id: "claim-text" }, text),
    el(
      "p",
      { class: "popup-actions" },
      el("button", { class: "pill small", type: "button", onclick: onCopy }, t(lang, "claimCopy")),
      el("a", { class: "pill small", href: url, target: "_blank", rel: "noopener" }, `${t(lang, "claimRenfe")} ↗`),
    ),
    el("p", { class: "small muted" }, t(lang, "claimNote")),
  ];
}

/** The favourites sheet: each train with its live state, each station. */
export function favouritesPanel(lang, list, { trainInfo, onTrain, onStation, onRemove, limit }) {
  if (!list.length) return [el("p", { class: "muted" }, t(lang, "favEmpty"))];
  const items = list.map((f) => {
    const remove = el("button", { class: "pill small", type: "button", "aria-label": t(lang, "favRemove"), onclick: () => onRemove(f) }, "✕");
    if (f.type === "station") {
      return el("li", {}, el("button", { class: "link", onclick: () => onStation(f) }, el("strong", {}, `■ ${f.name}`)), " ", remove);
    }
    const info = trainInfo(f);
    const state = info
      ? el("span", { class: "board-delay" }, formatDelay(lang, info.delay))
      : el("span", { class: "muted" }, ` ${t(lang, "favNotRunning")}`);
    const name = el("strong", {}, info ? trainTitle(info) : f.label);
    return el(
      "li",
      {},
      info ? el("button", { class: "link", onclick: () => onTrain(info) }, name) : name,
      info?.destination ? el("span", { class: "board-main muted" }, ` → ${info.destination}`) : null,
      " ",
      state,
      " ",
      remove,
    );
  });
  return [el("ul", { class: "board" }, items), el("p", { class: "small muted" }, Number.isFinite(limit) ? t(lang, "favNote", { n: limit }) : t(lang, "favNotePro"))];
}

/** The line's last 7 days (phase C2b), from the history API's summary. */
export function historyBox(lang, h, proUrl, onPro = null, onHistory = null) {
  const n = (x) => x.toLocaleString(lang === "en" ? "en-GB" : "es-ES");
  const parts = [t(lang, "histLine", { p: h.onTimePct, l: h.late5Pct })];
  if (h.medianMin !== null && h.medianMin > 0) parts.push(t(lang, "histMedian", { m: h.medianMin }));
  const runs = [t(lang, "histRuns", { n: n(h.trips), d: h.days })];
  if (h.cancelled) runs.push(h.cancelled === 1 ? t(lang, "histCancelled1") : t(lang, "histCancelled", { n: n(h.cancelled) }));
  return el(
    "div",
    { class: "history-box", id: "history-box" },
    el("div", { class: "history-title" }, t(lang, "histTitle")),
    el("div", {}, parts.join(" · ")),
    el("div", { class: "small muted" }, runs.join(" · ")),
    el("div", { class: "small muted" }, t(lang, "histNote")),
    onHistory ? el("button", { class: "link small", type: "button", id: "history-open", onclick: onHistory }, t(lang, "histOpen")) : null,
    onPro
      ? el("button", { class: "link small", type: "button", onclick: onPro }, t(lang, "histPro"))
      : proUrl
        ? el("a", { class: "small", href: proUrl, target: "_blank", rel: "noopener" }, t(lang, "histPro"))
        : null,
  );
}

function minutesUntil(lang, unix) {
  const m = Math.round((unix - Date.now() / 1000) / 60);
  return m <= 0 ? t(lang, "now") : t(lang, "inMin", { m });
}

/** "¿Voy en este tren?" status line, with a button to show the train. */
export function onboardBlock(lang, v, trainTitles, onShow) {
  let text;
  let show = null;
  const conf = (c) => t(lang, c === "high" ? "confHigh" : c === "medium" ? "confMedium" : "confLow");
  switch (v.status) {
    case "collecting":
      text = t(lang, "onboardCollecting", { n: v.samples, s: v.span_secs });
      break;
    case "stationary":
      text = t(lang, "onboardStationary");
      break;
    case "none":
      text = t(lang, "onboardNone");
      break;
    case "match": {
      const c = v.candidates[0];
      text = t(lang, "onboardMatch", { train: trainTitles(c), conf: conf(c.confidence) });
      if (c.index >= 0) show = c;
      break;
    }
    default:
      text = t(lang, "onboardAmbiguous", { trains: v.candidates.map(trainTitles).join(", ") });
  }
  return el(
    "div",
    { class: "onboard" },
    el("h3", {}, t(lang, "onboardTitle")),
    el("p", {}, text),
    show ? el("button", { class: "pill", onclick: () => onShow(show) }, t(lang, "showTrain")) : null,
  );
}

/** Nearest stations with a board for the closest and trains approaching it. */
export function nearPanel(lang, { stations, board, approaching, onStation, onTrain }) {
  const out = [];
  if (stations.length) {
    const s0 = stations[0];
    out.push(el("h3", {}, t(lang, "nextTrains", { station: s0.name })));
    out.push(boardList(lang, board));
    out.push(el("h3", {}, t(lang, "approaching", { station: s0.name })));
    out.push(
      approaching.length
        ? el(
            "ul",
            { class: "board" },
            approaching.map((a) =>
              el(
                "li",
                {},
                el("button", { class: "link", onclick: () => onTrain(a) }, el("strong", {}, trainTitle(a))),
                el("span", { class: "board-main muted" }, ` ${minutesUntil(lang, a.eta)} · ${formatDistance(lang, a.distance_m)}`),
                el("span", { class: "board-delay" }, formatDelay(lang, a.delay)),
              ),
            ),
          )
        : el("p", { class: "muted" }, t(lang, "noneApproaching")),
    );
    out.push(el("h3", {}, t(lang, "nearestStations")));
    out.push(
      el(
        "ul",
        { class: "board" },
        stations.map((s) =>
          el(
            "li",
            {},
            el("button", { class: "link", onclick: () => onStation(s) }, s.name),
            el("span", { class: "board-delay muted" }, formatDistance(lang, s.distance_m)),
          ),
        ),
      ),
    );
  }
  return out;
}

/** Departures board rows (engine.stationBoardJson). */
function boardList(lang, board) {
  return board.length
    ? el(
        "ul",
        { class: "board" },
        board.map((r) =>
          el(
            "li",
            { class: r.canceled ? "canceled" : "" },
            el("span", { class: "board-time" }, formatClock(r.sched)),
            el(
              "span",
              { class: "board-main" },
              el("strong", {}, `${r.route} ${r.number}`.trim()),
              " ",
              r.terminates ? t(lang, "fromOrigin", { origin: r.other_end }) : t(lang, "toDest", { dest: r.other_end }),
            ),
            el(
              "span",
              { class: "board-delay", style: `color:${COLORS[r.delay === null ? 3 : r.delay < 300 ? 0 : r.delay < 900 ? 1 : 2]}` },
              r.canceled ? t(lang, "canceled") : formatDelay(lang, r.delay),
            ),
          ),
        ),
      )
    : el("p", { class: "muted" }, t(lang, "noTrainsSoon"));
}

/** Popup for a station: next trains, and trains on their way. */
export function stationPopup(lang, station, board, approaching, onTrain, { fav = null, onShare = null, onHistory = null, commute = null } = {}) {
  return el(
    "div",
    { class: "popup" },
    el("div", { class: "popup-title" }, station.name),
    popupActions(lang, fav, onShare),
    onHistory || commute
      ? el(
          "div",
          { class: "popup-actions" },
          onHistory ? el("button", { class: "pill small", type: "button", id: "station-history", onclick: onHistory }, `📊 ${t(lang, "histStation")}`) : null,
          commute ? el("button", { class: "pill small", type: "button", id: "commute-from", onclick: commute.setFrom }, t(lang, commute.isFrom ? "commuteIsFrom" : "commuteFrom")) : null,
          commute ? el("button", { class: "pill small", type: "button", id: "commute-to", onclick: commute.setTo }, t(lang, commute.isTo ? "commuteIsTo" : "commuteTo")) : null,
        )
      : null,
    el("h3", {}, t(lang, "departuresNext")),
    boardList(lang, board),
    el("h3", {}, t(lang, "approachingShort")),
    approaching.length
      ? el(
          "ul",
          { class: "board" },
          approaching.map((a) =>
            el(
              "li",
              {},
              el("button", { class: "link", onclick: () => onTrain(a) }, el("strong", {}, trainTitle(a))),
              el("span", { class: "board-main muted" }, ` ${minutesUntil(lang, a.eta)} · ${formatDistance(lang, a.distance_m)}`),
              el("span", { class: "board-delay" }, formatDelay(lang, a.delay)),
            ),
          ),
        )
      : el("p", { class: "muted" }, t(lang, "noneApproaching")),
  );
}

/** One row of the delayed-arrivals list. */
export function delayedItem(lang, info, onSelect) {
  return el(
    "li",
    {},
    el(
      "button",
      { class: "delayed-item", onclick: () => onSelect(info) },
      el(
        "span",
        { class: "delayed-delay", style: `color:${COLORS[info.delay < 900 ? 1 : 2]}` },
        formatDelay(lang, info.delay),
      ),
      el(
        "span",
        { class: "delayed-main" },
        el("strong", {}, trainTitle(info)),
        " ",
        info.destination ? `→ ${info.destination}` : "",
        info.next_stop
          ? el(
              "span",
              { class: "muted" },
              ` · ${info.next_stop}${info.next_arrival ? ` ${formatClock(info.next_arrival)}` : ""}`,
            )
          : "",
      ),
    ),
  );
}

/** The notices panel body: feed age, optional filter, list, Adif link. */
export function incidentsPanel(lang, { list, modifiedMs, filter, regionName, onShowAll, onStop, stopped, onTrain }) {
  const out = stopped ? stoppedPanel(lang, stopped, onTrain) : [];
  out.push(el("h3", {}, t(lang, "incidentsTitle")));
  if (modifiedMs) {
    const ageSecs = (Date.now() - modifiedMs) / 1000;
    const vars = { date: formatDay(lang, modifiedMs / 1000), ago: formatAgo(lang, ageSecs) };
    const stale = ageSecs > 2 * 86_400;
    out.push(el("p", { class: stale ? "small warn" : "small muted" }, t(lang, stale ? "incidentsStale" : "incidentsAge", vars)));
  }
  if (filter) {
    out.push(
      el(
        "p",
        { class: "small" },
        t(lang, "filteredBy", { what: filter.label }),
        " · ",
        el("button", { class: "link", onclick: onShowAll }, t(lang, "showAll")),
      ),
    );
  }
  const shown = filter ? list.filter(filter.test) : list;
  if (!shown.length) out.push(el("p", { class: "muted" }, t(lang, "noIncidents")));
  out.push(
    el(
      "ul",
      { class: "incidents" },
      shown.map((i) =>
        el(
          "li",
          {},
          el(
            "div",
            { class: "incident-meta" },
            i.kind ? el("span", { class: `chip chip-kind kind-${i.kind}` }, t(lang, `kind_${i.kind}`)) : null,
            i.nucleos.map((n) => el("span", { class: "chip chip-region" }, regionName(n) || n)),
            i.lines.map((l) => el("span", { class: "chip" }, l)),
            el(
              "span",
              { class: "muted" },
              i.from ? t(lang, "published", { date: formatDay(lang, i.from) }) : "",
              i.until ? ` ${t(lang, "untilDate", { date: formatDay(lang, i.until) })}` : "",
            ),
          ),
          el("p", { class: "incident-text" }, i.text),
          i.stops.length
            ? el(
                "p",
                { class: "small" },
                i.stops.map((s, k) => [k ? ", " : "", s.lat !== null ? el("button", { class: "link", onclick: () => onStop(s) }, s.name) : s.name]),
              )
            : null,
        ),
      ),
    ),
  );
  out.push(...officialLinks(lang));
  return out;
}

/** Trains stopped between stations, grouped by section to flag likely problems. */
export function stoppedPanel(lang, list, onSelect) {
  const out = [el("h3", {}, t(lang, "stoppedTitle"))];
  if (!list.length) {
    out.push(el("p", { class: "muted small" }, t(lang, "stoppedNone")));
    return out;
  }
  const bySection = new Map();
  for (const i of list) {
    const k = `${i.stopped.after}|${i.stopped.before}`;
    bySection.set(k, [...(bySection.get(k) || []), i]);
  }
  for (const [k, group] of bySection) {
    if (group.length >= 2) {
      const [a, b] = k.split("|");
      out.push(el("p", { class: "small warn" }, t(lang, "stoppedCluster", { n: group.length, a, b })));
    }
  }
  out.push(
    el(
      "ul",
      { class: "board" },
      list.map((i) =>
        el(
          "li",
          {},
          el("button", { class: "link", onclick: () => onSelect(i) }, el("strong", {}, trainTitle(i))),
          el(
            "span",
            { class: "board-main muted" },
            ` ${i.stopped.after} – ${i.stopped.before} · ${formatDuration(lang, Date.now() / 1000 - i.stopped.since)}${i.stopped.confirmed ? "" : " (?)"}`,
          ),
          el("span", { class: "board-delay" }, formatDelay(lang, i.delay)),
        ),
      ),
    ),
  );
  return out;
}
