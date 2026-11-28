// Run with: node --test backend-reports/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAILY, KINDS, count, nonceText, prune, publish, refused, sha256b64, undo, validate, validateDispute } from "../src/rules.js";
import { verdictProblem } from "../src/integrity.js";
import { handle } from "../src/index.js";

const NOW = Date.UTC(2026, 10, 28, 8, 0);
const TOKEN = "abcdefghijklmnopqrstuvwx";
const body = (o = {}) => ({ country: "uk", trip: "C12345:2026-11-28", train: "2C45", kind: "delay", where: "train", band: "300", acc: "20", at: NOW, token: TOKEN, integrity: "x.y.z", ...o });
const opts = { countries: ["uk"], now: NOW };

test("a report is checked field by field; nothing else is kept", () => {
  const v = validate(body({ extra: "no", lat: 51.5 }), opts);
  assert.deepEqual(v.report, { country: "uk", trip: "C12345:2026-11-28", train: "2C45", kind: "delay", where: "train", station: "", band: "300", acc: "20", at: NOW });
  assert.equal(validate(body({ country: "es" }), opts).error, "country");
  assert.equal(validate(body({ kind: "crowded" }), opts).error, "kind");
  // "Hasn't come" only from a station on its route.
  assert.equal(validate(body({ kind: "cancel" }), opts).error, "where");
  assert.equal(validate(body({ kind: "cancel", where: "station" }), opts).error, "station");
  assert.equal(validate(body({ kind: "cancel", where: "station", station: "London Euston" }), opts).report.station, "London Euston");
  assert.equal(validate(body({ band: "5000" }), opts).error, "band");
  assert.equal(validate(body({ at: NOW - 10 * 60_000 }), opts).error, "time");
  assert.equal(validate(body({ token: "short" }), opts).error, "token");
  assert.equal(validate(body({ integrity: "" }), opts).error, "integrity");
  assert.equal(validate(body({ trip: "<script>" }), opts).error, "trip");
  assert.equal(validateDispute(body(), opts).dispute.kind, "delay");
});

test("the nonce binds the integrity token to this report", () => {
  assert.equal(nonceText(body()), `report|uk|C12345:2026-11-28|delay|train||${NOW}|${TOKEN}`);
  assert.equal(nonceText(body({ where: "station", station: "Crewe" })), `report|uk|C12345:2026-11-28|delay|station|Crewe|${NOW}|${TOKEN}`);
  assert.equal(nonceText(body(), true), `dispute|uk|C12345:2026-11-28|delay|${NOW}|${TOKEN}`);
});

test("limits: one per train and kind every 10 min, not on two trains at once, 20 a day", () => {
  const r = validate(body(), opts).report;
  const log = [{ h: "a", ...r, at: NOW - 5 * 60_000 }];
  assert.equal(refused(log, "a", r, NOW), "repeat");
  assert.equal(refused(log, "b", r, NOW), null);
  assert.equal(refused(log, "a", r, NOW + 6 * 60_000), null);
  assert.equal(refused(log, "a", { ...r, trip: "other" }, NOW), "elsewhere");
  // At a station, several trains are fine.
  assert.equal(refused(log, "a", { ...r, trip: "other", where: "station", station: "Crewe" }, NOW), null);
  const many = Array.from({ length: DAILY }, (_, i) => ({ h: "a", ...r, trip: `t${i}`, where: "station", at: NOW - (i + 1) * 3600_000 * 0.5 }));
  assert.equal(refused(many, "a", { ...r, trip: "new", where: "station" }, NOW), "daily");
});

test("counts are shown once enough phones agree within 20 minutes", () => {
  const e = (h, mins, o = {}) => ({ h, trip: "T1", train: "2C45", kind: "delay", where: "train", station: "", at: NOW - mins * 60_000, ...o });
  assert.deepEqual(publish([e("a", 5), e("b", 3)], [], NOW).trips, {});
  // The same phone twice is one.
  assert.deepEqual(publish([e("a", 5), e("a", 3), e("b", 1)], [], NOW).trips, {});
  const three = [e("a", 15), e("b", 10), e("c", 2)];
  assert.deepEqual(publish(three, [], NOW).trips, { T1: { delay: { n: 3, last: NOW - 2 * 60_000 } } });
  // Too far apart to agree.
  assert.deepEqual(publish([e("a", 50), e("b", 25), e("c", 2)], [], NOW).trips, {});
  // Gone an hour after the reports.
  assert.deepEqual(publish(three, [], NOW + 61 * 60_000).trips, {});
  // An incident needs five.
  const four = ["a", "b", "c", "d"].map((h, i) => e(h, i, { kind: "incident" }));
  assert.deepEqual(publish(four, [], NOW).trips, {});
  assert.equal(publish([...four, e("x", 4, { kind: "incident" })], [], NOW).trips.T1.incident.n, 5);
  assert.equal(KINDS.incident.min, 5);
});

test("'that's not right' lowers a count; reporters can't dispute their own", () => {
  const e = (h, mins) => ({ h, trip: "T1", kind: "delay", where: "train", at: NOW - mins * 60_000 });
  const log = [e("a", 3), e("b", 2), e("c", 1), e("d", 1)];
  assert.equal(publish(log, [{ h: "z", trip: "T1", kind: "delay", at: NOW }], NOW).trips.T1.delay.n, 3);
  assert.equal(publish(log, [{ h: "a", trip: "T1", kind: "delay", at: NOW }], NOW).trips.T1.delay.n, 4);
  assert.deepEqual(publish(log, ["y", "z"].map((h) => ({ h, trip: "T1", kind: "delay", at: NOW })), NOW).trips, {});
  // The published file carries no tokens or stations.
  const doc = JSON.stringify(publish(log, [], NOW));
  assert.ok(!doc.includes('"h"') && !doc.includes("station"));
});

test("single reports go after 48 hours; daily totals keep no tokens", () => {
  assert.equal(prune([{ at: NOW - 49 * 3600_000 }, { at: NOW - 3600_000 }], NOW).length, 1);
  const d = count({}, { kind: "delay" }, NOW);
  assert.deepEqual(d, { "2026-11-28": { delay: 1 } });
});

test("Play Integrity: the real app, from Play, on a real phone, for this request", () => {
  const good = {
    requestDetails: { requestPackageName: "com.metranos.trainradar", nonce: "N", timestampMillis: String(NOW) },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
    deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
  };
  assert.equal(verdictProblem(good, "N", NOW), null);
  assert.equal(verdictProblem(good, "M", NOW), "nonce");
  assert.equal(verdictProblem(good, "N", NOW + 20 * 60_000), "stale");
  assert.equal(verdictProblem({ ...good, appIntegrity: { appRecognitionVerdict: "UNRECOGNIZED_VERSION" } }, "N", NOW), "app");
  assert.equal(verdictProblem({ ...good, deviceIntegrity: { deviceRecognitionVerdict: [] } }, "N", NOW), "device");
});

test("the Worker refuses everything while off, and without the credential", async () => {
  const req = () => new Request("https://reports.mytrainradar.com/v1/reports", { method: "POST", body: JSON.stringify(body({ at: Date.now() })) });
  assert.equal((await handle(req(), { REPORTS_ENABLED: "false", PLAY_INTEGRITY_CREDENTIALS: "{}" })).status, 503);
  assert.equal((await handle(req(), { REPORTS_ENABLED: "true" })).status, 503);
  const r = await handle(new Request("https://reports.mytrainradar.com/v1/reports", { method: "OPTIONS" }), {});
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
});

test("a bad integrity token is refused before anything is stored", async () => {
  let stored = false;
  const env = {
    REPORTS_ENABLED: "true",
    PLAY_INTEGRITY_CREDENTIALS: "not json",
    REPORT_COUNTRIES: "uk",
    REPORTS: { idFromName: () => "id", get: () => ({ fetch: () => ((stored = true), new Response("{}")) }) },
  };
  const r = await handle(new Request("https://reports.mytrainradar.com/v1/reports", { method: "POST", body: JSON.stringify(body({ at: Date.now() })) }), env);
  assert.equal(r.status, 403);
  assert.equal(stored, false);
  assert.equal((await sha256b64("x")).length, 43);
});

test("undo: only this phone's own report of that train and kind, within the minute (and slack)", () => {
  const e = (h, trip, kind, secsAgo) => ({ h, trip, kind, at: NOW - secsAgo * 1000 });
  const log = [e("a", "T1", "delay", 30), e("b", "T1", "delay", 30), e("a", "T2", "delay", 30), e("a", "T1", "incident", 30)];
  const u = undo(log, "a", "T1", "delay", NOW);
  assert.equal(u.removed.length, 1);
  assert.equal(u.log.length, 3);
  assert.equal(undo([e("a", "T1", "delay", 120)], "a", "T1", "delay", NOW).removed.length, 0);
  // The daily totals go back down, never below zero.
  const d = count({}, { kind: "delay" }, NOW);
  assert.deepEqual(count(count(d, { kind: "delay" }, NOW, -1), { kind: "delay" }, NOW, -1), { "2026-11-28": { delay: 0 } });
});
