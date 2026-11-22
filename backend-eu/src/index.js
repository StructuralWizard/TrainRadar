// TrainRadar Europe ingest (docs/plan-europe.md A5). One Durable Object per
// country feed, each with its own timer, back-off and status, so a failing
// feed never touches another. For now: Ireland (the NTA's GTFS-Realtime,
// filtered to Iarnród Éireann) → ie/rt/ in the shared live bucket.
// IE_ENABLED is the kill switch; IE_NTA_API_KEY is a Worker secret.

import { CYCLE_MS, emptyState, runCycle } from "./cycle.js";

export class FeedIngest {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  enabled() {
    return this.env.IE_ENABLED === "true" && !!this.env.IE_NTA_API_KEY;
  }

  async fetch(request) {
    if (new URL(request.url).pathname !== "/ensure") return new Response("not found", { status: 404 });
    if (this.enabled() && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return new Response("armed");
    }
    return new Response(this.enabled() ? "running" : "disabled");
  }

  async alarm() {
    if (!this.enabled()) return;
    const started = Date.now();
    const state = (await this.ctx.storage.get("state")) || emptyState();
    try {
      await runCycle({ state, env: this.env, now: started });
    } finally {
      await this.ctx.storage.put("state", state);
      await this.ctx.storage.setAlarm(started + CYCLE_MS);
    }
  }
}

export default {
  // Every minute: re-arm Ireland's alarm in case it ever stopped.
  async scheduled(_event, env) {
    const stub = env.FEED_INGEST.get(env.FEED_INGEST.idFromName("ie"));
    await stub.fetch("https://ingest/ensure");
  },
  async fetch() {
    return new Response("TrainRadar Europe ingest: see ie/rt/status.json on the live domain.\n");
  },
};
