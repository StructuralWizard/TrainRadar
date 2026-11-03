// Run with: node --test backend/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDS,
  MAX_BACKOFF_S,
  MIN_GAP_S,
  PHASE_OFFSET_S,
  initialState,
  medianGap,
  nextFetchAt,
  pollFeed,
  runCycle,
  statusDoc,
} from "../src/poller.js";
import worker, { Poller, SERVED } from "../src/index.js";

const LD = FEEDS[0]; // vehicle_positions_LD.pb, every 15 s
const ALERTS = FEEDS.find((f) => f.name === "alerts.pb");
const BYTES = new Uint8Array([0x0a, 0x03, 0x32, 0x2e, 0x30, 0xff]);
const noJitter = () => 0.5; // rand() = 0.5 → jitter 0

/** In-memory stand-in for an R2 bucket. */
function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, opts = {}) {
      const body = typeof value === "string" ? new TextEncoder().encode(value) : value;
      objects.set(key, { body, ...opts });
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      return {
        body: o.body,
        httpEtag: '"etag-1"',
        customMetadata: o.customMetadata,
        writeHttpMetadata(h) {
          if (o.httpMetadata?.contentType) h.set("Content-Type", o.httpMetadata.contentType);
        },
      };
    },
  };
}

const renfe = (status, { lm = "Tue, 03 Nov 2026 08:00:00 GMT", etag = '"r1"', body = BYTES } = {}) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (status === "timeout") {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    return new Response(status === 200 ? body : null, {
      status,
      headers: status === 200 ? { "Last-Modified": lm, ETag: etag } : {},
    });
  };
  fn.calls = calls;
  return fn;
};

test("200: stores Renfe's bytes unchanged, with cache headers and Renfe's Last-Modified", async () => {
  const bucket = fakeBucket();
  const fetchFn = renfe(200);
  const st = await pollFeed(LD, initialState(), { fetchFn, bucket, now: 1000 });
  assert.equal(fetchFn.calls[0].url, "https://gtfsrt.renfe.com/vehicle_positions_LD.pb");
  const o = bucket.objects.get("rt/vehicle_positions_LD.pb");
  assert.deepEqual(o.body, BYTES, "byte for byte");
  assert.equal(o.httpMetadata.cacheControl, "public, max-age=10");
  assert.equal(o.customMetadata.renfeLastModified, "Tue, 03 Nov 2026 08:00:00 GMT");
  assert.equal(st.ok, true);
  assert.equal(st.etag, '"r1"');
  assert.equal(st.changes.length, 1);
});

test("conditional GET; 304 costs no R2 write", async () => {
  const bucket = fakeBucket();
  const st0 = { ...initialState(), etag: '"r1"', lastModified: "Tue, 03 Nov 2026 08:00:00 GMT" };
  const fetchFn = renfe(304);
  const st = await pollFeed(LD, st0, { fetchFn, bucket, now: 1000 });
  assert.equal(fetchFn.calls[0].init.headers["If-None-Match"], '"r1"');
  assert.equal(fetchFn.calls[0].init.headers["If-Modified-Since"], "Tue, 03 Nov 2026 08:00:00 GMT");
  assert.equal(bucket.objects.size, 0);
  assert.equal(st.ok, true);
  assert.equal(st.lastFetch, 1000);
});

test("5xx and timeouts back off exponentially, capped at 10 min, and recover", async () => {
  const bucket = fakeBucket();
  let st = initialState();
  const waits = [];
  for (let i = 0; i < 8; i++) {
    st = await pollFeed(LD, st, { fetchFn: renfe(i % 2 ? "timeout" : 503), bucket, now: 1000 });
    waits.push(nextFetchAt(LD, st, 1000, noJitter) - 1000);
  }
  assert.equal(st.ok, false);
  assert.equal(st.error, "timeout");
  assert.deepEqual(waits.slice(0, 3), [30, 60, 120]);
  assert.equal(Math.max(...waits), MAX_BACKOFF_S);
  st = await pollFeed(LD, st, { fetchFn: renfe(200), bucket, now: 2000 });
  assert.equal(st.failures, 0);
  assert.equal(nextFetchAt(LD, st, 2000, noJitter) - 2000, 15, "back to the base cadence");
});

test("never faster than once per 15 s per feed, even with jitter", () => {
  const st = { ...initialState(), lastFetch: 1000 };
  for (const r of [0, 0.25, 0.75, 0.999]) {
    assert.ok(nextFetchAt(LD, st, 1000, () => r) >= 1000 + MIN_GAP_S);
  }
});

test("phase-lock: once Renfe's rhythm is known, fetch 2 s after the expected change", () => {
  // Renfe changed at 1000, 1017, 1034, 1051: every 17 s. We fetched at 1052.
  const st = { ...initialState(), changes: [1000, 1017, 1034, 1051], lastFetch: 1052 };
  assert.equal(medianGap(st.changes), 17);
  const t = nextFetchAt(LD, st, 1052, noJitter);
  assert.equal(t, Math.max(1051 + 17 + PHASE_OFFSET_S, 1052 + MIN_GAP_S));
  assert.equal(t, 1070);
});

test("alerts: every 2 min, every 5 min after an hour unchanged, never phase-locked", () => {
  const st = { ...initialState(), changes: [0, 20, 40, 60], lastChangeSeen: 1000, lastFetch: 1000 };
  assert.equal(nextFetchAt(ALERTS, st, 1000, noJitter) - 1000, 120);
  assert.equal(nextFetchAt(ALERTS, { ...st, lastFetch: 5000 }, 5000, noJitter) - 5000, 300);
});

test("cycle: polls due feeds, writes status.json, schedules the next alarm", async () => {
  const bucket = fakeBucket();
  const fetchFn = renfe(200);
  const res = await runCycle({}, { now: 1000, fetchFn, bucket, rand: noJitter });
  assert.equal(fetchFn.calls.length, FEEDS.length, "all due at start");
  assert.ok(res.wroteStatus);
  const status = JSON.parse(new TextDecoder().decode(bucket.objects.get("rt/status.json").body));
  assert.equal(status.pollerEnabled, true);
  assert.deepEqual(Object.keys(status.feeds).sort(), FEEDS.map((f) => f.name).sort());
  const s = status.feeds["vehicle_positions_LD.pb"];
  assert.equal(s.renfeLastModified, "Tue, 03 Nov 2026 08:00:00 GMT");
  assert.equal(s.ok, true);
  assert.equal(s.fetchedAt, new Date(1000 * 1000).toISOString());
  assert.equal(res.nextAlarm, 1015, "next: the 15 s feeds");
  // Nothing due 5 s later: no fetch, and status isn't rewritten yet.
  const again = await runCycle(res.states, { now: 1005, fetchFn, bucket, rand: noJitter, lastStatusAt: 1000 });
  assert.equal(fetchFn.calls.length, FEEDS.length);
  assert.equal(again.wroteStatus, false);
});

test("kill switch: POLLER_ENABLED off → no Renfe requests, no next alarm", async () => {
  const fetchFn = renfe(200);
  const res = await runCycle({}, { now: 1000, fetchFn, bucket: fakeBucket(), enabled: false });
  assert.equal(fetchFn.calls.length, 0);
  assert.equal(res.nextAlarm, null);
});

test("status document shape for an unknown feed", () => {
  const doc = statusDoc({}, 1000, true);
  assert.equal(doc.feeds["alerts.pb"].ok, null);
  assert.equal(doc.feeds["alerts.pb"].fetchedAt, null);
});

test("Worker serves rt/* from R2 with CORS for allowed origins only", async () => {
  const bucket = fakeBucket();
  await bucket.put("rt/trip_updates.pb", BYTES, {
    httpMetadata: { contentType: "application/x-protobuf" },
    customMetadata: { renfeLastModified: "Tue, 03 Nov 2026 08:00:00 GMT" },
  });
  const env = { LIVE: bucket, ALLOWED_ORIGINS: "https://trainradar.pages.dev,capacitor://localhost" };
  const get = (path, origin) => worker.fetch(new Request(`https://live.example/${path}`, { headers: { Origin: origin } }), env);
  const res = await get("rt/trip_updates.pb", "https://trainradar.pages.dev");
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), BYTES);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://trainradar.pages.dev");
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=10");
  assert.equal(res.headers.get("Last-Modified"), "Tue, 03 Nov 2026 08:00:00 GMT");
  const app = await get("rt/trip_updates.pb", "capacitor://localhost");
  assert.equal(app.headers.get("Access-Control-Allow-Origin"), "capacitor://localhost");
  const other = await get("rt/trip_updates.pb", "https://evil.example");
  assert.equal(other.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await get("rt/secret.txt", "https://trainradar.pages.dev")).status, 404);
  assert.equal((await get("rt/alerts.pb", "https://trainradar.pages.dev")).status, 503, "not fetched yet");
  assert.ok(SERVED.has("rt/status.json"));
});

test("Durable Object: /ensure arms the alarm once; the alarm runs a cycle and re-arms", async () => {
  let alarm = null;
  const store = new Map();
  const state = {
    storage: {
      getAlarm: async () => alarm,
      setAlarm: async (t) => (alarm = t),
      get: async (k) => store.get(k),
      put: async (k, v) => store.set(k, v),
    },
  };
  const bucket = fakeBucket();
  const env = { POLLER_ENABLED: "true", LIVE: bucket };
  const saved = globalThis.fetch;
  globalThis.fetch = renfe(200);
  try {
    const p = new Poller(state, env);
    assert.equal(await (await p.fetch(new Request("https://poller/ensure"))).text(), "armed");
    assert.equal(await (await p.fetch(new Request("https://poller/ensure"))).text(), "running");
    await p.alarm();
    assert.ok(bucket.objects.has("rt/vehicle_positions.pb"));
    assert.ok(alarm > Date.now(), "re-armed in the future");
    const status = await (await p.fetch(new Request("https://poller/status"))).json();
    assert.equal(status.feeds["trip_updates.pb"].ok, true);
  } finally {
    globalThis.fetch = saved;
  }
});
