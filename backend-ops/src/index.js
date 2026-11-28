// TrainRadar ops Worker: alerts and the administrator dashboard. Separate
// from the ingest Workers: it only reads. Set-up: wrangler.toml's comments.
//
// Every 5 minutes (cron): every country's status.json in the live bucket and,
// hourly, each country's data manifest on the site → rules.js → a Telegram
// message on a new problem and on its recovery (notify.js, the bot and chat
// in ALERTS_TELEGRAM_BOT_TOKEN / _CHAT_ID), the alert state kept in a
// Durable Object.
// OPS_ENABLED is the kill switch.
//
// The dashboard (/, /api/summary, /api/test-mail) answers only requests with
// a valid Cloudflare Access token (access.js): live feeds, data freshness,
// Cloudflare's numbers (cf.js) and Google Play's (play.js). Aggregates only.

import { accessUser } from "./access.js";
import { cloudflare } from "./cf.js";
import { PAGE } from "./dashboard.js";
import { compose, send } from "./notify.js";
import { play } from "./play.js";
import { DATA_COUNTRIES, STATUS_KEYS, problems, step } from "./rules.js";

const MANIFEST_EVERY_MS = 3600_000;
const SUMMARY_TTL_MS = 5 * 60_000;

/** Every country's status.json from the live bucket: { code: status | null }. */
export async function readStatuses(env) {
  const out = {};
  await Promise.all(
    Object.entries(STATUS_KEYS).map(async ([cc, key]) => {
      try {
        const o = await env.LIVE.get(key);
        out[cc] = o ? JSON.parse(await o.text()) : null;
      } catch {
        out[cc] = null;
      }
    }),
  );
  return out;
}

/** Each country's data build time (generated_at, seconds) from the site; null if not deployed. */
export async function readManifests(env, fetchFn = fetch) {
  const base = (env.SITE_URL || "https://mytrainradar.com/").replace(/\/?$/, "/");
  const out = {};
  await Promise.all(
    DATA_COUNTRIES.map(async (cc) => {
      try {
        const r = await fetchFn(`${base}data/${cc === "es" ? "" : `${cc}/`}manifest.json`, { headers: { "User-Agent": "Metranos-TrainRadar ops" } });
        out[cc] = r.ok ? (await r.json()).generated_at || null : null;
      } catch {
        out[cc] = null;
      }
    }),
  );
  return out;
}

/** The feeds table for the dashboard. */
function feedRows(statuses, now) {
  return Object.entries(statuses).map(([cc, st]) => {
    const at = st?.updatedAt || st?.generatedAt || null;
    const off = !st || !at || now - Date.parse(at) > 7 * 86_400_000;
    return {
      country: cc,
      off,
      ok: !off && st.ok !== false,
      updatedAt: at,
      callsToday: st?.callsToday ?? null,
      dailyCap: st?.dailyCap ?? null,
      error: st?.ok === false ? st.error || null : st?.tfl?.ok === false ? `TfL: ${st.tfl.error}` : null,
      feeds: Object.entries(st?.feeds || {}).map(([name, f]) => ({ name, ok: f.ok, fetchedAt: f.fetchedAt, kept: f.kept ?? f.entities ?? null })),
    };
  });
}

/** The alert state and the checks: one instance ("ops"). */
export class OpsState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.summary = null; // { at, data }
  }

  async check(now = Date.now(), fetchFn = fetch) {
    const state = (await this.ctx.storage.get("alerts")) || {};
    const statuses = await readStatuses(this.env);
    let manifests = (await this.ctx.storage.get("manifests")) || { at: 0, data: {} };
    if (now - manifests.at > MANIFEST_EVERY_MS) {
      manifests = { at: now, data: await readManifests(this.env, fetchFn) };
      await this.ctx.storage.put("manifests", manifests);
    }
    const found = problems({ statuses, manifests: manifests.data, now });
    const { raised, cleared } = step(state, found, now);
    const mail = compose({ raised, cleared, open: state.open, site: this.env.DASHBOARD_URL || "https://ops.mytrainradar.com/" });
    if (mail && this.env.ALERTS_TELEGRAM_BOT_TOKEN && this.env.ALERTS_TELEGRAM_CHAT_ID) {
      try {
        await send(this.env, mail, fetchFn);
        state.lastMail = { at: now, title: mail.title };
      } catch (e) {
        state.lastMailError = { at: now, error: String(e?.message || e).slice(0, 200) };
      }
    }
    state.checkedAt = now;
    await this.ctx.storage.put("alerts", state);
    return { found: found.length, raised: raised.length, cleared: cleared.length };
  }

  async summaryData(user, now = Date.now()) {
    if (this.summary && now - this.summary.at < SUMMARY_TTL_MS) return { ...this.summary.data, user };
    const state = (await this.ctx.storage.get("alerts")) || {};
    const manifests = (await this.ctx.storage.get("manifests")) || { data: {} };
    const statuses = await readStatuses(this.env);
    const [cf, gp] = await Promise.all([cloudflare(this.env).catch((e) => ({ error: String(e) })), play(this.env).catch((e) => ({ error: String(e) }))]);
    const data = {
      at: new Date(now).toISOString(),
      alerts: state.open || {},
      checkedAt: state.checkedAt || null,
      lastMail: state.lastMail || null,
      lastMailError: state.lastMailError || null,
      feeds: feedRows(statuses, now),
      data: Object.entries(manifests.data || {}).map(([country, g]) => ({ country, generatedAt: g ? new Date(g * 1000).toISOString() : null })),
      cloudflare: cf,
      play: gp,
    };
    this.summary = { at: now, data };
    return { ...data, user };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/check") return Response.json(await this.check());
    if (url.pathname === "/summary") return Response.json(await this.summaryData(request.headers.get("X-Ops-User") || ""));
    if (url.pathname === "/test-mail") {
      if (!this.env.ALERTS_TELEGRAM_BOT_TOKEN || !this.env.ALERTS_TELEGRAM_CHAT_ID) return new Response("ALERTS_TELEGRAM_BOT_TOKEN or ALERTS_TELEGRAM_CHAT_ID is not set", { status: 400 });
      try {
        await send(this.env, { title: "🔔 TrainRadar: test alert", text: "A test from the ops dashboard: alerts reach this chat." });
      } catch (e) {
        return new Response(String(e?.message || e), { status: 502 });
      }
      return new Response("sent");
    }
    return new Response("not found", { status: 404 });
  }
}

const stub = (env) => env.OPS.get(env.OPS.idFromName("ops"));
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" };

export default {
  async scheduled(event, env, ctx) {
    if (env.OPS_ENABLED !== "true") return;
    ctx.waitUntil(stub(env).fetch("https://ops/check"));
  },
  async fetch(request, env) {
    const user = await accessUser(request, env);
    if (!user) return new Response("Sign in through Cloudflare Access.", { status: 403, headers: HEADERS });
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(PAGE, { headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" } });
    }
    if (url.pathname === "/api/summary") {
      const r = await stub(env).fetch("https://ops/summary", { headers: { "X-Ops-User": user } });
      return new Response(r.body, { status: r.status, headers: { ...HEADERS, "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/test-mail" && request.method === "POST") {
      const r = await stub(env).fetch("https://ops/test-mail");
      return new Response(await r.text(), { status: r.status, headers: HEADERS });
    }
    return new Response("not found", { status: 404, headers: HEADERS });
  },
};
