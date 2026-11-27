// Display formatting. Pure functions, unit tested in format.test.mjs.
import { LOCALES, locale, t } from "./i18n.js";

const MINUTE = 60;

/** "+7 min", "On time" (within a minute), "2 min early", "—". */
export function formatDelay(lang, secs) {
  if (secs === null || secs === undefined || Number.isNaN(secs)) return t(lang, "unknown");
  const m = Math.round(secs / MINUTE);
  if (m === 0) return t(lang, "onTime");
  return m > 0 ? t(lang, "late", { m }) : t(lang, "early", { m: -m });
}

/** "Mediana +3 min", or "Mediana: a su hora" when the median is under a
 * minute (not "mediana A su hora"). */
export function formatMedian(lang, secs) {
  if (secs === null || secs === undefined || Number.isNaN(secs)) return "";
  return Math.round(secs / MINUTE) === 0 ? t(lang, "medianOnTime") : t(lang, "medianChip", { delay: formatDelay(lang, secs) });
}

/** Colour band, matching the engine: 0 <5 min, 1 5–14, 2 15+, 3 unknown. */
export function delayClass(secs) {
  if (secs === null || secs === undefined) return 3;
  if (secs < 5 * MINUTE) return 0;
  if (secs < 15 * MINUTE) return 1;
  return 2;
}

/** A duration: "40 s", "3 min", "1 h 5 min". */
export function formatDuration(lang, secs) {
  const s = Math.max(0, Math.round(secs));
  if (s < MINUTE) return `${s} s`;
  const m = Math.round(s / MINUTE);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 48) {
    const d = Math.round(h / 24);
    return t(lang, "daysCount", { n: d });
  }
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** "hace 3 min" / "3 min ago". */
export function formatAgo(lang, secs) {
  return t(lang, "ago", { t: formatDuration(lang, secs) });
}

/** "850 m", "4,2 km" (es) / "4.2 km" (en), "123 km". */
export function formatDistance(lang, metres) {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  const km = metres / 1000;
  const n = new Intl.NumberFormat(locale(lang), {
    maximumFractionDigits: km < 10 ? 1 : 0,
  }).format(km);
  return `${n} km`;
}

// Times and dates are shown in the country's own time zone (Madrid, or
// London for the UK: plan 3); set once at start with setTimeZone.
let clock = null;
let dayFmt = null;
export function setTimeZone(timeZone = "Europe/Madrid") {
  clock = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone });
  dayFmt = Object.fromEntries(Object.entries(LOCALES).map(([l, loc]) => [l, new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone })]));
}
setTimeZone();

/** Local wall-clock time "18:42" for a unix timestamp in seconds. */
export function formatClock(unixSecs) {
  return clock.format(new Date(unixSecs * 1000));
}

/** Integer with thousands separators for the stats bar. */
export function formatCount(lang, n) {
  return new Intl.NumberFormat(locale(lang)).format(n);
}

/** "7 oct" / "7 Oct" for a unix timestamp in seconds (local date). */
export function formatDay(lang, unixSecs) {
  return (dayFmt[lang] || dayFmt.es).format(new Date(unixSecs * 1000)).replace(".", "");
}

/**
 * The small label next to a train on the map: "C5 +12" for Cercanías (the
 * line says enough), "AVE 3047 +3" for the rest; no delay part when on
 * time or unknown. null when there's nothing to say.
 */
export function trainLabel(route, number, delaySecs, commuter, onTime = "") {
  const n = String(number || "").replace(/^0+/, "");
  const base = (commuter ? route || n : [route, n].filter(Boolean).join(" ")).trim();
  if (!base) return null;
  if (delaySecs === null || delaySecs === undefined) return base;
  // "LINE · +delay" (docs/design/ui-redesign/PLAN.md, step 7).
  const m = Math.round(delaySecs / 60);
  if (m >= 1) return `${base} · +${m}`;
  if (m <= -1) return `${base} · ${m}`;
  return onTime ? `${base} · ${onTime}` : base;
}

/** "YYYY-MM-DDTHH:MM" (a datetime-local field's value) for `ms` in time zone `tz`. */
export function zonedInput(ms, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Unix ms for a wall time "YYYY-MM-DDTHH:MM" in time zone `tz`, or null. */
export function fromZonedInput(s, tz) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(s || "");
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // The zone's offset at that moment, twice (the first guess may sit on
  // the other side of a clock change).
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const shown = fromParts(zonedInput(t, tz));
    t = t - (shown - wall);
  }
  return t;
}

const fromParts = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16));
