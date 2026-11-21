// The UK ingest Worker's minute (plan 3, phase 3c), without Cloudflare
// imports so it runs in Node tests: drain TRUST, update the trains, write
// uk/rt/trip_updates.pb and uk/rt/status.json to the live bucket.

import { OLD_SUBSCRIPTIONS, drain, removeSubscription } from "./drain.js";
import { applyMessage, expire, tripUpdates } from "./trust.js";
import { encodeTripUpdates } from "./gtfsrt.js";
import { refreshIncidents } from "./kb.js";

export const CYCLE_MS = 60_000;
export const CACHE = "public, max-age=30";
/**
 * After a failed login, wait before the next one: 1, 2, 4… minutes, at most
 * an hour. Network Rail's broker answers AMQ339009 to accounts it is
 * blocking, and logging in again every minute (9 days of it in Nov 2026)
 * may keep the block going (openraildata-talk: "exponential backoff on
 * your reconnection policy is key").
 */
export const BACKOFF_MAX_MS = 60 * 60_000;
export function backoffMs(failures) {
  return Math.min(BACKOFF_MAX_MS, CYCLE_MS * 2 ** Math.max(0, failures - 1));
}

/** One minute's work, with the I/O injected (tests run it in Node). */
export async function runCycle({ state, env, open, fetchFn = fetch, now = Date.now() }) {
  const cycle = { at: new Date(now).toISOString(), ok: true };
  // Backing off after failed logins: no login this minute (the notices and
  // the status still update).
  const waiting = !!state.nextLoginAt && now < state.nextLoginAt;
  const once = () =>
    drain({
      open,
      login: env.NETWORK_RAIL_USERNAME,
      passcode: env.NETWORK_RAIL_PASSWORD,
      onMessages: (list) => {
        for (const m of list) applyMessage(state, m, now);
      },
    });
  if (!waiting) state.lastLoginAt = cycle.at;
  if (waiting) {
    cycle.ok = false;
    cycle.skipped = true;
    cycle.error = state.lastError || "backing off";
  } else {
    try {
      Object.assign(cycle, await once());
      state.failingSince = null;
      state.failures = 0;
      state.nextLoginAt = null;
      state.lastError = null;
    } catch (e) {
      cycle.ok = false;
      cycle.error = String(e?.message || e).slice(0, 300);
      state.failingSince ||= cycle.at;
      state.failures = (state.failures || 0) + 1;
      state.nextLoginAt = now + backoffMs(state.failures);
      state.lastError = cycle.error;
    }
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
  // 10 minutes each, and not while backing off), so it stops queueing
  // messages nobody reads.
  state.removed ||= [];
  for (const name of OLD_SUBSCRIPTIONS) {
    if (!cycle.ok || state.removed.includes(name) || now - (state.removeTriedAt || 0) < 10 * 60_000) continue;
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
    // Backing off: how many logins failed in a row, and when the next one is.
    failures: state.failures || 0,
    nextLoginAt: state.nextLoginAt ? new Date(state.nextLoginAt).toISOString() : null,
    skipped: !!cycle.skipped,
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
      "trip_updates.pb": { ok: cycle.ok, fetchedAt: cycle.skipped ? state.lastLoginAt || null : cycle.at, renfeLastModified: state.feedLm || null },
    },
  };
  await env.LIVE.put("uk/rt/status.json", JSON.stringify(status), {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=10" },
  });
  return status;
}

