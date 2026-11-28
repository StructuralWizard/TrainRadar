// Alert notifications (backend-ops), through a Telegram bot: a message to
// the maintainer's chat. The bot's token (ALERTS_TELEGRAM_BOT_TOKEN) goes in
// the request URL, the only way Telegram's Bot API takes it (HTTPS; the
// exception the maintainer records in AGENTS.md): that URL is built only for
// the call, never logged and never in an error. The chat id
// (ALERTS_TELEGRAM_CHAT_ID) goes in the JSON body. A recovery is sent
// silently (no sound).

const API = "https://api.telegram.org";

/** The notification for this check's changes, or null if nothing changed. */
export function compose({ raised, cleared, open, site }) {
  if (!raised.length && !cleared.length) return null;
  const line = (p) => `${p.country.toUpperCase()}: ${p.text}`;
  const title = raised.length
    ? `⚠️ TrainRadar: ${raised.length} new problem${raised.length > 1 ? "s" : ""} (${[...new Set(raised.map((p) => p.country.toUpperCase()))].join(", ")})`
    : `✅ TrainRadar: ${cleared.length} problem${cleared.length > 1 ? "s" : ""} cleared`;
  const parts = [];
  if (raised.length) parts.push(...raised.map((p) => `New · ${line(p)}`));
  if (cleared.length) parts.push(...cleared.map((p) => `Cleared · ${line(p)} (lasted ${Math.round(p.lasted / 60_000)} min)`));
  const still = Object.values(open || {}).filter((o) => !raised.some((p) => p.text === o.text));
  if (still.length) parts.push(...still.map((o) => `Still open · ${o.country.toUpperCase()}: ${o.text}`));
  return { title, text: parts.join("\n"), silent: !raised.length, link: site.replace(/\/?$/, "/") };
}

/** The sendMessage request's JSON body (plain text, no Markdown to escape). */
export function body(chatId, n) {
  const text = [n.title, "", n.text, ...(n.link ? ["", n.link] : [])].join("\n").slice(0, 4000);
  return { chat_id: chatId, text, disable_notification: !!n.silent, link_preview_options: { is_disabled: true } };
}

/** Send one notification; throws on failure (never with the token). */
export async function send(env, n, fetchFn = fetch) {
  const token = env.ALERTS_TELEGRAM_BOT_TOKEN;
  const chat = env.ALERTS_TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("ALERTS_TELEGRAM_BOT_TOKEN or ALERTS_TELEGRAM_CHAT_ID not set");
  let r;
  try {
    r = await fetchFn(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body(chat, n)),
    });
  } catch (e) {
    throw new Error(`Telegram: ${e?.name || "network error"}`);
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`Telegram: HTTP ${r.status}${j.description ? ` ${String(j.description).slice(0, 120)}` : ""}`);
  }
}
