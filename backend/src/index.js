// TrainRadar live backend Worker (phase C1).
//
// - scheduled (every minute): make sure the Poller Durable Object's alarm is
//   armed; the alarm does the actual fetching (see poller.js).
// - fetch: serves `rt/*` from the R2 bucket with CORS for TrainRadar's own
//   origins. This is the staging path; in production clients read the
//   bucket through its custom domain (CDN-cached, no Worker invocation).

import { CACHE_CONTROL, FEEDS } from "./poller.js";

export { Poller } from "./poller.js";

export const SERVED = new Set([...FEEDS.map((f) => `rt/${f.name}`), "rt/status.json"]);

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

export default {
  async fetch(request, env) {
    const headers = baseHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Allow", "GET, HEAD, OPTIONS");
      return new Response("method not allowed", { status: 405, headers });
    }
    const key = new URL(request.url).pathname.replace(/^\/+/, "");
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

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(poller(env).fetch("https://poller/ensure"));
  },
};
