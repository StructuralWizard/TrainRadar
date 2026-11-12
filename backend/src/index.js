// TrainRadar live backend Worker (phases C1 and C3).
//
// - scheduled, every minute: make sure the Poller's alarm (and, when the
//   history is enabled, the Recorder's) is armed; the alarms do the work
//   (poller.js, recorder.js). Daily (DAILY_CRON): the history's aggregates,
//   backups, archive and retention (history.js).
// - fetch: `/v1/history/*`, the public history API (api.js), and `rt/*`
//   from the R2 bucket with CORS for TrainRadar's own origins. `rt/*` here
//   is the staging path; in production clients read the bucket through its
//   custom domain (CDN-cached, no Worker invocation).

import { historyApi } from "./api.js";
import { CACHE_CONTROL, FEEDS } from "./poller.js";

export { Poller } from "./poller.js";
export { Recorder } from "./recorder-do.js";

export const SERVED = new Set([
  ...FEEDS.map((f) => `rt/${f.name}`),
  "rt/status.json",
  "rt/summary.json",
  "rt/recorder.json",
  // Written by the UK ingest Worker (backend-uk/), same bucket.
  "uk/rt/status.json",
  "uk/rt/trip_updates.pb",
]);
/** Must match the daily entry in wrangler.toml's crons (UTC). */
export const DAILY_CRON = "40 2 * * *";

function allowedOrigins(env) {
  return new Set(
    String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function baseHeaders(request, env) {
  const h = new Headers({ Vary: "Origin", "X-Content-Type-Options": "nosniff" });
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(env).has(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    h.set("Access-Control-Expose-Headers", "Last-Modified, ETag, Date");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}

function poller(env) {
  return env.POLLER.get(env.POLLER.idFromName("main"));
}

function recorder(env) {
  return env.RECORDER.get(env.RECORDER.idFromName("main"));
}

/** History API, cached at the edge for an hour (the data changes daily). */
async function api(request, env, headers) {
  const url = new URL(request.url);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(url.toString(), { method: "GET" });
  let res = cache ? await cache.match(key) : undefined;
  if (!res) {
    res = await historyApi(url, env.HISTORY);
    if (cache && res.status === 200) await cache.put(key, res.clone());
  }
  for (const [k, v] of res.headers) headers.set(k, v);
  return new Response(request.method === "HEAD" ? null : res.body, { status: res.status, headers });
}

export default {
  async fetch(request, env) {
    const headers = baseHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Allow", "GET, HEAD, OPTIONS");
      return new Response("method not allowed", { status: 405, headers });
    }
    const key = new URL(request.url).pathname.replace(/^\/+/, "");
    if (key.startsWith("v1/history/")) return api(request, env, headers);
    if (!SERVED.has(key)) return new Response("not found", { status: 404, headers });
    const obj = await env.LIVE.get(key);
    if (!obj) return new Response("not yet available", { status: 503, headers });
    obj.writeHttpMetadata(headers);
    headers.set("Cache-Control", CACHE_CONTROL);
    headers.set("ETag", obj.httpEtag);
    if (obj.customMetadata?.renfeLastModified) {
      headers.set("Last-Modified", obj.customMetadata.renfeLastModified);
    }
    return new Response(request.method === "HEAD" ? null : obj.body, { headers });
  },

  async scheduled(event, env, ctx) {
    if (event.cron === DAILY_CRON) {
      if (env.RECORDER && env.RECORDER_ENABLED === "true") ctx.waitUntil(recorder(env).fetch("https://recorder/daily"));
      return;
    }
    ctx.waitUntil(poller(env).fetch("https://poller/ensure"));
    if (env.RECORDER && env.RECORDER_ENABLED === "true") ctx.waitUntil(recorder(env).fetch("https://recorder/ensure"));
  },
};
