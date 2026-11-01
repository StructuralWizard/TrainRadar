// TrainRadar CORS pass-through for Renfe's GTFS-RT feeds.
//
// Renfe's feeds send no CORS headers, so browsers can't read them directly.
// This Worker forwards the raw bytes UNCHANGED for five allow-listed paths,
// adds CORS headers for TrainRadar's own origins, and caches at the edge for
// at most 15 s (Renfe refreshes every 15–20 s). No parsing, no logic, no logs
// of anything beyond Cloudflare's defaults.

const UPSTREAM = "https://gtfsrt.renfe.com/";
export const ALLOWED_PATHS = new Set([
  "vehicle_positions_LD.pb",
  "trip_updates_LD.pb",
  "vehicle_positions.pb",
  "trip_updates.pb",
  "alerts.pb",
]);
export const EDGE_TTL_SECS = 15;
const PASS_HEADERS = ["content-type", "last-modified", "etag", "date"];

function allowedOrigins(env) {
  return new Set(
    String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const h = new Headers({ Vary: "Origin" });
  if (origin && allowedOrigins(env).has(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    h.set("Access-Control-Expose-Headers", "Last-Modified, Date, ETag");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}

function reply(status, text, headers) {
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(text, { status, headers });
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    headers.set("X-Content-Type-Options", "nosniff");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Allow", "GET, HEAD, OPTIONS");
      return reply(405, "method not allowed", headers);
    }
    const path = new URL(request.url).pathname.replace(/^\/+/, "");
    if (!ALLOWED_PATHS.has(path)) {
      return reply(404, "not found", headers);
    }

    let upstream;
    try {
      upstream = await fetch(UPSTREAM + path, {
        method: request.method,
        cf: { cacheTtl: EDGE_TTL_SECS, cacheEverything: true },
      });
    } catch {
      return reply(502, "upstream unreachable", headers);
    }
    for (const k of PASS_HEADERS) {
      const v = upstream.headers.get(k);
      if (v) headers.set(k, v);
    }
    headers.set("Cache-Control", `public, max-age=${EDGE_TTL_SECS}`);
    if (!upstream.ok) {
      return reply(502, `upstream status ${upstream.status}`, headers);
    }
    // The body stream is passed through untouched.
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: 200,
      headers,
    });
  },
};
