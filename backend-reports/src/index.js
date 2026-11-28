// TrainRadar travellers' reports Worker (docs/plan-crowd-reports.md), at
// reports.mytrainradar.com, UK only (REPORT_COUNTRIES):
//   POST /v1/reports          a report from the Android app (Play Integrity)
//   POST /v1/reports/dispute  "that's not right" on a shown count
//   POST /v1/reports/undo     take back this phone's report, within a minute
//   POST /v1/reports/forget   delete this phone's reports (its token)
// One Durable Object per country keeps the single reports for 48 hours
// (hashed token, train, kind, on the train or which station, time) and
// writes the counts above the threshold to the live bucket every 30 s when
// something changed: <cc>/rt/reports.json, read by everyone from the CDN.
// Every 5 minutes it also checks the counts it showed against the official
// live files in the same bucket and publishes how often they were later
// confirmed, and how much earlier: <cc>/rt/reports-stats.json (stats.js).
//
// Privacy: no coordinates ever arrive (the location check runs on the
// phone); IP addresses and headers aren't read, stored or logged; nothing
// here logs requests (observability is off in wrangler.toml). REPORTS_ENABLED
// is the kill switch: off, or without PLAY_INTEGRITY_CREDENTIALS, every
// report is refused and reports.json says {"on": false}, which hides the
// app's report button.

import { checkIntegrity } from "./integrity.js";
import { aggregate, judge, officialTrips, summary, track } from "./stats.js";
import { KINDS, count, nonceText, prune, publish, refused, sha256b64, undo, validate, validateDispute } from "./rules.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const PUBLISH_MS = 30_000;
/** The operator's live files each country's reports are checked against. */
const OFFICIAL_FILES = { uk: ["trip_updates.pb", "tfl_updates.pb"] };

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
    if (path === "/undo") {
      const u = undo(st.log, body.h, body.trip, body.kind, now);
      st.log = u.log;
      for (const e of u.removed) count(st.daily, e, e.at, -1);
      await this.ctx.storage.put({ log: st.log, daily: st.daily });
      if (u.removed.length) await this.dirty();
      return json({ ok: true, removed: u.removed.length });
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
      await this.trust();
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
    // Each count shown opens a case for the trust statistics.
    const cases = track((await this.ctx.storage.get("cases")) || {}, doc, now);
    await this.ctx.storage.put("cases", cases);
  }

  /** The trust statistics: judge the open cases against the official data
   * and publish the 30-day summary. */
  async trust() {
    const now = Date.now();
    const country = (await this.ctx.storage.get("country")) || "";
    if (!country) return;
    const official = new Map();
    for (const f of OFFICIAL_FILES[country] || []) {
      try {
        const obj = await this.env.LIVE.get(`${country}/rt/${f}`);
        if (obj) officialTrips(new Uint8Array(await obj.arrayBuffer()), official);
      } catch {
        // a missing or broken file: those cases wait, or end "unknown"
      }
    }
    const r = judge((await this.ctx.storage.get("cases")) || {}, official, now);
    const trust = aggregate((await this.ctx.storage.get("trust")) || {}, r.decided);
    await this.ctx.storage.put({ cases: r.cases, trust });
    await this.env.LIVE.put(`${country}/rt/reports-stats.json`, JSON.stringify(summary(trust, now)), {
      httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=600" },
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
  // Undo and forget need only the phone's own code: they can only remove
  // what that code sent.
  const ownToken = typeof b.token === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(b.token);
  if (url.pathname === "/v1/reports/undo") {
    if (!opts.countries.includes(b.country) || !ownToken || typeof b.trip !== "string" || b.trip.length > 120 || !KINDS[b.kind]) return json({ ok: false, error: "body" }, 400);
    return stub(env, b.country).fetch("https://reports/undo", { method: "POST", body: JSON.stringify({ country: b.country, h: await sha256b64(`trainradar-report|${b.token}`), trip: b.trip, kind: b.kind }) });
  }
  if (url.pathname === "/v1/reports/forget") {
    if (!opts.countries.includes(b.country) || !ownToken) return json({ ok: false, error: "token" }, 400);
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
