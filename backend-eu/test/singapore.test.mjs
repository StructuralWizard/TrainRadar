import { test } from "node:test";
import assert from "node:assert/strict";
import { SG, parseAlerts, routesOf, sgSeconds } from "../src/singapore.js";
import { runCycle, emptyState } from "../src/cycle.js";
import { alertTargets } from "../src/gtfsrt.js";
import { fields } from "../src/protobuf.js";

const bucket = () => ({
  m: new Map(),
  async put(k, v) {
    this.m.set(k, v);
  },
  async get(k) {
    const v = this.m.get(k);
    return v == null ? null : { arrayBuffer: async () => v, text: async () => String(v) };
  },
});

const DISRUPTED = {
  value: {
    Status: 2,
    AffectedSegments: [{ Line: "NSL", Direction: "Jurong East", Stations: "NS17,NS16,NS15", FreePublicBus: "NS17,NS16,NS15", FreeMRTShuttle: "", MRTShuttleDirection: "" }],
    Message: [{ Content: "0805hrs: NSL - No train service between Bishan and Woodlands. Free bus rides are available.", CreatedDate: "2026-11-25 08:05:20" }],
  },
};

test("SG: DataMall lines become the estimated timetable's routes; times are Singapore's", () => {
  assert.deepEqual(routesOf("NSL"), ["NS"]);
  assert.deepEqual(routesOf("PLRT"), ["PE", "PW"]);
  assert.deepEqual(routesOf("XYZ"), []);
  assert.equal(sgSeconds("2026-11-25 08:05:20"), Date.UTC(2026, 10, 25, 0, 5, 20) / 1000);
  const a = parseAlerts(DISRUPTED);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].routes, ["NS"]);
  assert.equal(a[0].effect, 2);
  assert.match(a[0].header, /No train service between Bishan and Woodlands/);
  // Normal service, no message: nothing.
  assert.deepEqual(parseAlerts({ value: { Status: 1, AffectedSegments: [], Message: [] } }), []);
  // Disrupted with no message: one alert per segment.
  const seg = parseAlerts({ value: { Status: 2, AffectedSegments: [{ Line: "CCL", Stations: "CC1,CC2" }], Message: [] } });
  assert.match(seg[0].header, /CCL: disrupted between CC1 and CC2/);
});

test("SG: the key in the AccountKey header only; the JSON becomes GTFS-RT alerts", async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(DISRUPTED), { status: 200 });
  };
  const env = { SG_ENABLED: "true", SG_LTA_ACCOUNT_KEY: "sg-secret", LIVE: bucket() };
  assert.equal(SG.enabled(env), true);
  const s = await runCycle({ state: emptyState(), env, fetchFn, now: Date.UTC(2026, 10, 25), country: SG });
  assert.equal(s.ok, true, s.error);
  assert.equal(seen[0].url, "https://datamall2.mytransport.sg/ltaodataservice/TrainServiceAlerts");
  assert.equal(seen[0].init.headers.AccountKey, "sg-secret");
  assert.ok(!seen[0].url.includes("sg-secret"));
  const pb = env.LIVE.m.get("sg/rt/alerts.pb");
  const ents = fields(pb).filter((f) => f.field === 2);
  assert.equal(ents.length, 1);
  assert.deepEqual(alertTargets(ents[0].value).map((t) => t.route), ["NS"]);
});

test("SG: a refused key is reported without the key", async () => {
  const fetchFn = async () => new Response("no", { status: 401 });
  const env = { SG_ENABLED: "true", SG_LTA_ACCOUNT_KEY: "sg-secret", LIVE: bucket() };
  const s = await runCycle({ state: emptyState(), env, fetchFn, now: 0, country: SG });
  assert.equal(s.ok, false);
  assert.ok(!s.error.includes("sg-secret"));
  assert.match(SG.missing({}), /SG_LTA_ACCOUNT_KEY/);
});
