// TrainRadar UK ingest Worker (plan 3, phase 3c). Separate from Spain's
// backend/ so a UK problem never touches Renfe's poller or recorder.
//
// A Durable Object alarm, every minute: drain Network Rail's durable TRUST
// subscription (drain.js), update each train's delay (trust.js), and write to
// the shared live bucket, served from the same live domain as Spain's:
//   uk/rt/trip_updates.pb   GTFS-Realtime TripUpdates (gtfsrt.js)
//   uk/rt/status.json       health: last drain, counts, errors
// A cron (every minute) re-arms the alarm if it ever died. UK_ENABLED is
// the kill switch. The login comes from Worker secrets.

import { connect } from "cloudflare:sockets";
import { HOST, PORT } from "./drain.js";
import { emptyState } from "./trust.js";
import { CYCLE_MS, runCycle } from "./cycle.js";
/** Trains per storage key (Durable Object values are size-limited). */
const CHUNK = 400;

function workersOpen() {
  const s = connect({ hostname: HOST, port: PORT });
  const writer = s.writable.getWriter();
  const reader = s.readable.getReader();
  return {
    write: (b) => writer.write(b),
    read: () => reader.read(),
    close: () => {
      writer.close().catch(() => {});
      s.close().catch(() => {});
    },
  };
}

export class UkIngest {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  enabled() {
    return this.env.UK_ENABLED === "true" && !!this.env.NETWORK_RAIL_USERNAME && !!this.env.NETWORK_RAIL_PASSWORD;
  }

  async load() {
    const meta = (await this.ctx.storage.get("meta")) || { chunks: 0, counts: emptyState().counts };
    const state = { trains: {}, counts: meta.counts };
    for (let i = 0; i < meta.chunks; i++) {
      for (const t of (await this.ctx.storage.get(`trains:${i}`)) || []) state.trains[t.id] = t;
    }
    return { state, meta };
  }

  async save(state, meta) {
    const list = Object.values(state.trains);
    const chunks = Math.ceil(list.length / CHUNK);
    const puts = { meta: { chunks, counts: state.counts } };
    for (let i = 0; i < chunks; i++) puts[`trains:${i}`] = list.slice(i * CHUNK, (i + 1) * CHUNK);
    await this.ctx.storage.put(puts);
    for (let i = chunks; i < meta.chunks; i++) await this.ctx.storage.delete(`trains:${i}`);
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/ensure") {
      if (this.enabled() && (await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        return new Response("armed");
      }
      return new Response(this.enabled() ? "running" : "disabled");
    }
    return new Response("not found", { status: 404 });
  }

  async alarm() {
    if (!this.enabled()) return;
    const started = Date.now();
    const { state, meta } = await this.load();
    await runCycle({ state, env: this.env, open: workersOpen, now: started });
    await this.save(state, meta);
    await this.ctx.storage.setAlarm(started + CYCLE_MS);
  }
}

export default {
  async fetch() {
    // Data is read from the bucket's live domain, not through this Worker.
    return new Response("TrainRadar UK ingest", { status: 404 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(env.UK_INGEST.get(env.UK_INGEST.idFromName("main")).fetch("https://uk/ensure"));
  },
};
