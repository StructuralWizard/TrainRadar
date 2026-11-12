// The UK ingest Worker's minute (plan 3, phase 3c), without Cloudflare
// imports so it runs in Node tests: drain TRUST, update the trains, write
// uk/rt/trip_updates.pb and uk/rt/status.json to the live bucket.

import { OLD_SUBSCRIPTIONS, drain, removeSubscription } from "./drain.js";
import { applyMessage, expire, tripUpdates } from "./trust.js";
import { encodeTripUpdates } from "./gtfsrt.js";
import { refreshIncidents } from "./kb.js";

export const CYCLE_MS = 60_000;
export const CACHE = "public, max-age=30";

/** One minute's work, with the I/O injected (tests run it in Node). */
export async function runCycle({ state, env, open, fetchFn = fetch, now = Date.now(), retryMs = 5000 }) {
  const cycle = { at: new Date(now).toISOString(), ok: true };
  const once = () =>
    drain({
      open,
      login: env.NETWORK_RAIL_USERNAME,
      passcode: env.NETWORK_RAIL_PASSWORD,
      onMessages: (list) => {
        for (const m of list) applyMessage(state, m, now);
      },
    });
  try {
    let r;
    try {
      r = await once();
    } catch (e) {
      // The broker still holding last minute's session (AMQ339009): once more.
      if (!/AMQ339009|session|client.?id/i.test(String(e?.message))) throw e;
      await new Promise((res) => setTimeout(res, retryMs));
      r = await once();
      cycle.retried = true;
    }
    Object.assign(cycle, r);
    state.failingSince = null;
  } catch (e) {
    cycle.ok = false;
    cycle.error = String(e?.message || e).slice(0, 300);
    state.failingSince ||= cycle.at;
  }
  expire(state, now);
  const updates = tripUpdates(state);
  if (cycle.ok) {
    state.feedLm = new Date(now).toUTCString();
    await env.LIVE.put("uk/rt/trip_updates.pb", encodeTripUpdates(updates, Math.round(now / 1000)), {
      httpMetadata: { contentType: "application/x-protobuf", cacheControl: CACHE },
    });
  }
  // Old durable subscriptions: removed once the broker lets us (at most every
  // 10 minutes each), so it stops queueing messages nobody reads.
  state.removed ||= [];
  for (const name of OLD_SUBSCRIPTIONS) {
    if (state.removed.includes(name) || now - (state.removeTriedAt || 0) < 10 * 60_000) continue;
    state.removeTriedAt = now;
    try {
      await removeSubscription({ open, login: env.NETWORK_RAIL_USERNAME, passcode: env.NETWORK_RAIL_PASSWORD, name });
      state.removed.push(name);
    } catch {
      // still held: next time
    }
  }
  // National Rail incidents, every few minutes (never stops the TRUST work).
  await refreshIncidents({ state, env, fetchFn, now }).catch(() => {});
  const trains = Object.values(state.trains);
  const status = {
    updatedAt: cycle.at,
    ok: cycle.ok,
    error: cycle.error || null,
    failingSince: state.failingSince || null,
    retried: !!cycle.retried,
    lastDrain: { frames: cycle.frames ?? 0, messages: cycle.messages ?? 0, bytes: cycle.bytes ?? 0, ms: cycle.ms ?? 0 },
    trains: trains.length,
    withDelay: trains.filter((t) => t.delay !== undefined).length,
    activated: trains.filter((t) => t.uid).length,
    canceled: trains.filter((t) => t.canceled).length,
    published: updates.length,
    totals: state.counts,
    incidents: state.kb || null,
    oldSubscriptionsRemoved: state.removed,
    // The same shape as Spain's poller status (backend/src/poller.js), so
    // the app's live mode reads the UK feed with the same code.
    feeds: {
      "trip_updates.pb": { ok: cycle.ok, fetchedAt: cycle.at, renfeLastModified: state.feedLm || null },
    },
  };
  await env.LIVE.put("uk/rt/status.json", JSON.stringify(status), {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=10" },
  });
  return status;
}

