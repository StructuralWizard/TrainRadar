import { test } from "node:test";
import assert from "node:assert/strict";
import { HistoryApi, HistoryCache, RENFE_PUNCTUALITY, dailySeries, rangeBefore, renfeOfficialUrl, summarize } from "./history.js";

const day = (date, product, o = {}) => ({ date, product, trips: 10, on_time: 8, late_5: 2, late_15: 1, cancelled: 0, median_delay: 2, p90_delay: 9, ...o });

test("summary of a line over the days, for the train's product", () => {
  const s = summarize([day("2026-11-01", "AVE"), day("2026-11-02", "AVE", { median_delay: 4 }), day("2026-11-02", "ALVIA", { on_time: 0, late_5: 10 })], "AVE");
  assert.deepEqual(s, { trips: 20, onTimePct: 80, late5Pct: 20, late15Pct: 10, cancelled: 0, medianMin: 3, days: 2 });
  assert.equal(summarize([day("2026-11-01", "AVE", { trips: 3 })], "AVE"), null, "too few runs");
  assert.equal(summarize([], "AVE"), null);
  assert.equal(summarize(undefined), null);
});

test("one request per line; loading, then the summary; failures retried later", async () => {
  const calls = [];
  let answer = { ok: true, json: async () => ({ days: [day("2026-11-01", "CERCANIAS")] }) };
  const loaded = [];
  const c = new HistoryCache("https://api.example/", { fetchFn: async (u) => (calls.push(u), answer), onLoad: (l) => loaded.push(l) });
  assert.equal(c.get("10-C5", "CERCANIAS", 0), undefined, "loading");
  assert.equal(c.get("10-C5", "CERCANIAS", 0), undefined, "still loading, no second request");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ["https://api.example/v1/history/line/10-C5?days=7"]);
  assert.deepEqual(loaded, ["10-C5"]);
  assert.equal(c.get("10-C5", "CERCANIAS", 0).onTimePct, 80);

  answer = { ok: false, status: 503 };
  c.get("10-C1", "CERCANIAS", 0);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(c.get("10-C1", "CERCANIAS", 60_000), null, "failed: nothing shown");
  assert.equal(calls.length, 2, "not retried at once");
  c.get("10-C1", "CERCANIAS", 11 * 60_000);
  assert.equal(calls.length, 3, "retried after 10 min");

  assert.equal(new HistoryCache("").get("10-C5", "CERCANIAS"), null, "no API configured");
});

test("daily series for charts; one cached request per range", async () => {
  const rows = [
    { date: "2026-11-02", product: "AVE", trips: 10, on_time: 9, late_5: 1 },
    { date: "2026-11-01", product: "AVE", trips: 10, on_time: 5, late_5: 5 },
    { date: "2026-11-01", product: "ALVIA", trips: 4, on_time: 0, late_5: 4 },
    { date: "2026-11-03", product: "AVE", trips: 3, on_time: 0, late_5: 0 },
  ];
  assert.deepEqual(dailySeries(rows, "AVE"), [
    { date: "2026-11-01", onTimePct: 50, runs: 10 },
    { date: "2026-11-02", onTimePct: 90, runs: 10 },
  ]);
  assert.deepEqual(dailySeries([{ date: "2026-11-01", calls: 100, on_time: 80, late_5: 20 }]), [{ date: "2026-11-01", onTimePct: 80, runs: 100 }]);
  const calls = [];
  const api = new HistoryApi("https://api.example/", async (u) => (calls.push(u), { ok: true, json: async () => ({ runs: [] }) }));
  await api.get("train", "03071", 30);
  await api.get("train", "03071", 30);
  assert.deepEqual(calls, ["https://api.example/v1/history/train/03071?days=30"]);
  await assert.rejects(new HistoryApi("").get("line", "x", 7));
});

test("history: Renfe's official page per service, and whether a range starts before the history", () => {
  assert.match(renfeOfficialUrl("CERCANIAS"), /\/cercanias$/);
  assert.match(renfeOfficialUrl("AVE"), /\/ave-larga-distancia$/);
  assert.match(renfeOfficialUrl("ALVIA"), /\/ave-larga-distancia$/);
  assert.match(renfeOfficialUrl("MD"), /\/media-distancia$/);
  assert.match(renfeOfficialUrl("REG.EXP."), /\/media-distancia$/);
  assert.equal(renfeOfficialUrl(null), RENFE_PUNCTUALITY, "stations: the general page");
  const now = Date.parse("2026-11-08T10:00:00Z"); // yesterday = 7 Nov
  assert.equal(rangeBefore("2026-11-04", 4, now), false, "4–7 Nov");
  assert.equal(rangeBefore("2026-11-04", 7, now), true, "1–7 Nov");
  assert.equal(rangeBefore(null, 365, now), false);
});
