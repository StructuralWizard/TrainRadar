import { test } from "node:test";
import assert from "node:assert/strict";
import { CANCELED, decode, encodeTripUpdates } from "../src/gtfsrt.js";
import { applyMessage, emptyState, expire, tripUpdates, KEEP_TERMINATED_MS } from "../src/trust.js";
import { FrameReader, encodeFrame } from "../src/stomp.js";
import { SUBSCRIPTION, TOPIC, drain } from "../src/drain.js";
import { runCycle } from "../src/cycle.js";

const T0 = Date.parse("2026-11-12T17:47:00Z");
// Messages in TRUST's real shape (docs/data-sources-uk.md).
const activation = (id, uid, start, stp) => ({
  header: { msg_type: "0001" },
  body: { train_id: id, train_uid: uid, schedule_start_date: start, schedule_type: stp, tp_origin_timestamp: "2026-11-12", toc_id: "30" },
});
const movement = (id, lateMin, extra = {}) => ({
  header: { msg_type: "0003" },
  body: {
    train_id: id,
    loc_stanox: "63630",
    planned_timestamp: String(T0),
    actual_timestamp: String(T0 + lateMin * 60_000),
    timetable_variation: String(Math.abs(lateMin)),
    variation_status: lateMin > 0 ? "LATE" : lateMin < 0 ? "EARLY" : "ON TIME",
    event_type: "DEPARTURE",
    train_terminated: "false",
    ...extra,
  },
});

test("gtfs-rt: trip updates encode as GTFS-Realtime", () => {
  const bytes = encodeTripUpdates(
    [
      { id: "a", tripId: "C34353:2026-05-18:O", startDate: "20261112", delay: 240, timestamp: 1794505620 },
      { id: "b", tripId: "X1:2026-01-01:P", startDate: "20261112", delay: -60, canceled: true, timestamp: 1 },
    ],
    1794505700,
  );
  const msg = decode(bytes);
  const header = decode(msg[1][0]);
  assert.equal(new TextDecoder().decode(header[1][0]), "2.0");
  assert.equal(header[3][0], 1794505700);
  assert.equal(msg[2].length, 2);
  const tu = decode(decode(msg[2][0])[3][0]);
  const trip = decode(tu[1][0]);
  assert.equal(new TextDecoder().decode(trip[1][0]), "C34353:2026-05-18:O");
  assert.equal(new TextDecoder().decode(trip[3][0]), "20261112");
  assert.equal(tu[5][0], 240);
  const tu2 = decode(decode(msg[2][1])[3][0]);
  assert.equal(tu2[5][0], -60, "negative delays (early)");
  assert.equal(decode(tu2[1][0])[4][0], CANCELED);
});

test("trust: activation + movements → delay; P/O swap; cancellation; expiry", () => {
  const s = emptyState();
  applyMessage(s, activation("512J06MX12", "C34353", "2026-05-18", "O"), T0);
  assert.deepEqual(tripUpdates(s), [], "no movement yet: nothing to say");
  applyMessage(s, movement("512J06MX12", 4), T0);
  applyMessage(s, movement("512J06MX12", 6), T0 + 120_000);
  let u = tripUpdates(s);
  assert.deepEqual(u.map((x) => x.tripId), ["C34353:2026-05-18:O", "C34353:2026-05-18:P"]);
  assert.equal(u[0].delay, 360);
  assert.equal(u[0].startDate, "20261112");
  // Early runs are negative.
  applyMessage(s, activation("1A01XX12", "N02649", "2026-11-12", "N"), T0);
  applyMessage(s, movement("1A01XX12", -2), T0);
  assert.equal(tripUpdates(s).find((x) => x.tripId.startsWith("N02649")).delay, -120);
  // Cancelled at origin.
  applyMessage(s, activation("156N29CY12", "H1", "2026-11-01", "P"), T0);
  applyMessage(s, { header: { msg_type: "0002" }, body: { train_id: "156N29CY12", canx_type: "AT ORIGIN", loc_stanox: "15425" } }, T0);
  assert.ok(tripUpdates(s).some((x) => x.tripId === "H1:2026-11-01:P" && x.canceled));
  // A movement for a train we never saw activated: kept, not published.
  applyMessage(s, movement("999X99XX12", 3), T0);
  assert.ok(!tripUpdates(s).some((x) => x.id.startsWith("999X")));
  // Terminated trains go after a while.
  applyMessage(s, movement("1A01XX12", 0, { train_terminated: "true" }), T0);
  expire(s, T0 + KEEP_TERMINATED_MS + 1);
  assert.ok(!s.trains["1A01XX12"]);
  assert.ok(s.trains["512J06MX12"]);
  assert.equal(s.counts.movements, 5);
});

/** A fake broker on an in-memory transport: CONNECTED, then queued frames. */
function fakeBroker(frames, { badLogin = false, busy = 0 } = {}) {
  let busyLeft = busy;
  const seen = [];
  // Each open() is a new connection with its own state.
  const open = async () => {
    const r = new FrameReader();
    const queue = [];
    let wake = null;
    let closed = false;
    const push = (b) => {
      queue.push(b);
      wake?.();
    };
    return {
      write: async (bytes) => {
        for (const f of r.push(bytes)) {
          seen.push(f);
          if (f.command === "CONNECT") {
            if (busyLeft > 0) (busyLeft -= 1), push(encodeFrame("ERROR", { message: "AMQ339009 Exception getting session" }));
            else push(badLogin ? encodeFrame("ERROR", { message: "bad login" }) : encodeFrame("CONNECTED", { version: "1.2" }));
          }
          if (f.command === "SUBSCRIBE") {
            for (const body of frames) push(encodeFrame("MESSAGE", { destination: f.headers.destination }, JSON.stringify(body)));
          }
          if (f.command === "DISCONNECT") (closed = true), wake?.();
        }
      },
      read: async () => {
        while (!queue.length && !closed) await new Promise((res) => (wake = res));
        return queue.length ? { value: queue.shift(), done: false } : { done: true };
      },
      close: () => ((closed = true), wake?.()),
    };
  };
  return { seen, open };
}

test("drain: durable subscription, reads until quiet", async () => {
  const b = fakeBroker([[activation("512J06MX12", "C34353", "2026-05-18", "O"), movement("512J06MX12", 4)], [movement("512J06MX12", 5)]]);
  const got = [];
  const r = await drain({ open: b.open, login: "me", passcode: "pw", onMessages: (l) => got.push(...l), idleMs: 300, firstMs: 1000 });
  assert.equal(r.frames, 2);
  assert.equal(r.messages, 3);
  assert.equal(got.length, 3);
  const connect = b.seen.find((f) => f.command === "CONNECT");
  assert.equal(connect.headers["client-id"], SUBSCRIPTION);
  const sub = b.seen.find((f) => f.command === "SUBSCRIBE");
  assert.equal(sub.headers.destination, TOPIC);
  assert.equal(sub.headers["durable-subscription-name"], SUBSCRIPTION);
  assert.ok(b.seen.some((f) => f.command === "DISCONNECT"), "disconnects (the subscription stays)");
  assert.ok(!b.seen.some((f) => f.command === "UNSUBSCRIBE"), "never unsubscribes");
});

function fakeBucket() {
  const objects = new Map();
  return { objects, put: async (k, v, o) => objects.set(k, { v, o }) };
}

test("cycle: writes trip updates and status; a failed login keeps the last feed", async () => {
  const bucket = fakeBucket();
  const env = { LIVE: bucket, NETWORK_RAIL_USERNAME: "me", NETWORK_RAIL_PASSWORD: "pw" };
  const state = emptyState();
  const b = fakeBroker([[activation("512J06MX12", "C34353", "2026-05-18", "O"), movement("512J06MX12", 4)]]);
  const st = await runCycle({ state, env, open: b.open, now: T0 });
  assert.equal(st.ok, true);
  assert.equal(st.published, 2);
  assert.equal(st.lastDrain.messages, 2);
  // Spain's poller status shape, so the app reads it the same way.
  assert.equal(st.feeds["trip_updates.pb"].ok, true);
  assert.equal(st.feeds["trip_updates.pb"].renfeLastModified, new Date(T0).toUTCString());
  const pb = bucket.objects.get("uk/rt/trip_updates.pb");
  assert.equal(pb.o.httpMetadata.cacheControl, "public, max-age=30");
  assert.equal(decode(pb.v)[2].length, 2);
  // Next minute the login fails: status says so, the feed isn't overwritten.
  const before = bucket.objects.get("uk/rt/trip_updates.pb");
  const st2 = await runCycle({ state, env, open: fakeBroker([], { badLogin: true }).open, now: T0 + 60_000 });
  assert.equal(st2.ok, false);
  assert.match(st2.error, /bad login/);
  assert.equal(bucket.objects.get("uk/rt/trip_updates.pb"), before);
  const status = JSON.parse(bucket.objects.get("uk/rt/status.json").v);
  assert.equal(status.ok, false);
  assert.ok(!JSON.stringify(status).includes("pw"), "never the password");
});

test("cycle: retries once when the broker still holds last minute's session", async () => {
  const bucket = fakeBucket();
  const env = { LIVE: bucket, NETWORK_RAIL_USERNAME: "me", NETWORK_RAIL_PASSWORD: "pw" };
  const state = emptyState();
  const b = fakeBroker([[activation("512J06MX12", "C34353", "2026-05-18", "O"), movement("512J06MX12", 4)]], { busy: 1 });
  const st = await runCycle({ state, env, open: b.open, now: T0, retryMs: 10 });
  assert.equal(st.ok, true);
  assert.equal(st.retried, true);
  assert.equal(st.failingSince, null);
  // Failing twice: reported, with since when.
  const st2 = await runCycle({ state, env, open: fakeBroker([], { busy: 2 }).open, now: T0 + 60_000, retryMs: 10 });
  assert.equal(st2.ok, false);
  assert.equal(st2.failingSince, new Date(T0 + 60_000).toISOString());
  const st3 = await runCycle({ state, env, open: fakeBroker([], { busy: 2 }).open, now: T0 + 120_000, retryMs: 10 });
  assert.equal(st3.failingSince, new Date(T0 + 60_000).toISOString(), "kept from the first failure");
});
