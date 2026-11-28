// Alert notifications (backend-ops), through ntfy (https://ntfy.sh): a push
// to the ntfy app on the maintainer's phone, subscribed to the topic in the
// ALERTS_NTFY_TOPIC secret. The topic goes in the JSON body of the publish
// request (ntfy's JSON publishing), never in a URL; anyone who knows it can
// read the alerts, which only name feeds and countries.

export const NTFY = "https://ntfy.sh/";

/** The notification for this check's changes, or null if nothing changed. */
export function compose({ raised, cleared, open, site }) {
  if (!raised.length && !cleared.length) return null;
  const line = (p) => `${p.country.toUpperCase()}: ${p.text}`;
  const title = raised.length
    ? `TrainRadar: ${raised.length} new problem${raised.length > 1 ? "s" : ""} (${[...new Set(raised.map((p) => p.country.toUpperCase()))].join(", ")})`
    : `TrainRadar: ${cleared.length} problem${cleared.length > 1 ? "s" : ""} cleared`;
  const parts = [];
  if (raised.length) parts.push(...raised.map((p) => `New · ${line(p)}`));
  if (cleared.length) parts.push(...cleared.map((p) => `Cleared · ${line(p)} (lasted ${Math.round(p.lasted / 60_000)} min)`));
  const still = Object.values(open || {}).filter((o) => !raised.some((p) => p.text === o.text));
  if (still.length) parts.push(...still.map((o) => `Still open · ${o.country.toUpperCase()}: ${o.text}`));
  return {
    title,
    text: parts.join("\n"),
    priority: raised.length ? 4 : 2, // high for a new problem, low for a recovery
    tags: raised.length ? ["warning"] : ["white_check_mark"],
    click: site.replace(/\/?$/, "/"),
  };
}

/** The ntfy publish request's JSON body. */
export function body(topic, n) {
  return { topic, title: n.title, message: n.text.slice(0, 3900), priority: n.priority ?? 3, tags: n.tags || [], ...(n.click ? { click: n.click } : {}) };
}

/** Publish one notification; throws on failure. */
export async function send(env, n, fetchFn = fetch) {
  const r = await fetchFn(NTFY, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Metranos-TrainRadar ops" },
    body: JSON.stringify(body(env.ALERTS_NTFY_TOPIC, n)),
  });
  if (!r.ok) throw new Error(`ntfy: HTTP ${r.status}`);
}
