// The UK ingest Worker's minute (plan 3, phase 3c), without Cloudflare
// imports so it runs in Node tests: drain TRUST, update the trains, write
// uk/rt/trip_updates.pb and uk/rt/status.json to the live bucket.

import { drain } from "./drain.js";
import { applyMessage, expire, tripUpdates } from "./trust.js";
import { encodeTripUpdates } from "./gtfsrt.js";

export const CYCLE_MS = 60_000;
export const CACHE = "public, max-age=30";

/** One minute's work, with the I/O injected (tests run it in Node). */
export async function runCycle({ state, env, open, now = Date.now() }) {
  const cycle = { at: new Date(now).toISOString(), ok: true };
  try {
    const r = await drain({
      open,
      login: env.NETWORK_RAIL_USERNAME,
      passcode: env.NETWORK_RAIL_PASSWORD,
      onMessages: (list) => {
        for (const m of list) applyMessage(state, m, now);
      },
    });
    Object.assign(cycle, r);
  } catch (e) {
    cycle.ok = false;
    cycle.error = String(e?.message || e).slice(0, 300);
  }
  expire(state, now);
  const updates = tripUpdates(state);
  if (cycle.ok) {
    await env.LIVE.put("uk/rt/trip_updates.pb", encodeTripUpdates(updates, Math.round(now / 1000)), {
      httpMetadata: { contentType: "application/x-protobuf", cacheControl: CACHE },
    });
  }
  const trains = Object.values(state.trains);
  const status = {
    updatedAt: cycle.at,
    ok: cycle.ok,
    error: cycle.error || null,
    lastDrain: { frames: cycle.frames ?? 0, messages: cycle.messages ?? 0, bytes: cycle.bytes ?? 0, ms: cycle.ms ?? 0 },
    trains: trains.length,
    withDelay: trains.filter((t) => t.delay !== undefined).length,
    activated: trains.filter((t) => t.uid).length,
    canceled: trains.filter((t) => t.canceled).length,
    published: updates.length,
    totals: state.counts,
  };
  await env.LIVE.put("uk/rt/status.json", JSON.stringify(status), {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=10" },
  });
  return status;
}

