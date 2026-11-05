// Same cases as app/android/app/src/test/…/AlertRulesTest.java.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertLevel, decideAlerts, liveState } from "./alerts.js";

const FAVS = [
  { type: "train", number: "03071", label: "AVE 3071" },
  { type: "station", id: "18000" },
  { type: "train", number: "19", label: "C5 19" },
];
const trains = (d71, s19) =>
  new Map([
    ["3071", { delayMin: d71, status: "running" }],
    ["19", { delayMin: 0, status: s19 }],
    ["999", { delayMin: 40, status: "running" }],
  ]);

test("notifies once per level and day", () => {
  let r = decideAlerts(FAVS, trains(3, "running"), {}, "2026-11-05");
  assert.equal(r.alerts.length, 0, "under 5 min: nothing");
  r = decideAlerts(FAVS, trains(7, "running"), r.state, "2026-11-05");
  assert.deepEqual(r.alerts, [{ trainNo: "3071", level: 1, title: "AVE 3071", body: "7 min de retraso" }]);
  r = decideAlerts(FAVS, trains(9, "running"), r.state, "2026-11-05");
  assert.equal(r.alerts.length, 0, "same level: once");
  r = decideAlerts(FAVS, trains(4, "running"), r.state, "2026-11-05");
  assert.equal(r.alerts.length, 0, "back under, no news");
  r = decideAlerts(FAVS, trains(16, "cancelled"), r.state, "2026-11-05", { lang: "en" });
  assert.deepEqual(r.alerts.map((a) => a.body), ["16 min late", "Cancelled"]);
  r = decideAlerts(FAVS, trains(7, "running"), r.state, "2026-11-06");
  assert.equal(r.alerts.length, 1, "a new day starts over");
});

test("levels and the engine's shape", () => {
  assert.equal(alertLevel({ delayMin: null, status: "running" }), 0);
  assert.equal(alertLevel({ delayMin: 15, status: "running" }), 2);
  assert.deepEqual(liveState({ delay: 430, canceled: false }), { delayMin: 7, status: "running" });
  assert.deepEqual(liveState({ delay: null, canceled: true }), { delayMin: null, status: "cancelled" });
});
