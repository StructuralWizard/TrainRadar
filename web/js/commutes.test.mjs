import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMMUTES,
  activeCommute,
  emptyCommutes,
  parseCommutes,
  removeActive,
  selectCommute,
  serializeCommutes,
  setDestination,
  setOrigin,
  swapActive,
} from "./commutes.js";

const st = (id) => ({ id, name: `S${id}`, lon: 1, lat: 2 });

test("commutes: the single 2.0.x commute becomes a list of one", () => {
  const s = parseCommutes(JSON.stringify({ from: st("a"), to: st("b") }));
  assert.equal(s.list.length, 1);
  assert.equal(activeCommute(s).to.id, "b");
  assert.deepEqual(parseCommutes(JSON.stringify({ from: st("a"), to: null })).draft.id, "a", "half-set: kept as origin");
  for (const bad of [null, "", "{bad", "[]", '{"list":"x"}']) assert.deepEqual(parseCommutes(bad).list, []);
});

test("commutes: add several, select, swap, remove; round trip", () => {
  let s = emptyCommutes();
  s = setOrigin(s, st("a"));
  let r = setDestination(s, st("b"));
  assert.ok(r.added);
  s = setDestination(setOrigin(r.state, st("c")), st("d")).state;
  assert.deepEqual(s.list.map((c) => `${c.from.id}${c.to.id}`), ["ab", "cd"]);
  assert.equal(s.active, 1, "the new one is active");
  assert.equal(s.draft, null);
  // Adding an existing pair selects it.
  s = setDestination(setOrigin(s, st("a")), st("b")).state;
  assert.equal(s.list.length, 2);
  assert.equal(s.active, 0);
  // Swap: a→b becomes b→a; swapping into an existing reverse selects it.
  s = swapActive(s);
  assert.equal(`${activeCommute(s).from.id}${activeCommute(s).to.id}`, "ba");
  s = setDestination(setOrigin(s, st("d")), st("c")).state; // d→c, the reverse of c→d
  assert.equal(s.list.length, 3);
  s = selectCommute(s, 1);
  s = swapActive(s); // c→d → d→c exists: select it
  assert.equal(s.list.length, 3);
  assert.equal(s.active, 2);
  s = removeActive(s);
  assert.equal(s.list.length, 2);
  assert.equal(s.active, 1);
  assert.deepEqual(parseCommutes(serializeCommutes(s)), s);
  s = removeActive(removeActive(s));
  assert.equal(s.active, -1);
  assert.equal(activeCommute(s), null);
});

test("commutes: same station twice, no origin, and the limit", () => {
  let s = emptyCommutes();
  assert.equal(setDestination(s, st("a")).added, false, "no origin yet");
  assert.equal(setDestination(setOrigin(s, st("a")), st("a")).added, false, "same station");
  for (let i = 0; i < MAX_COMMUTES; i++) s = setDestination(setOrigin(s, st(`f${i}`)), st(`t${i}`)).state;
  const r = setDestination(setOrigin(s, st("x")), st("y"));
  assert.equal(r.added, false);
  assert.equal(r.full, true);
  assert.equal(r.state.list.length, MAX_COMMUTES);
});

import { journeyStatus, journeyToSave, parseJourney, removeJourney, saveJourney, updateJourney } from "./commutes.js";

// A route-sheet journey (engine journeysJson): AVE, a walk, then Cercanías.
const found = {
  dep: 100,
  arr: 200,
  changes: 1,
  steps: [
    { kind: "ride", trip_id: "AVE1", route: "AVE", number: "03063", from: "04040", from_name: "Zaragoza", to: "60000", to_name: "Atocha AVE", dep: 1000, arr: 2000, delay: 60 },
    { kind: "walk", from: "60000", to: "18000", secs: 420 },
    { kind: "ride", trip_id: "C3x", route: "C3", number: "20138", from: "18000", from_name: "Atocha Cerc.", to: "35600", to_name: "Pinto", dep: 2700, arr: 3480, delay: null },
  ],
};
const clock = (u) => ({ 1000: "08:05", 2000: "09:30", 2700: "09:45", 3480: "09:58" })[u];

test("saved journeys: from the route sheet, validated, saved on its commute", () => {
  const j = journeyToSave(found, clock, 2);
  assert.deepEqual(j.days, [1, 2, 3, 4, 5], "a weekday: Monday to Friday");
  assert.equal(j.legs.length, 2);
  assert.equal(j.legs[1].walk, 420);
  assert.equal(j.legs[0].dep, "08:05");
  assert.equal(j.remind, 30);
  assert.ok(Object.values(j.notify).every(Boolean));
  assert.deepEqual(journeyToSave(found, clock, 6).days, [6], "a Saturday: that day");

  // Saved on a new commute, then the same pair again replaces it.
  let r = saveJourney(emptyCommutes(), { from: st("04040"), to: st("35600") }, j);
  assert.ok(r.added);
  assert.equal(activeCommute(r.state).journey.legs[0].number, "03063");
  // Survives the round trip; bad journeys are dropped, the commute kept.
  const back = parseCommutes(serializeCommutes(r.state));
  assert.deepEqual(activeCommute(back).journey, j);
  const bad = JSON.parse(serializeCommutes(r.state));
  bad.list[0].journey.legs[0].dep = "8h";
  assert.equal(activeCommute(parseCommutes(JSON.stringify(bad))).journey, undefined);
  assert.equal(parseJourney({ legs: [] }), null);

  // Settings, then forgetting the journey keeps the commute.
  let s = updateJourney(r.state, { days: [1, 3, 9], remind: 45, notify: { platform: false } });
  assert.deepEqual(activeCommute(s).journey.days, [1, 3]);
  assert.equal(activeCommute(s).journey.remind, 45);
  assert.equal(activeCommute(s).journey.notify.platform, false);
  assert.equal(activeCommute(s).journey.notify.delay, true);
  s = removeJourney(s);
  assert.equal(activeCommute(s).journey, undefined);
  assert.equal(s.list.length, 1);
  // Swapping ends drops the journey (other trains the other way).
  r = saveJourney(emptyCommutes(), { from: st("04040"), to: st("35600") }, j);
  assert.equal(activeCommute(swapActive(r.state)).journey, undefined);
});

test("saved journeys: today's state, changes at risk and broken", () => {
  const j = journeyToSave(found, clock, 2);
  // 09:30 → 09:45 with a 7 min walk: 8 min margin.
  let st1 = journeyStatus(j, [null, null]);
  assert.equal(st1.changes[0].margin, 8 * 60);
  assert.equal(st1.risk, false);
  // The AVE 4 min late: 4 min left, at risk; 10 late: broken.
  st1 = journeyStatus(j, [{ delay: 240 }, null]);
  assert.ok(st1.risk && !st1.broken);
  st1 = journeyStatus(j, [{ delay: 600 }, { delay: 60 }]);
  assert.ok(st1.broken);
  // The Cercanías late too: the margin grows back.
  st1 = journeyStatus(j, [{ delay: 600 }, { delay: 600 }]);
  assert.equal(st1.changes[0].margin, 8 * 60);
  // Cancelled.
  assert.ok(journeyStatus(j, [null, { canceled: true }]).broken);
});
