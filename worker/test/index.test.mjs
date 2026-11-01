// Run with: node --test worker/test/index.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { ALLOWED_PATHS, EDGE_TTL_SECS } from "../src/index.js";

const env = { ALLOWED_ORIGINS: "https://trainradar.pages.dev, http://localhost:8080" };
const BYTES = new Uint8Array([0x0a, 0x03, 0x32, 0x2e, 0x30, 0xff]);
let calls;

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(BYTES, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Last-Modified": "Sun, 01 Nov 2026 11:51:34 GMT",
        "Set-Cookie": "upstream=secret",
      },
    });
  };
});

const req = (path, init = {}) =>
  new Request(`https://proxy.example${path}`, {
    ...init,
    headers: { Origin: "https://trainradar.pages.dev", ...(init.headers || {}) },
  });

test("forwards allow-listed feeds byte for byte with CORS", async () => {
  const res = await worker.fetch(req("/vehicle_positions_LD.pb"), env);
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), BYTES);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://trainradar.pages.dev");
  assert.equal(res.headers.get("Cache-Control"), `public, max-age=${EDGE_TTL_SECS}`);
  assert.equal(res.headers.get("Last-Modified"), "Sun, 01 Nov 2026 11:51:34 GMT");
  assert.equal(res.headers.get("Set-Cookie"), null, "upstream cookies are not passed on");
  assert.equal(calls[0].url, "https://gtfsrt.renfe.com/vehicle_positions_LD.pb");
  assert.equal(calls[0].init.cf.cacheTtl, 15);
});

test("edge cache is never longer than the fastest feed refresh", () => {
  assert.ok(EDGE_TTL_SECS <= 15);
  assert.equal(ALLOWED_PATHS.size, 5);
});

test("rejects other paths without contacting Renfe", async () => {
  for (const p of ["/", "/alerts.json", "/../etc/passwd", "/vehicle_positions.pb/x", "/?x=1"]) {
    const res = await worker.fetch(req(p), env);
    assert.equal(res.status, 404, p);
  }
  assert.equal(calls.length, 0);
});

test("no CORS grant for other websites", async () => {
  const res = await worker.fetch(
    req("/alerts.pb", { headers: { Origin: "https://evil.example" } }),
    env,
  );
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});

test("preflight and methods", async () => {
  const pre = await worker.fetch(req("/alerts.pb", { method: "OPTIONS" }), env);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("Access-Control-Allow-Methods"), /GET/);
  const post = await worker.fetch(req("/alerts.pb", { method: "POST", body: "x" }), env);
  assert.equal(post.status, 405);
  assert.equal(calls.length, 0);
});

test("upstream failures become 502 with CORS headers", async () => {
  globalThis.fetch = async () => new Response("down", { status: 503 });
  const res = await worker.fetch(req("/trip_updates.pb"), env);
  assert.equal(res.status, 502);
  assert.ok(res.headers.get("Access-Control-Allow-Origin"));
  globalThis.fetch = async () => {
    throw new Error("network");
  };
  assert.equal((await worker.fetch(req("/trip_updates.pb"), env)).status, 502);
});
