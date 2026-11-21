import { test } from "node:test";
import assert from "node:assert/strict";
import { planCodes, planUntil } from "./planner.js";
import { fromZonedInput, zonedInput } from "./format.js";

const manifest = {
  regions: [
    { code: "ld", bbox: [36, -9, 43, 3], until: "2026-12-13" },
    { code: "10", bbox: [40.0, -4.2, 40.9, -3.2], until: "2027-01-21" },
    { code: "60", bbox: [41.2, 1.6, 41.9, 2.6], until: "2027-01-21" },
    { code: "ouigo", bbox: [36, -9, 43, 3] },
  ],
};

test("plan: regions for the places asked about, and how far it goes", () => {
  // Madrid (Atocha): long distance, OUIGO and Madrid's Cercanías.
  assert.deepEqual(planCodes(manifest, [[-3.69, 40.41]]), ["ld", "10", "ouigo"]);
  // Madrid and Barcelona.
  assert.deepEqual(planCodes(manifest, [[-3.69, 40.41], [2.14, 41.38]]), ["ld", "10", "60", "ouigo"]);
  assert.equal(planUntil(manifest), "2027-01-21");
  assert.equal(planUntil({ regions: [] }), null);
});

test("plan: date fields in the country's time zone", () => {
  // 1 Dec 2026 08:05 in Madrid is 07:05 UTC; in London 08:05 UTC.
  assert.equal(fromZonedInput("2026-12-01T08:05", "Europe/Madrid"), Date.UTC(2026, 11, 1, 7, 5));
  assert.equal(fromZonedInput("2026-12-01T08:05", "Europe/London"), Date.UTC(2026, 11, 1, 8, 5));
  // Summer time.
  assert.equal(fromZonedInput("2027-07-01T08:05", "Europe/Madrid"), Date.UTC(2027, 6, 1, 6, 5));
  assert.equal(zonedInput(Date.UTC(2026, 11, 1, 7, 5), "Europe/Madrid"), "2026-12-01T08:05");
  assert.equal(fromZonedInput("bad", "Europe/Madrid"), null);
});
