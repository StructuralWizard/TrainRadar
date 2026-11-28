// Train and station details for the phone's bottom sheet (< 900 px) and the desktop side panel. The
// desktop keeps the map popups (ui.js trainPopup / stationPopup). Feed text
// (names, lines, notices) only ever goes into textContent.
import { t } from "./i18n.js";
import { formatAgo, formatClock, formatCount, formatDistance, formatDuration, fromZonedInput, zonedInput } from "./format.js";
import { icon } from "./icons.js";
import { fold, matchScore } from "./places.js";
import { journeyKey } from "./route.js";
import { clock } from "./cabrides.js";
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
  if (secs === null || secs === undefined) return t(lang, "legendUnknown");
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
 * notice {open, kinds, label(kind), onToggle, onPick(kind)} ("Compartir aviso"),
 * report {list [{kind, n, last ms, resolved, trust {confirmed, earlierMin}}], onDispute(kind)?, canReport,
 * open, kinds, busy, msg, onUndo?, onToggle, onPick(kind)} (travellers' reports),
 * onHistory, trip {on, pro, onToggle}, onIncidents, history, rows (trainRows
 * options), redraw }.
 */
export function trainSheet(lang, info, o = {}) {
  const now = (o.now ?? Date.now()) / 1000;
  const route = info.route || info.line || "";
  const tone = delayTone(info.delay);
  const mins = info.delay === null || info.delay === undefined ? null : delayMinutes(info.delay);
  // The delay as a compact pill: "+17", "A su hora", "Suprimido", "—".
  const pill = info.canceled
    ? el("span", { class: "ts-pill tone-major" }, t(lang, "canceled"))
    : mins === null
      ? el("span", { class: "ts-pill tone-none", "aria-label": t(lang, "legendUnknown") }, "—")
      : mins <= 0
        ? el("span", { class: "ts-pill tone-ok" }, t(lang, "onTime"))
        : el("span", { class: `ts-pill tone-${tone}`, "aria-label": t(lang, "late", { m: mins }) }, `+${formatCount(lang, mins)}`);

  // Sub-line: where it runs (a Cercanías network, or its two ends and their
  // times), the platform and how fresh the position is. Empty parts are left out.
  const stopsAll = Array.isArray(o.stops) ? o.stops : [];
  const sub = [];
  if (info.feed === "vp_cer" && o.regionName) sub.push(t(lang, "cercanias", { region: o.regionName }));
  else if (info.origin && stopsAll.length > 1) {
    sub.push(`${info.origin} ${formatClock(stopsAll[0].time)}`, `${info.destination || stopsAll[stopsAll.length - 1].name} ${formatClock(stopsAll[stopsAll.length - 1].time)}`);
  }
  if (info.platform) sub.push(t(lang, "platform", { p: info.platform }));
  if (info.position === "scheduled" && !info.timetable_only) sub.push(t(lang, "ukPosition"));
  else if (!info.timetable_only) {
    const age = formatAgo(lang, info.fix_age);
    sub.push(info.position === "gps" || info.fix_age < 60 ? t(lang, "gpsAgo", { age }) : t(lang, "estimatedPos", { age }));
  }
  if (info.accessible) sub.push(t(lang, info.accessible === "yes" ? "accessibleYes" : "accessibleNo").replace(/^♿\s*/u, ""));

  // Guardar · Seguir · Compartir (icon); Avisarme and Historial as chips.
  const acts = [];
  if (o.fav) acts.push(el("button", { class: "ts-act fav-btn", type: "button", "aria-pressed": String(o.fav.on), onclick: o.fav.onToggle }, icon("star", 18), el("span", {}, t(lang, o.fav.on ? "favOn" : "favAdd"))));
  if (o.follow) acts.push(el("button", { class: "ts-act ts-act-strong", type: "button", id: "follow-btn", "aria-pressed": String(o.follow.on), onclick: o.follow.onToggle }, el("span", {}, t(lang, o.follow.on ? "following" : "follow"))));
  if (o.onShare) acts.push(el("button", { class: "ts-act ts-act-icon", type: "button", id: "share-btn", "aria-label": t(lang, "share"), title: t(lang, "share"), onclick: o.onShare }, icon("share", 18)));
  const chips = [];
  const chip = (ic, label, onclick, attrs = {}) => el("button", { class: "chip-btn", type: "button", onclick, ...attrs }, icon(ic, 16), label);
  if (o.notify?.href) chips.push(el("a", { class: "chip-btn", id: "notify-btn", href: o.notify.href, target: "_blank", rel: "noopener" }, icon("bell", 16), t(lang, "actNotify")));
  else if (o.notify) chips.push(chip("bell", t(lang, o.notify.on ? "actNotifyOn" : "actNotify"), o.notify.onToggle, { id: "notify-btn", "aria-pressed": String(o.notify.on) }));
  if (o.onHistory) chips.push(chip("chart", t(lang, "actHistory"), o.onHistory, { id: "history-btn" }));
  if (o.notice) chips.push(chip("message", t(lang, "noticeShare"), o.notice.onToggle, { id: "notice-btn", "aria-expanded": String(!!o.notice.open) }));
  if (o.report?.canReport) chips.push(chip("warning", t(lang, "reportChip"), o.report.onToggle, { id: "report-btn", "aria-expanded": String(!!o.report.open) }));
  // Travellers' reports (reports.js): the counts, always with who says so
  // and that the operator hasn't confirmed them; the report choices.
  const crowd = (o.report?.list || []).map((r) =>
    r.resolved
      ? el(
          "p",
          { class: "small muted crowd-resolved", "data-kind": r.kind },
          t(lang, `reportResolved_${r.kind}`, { n: formatCount(lang, r.n) }),
        )
      : el(
      "div",
      { class: "crowd-report", "data-kind": r.kind },
      el("p", { class: "crowd-count" }, icon("warning", 16), el("span", {}, `${t(lang, `reportCount_${r.kind}`, { n: formatCount(lang, r.n) })} · ${t(lang, "reportLast", { age: formatAgo(lang, Math.max(0, now - r.last / 1000)) })}`)),
      el("p", { class: "small muted" }, [t(lang, "reportDisclaimer"), r.kind === "incident" ? t(lang, "reportEmergency") : ""].filter(Boolean).join(" ")),
      // How often such counts were later confirmed (backend-reports stats.js).
      r.trust
        ? el(
            "p",
            { class: "small muted crowd-trust" },
            t(lang, r.trust.earlierMin ? "reportTrustEarlier" : "reportTrust", { pct: formatCount(lang, r.trust.confirmed), min: formatCount(lang, r.trust.earlierMin || 0) }),
          )
        : null,
      o.report.onDispute ? el("button", { class: "link small", type: "button", onclick: () => o.report.onDispute(r.kind) }, t(lang, "reportDispute")) : null,
    ),
  );
  const reportPick = o.report?.open
    ? el(
        "div",
        { class: "notice-pick", id: "report-pick", role: "group", "aria-label": t(lang, "reportChip") },
        el("p", { class: "small muted" }, t(lang, "reportPick")),
        el("div", { class: "chip-row" }, o.report.kinds.map((k) => el("button", { class: "chip-btn", type: "button", "data-kind": k, disabled: o.report.busy || null, onclick: () => o.report.onPick(k) }, t(lang, `reportKind_${k}`)))),
      )
    : null;
  const reportMsg = o.report?.msg
    ? el(
        "p",
        { class: "small report-msg", role: "status" },
        o.report.msg,
        o.report.onUndo ? el("button", { class: "link small", type: "button", id: "report-undo", onclick: o.report.onUndo }, ` ${t(lang, "reportUndo")}`) : null,
      )
    : null;
  // "Compartir aviso": what's happening, as a fixed choice (notice.js).
  const noticePick = o.notice?.open
    ? el(
        "div",
        { class: "notice-pick", id: "notice-pick", role: "group", "aria-label": t(lang, "noticePick") },
        el("p", { class: "small muted" }, t(lang, "noticePick")),
        el("div", { class: "chip-row" }, o.notice.kinds.map((k) => el("button", { class: "chip-btn", type: "button", "data-kind": k, onclick: () => o.notice.onPick(k) }, o.notice.label(k)))),
      )
    : null;

  // The stop timeline: the last stop passed (grey), "Ahora: entre X e Y",
  // the next stop (a ring in brand blue) and the ones after (hollow), each
  // with its time and expected delay.
  const up = upcomingStops(stopsAll, info.next_stop, info.delay, now);
  const nextIdx = up.length ? stopsAll.length - up.length : -1;
  const passed = nextIdx > 0 ? stopsAll.slice(0, nextIdx).map((s) => ({ name: s.name, sched: s.time - (info.delay || 0) })) : [];
  const key = `${info.trip_id}|${info.number}`;
  const showAll = allStopsFor === key;
  const before = showAll ? passed : passed.slice(-1);
  const after = showAll ? up : up.slice(0, 5);
  const late = (s) => Math.round((s.expected - s.sched) / 60);
  const stopRow = (s, kind) =>
    el(
      "li",
      { class: `tl-stop tl-${kind}` },
      el("span", { class: "tl-time" }, formatClock(kind === "passed" ? s.sched : s.expected)),
      el("span", { class: "tl-dot", "aria-hidden": "true" }),
      el("span", { class: "tl-name" }, s.name),
      kind !== "passed" && !info.timetable_only && info.delay !== null && info.delay !== undefined
        ? el("span", { class: `tl-delay${late(s) >= 15 ? " tone-text-major" : late(s) >= 5 ? " tone-text-minor" : late(s) <= 0 ? " tone-text-ok" : ""}` }, late(s) > 0 ? `+${late(s)}` : "0")
        : el("span", { class: "tl-delay" }),
    );
  const between =
    passed.length && up.length
      ? el(
          "li",
          { class: "tl-now" },
          el("span", { class: "tl-time" }),
          el("span", { class: "tl-dot", "aria-hidden": "true" }),
          el(
            "span",
            { class: "tl-name" },
            [t(lang, "nowBetween", { a: passed[passed.length - 1].name, b: up[0].name }), info.speed_kmh && (info.speed_measured || info.speed_kmh > 0) ? `${info.speed_kmh} km/h` : ""].filter(Boolean).join(" · "),
          ),
          el("span", { class: "tl-delay" }),
        )
      : null;
  const stops = info.origin
    ? [
        el("h3", { class: "sheet-h3 ts-h3" }, t(lang, before.length ? "journeyStops" : "nextStops")),
        up.length
          ? el("ol", { class: "timeline" }, [...before.map((s) => stopRow(s, "passed")), between, ...after.map((s, i) => stopRow(s, i === 0 ? "next" : "later"))])
          : el("p", { class: "muted small" }, t(lang, "noStops")),
        (up.length > 5 || passed.length > 1) && !showAll
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
              t(lang, "allStops", { n: stopsAll.length }),
            )
          : null,
      ]
    : [];

  // The trains ahead and behind, as two cards (hidden when there are none).
  const gapCard = (label, g) =>
    g
      ? el(
          g.i !== undefined && o.rows?.onTrain ? "button" : "div",
          { class: "ts-card", type: g.i !== undefined && o.rows?.onTrain ? "button" : null, onclick: g.i !== undefined && o.rows?.onTrain ? () => o.rows.onTrain(g.i) : null },
          el("span", { class: "ts-card-k" }, label),
          el("span", { class: "ts-card-v" }, [g.title || "", `${g.estimated ? "≈ " : ""}${formatDuration(lang, g.time_secs)}`].filter(Boolean).join(" · ")),
        )
      : null;
  const cards = info.origin ? [gapCard(t(lang, "ahead"), info.ahead), gapCard(t(lang, "behind"), info.behind)].filter(Boolean) : [];

  const details = trainRows(lang, info, o.onIncidents, o.rows || {}, new Set(["alerts", "next", "delay", "history", "speed", "accessible", "position", "gaps"]));

  return el(
    "div",
    { class: "popup sheet-train" },
    el(
      "div",
      { class: "ts-head sheet-grip" },
      el(
        "div",
        { class: "ts-main" },
        el(
          "h2",
          { class: "ts-title popup-title" },
          route ? lineBadge(route, o.lineColor) : null,
          el("span", { class: "ts-number" }, info.number || trainTitle(info)),
          info.destination ? el("span", { class: "ts-dest" }, ` → ${info.destination}`) : null,
        ),
        sub.length ? el("p", { class: "ts-meta" }, sub.join(" · ")) : null,
      ),
      pill,
      closeButton(lang, o.onClose),
    ),
    withIcons(trainAlerts(lang, info, o.onIncidents)),
    crowd,
    acts.length ? el("div", { class: "ts-acts" }, acts) : null,
    chips.length ? el("div", { class: "chip-row" }, chips) : null,
    reportPick,
    reportMsg,
    noticePick,
    o.fav?.full ? el("p", { class: "small muted fav-full" }, t(lang, "favFull", { n: o.fav.limit })) : null,
    o.trip && info.origin
      ? el(
          "button",
          { class: "chip-btn trip-btn", type: "button", "aria-pressed": String(o.trip.on), onclick: o.trip.onToggle },
          icon("suitcase", 16),
          ` ${o.trip.on ? t(lang, "tripOn") : t(lang, o.trip.pro ? "tripStart" : "tripStartPro")}`,
        )
      : null,
    stops,
    cards.length ? el("div", { class: "ts-cards" }, cards) : null,
    o.history && info.origin ? historyBox(lang, o.history, o.rows?.appUrl, o.rows?.proLink, o.onHistory) : null,
    details.length ? [el("h3", { class: "sheet-h3" }, t(lang, "detailsTitle")), el("div", { class: "ts-details" }, details)] : null,
  );
}

/**
 * The station sheet. `o`: { sub, board (stationBoardJson), approaching,
 * tab "dep" | "arr", onTab, onDeparture(row), onTrain(info), onClose, fav,
 * onHistory, onShare, onRoute, commute, lineColor(route) }.
 */
/**
 * "When": now, or a date and time (plan future), in time zone `tz`.
 * `value` unix ms or null (now); `until` the last day with timetables
 * (YYYY-MM-DD) or null; `onChange(ms | null)`.
 */
export function whenField(lang, { id, value, tz, until, onChange }) {
  // Ahora · Hoy · Mañana · Otro día, then a time (and for another day, its
  // date): docs/design/ui-redesign/PLAN.md, step 8.
  const nowStr = zonedInput(Date.now(), tz);
  const today = nowStr.slice(0, 10);
  const tomorrow = zonedInput(Date.now() + 86_400_000, tz).slice(0, 10);
  const cur = value ? zonedInput(value, tz) : null;
  const day = cur ? cur.slice(0, 10) : null;
  const time = cur ? cur.slice(11, 16) : nowStr.slice(11, 16);
  const which = !cur ? "now" : day === today ? "today" : day === tomorrow ? "tomorrow" : "other";
  const at = (d, tm = time) => onChange(fromZonedInput(`${d}T${tm}`, tz));
  const chip = (k, label, onclick) =>
    el("button", { type: "button", class: "when-chip", id: `${id}-${k}`, "aria-pressed": String(which === k), onclick }, label);
  // The day after tomorrow, to start "another day" from.
  const later = zonedInput(Date.now() + 2 * 86_400_000, tz).slice(0, 10);
  return el(
    "div",
    { class: "when-row", id },
    chip("now", t(lang, "whenNow"), () => onChange(null)),
    chip("today", t(lang, "whenToday"), () => at(today)),
    chip("tomorrow", t(lang, "whenTomorrow"), () => at(tomorrow)),
    which === "other"
      ? el("label", { class: "when-pick" }, icon("calendar", 16), el("input", {
          type: "date", id: `${id}-date`, "aria-label": t(lang, "otherDay"), value: day, min: today, max: until || null,
          onchange: (e) => e.target.value && at(e.target.value),
        }))
      : chip("other", t(lang, "otherDay"), () => at(until && later > until ? until : later)),
    which === "now"
      ? null
      : el("label", { class: "when-pick" }, icon("clock", 16), el("input", {
          type: "time", id: `${id}-time`, "aria-label": t(lang, "whenLabel"), value: time,
          onchange: (e) => e.target.value && at(day || today, e.target.value),
        })),
  );
}

/** A train's stops on a date, by timetable (plan future): `runs` from
 * engine trainOnDateJson. */
export function trainDayList(lang, { number, runs, loading, onStation }) {
  if (loading) return [el("p", { class: "muted small", id: "trainday-loading" }, t(lang, "planLoading"))];
  if (!runs.length) return [el("p", { class: "muted", id: "trainday-none" }, t(lang, "trainNotThatDay", { n: number }))];
  return runs.map((r) =>
    el(
      "section",
      { class: "trainday" },
      el("h3", { class: "group-h" }, [r.route, r.number].filter(Boolean).join(" "), el("span", { class: "muted small" }, ` · ${r.stops[0].name} → ${r.stops[r.stops.length - 1].name}`)),
      el(
        "ol",
        { class: "trainday-stops" },
        r.stops.map((st, i) =>
          el(
            "li",
            {},
            el("span", { class: "dep-time" }, formatClock(i === 0 ? st.dep : st.arr)),
            onStation ? el("button", { type: "button", class: "link", onclick: () => onStation(st) }, st.name) : st.name,
          ),
        ),
      ),
    ),
  );
}

export function stationSheet(lang, station, o = {}) {
  const chip = (ic, label, onclick, attrs = {}) =>
    el("button", { class: "chip-btn", type: "button", onclick, ...attrs }, ic ? icon(ic, 16) : null, label);
  const chips = [];
  if (o.fav) chips.push(chip("star", t(lang, o.fav.on ? "favOn" : "favAdd"), o.fav.onToggle, { class: "chip-btn fav-btn", "aria-pressed": String(o.fav.on) }));
  if (o.onHistory) chips.push(chip("chart", t(lang, "histStation"), o.onHistory, { id: "station-history" }));
  if (o.onShare) chips.push(chip("share", t(lang, "share"), o.onShare));
  if (o.onRoute) chips.push(chip("arrowRight", t(lang, "routeFromHere"), o.onRoute, { id: "station-route" }));
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
          // Travellers' reports on this train (reports.js), the biggest worry.
          o.reported?.(r)
            ? el("span", { class: "dep-crowd" }, `⚠ ${t(lang, `reportCount_${o.reported(r).kind}`, { n: formatCount(lang, o.reported(r).n) })}`)
            : null,
        ),
        delayPill(lang, r.delay, r.canceled),
      ),
    );
  });
  // A chosen date: the timetable's arrivals instead of trains on the map.
  const plannedArr = (o.arrivals || []).map((r) =>
    el(
      "li",
      {},
      el(
        "div",
        { class: "dep-row" },
        el("span", { class: "dep-time" }, formatClock(r.sched)),
        el(
          "span",
          { class: "dep-main" },
          el("span", { class: "dep-line" }, lineBadge(r.route, o.lineColor?.(r.route)), el("span", { class: "dep-dest" }, t(lang, "fromOrigin", { origin: r.other_end }))),
          el("span", { class: "dep-sub" }, t(lang, "trainNo", { n: r.number })),
        ),
      ),
    ),
  );
  const arrRows = o.planned ? plannedArr : (o.approaching || []).map((a) =>
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
        : el("p", { class: "muted small" }, t(lang, o.planned ? (o.loading ? "planLoading" : "noTrainsPlanned") : "noTrainsSoon"))
      : arrRows.length
        ? el("ul", { class: "dep-list" }, arrRows)
        : el("p", { class: "muted small" }, t(lang, o.planned ? (o.loading ? "planLoading" : "noTrainsPlanned") : "noneApproaching"));

  return el(
    "div",
    { class: "popup sheet-station" },
    el(
      "div",
      { class: "ss-head sheet-grip" },
      el(
        "div",
        { class: "ss-main" },
        el("h2", { class: "popup-title" }, station.name),
        o.routes?.length ? el("div", { class: "ss-lines" }, o.routes.map((r) => lineBadge(r, o.lineColor?.(r)))) : null,
        o.sub ? el("p", { class: "ts-meta" }, o.sub) : null,
      ),
      closeButton(lang, o.onClose),
    ),
    chips.length ? el("div", { class: "chip-row" }, chips) : null,
    o.fav?.full ? el("p", { class: "small muted fav-full" }, t(lang, "favFull", { n: o.fav.limit })) : null,
    o.when || null,
    el("div", { class: "seg", role: "tablist", "aria-label": t(lang, "boardLabel") }, seg("dep", t(lang, "tabDepartures")), seg("arr", t(lang, o.planned ? "tabArrivals" : "tabArriving"))),
    o.planned ? el("p", { class: "small muted", id: "station-planned" }, o.loading ? t(lang, "planLoading") : t(lang, "plannedNote")) : null,
    list,
  );
}

/**
 * The network picker. `o`: { query, near: { name, onPick } | { onLocate }
 * | null, spain: { trains, onPick }, networks: [{ code, name, median }],
 * countries: [{ code, name, current, onPick }], areas: [{ code, name }],
 * areaGroups: [{ label, items }], area (the one shown), allCode, allLabel,
 * onPick(code), onQuery(q), onClose }. `median` in seconds or null
 * (undefined: none to show).
 */
export function networksSheet(lang, o) {
  const q = o.query || "";
  const hit = (n) => !fold(q) || [n.name, ...(n.alt || [])].some((x) => matchScore(q, x) >= 0);
  const list = (o.networks || []).filter(hit);
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
    el("span", { class: "net-card-v" }, o.spain?.label || t(lang, "allSpain")),
  );
  // Two drop-downs: the country (one at a time: another reloads the page
  // with its data), then its area (a núcleo, region, state…).
  const countrySel = o.countries
    ? el(
        "select",
        { id: "net-country", "aria-label": t(lang, "country"), onchange: (e) => o.countries.find((c) => c.code === e.target.value)?.onPick() },
        o.countries.map((c) => el("option", { value: c.code, selected: c.current ? "" : null }, c.name)),
      )
    : null;
  const opt = (a) => el("option", { value: a.code, selected: a.code === o.area ? "" : null }, a.name);
  const areaGroups = (o.areaGroups || []).filter((g) => g.items.length);
  const areaSel =
    o.areas?.length || areaGroups.length
      ? el(
          "select",
          { id: "net-area", "aria-label": t(lang, "area"), onchange: (e) => e.target.value && o.onPick?.(e.target.value) },
          el("option", { value: o.allCode || "es", selected: o.area ? null : "" }, o.allLabel || t(lang, "allAreas")),
          ...(o.areas || []).map(opt),
          ...areaGroups.map((g) => el("optgroup", { label: g.label }, g.items.map(opt))),
        )
      : null;
  const countries =
    countrySel || areaSel
      ? el(
          "div",
          { class: "net-pickers" },
          countrySel ? el("label", { class: "net-pick" }, el("span", { class: "net-pick-k" }, t(lang, "country")), countrySel) : null,
          areaSel ? el("label", { class: "net-pick" }, el("span", { class: "net-pick-k" }, t(lang, "area")), areaSel) : null,
        )
      : null;
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
    placeholder: o.searchLabel || t(lang, "netSearch"),
    "aria-label": o.searchLabel || t(lang, "netSearch"),
    value: q,
    oninput: (e) => o.onQuery?.(e.target.value),
  });
  // Areas without a median (other countries'): just the chevron.
  const right = (n) => (n.median === undefined ? icon("chevronRight", 16) : median(n.median));
  const row = (n, right) =>
    el("li", {}, el("button", { class: "net-row", type: "button", "data-code": n.code, onclick: () => o.onPick?.(n.code) }, el("span", { class: "net-name" }, n.name), right));
  // Communities and provinces: no median (their trains aren't told apart).
  const group = (id, title, items) => {
    const shown = items.filter(hit);
    return shown.length ? [el("h3", { class: "group-h", id }, title), el("ul", { class: "net-list" }, shown.map((n) => row(n, icon("chevronRight", 16))))] : [];
  };
  const extra = [...group("net-g-ccaa", t(lang, "netCommunities"), o.communities || []), ...group("net-g-prov", t(lang, "netProvinces"), o.provinces || [])];
  return [
    fold(q) ? null : countries,
    el("label", { class: "net-search" }, icon("search", 18), input),
    fold(q) ? null : el("div", { class: "net-cards" }, nearCard, spainCard),
    // Searching: only the groups with a match ("none" when there's none).
    // No networks to list at all (the UK, for now): just the cards.
    ...(o.networks?.length || o.communities?.length || o.provinces?.length
      ? [
          ...(list.length || !extra.length ? [el("h3", { class: "group-h" }, o.groupLabel || t(lang, "netGroup"))] : []),
          list.length ? el("ul", { class: "net-list" }, list.map((n) => row(n, right(n)))) : extra.length ? null : el("p", { class: "muted small" }, t(lang, "netNone")),
        ]
      : []),
    ...extra,
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

/** Kind label of a place search hit ("Ciudad", "Estación"…). */
export function placeKind(lang, kind) {
  return t(lang, { city: "placeCity", station: "searchStation", province: "placeProvince", community: "placeCommunity" }[kind]);
}

/** Icon for a place search hit. */
export const PLACE_ICON = { city: "globe", station: "pin", province: "map", community: "map" };

/**
 * Origin → destination results: `rows` from route.js mergeRoutes (each
 * with its `from` and `to` station), `multi` when an end is a city (then
 * each row says which stations). `onTrain(row)` for trains on the map.
 */
export function routeResults(lang, { from, to, rows, multi, onTrain }) {
  if (!rows.length) return [el("p", { class: "muted", id: "route-none" }, t(lang, "routeNone", { from: from.item.name, to: to.item.name }))];
  return [
    el("p", { class: "small muted", id: "route-count" }, t(lang, "routeCount", { n: formatCount(lang, rows.length) })),
    el(
      "ul",
      { class: "route-list" },
      rows.map((r) => {
        const label = [r.route, r.number].filter(Boolean).join(" ");
        const main = el(
          "span",
          { class: "route-main" },
          el("span", { class: "route-times" }, el("strong", {}, formatClock(r.expected_dep)), " ", el("span", { class: "muted" }, t(lang, "routeArr", { time: formatClock(r.expected_arr) }))),
          el("span", { class: "route-train" }, label, multi ? el("span", { class: "muted" }, ` · ${r.from.name} → ${r.to.name}`) : null),
        );
        const delay = el(
          "span",
          { class: `route-delay tone-text-${r.canceled ? "major" : delayTone(r.delay)}` },
          r.canceled ? t(lang, "canceled") : r.delay === null || r.delay === undefined ? "" : delayShortMin(lang, r.delay),
        );
        return el(
          "li",
          {},
          r.live && onTrain
            ? el("button", { class: "route-row", type: "button", "data-number": r.number, onclick: () => onTrain(r) }, main, delay, icon("chevronRight", 16))
            : el("div", { class: "route-row" }, main, delay),
        );
      }),
    ),
  ];
}

/** Minimum change time (s): a tighter change is "at risk" (engine journeys.rs). */
export const CHANGE_RISK_SECS = 5 * 60;

/** "1 h 25 min" / "45 min". */
export function durationText(lang, secs) {
  const m = Math.max(0, Math.round(secs / 60));
  const h = Math.floor(m / 60);
  return h ? t(lang, "durationHm", { h, m: String(m % 60).padStart(2, "0") }) : t(lang, "durationM", { m });
}

/**
 * Journeys with changes (engine journeysJson): one row per journey, its
 * trains and changes inside. `onTrain(ride)` opens a train on the map;
 * `onSave(journey)` (when given) saves it (Pro). `openKey` (journeyKey)
 * keeps the journey the user opened open when the list is redrawn.
 */
export function journeyResults(lang, { from, to, journeys, onTrain, onSave, saveLabel, openKey }) {
  if (!journeys.length) return [el("p", { class: "muted", id: "route-none" }, t(lang, "routeNone", { from: from.item.name, to: to.item.name }))];
  const rides = (j) => j.steps.filter((s) => s.kind === "ride");
  const direct = journeys.filter((j) => j.changes === 0).length;
  return [
    el("p", { class: "small muted", id: "route-count" }, t(lang, "routeCountJ", { n: formatCount(lang, journeys.length), d: formatCount(lang, direct) })),
    el(
      "ul",
      { class: "route-list journey-list" },
      journeys.map((j, i) => {
        const rs = rides(j);
        const risk = j.tightest_change !== null && j.tightest_change !== undefined && j.tightest_change < CHANGE_RISK_SECS;
        const worst = rs.reduce((m, r) => Math.max(m, r.delay || 0), 0);
        const anyDelay = rs.some((r) => r.delay !== null && r.delay !== undefined);
        const summary = el(
          "summary",
          { class: "route-row journey-row", "data-changes": String(j.changes) },
          el(
            "span",
            { class: "route-main" },
            el(
              "span",
              { class: "route-times" },
              el("strong", {}, `${formatClock(j.dep)} → ${formatClock(j.arr)}`),
              " ",
              el("span", { class: "muted" }, `${durationText(lang, j.arr - j.dep)} · ${j.changes ? t(lang, j.changes === 1 ? "routeChange1" : "routeChanges", { n: j.changes }) : t(lang, "routeDirect")}`),
            ),
            el("span", { class: "route-train" }, rs.map((r) => [r.route, r.number].filter(Boolean).join(" ")).join(" → ")),
            risk ? el("span", { class: "journey-risk small" }, t(lang, "routeRisk")) : null,
          ),
          el("span", { class: `route-delay tone-text-${delayTone(worst)}` }, anyDelay ? delayShortMin(lang, worst) : ""),
        );
        const legs = [];
        let prevArr = null;
        let walked = 0;
        for (const s of j.steps) {
          if (s.kind === "walk") {
            walked += s.secs;
            legs.push(el("li", { class: "journey-walk small muted" }, icon("walk", 14), t(lang, "routeWalk", { to: s.to_name, min: Math.round(s.secs / 60) })));
            continue;
          }
          if (prevArr !== null) {
            const margin = s.expected_dep - prevArr - walked;
            legs.push(
              el("li", { class: `journey-change small${margin < CHANGE_RISK_SECS ? " at-risk" : ""}` }, t(lang, "routeChangeAt", { station: s.from_name, min: Math.max(0, Math.round(margin / 60)) })),
            );
          }
          const label = [s.route, s.number].filter(Boolean).join(" ");
          const body = [
            el("span", { class: "journey-leg-times" }, el("strong", {}, formatClock(s.expected_dep)), " – ", formatClock(s.expected_arr)),
            el("span", { class: "journey-leg-train" }, el("strong", {}, label), el("span", { class: "muted" }, ` · ${t(lang, "routeTowards", { to: s.headsign })}`)),
            el("span", { class: "small muted" }, `${s.from_name} → ${s.to_name}`),
          ];
          const delay = el("span", { class: `route-delay tone-text-${delayTone(s.delay)}` }, s.delay === null || s.delay === undefined ? "" : delayShortMin(lang, s.delay));
          legs.push(
            el(
              "li",
              { class: "journey-leg" },
              s.live && onTrain
                ? el("button", { type: "button", class: "journey-leg-btn", "data-number": s.number, onclick: () => onTrain(s) }, el("span", { class: "route-main" }, ...body), delay, icon("chevronRight", 16))
                : el("div", { class: "journey-leg-btn" }, el("span", { class: "route-main" }, ...body), delay),
            ),
          );
          prevArr = s.expected_arr;
          walked = 0;
        }
        return el(
          "li",
          {},
          el(
            "details",
            {
              class: "journey",
              "data-key": journeyKey(j),
              open: (openKey ? journeyKey(j) === openKey : i === 0 && journeys.length === 1) ? "" : null,
            },
            summary,
            el("ol", { class: "journey-legs" }, legs),
            onSave ? el("button", { type: "button", class: "pill small journey-save", onclick: () => onSave(j) }, icon("star", 16), saveLabel || t(lang, "routeSave")) : null,
          ),
        );
      }),
    ),
  ];
}

/**
 * A search field with suggestions under it, for adding things: `search(q)`
 * gives [{ key, icon, name, sub, value }], `onPick(value)` on a choice. The
 * element keeps its own state, so the screen around it can redraw freely.
 */
export function pickField(lang, { id, label, placeholder, search, onPick }) {
  const ul = el("ul", { class: "route-sugg", id: `${id}-sugg`, hidden: true });
  const input = el("input", { id, type: "search", autocomplete: "off", placeholder, "aria-label": label });
  const draw = () => {
    const hits = input.value.trim().length >= 2 ? search(input.value) : [];
    ul.hidden = !hits.length;
    ul.replaceChildren(
      ...hits.map((h) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              class: "route-sugg-row",
              "data-key": h.key,
              onclick: () => {
                input.value = h.name;
                ul.hidden = true;
                onPick(h.value);
              },
            },
            icon(h.icon, 16),
            el("strong", {}, h.name),
            h.sub ? el("span", { class: "muted" }, ` · ${h.sub}`) : null,
          ),
        ),
      ),
    );
  };
  input.addEventListener("input", () => {
    onPick(null);
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ul.querySelector("button")?.click();
  });
  return el("div", { class: "pick-field" }, el("label", { class: "route-field" }, el("span", { class: "route-k" }, label), input), ul);
}

/** One cab-ride video row: a link that opens YouTube at the moment. */
function cabRow(v) {
  return el(
    "li",
    {},
    el(
      "a",
      { class: "cab-row", href: v.url, target: "_blank", rel: "noopener" },
      el("span", { class: "cab-main" }, el("span", { class: "cab-title" }, v.title), el("span", { class: "cab-channel muted small" }, v.channel)),
      el("span", { class: "cab-time" }, `▶ ${v.real ? "" : "≈"}${clock(v.t)}`),
    ),
  );
}

/**
 * Cab-ride videos at a station (docs/plan-cab-rides.md): the first three,
 * then "N more". `items` from cabrides.videosAt; `o`: { showAll, onMore }.
 * Nothing when there are none.
 */
export function cabVideos(lang, items, o = {}) {
  if (!items?.length) return [];
  const shown = o.showAll ? items : items.slice(0, 3);
  return [
    el("h3", { class: "sheet-h3", id: "cab-title" }, t(lang, "cabTitle")),
    el("ul", { class: "cab-list", id: "cab-list" }, shown.map(cabRow)),
    items.length > shown.length
      ? el("button", { class: "link more-stops", type: "button", id: "cab-more", onclick: o.onMore }, t(lang, "cabMore", { n: items.length - shown.length }))
      : null,
    el("p", { class: "muted small cab-note" }, t(lang, "cabNote")),
  ];
}

/** "Watch from the cab": a video of the stretch the train is on, opened at
 * about where it is (cabrides.videoForTrain), or nothing. */
export function cabTrain(lang, v) {
  if (!v) return [];
  return [el("h3", { class: "sheet-h3", id: "cab-train" }, t(lang, "cabTrain")), el("ul", { class: "cab-list" }, [cabRow({ ...v, real: false })])];
}
