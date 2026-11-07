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
