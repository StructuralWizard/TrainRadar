import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeR2 } from "./fakes.mjs";
import { NOTICES_FIRST_KEY, NOTICES_WRITE_MS, NoticeLog, madridDay, noticesKey } from "../src/notices.js";

const notice = (id, text = "Obras entre A y B") => ({ id, text, kind: "works", tags: [], lines: ["C3"], nucleos: ["10"], stops: [], from: 1_700_000_000, until: null });
const read = async (bucket, day) => JSON.parse(await (await bucket.get(noticesKey(day))).text());

test("notices: Madrid day", () => {
  assert.equal(madridDay(Date.parse("2026-11-12T23:30:00Z")), "2026-11-13");
  assert.equal(madridDay(Date.parse("2026-11-12T22:30:00Z")), "2026-11-12");
});

test("notices: a day file with first and last seen; rewritten on change, else every few minutes", async () => {
  const bucket = fakeR2();
  const t0 = Date.parse("2026-11-12T08:00:00Z");
  const log = new NoticeLog(bucket);
  await log.add(JSON.stringify([notice("a")]), t0);
  let doc = await read(bucket, "2026-11-12");
  assert.deepEqual(doc.notices.map((n) => [n.id, n.seen]), [["a", [t0 / 1000, t0 / 1000]]]);
  assert.equal(doc.notices[0].text, "Obras entre A y B");
  assert.deepEqual(JSON.parse(await (await bucket.get(NOTICES_FIRST_KEY)).text()), { day: "2026-11-12" });

  // Same notice a minute later: not rewritten yet.
  await log.add(JSON.stringify([notice("a")]), t0 + 60_000);
  doc = await read(bucket, "2026-11-12");
  assert.equal(doc.notices[0].seen[1], t0 / 1000);
  // A new notice: written at once, newest first; "a" gone but kept.
  await log.add(JSON.stringify([notice("b", "Huelga")]), t0 + 120_000);
  doc = await read(bucket, "2026-11-12");
  assert.deepEqual(doc.notices.map((n) => n.id), ["b", "a"]);
  assert.equal(doc.notices[1].seen[1], (t0 + 60_000) / 1000);
  // Unchanged for long enough: written for the new "last seen".
  await log.add(JSON.stringify([notice("b", "Huelga")]), t0 + 120_000 + NOTICES_WRITE_MS);
  doc = await read(bucket, "2026-11-12");
  assert.equal(doc.notices[0].seen[1], (t0 + 120_000 + NOTICES_WRITE_MS) / 1000);

  // Restart: a new log reads the day back.
  const again = new NoticeLog(bucket);
  await again.add(JSON.stringify([notice("c")]), t0 + 3_600_000);
  doc = await read(bucket, "2026-11-12");
  assert.deepEqual(doc.notices.map((n) => n.id).sort(), ["a", "b", "c"]);

  // Next Madrid day: the old file is closed (long cache), a new one begins.
  await again.add(JSON.stringify([notice("c")]), Date.parse("2026-11-12T23:10:00Z"));
  assert.equal(bucket.objects.get(noticesKey("2026-11-12")).httpMetadata.cacheControl, "public, max-age=86400");
  doc = await read(bucket, "2026-11-13");
  assert.deepEqual(doc.notices.map((n) => n.id), ["c"]);
  assert.deepEqual(JSON.parse(await (await bucket.get(NOTICES_FIRST_KEY)).text()), { day: "2026-11-12" }, "first day kept");
});
