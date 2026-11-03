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
function svg(tag, attrs) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
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

export function trainPopup(lang, info, regionName, onIncidents, { napDate, profile, onTrain } = {}) {
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
  // A timetabled 0 km/h just means "dwelling at a station": not worth a row.
  if (info.speed_kmh !== null && info.speed_kmh !== undefined && (info.speed_measured || info.speed_kmh > 0)) {
    rows.push(
      row(t(lang, "speed"), t(lang, info.speed_measured ? "speedMeasured" : "speedScheduled", { v: info.speed_kmh })),
    );
  }
  if (info.gauge_mm || info.max_kmh || info.tracks || info.electrified) {
    const parts = [];
    if (info.tracks) parts.push(t(lang, info.tracks === 1 ? "trackSingle" : info.tracks === 2 ? "trackDouble" : "trackMany", { n: info.tracks }));
    if (info.electrified) parts.push(t(lang, info.electrified === 2 ? "electrified" : "notElectrified"));
    const g = gaugeName(lang, info.gauge_mm);
    if (g) parts.push(t(lang, g));
    if (info.max_kmh) parts.push(t(lang, "maxSpeed", { v: info.max_kmh }));
    const src = info.tracks || info.electrified ? "trackSourceIgn" : "trackSource";
    rows.push(row(t(lang, "track"), parts.join(" · "), el("span", { class: "muted" }, ` ${t(lang, src)}`)));
  }
  if (info.grade_permille !== undefined) {
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
  if (info.origin) {
    rows.push(row(t(lang, "ahead"), gapText(lang, info.ahead, onTrain)));
    rows.push(row(t(lang, "behind"), gapText(lang, info.behind, onTrain)));
    if (info.oncoming) rows.push(row(t(lang, "oncoming"), oncomingText(lang, info.oncoming, onTrain)));
  }
  if (!info.timetable_only) rows.push(...sourceNote(lang, info));
  return el("div", { class: "popup" }, title, sub.length ? el("div", { class: "muted" }, sub.join(" · ")) : null, rows);
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
export function stationPopup(lang, station, board, approaching, onTrain) {
  return el(
    "div",
    { class: "popup" },
    el("div", { class: "popup-title" }, station.name),
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
