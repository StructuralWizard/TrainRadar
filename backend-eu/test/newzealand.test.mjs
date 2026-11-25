import { test } from "node:test";
import assert from "node:assert/strict";
import { NZ, isAucklandRail, isWellingtonRail } from "../src/newzealand.js";
import { feedFor } from "../src/ireland.js";
import { runCycle, emptyState } from "../src/cycle.js";
import { filterFeed } from "../src/gtfsrt.js";
import { fields } from "../src/protobuf.js";
import { msg, str } from "../src/encode.js";

const env = (o = {}) => ({
  NZ_ENABLED: "true",
  NZ_METLINK_API_KEY: "wlg-secret",
  NZ_AT_API_KEY: "akl-secret",
  LIVE: { m: new Map(), async put(k, v) { this.m.set(k, v); }, async get(k) { const v = this.m.get(k); return v == null ? null : { arrayBuffer: async () => v }; } },
  ...o,
});

test("NZ: both regions in turn, every feed within a turn, gentle on both keys", () => {
  const names = NZ.feeds.map((f) => f.name);
  for (const n of Object.values(NZ.parts).flat()) assert.ok(names.includes(n), n);
  const perDay = 86_400_000 / NZ.cycleMs;
  for (const region of ["wlg", "akl"]) {
    const share = NZ.feeds.filter((f) => f.region === region).length / NZ.feeds.length;
    assert.ok(perDay * share <= 6_000, `${region}: ${perDay * share} calls a day`);
  }
  assert.equal(feedFor(0, NZ).name, "vp_akl.pb");
  assert.equal(feedFor(1, NZ).name, "vp_wlg.pb");
});

test("NZ: each key only in its own region's header, never in a URL or an error", async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    return new Response("no", { status: 401 });
  };
  const e = env();
  assert.equal(NZ.enabled(e), true);
  const s0 = await runCycle({ state: emptyState(), env: e, fetchFn, now: 0, country: NZ });
  const s1 = await runCycle({ state: { ...emptyState(), minute: 1 }, env: e, fetchFn, now: 0, country: NZ });
  assert.equal(seen[0].url, "https://api.at.govt.nz/realtime/legacy/vehiclelocations");
  assert.equal(seen[0].init.headers["Ocp-Apim-Subscription-Key"], "akl-secret");
  assert.equal(seen[0].init.headers["x-api-key"], undefined);
  assert.equal(seen[1].url, "https://api.opendata.metlink.org.nz/v1/gtfs-rt/vehiclepositions");
  assert.equal(seen[1].init.headers["x-api-key"], "wlg-secret");
  assert.equal(seen[1].init.headers["Ocp-Apim-Subscription-Key"], undefined);
  for (const { url } of seen) assert.ok(!url.includes("secret"));
  for (const s of [s0, s1]) assert.ok(!s.error.includes("secret"));
  assert.match(NZ.missing(env({ NZ_AT_API_KEY: "" })), /NZ_AT_API_KEY/);
  assert.equal(NZ.enabled(env({ NZ_ENABLED: "false" })), false);
});

test("NZ: trains kept, buses and the Cable Car dropped", () => {
  assert.ok(isWellingtonRail("KPL__1__6203__RAIL__Rail_MTuWThF-XHol_20261122", ""));
  assert.ok(isWellingtonRail("", "5"));
  assert.ok(!isWellingtonRail("AX__1__100__MNM__6011__6011_20261122", "60"));
  assert.ok(isAucklandRail("E-W-201") && isAucklandRail("S-C-201") && isAucklandRail("O-W-201") && isAucklandRail("HUIA-404"));
  assert.ok(!isAucklandRail("NX1-203") && !isAucklandRail("") && !isAucklandRail("WEST-1"));

  // A feed: one Auckland train, one bus (trip updates); one train alert,
  // one bus-stop alert.
  const trip = (id, route) => msg(1, [str(1, id), str(5, route)]);
  const tu = (id, trip_) => msg(2, [str(1, id), msg(3, [trip_])]);
  const feed = new Uint8Array([...msg(1, [str(1, "2.0")]), ...tu("a", trip("t1", "E-W-201")), ...tu("b", trip("t2", "NX1-203"))]);
  const out = filterFeed(feed, NZ.keep("tu_akl.pb"));
  assert.equal(out.total, 2);
  assert.equal(out.kept, 1);
  const alert = (id, sel) => msg(2, [str(1, id), msg(5, [msg(5, sel)])]);
  const alerts = new Uint8Array([...msg(1, [str(1, "2.0")]), ...alert("x", [str(2, "S-C-201")]), ...alert("y", [str(5, "stop-1")])]);
  const kept = filterFeed(alerts, NZ.keep("al_akl.pb"));
  assert.equal(kept.kept, 1);
  assert.equal(fields(kept.bytes).filter((f) => f.field === 2).length, 1);
});
