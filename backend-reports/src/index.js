// TrainRadar travellers' reports Worker (docs/plan-crowd-reports.md), at
// reports.mytrainradar.com, UK only (REPORT_COUNTRIES):
//   POST /v1/reports          a report from the Android app (Play Integrity)
//   POST /v1/reports/dispute  "that's not right" on a shown count
//   POST /v1/reports/forget   delete this phone's reports (its token)
// One Durable Object per country keeps the single reports for 48 hours
// (hashed token, train, kind, on the train or which station, time) and
// writes the counts above the threshold to the live bucket every 30 s when
// something changed: <cc>/rt/reports.json, read by everyone from the CDN.
//
// Privacy: no coordinates ever arrive (the location check runs on the
// phone); IP addresses and headers aren't read, stored or logged; nothing
// here logs requests (observability is off in wrangler.toml). REPORTS_ENABLED
// is the kill switch: off, or without PLAY_INTEGRITY_CREDENTIALS, every
// report is refused and reports.json says {"on": false}, which hides the
// app's report button.

import { checkIntegrity } from "./integrity.js";
import { count, nonceText, prune, publish, refused, sha256b64, validate, validateDispute } from "./rules.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const PUBLISH_MS = 30_000;

export const enabled = (env) => env.REPORTS_ENABLED === "true" && !!env.PLAY_INTEGRITY_CREDENTIALS;
export const countries = (env) => String(env.REPORT_COUNTRIES || "").split(",").map((s) => s.trim()).filter(Boolean);

export class Reports {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async state() {
    const s = await this.ctx.storage.get(["log", "disputes", "daily", "country"]);
    return { log: s.get("log") || [], disputes: s.get("disputes") || [], daily: s.get("daily") || {}, country: s.get("country") || "" };
  }

  async dirty() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + PUBLISH_MS);
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const now = Date.now();
    const body = request.method === "POST" ? await request.json() : {};
    const st = await this.state();
    if (body.country) st.country = body.country;
    if (path === "/report") {
      const why = refused(st.log, body.h, body.report, now);
      if (why) return json({ ok: false, error: why }, 429);
      st.log = prune(st.log, now);
      st.log.push({ h: body.h, ...body.report, at: now });
      count(st.daily, body.report, now);
      await this.ctx.storage.put({ log: st.log, daily: st.daily, country: st.country });
      await this.dirty();
      return json({ ok: true });
    }
    if (path === "/dispute") {
      st.disputes = prune(st.disputes, now).filter((d) => !(d.h === body.h && d.trip === body.dispute.trip && d.kind === body.dispute.kind));
      st.disputes.push({ h: body.h, trip: body.dispute.trip, kind: body.dispute.kind, at: now });
      await this.ctx.storage.put({ disputes: st.disputes, country: st.country });
      await this.dirty();
      return json({ ok: true });
    }
    if (path === "/forget") {
      const before = st.log.length + st.disputes.length;
      st.log = st.log.filter((e) => e.h !== body.h);
      st.disputes = st.disputes.filter((d) => d.h !== body.h);
      await this.ctx.storage.put({ log: st.log, disputes: st.disputes });
      await this.dirty();
      return json({ ok: true, deleted: before - st.log.length - st.disputes.length });
    }
    if (path === "/publish") {
      await this.alarm();
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }

  /** Write the counts (and drop what's expired). */
  async alarm() {
    const now = Date.now();
    const st = await this.state();
    if (!st.country) return;
    st.log = prune(st.log, now);
    st.disputes = prune(st.disputes, now);
    await this.ctx.storage.put({ log: st.log, disputes: st.disputes });
    const doc = publish(st.log, st.disputes, now, enabled(this.env));
    await this.env.LIVE.put(`${st.country}/rt/reports.json`, JSON.stringify(doc), {
      httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=30" },
    });
  }
}

const stub = (env, country) => env.REPORTS.get(env.REPORTS.idFromName(country));

async function readBody(request) {
  if (Number(request.headers.get("Content-Length") || 0) > 16_384) return null;
  const text = await request.text();
  if (text.length > 16_384) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function handle(request, env, fetchFn = fetch) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST" || !url.pathname.startsWith("/v1/reports")) return json({ error: "not found" }, 404);
  if (!enabled(env)) return json({ ok: false, error: "off" }, 503);
  const b = await readBody(request);
  if (!b) return json({ ok: false, error: "body" }, 400);
  const now = Date.now();
  const opts = { countries: countries(env), now };
  if (url.pathname === "/v1/reports/forget") {
    if (!opts.countries.includes(b.country) || typeof b.token !== "string" || !/^[A-Za-z0-9_-]{22,64}$/.test(b.token)) return json({ ok: false, error: "token" }, 400);
    return stub(env, b.country).fetch("https://reports/forget", { method: "POST", body: JSON.stringify({ country: b.country, h: await sha256b64(`trainradar-report|${b.token}`) }) });
  }
  const isDispute = url.pathname === "/v1/reports/dispute";
  if (!isDispute && url.pathname !== "/v1/reports") return json({ error: "not found" }, 404);
  const v = isDispute ? validateDispute(b, opts) : validate(b, opts);
  if (v.error) return json({ ok: false, error: v.error }, 400);
  const problem = await checkIntegrity(b.integrity, await sha256b64(nonceText(b, isDispute)), env, fetchFn, now);
  if (problem) return json({ ok: false, error: "integrity" }, 403);
  const h = await sha256b64(`trainradar-report|${b.token}`);
  return stub(env, b.country).fetch(`https://reports/${isDispute ? "dispute" : "report"}`, {
    method: "POST",
    body: JSON.stringify({ country: b.country, h, ...(isDispute ? { dispute: v.dispute } : { report: v.report }) }),
  });
}

export default {
  fetch: (request, env) => handle(request, env),
  // Every 5 minutes: rewrite each country's counts, so expired ones go and
  // the kill switch shows ({"on": false}) even when nobody reports.
  async scheduled(event, env, ctx) {
    for (const c of countries(env)) {
      ctx.waitUntil(stub(env, c).fetch("https://reports/publish", { method: "POST", body: JSON.stringify({ country: c }) }));
    }
  },
};
