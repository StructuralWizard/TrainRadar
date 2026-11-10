import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeR2 } from "./fakes.mjs";
import { GPS_FLUSH_EVERY, GpsLog, gpsKey } from "../src/gpslog.js";
import { gunzipText } from "../src/replay.js";

const fixes = (rows) => JSON.stringify(rows);
const fix = (t, lat, key = "1004D100C3") => [key, "100", "cer", "C3", t, -370000, lat, 54, "18000", "18002", ""];
const read = async (bucket, key) =>
  (await gunzipText(await (await bucket.get(key)).arrayBuffer()))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

test("gps log: keys are per UTC hour, in gps/", () => {
  assert.equal(gpsKey("2026-11-10T07"), "gps/2026-11-10/07.ndjson.gz");
});

test("gps log: new fixes only, written every few minutes, hours split, a restart carries on", async () => {
  const bucket = fakeR2();
  const t0 = Date.parse("2026-11-10T07:30:00Z");
  const s = t0 / 1000;
  const log = new GpsLog(bucket);
  assert.equal(await log.add(fixes([fix(s, 4035000), ["03001", "03001", "ld", "AVE", s, -120000, 4110000, null, "", "", "71801"]]), t0), 2);
  // Same fix again, and the AV/LD/MD train repeating its position with a later time: not new.
  assert.equal(await log.add(fixes([fix(s, 4035000), ["03001", "03001", "ld", "AVE", s + 60, -120000, 4110000, null, "", "", ""]]), t0 + 60_000), 0);
  assert.equal(bucket.objects.size, 0, "nothing written before GPS_FLUSH_EVERY cycles");
  for (let k = 2; k < GPS_FLUSH_EVERY; k++) await log.add(fixes([fix(s + 60 * k, 4035000 + k)]), t0 + 60_000 * k);
  const key = "gps/2026-11-10/07.ndjson.gz";
  let rows = await read(bucket, key);
  assert.equal(rows.length, GPS_FLUSH_EVERY);
  assert.deepEqual(rows[0], [s, "1004D100C3", "100", "cer", "C3", -370000, 4035000, 54, "18000", "18002", ""]);
  assert.deepEqual(rows[1], [s, "03001", "03001", "ld", "AVE", -120000, 4110000, null, "", "", "71801"]);
  assert.equal(log.status().fixes, GPS_FLUSH_EVERY);

  // Restart: the hour's file is read back and extended, not overwritten.
  const again = new GpsLog(bucket);
  await again.add(fixes([fix(s + 1500, 4036000)]), t0 + 25 * 60_000);
  await again.flush();
  rows = await read(bucket, key);
  assert.equal(rows.length, GPS_FLUSH_EVERY + 1);

  // Next hour: the old file is written out, a new one starts.
  await again.add(fixes([fix(s + 1860, 4037000)]), Date.parse("2026-11-10T08:01:00Z"));
  await again.flush();
  assert.equal((await read(bucket, "gps/2026-11-10/08.ndjson.gz")).length, 1);
  assert.equal(bucket.objects.get(key).httpMetadata.contentType, "application/gzip");
});
