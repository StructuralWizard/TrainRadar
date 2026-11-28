// Alert mails (backend-ops), through Cloudflare Email Routing's send_email
// binding: plain text, from ALERTS_FROM on the site's domain to
// ALERTS_EMAIL_TO, an address verified in Email Routing (a Worker secret,
// never in the repository).

/** RFC 2047 for a subject with non-ASCII characters. */
function header(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`;
}

/** A plain-text message, MIME as Email Routing wants it. */
export function mime({ from, to, subject, text, now = Date.now() }) {
  const id = `<${now.toString(36)}.${Math.random().toString(36).slice(2)}@${from.split("@")[1] || "localhost"}>`;
  return [
    `From: TrainRadar alerts <${from}>`,
    `To: <${to}>`,
    `Subject: ${header(subject)}`,
    `Message-ID: ${id}`,
    `Date: ${new Date(now).toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text.replace(/\r?\n/g, "\r\n"),
  ].join("\r\n");
}

/** The mail for this check's changes, or null if nothing changed. */
export function compose({ raised, cleared, open, site }) {
  if (!raised.length && !cleared.length) return null;
  const line = (p) => `- ${p.country.toUpperCase()}: ${p.text}`;
  const subject = raised.length
    ? `TrainRadar: ${raised.length} new problem${raised.length > 1 ? "s" : ""} (${[...new Set(raised.map((p) => p.country.toUpperCase()))].join(", ")})`
    : `TrainRadar: ${cleared.length} problem${cleared.length > 1 ? "s" : ""} cleared`;
  const parts = [];
  if (raised.length) parts.push("New:", ...raised.map(line), "");
  if (cleared.length) parts.push("Cleared:", ...cleared.map((p) => `${line(p)} (lasted ${Math.round(p.lasted / 60_000)} min)`), "");
  const still = Object.values(open || {}).filter((o) => !raised.some((p) => p.text === o.text));
  if (still.length) parts.push("Still open:", ...still.map((o) => `- ${o.country.toUpperCase()}: ${o.text}`), "");
  parts.push(`Dashboard: ${site.replace(/\/?$/, "/")}`, "", "Sent by the TrainRadar ops Worker (backend-ops).");
  return { subject, text: parts.join("\n") };
}

/** Send one message with the binding; throws on failure. */
export async function send(env, { subject, text }) {
  const { EmailMessage } = await import("cloudflare:email");
  const raw = mime({ from: env.ALERTS_FROM, to: env.ALERTS_EMAIL_TO, subject, text });
  await env.MAIL.send(new EmailMessage(env.ALERTS_FROM, env.ALERTS_EMAIL_TO, raw));
}
