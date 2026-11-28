// The daily digest (backend-ops): once a day at DIGEST_HOUR in DIGEST_TZ
// (21:00 UK time by default), one Telegram message with everything: what's
// broken now, what broke and recovered in the last 24 hours, and each
// country's feed in one line. Sent on quiet days too ("all fine"), so a
// silent bot means the alerts themselves stopped. The immediate alerts
// (notify.js compose) still go out as problems start and clear.

/** The local date (YYYY-MM-DD) and hour at `ms` in time zone `tz`. */
export function localClock(ms, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** Whether today's digest is due now (the hour reached, not sent today). */
export function due(state, now, tz = "Europe/London", hour = 21) {
  const c = localClock(now, tz);
  return c.hour >= hour && state.digestDay !== c.date ? c.date : null;
}

/** Keep the last 24 h (and a bit) of raised and cleared problems for the digest. */
export function remember(state, raised, cleared, now) {
  state.log ||= [];
  for (const p of raised) state.log.push({ at: now, kind: "raised", id: p.id, country: p.country, text: p.text });
  for (const p of cleared) state.log.push({ at: now, kind: "cleared", id: p.id, country: p.country, text: p.text, lasted: p.lasted });
  state.log = state.log.filter((e) => now - e.at < 26 * 3600_000).slice(-200);
}

const mins = (ms) => (ms >= 3600_000 ? `${(ms / 3600_000).toFixed(1)} h` : `${Math.round(ms / 60_000)} min`);

/**
 * The digest message: { title, text, silent, link }. `feeds`: the dashboard's
 * feed rows ([{ country, off, ok }]); `open`: the alert state's open problems.
 */
export function composeDigest({ open = {}, log = [], feeds = [], now, site }) {
  const day = log.filter((e) => now - e.at < 24 * 3600_000);
  const recovered = day.filter((e) => e.kind === "cleared");
  const openList = Object.values(open);
  const on = feeds.filter((f) => !f.off);
  const failing = on.filter((f) => !f.ok).map((f) => f.country.toUpperCase());
  const off = feeds.filter((f) => f.off).map((f) => f.country.toUpperCase());
  const lines = [];
  lines.push(openList.length ? `Broken now (${openList.length}):` : "Nothing broken now.");
  for (const o of openList) lines.push(`• ${o.country.toUpperCase()}: ${o.text} (for ${mins(now - o.since)})`);
  if (recovered.length) {
    lines.push("", `Broke and recovered today (${recovered.length}):`);
    for (const e of recovered) lines.push(`• ${e.country.toUpperCase()}: ${e.text} (lasted ${mins(e.lasted || 0)})`);
  }
  lines.push("", `Live feeds: ${on.length - failing.length} ok${failing.length ? ` · ${failing.length} failing (${failing.join(", ")})` : ""}${off.length ? ` · ${off.length} off (${off.join(", ")})` : ""}`);
  const quiet = !openList.length && !recovered.length;
  return {
    title: quiet ? "✅ TrainRadar daily: all fine" : `📋 TrainRadar daily: ${openList.length} open, ${recovered.length} recovered`,
    text: lines.join("\n"),
    silent: true, // the digest never rings; the immediate alerts do
    link: site.replace(/\/?$/, "/"),
  };
}
