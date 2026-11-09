// Display formatting. Pure functions, unit tested in format.test.mjs.
import { t } from "./i18n.js";

const MINUTE = 60;

/** "+7 min", "On time" (within a minute), "2 min early", "—". */
export function formatDelay(lang, secs) {
  if (secs === null || secs === undefined || Number.isNaN(secs)) return t(lang, "unknown");
  const m = Math.round(secs / MINUTE);
  if (m === 0) return t(lang, "onTime");
  return m > 0 ? t(lang, "late", { m }) : t(lang, "early", { m: -m });
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
    return lang === "en" ? `${d} days` : `${d} días`;
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
  const n = new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
    maximumFractionDigits: km < 10 ? 1 : 0,
  }).format(km);
  return `${n} km`;
}

const clock = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});

/** Madrid wall-clock time "18:42" for a unix timestamp in seconds. */
export function formatClock(unixSecs) {
  return clock.format(new Date(unixSecs * 1000));
}

/** Integer with thousands separators for the stats bar. */
export function formatCount(lang, n) {
  return new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES").format(n);
}

const dayFmt = {
  es: new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "Europe/Madrid" }),
  en: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Madrid" }),
};

/** "7 oct" / "7 Oct" for a unix timestamp in seconds (Madrid date). */
export function formatDay(lang, unixSecs) {
  return (dayFmt[lang] || dayFmt.es).format(new Date(unixSecs * 1000)).replace(".", "");
}

/**
 * The small label next to a train on the map: "C5 +12" for Cercanías (the
 * line says enough), "AVE 3047 +3" for the rest; no delay part when on
 * time or unknown. null when there's nothing to say.
 */
export function trainLabel(route, number, delaySecs, commuter) {
  const n = String(number || "").replace(/^0+/, "");
  const base = (commuter ? route || n : [route, n].filter(Boolean).join(" ")).trim();
  if (!base) return null;
  if (delaySecs === null || delaySecs === undefined) return base;
  const m = Math.round(delaySecs / 60);
  return m >= 1 ? `${base} +${m}` : m <= -1 ? `${base} ${m}` : base;
}
