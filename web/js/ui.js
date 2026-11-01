// DOM for the stats bar, legend, delayed list and train popup. Feed text is
// untrusted: it only ever goes into textContent, never innerHTML.
import { t } from "./i18n.js";
import { formatAgo, formatClock, formatCount, formatDelay, formatDistance, formatDuration } from "./format.js";
import { COLORS } from "./map.js";

/** Create an element: el("div", { class: "x", onclick }, child, "text"). */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
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

function gapText(lang, g) {
  if (!g) return t(lang, "none");
  const s = t(lang, "gap", { time: formatDuration(lang, g.time_secs), dist: formatDistance(lang, g.distance_m) });
  return g.estimated ? `≈ ${s}` : s;
}

/** Popup body for one train (engine.trainJson). */
export function trainPopup(lang, info, regionName) {
  const title = el("div", { class: "popup-title" }, trainTitle(info));
  const sub = [];
  if (info.feed === "vp_cer" && regionName) sub.push(t(lang, "cercanias", { region: regionName }));
  if (info.platform) sub.push(t(lang, "platform", { p: info.platform }));
  const rows = [];
  if (info.canceled) rows.push(el("div", { class: "badge badge-red" }, t(lang, "canceled")));
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
  const age = formatAgo(lang, info.fix_age);
  rows.push(
    row(
      t(lang, "position"),
      // Under a minute old, the dot is effectively at the GPS fix.
      info.position === "gps" || info.fix_age < 60 ? t(lang, "gpsAgo", { age }) : t(lang, "estimatedPos", { age }),
    ),
  );
  if (info.origin) {
    rows.push(row(t(lang, "ahead"), gapText(lang, info.ahead)));
    rows.push(row(t(lang, "behind"), gapText(lang, info.behind)));
  }
  return el("div", { class: "popup" }, title, sub.length ? el("div", { class: "muted" }, sub.join(" · ")) : null, rows);
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
