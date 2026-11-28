// Run with: node --test web/js/board.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepLongDistance } from "./board.js";

test("long-distance trains stay on a board full of Cercanías", () => {
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => ({ n: `C${i}`, region: "madrid", sched: i * 60 })),
    { n: "OUIGO 6102", region: "ouigo", sched: 3000 },
    { n: "AVE 3100", region: "ld", sched: 5000 },
  ].sort((a, b) => a.sched - b.sched);
  const out = keepLongDistance(rows, 12);
  assert.equal(out.length, 14);
  assert.deepEqual(out.slice(12).map((r) => r.n), ["OUIGO 6102", "AVE 3100"]);
  assert.deepEqual(out.map((r) => r.sched), [...out.map((r) => r.sched)].sort((a, b) => a - b));
  // Elsewhere (no Cercanías, other countries): just the first rows.
  assert.equal(keepLongDistance(rows.slice(0, 5), 12).length, 5);
  assert.equal(keepLongDistance(rows, 12, 1).length, 13);
});
