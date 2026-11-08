import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeR2 } from "./fakes.mjs";
import { FIRST_KEY, REPLAY_FLUSH_EVERY, ReplayStore, gunzipText, hourId, hourKey } from "../src/replay.js";

const frame = (lat, delay = 120) =>
  JSON.stringify([
    ["1004D100C3", "C3", "100", "Aranjuez", -3.7, lat, 180, delay, 8],
    ["03001", "AVE", "03001", "Barcelona-Sants", -1.2, 41.1, null, null, 16],
  ]);
const read = async (bucket, key) => JSON.parse(await gunzipText(await (await bucket.get(key)).arrayBuffer()));

test("replay: hour ids and keys are UTC", () => {
  const ms = Date.parse("2026-11-08T23:59:30Z");
  assert.equal(hourId(ms), "2026-11-08T23");
  assert.equal(hourKey(hourId(ms)), "replay/2026-11-08/23.json.gz");
});

test("replay: frames are written every minute, hours split, and a restart continues the hour", async () => {
  const bucket = fakeR2();
  const t0 = Date.parse("2026-11-08T14:50:00Z");
  const store = new ReplayStore(bucket);
  for (let k = 0; k < REPLAY_FLUSH_EVERY; k++) await store.add(frame(40.35 + k * 0.001), t0 + k * 60_000);
  const key = "replay/2026-11-08/14.json.gz";
  let doc = await read(bucket, key);
  assert.equal(doc.hour, "2026-11-08T14");
  assert.equal(doc.trains.length, 2, "each train listed once");
  assert.deepEqual(doc.trains[0], ["1004D100C3", "C3", "100", "Aranjuez"]);
  assert.equal(doc.frames.length, REPLAY_FLUSH_EVERY);
  assert.deepEqual(doc.frames[0], [t0 / 1000, [[0, -370000, 4035000, 180, 120, 8], [1, -120000, 4110000, -1, null, 16]]]);
  assert.equal(bucket.objects.get(key).httpMetadata.cacheControl, "public, max-age=60", "still being written");
  assert.deepEqual(JSON.parse(await (await bucket.get(FIRST_KEY)).text()), { hour: "2026-11-08T14" });

  // Restart: a new store reads the hour back and carries on.
  const again = new ReplayStore(bucket);
  await again.add(frame(40.4), t0 + 5 * 60_000);
  await again.flush();
  doc = await read(bucket, key);
  assert.equal(doc.frames.length, REPLAY_FLUSH_EVERY + 1);

  // The next hour: the previous one is closed (long cache), a new file starts.
  await again.add(frame(40.41), Date.parse("2026-11-08T15:00:10Z"));
  assert.equal(bucket.objects.get(key).httpMetadata.cacheControl, "public, max-age=86400");
  await again.flush();
  const next = await read(bucket, "replay/2026-11-08/15.json.gz");
  assert.equal(next.frames.length, 1);
  assert.deepEqual(JSON.parse(await (await bucket.get(FIRST_KEY)).text()), { hour: "2026-11-08T14" }, "first hour kept");
});
