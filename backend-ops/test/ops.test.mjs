import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIRM, problems, step } from "../src/rules.js";
import { body, compose, send } from "../src/notify.js";
import { accessToken, latestByCountry, parseCsv } from "../src/play.js";
import { accessUser } from "../src/access.js";
import { cloudflare } from "../src/cf.js";
import { OpsState, readStatuses } from "../src/index.js";

const NOW = Date.UTC(2026, 10, 28, 12, 0, 0);
const iso = (minsAgo) => new Date(NOW - minsAgo * 60_000).toISOString();

test("rules: a stopped ingest, a failing feed, an old feed, a quota, the UK's login and TfL, old data", () => {
  const statuses = {
    es: { generatedAt: iso(1), feeds: { vp: { ok: true, fetchedAt: iso(1) } } }, // fine
    fr: { updatedAt: iso(20), ok: true }, // ingest stopped
    ie: { updatedAt: iso(1), ok: false, failingSince: iso(45), error: "HTTP 503", feeds: {} },
    nl: { updatedAt: iso(1), ok: true, feeds: { "trip_updates.pb": { ok: true, fetchedAt: iso(40) } } },
    se: { updatedAt: iso(1), ok: true, callsToday: 950, dailyCap: 1000 },
    uk: { updatedAt: iso(1), ok: false, failures: 4, error: "AMQ339009", tfl: { ok: false, error: "HTTP 429" } },
    pl: { updatedAt: iso(60 * 24 * 10), ok: false }, // off for 10 days: no alert
    de: null,
  };
  const ids = problems({ statuses, manifests: { es: NOW / 1000 - 3600, ie: NOW / 1000 - 48 * 3600, lu: null }, now: NOW }).map((p) => p.id).sort();
  assert.deepEqual(ids, ["fr:stale", "ie:data", "ie:failing", "nl:feed:trip_updates.pb", "se:quota", "uk:login", "uk:tfl"]);
});

test("alert state: a mail only after two checks in a row, and on recovery after two clear ones", () => {
  const state = {};
  const p = [{ id: "ie:failing", country: "ie", text: "failing" }];
  assert.equal(CONFIRM, 2);
  assert.deepEqual(step(state, p, NOW).raised, []);
  assert.equal(step(state, p, NOW + 300_000).raised.length, 1);
  assert.equal(step(state, p, NOW + 600_000).raised.length, 0, "not again while open");
  assert.deepEqual(step(state, [], NOW + 900_000).cleared, []);
  const c = step(state, [], NOW + 1_200_000).cleared;
  assert.equal(c.length, 1);
  assert.equal(c[0].lasted, 900_000);
  // A blip (one check) never mails.
  step(state, p, NOW + 1_500_000);
  assert.deepEqual(step(state, [], NOW + 1_800_000).raised, []);
  assert.deepEqual(state.open, {});
});

test("Telegram: title, new / cleared / still open; the token never in an error", async () => {
  const n = compose({
    raised: [{ country: "ie", text: "live feed failing for 45 min" }],
    cleared: [{ country: "fr", text: "stopped", lasted: 30 * 60_000 }],
    open: { a: { country: "uk", text: "TfL failing" } },
    site: "https://ops.example.test",
  });
  assert.equal(n.title, "⚠️ TrainRadar: 1 new problem (IE)");
  assert.match(n.text, /New · IE: live feed failing for 45 min/);
  assert.match(n.text, /Cleared · FR: stopped \(lasted 30 min\)/);
  assert.match(n.text, /Still open · UK: TfL failing/);
  assert.equal(n.silent, false);
  assert.equal(compose({ raised: [], cleared: [{ country: "fr", text: "x", lasted: 0 }], open: {}, site: "x" }).silent, true, "a recovery is silent");
  assert.equal(compose({ raised: [], cleared: [], open: {}, site: "x" }), null);
  const env = { ALERTS_TELEGRAM_BOT_TOKEN: "123:s3cret", ALERTS_TELEGRAM_CHAT_ID: "42" };
  const calls = [];
  await send(env, n, async (url, init) => (calls.push([url, init]), new Response("{}")));
  assert.equal(calls[0][0], "https://api.telegram.org/bot123:s3cret/sendMessage");
  const b = JSON.parse(calls[0][1].body);
  assert.deepEqual(b, body("42", n));
  assert.equal(b.chat_id, "42");
  assert.ok(!calls[0][1].body.includes("s3cret"), "the token not in the body");
  // Errors never carry the token (the URL).
  const failures = [
    async () => new Response(JSON.stringify({ description: "Unauthorized" }), { status: 401 }),
    async () => {
      throw new TypeError("fetch failed https://api.telegram.org/bot123:s3cret/sendMessage");
    },
  ];
  for (const f of failures) await assert.rejects(send(env, n, f), (e) => !String(e.message).includes("s3cret") && /Telegram/.test(e.message));
  await assert.rejects(send({}, n, async () => new Response("{}")), /not set/);
});

test("Play: UTF-16 reports, the latest day by country", () => {
  const csv = "Date,Package Name,Country,Daily Device Installs,Active Device Installs\n2026-11-26,p,ES,3,100\n2026-11-27,p,ES,5,104\n2026-11-27,p,GB,2,40\n";
  const u16 = new Uint8Array([0xff, 0xfe, ...Array.from(csv).flatMap((c) => [c.charCodeAt(0), 0])]);
  const r = latestByCountry(parseCsv(u16.buffer));
  assert.deepEqual(r, { date: "2026-11-27", countries: { ES: { "Daily Device Installs": 5, "Active Device Installs": 104 }, GB: { "Daily Device Installs": 2, "Active Device Installs": 40 } } });
});

test("Play: the service account's token is a signed JWT with read-only scopes", async () => {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
  const sa = JSON.stringify({ client_email: "ops@example.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n` });
  let seen;
  const token = await accessToken(sa, async (url, init) => {
    seen = new URLSearchParams(init.body).get("assertion");
    return new Response(JSON.stringify({ access_token: "t0k" }));
  }, NOW);
  assert.equal(token, "t0k");
  const [h, p, s] = seen.split(".");
  const dec = (x) => JSON.parse(Buffer.from(x, "base64url").toString());
  assert.equal(dec(h).alg, "RS256");
  assert.match(dec(p).scope, /androidpublisher/);
  assert.ok(!/\bandroidpublisher\.write|\bcloud-platform\b/.test(dec(p).scope));
  assert.ok(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", kp.publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`)));
});

test("Access: only a valid token for this application gets in", async () => {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
  const team = "team.cloudflareaccess.com";
  const sign = async (claims, kid = "k1") => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const u = `${enc({ alg: "RS256", kid })}.${enc(claims)}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(u));
    return `${u}.${Buffer.from(sig).toString("base64url")}`;
  };
  const env = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: "aud1" };
  const fetchFn = async (url) => (url === `https://${team}/cdn-cgi/access/certs` ? new Response(JSON.stringify({ keys: [jwk] })) : new Response("", { status: 404 }));
  const req = (t) => new Request("https://ops.example.test/", { headers: t ? { "Cf-Access-Jwt-Assertion": t } : {} });
  const good = { aud: ["aud1"], iss: `https://${team}`, exp: NOW / 1000 + 600, email: "me@example.test" };
  assert.equal(await accessUser(req(await sign(good)), env, fetchFn, NOW), "me@example.test");
  assert.equal(await accessUser(req(), env, fetchFn, NOW), null, "no token");
  assert.equal(await accessUser(req(await sign({ ...good, aud: ["other"] })), env, fetchFn, NOW), null, "another app");
  assert.equal(await accessUser(req(await sign({ ...good, exp: NOW / 1000 - 1 })), env, fetchFn, NOW), null, "expired");
  assert.equal(await accessUser(req(await sign({ ...good, iss: "https://evil.example" })), env, fetchFn, NOW), null, "issuer");
  assert.equal(await accessUser(req(await sign(good, "k2")), env, fetchFn, NOW), null, "unknown key");
  assert.equal(await accessUser(req(await sign(good)), {}, fetchFn, NOW), null, "Access not configured: nothing served");
});

test("Cloudflare: each query on its own; an error shows, the rest still come", async () => {
  const fetchFn = async (url, init) => {
    if (url.includes("/zones?")) return new Response(JSON.stringify({ result: [{ id: "z1" }] }));
    const q = JSON.parse(init.body).query;
    if (q.includes("workersInvocationsAdaptive")) return new Response(JSON.stringify({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 10, errors: 1, subrequests: 4 }, dimensions: { scriptName: "trainradar-uk" } }] }] } } }));
    if (q.includes("r2StorageAdaptiveGroups")) return new Response(JSON.stringify({ errors: [{ message: "field renamed" }] }));
    return new Response(JSON.stringify({ data: { viewer: { accounts: [{}], zones: [{ httpRequests1dGroups: [] }] } } }));
  };
  const out = await cloudflare({ CLOUDFLARE_ANALYTICS_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" }, fetchFn, NOW);
  assert.deepEqual(out.workers, [{ script: "trainradar-uk", requests: 10, errors: 1, subrequests: 4 }]);
  assert.match(out.r2.error, /field renamed/);
  assert.deepEqual(out.site, { days: [], countries: [] });
  assert.match((await cloudflare({}, fetchFn, NOW)).error, /not set/);
});

test("the check: statuses from the bucket, a confirmed problem mailed once", async () => {
  const bucket = { "ie/rt/status.json": JSON.stringify({ updatedAt: iso(1), ok: false, failingSince: iso(60), error: "HTTP 503" }) };
  const sent = [];
  const env = {
    LIVE: { get: async (k) => (bucket[k] ? { text: async () => bucket[k] } : null) },
    ALERTS_TELEGRAM_BOT_TOKEN: "1:t",
    ALERTS_TELEGRAM_CHAT_ID: "42",
  };
  const store = new Map();
  const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v) } };
  const ops = new OpsState(ctx, env);
  const fetchFn = async (url, init) => (url.startsWith("https://api.telegram.org/") ? (sent.push(JSON.parse(init.body)), new Response("{}")) : new Response("", { status: 404 }));
  const statuses = await readStatuses(env);
  assert.equal(statuses.ie.error, "HTTP 503");
  assert.equal(statuses.fr, null);
  const r1 = await ops.check(NOW, fetchFn);
  assert.deepEqual(r1, { found: 1, raised: 0, cleared: 0 });
  // The second check confirms it: one push, and not again on the third.
  const r2 = await ops.check(NOW + 300_000, fetchFn);
  assert.equal(r2.raised, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, "42");
  assert.match(sent[0].text, /IE: live feed failing/);
  await ops.check(NOW + 600_000, fetchFn);
  assert.equal(sent.length, 1);
  assert.ok(store.get("alerts").open["ie:failing"]);
});
