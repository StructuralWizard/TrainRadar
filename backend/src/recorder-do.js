// The recorder's Durable Object: one instance ("main") keeps the engine in
// memory and records every minute on its own alarm, separately from the
// poller, so a recorder problem can never stop the feeds. The engine is the
// app's WebAssembly build (web/pkg, built by tools/build-wasm.sh).

import wasmModule from "../../web/pkg/engine_bg.wasm";
import { Engine, initSync } from "../../web/pkg/engine.js";
import { dailyJob } from "./history.js";
import { CYCLE_MS, RecorderCore } from "./recorder.js";

let ready = false;
function makeEngine() {
  if (!ready) {
    initSync({ module: wasmModule });
    ready = true;
  }
  return new Engine();
}

export class Recorder {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.core = new RecorderCore({ makeEngine, storage: state.storage, env });
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/ensure") {
      if (this.core.enabled() && (await this.state.storage.getAlarm()) === null) {
        await this.state.storage.setAlarm(Date.now() + 1000);
        return new Response("armed");
      }
      return new Response(this.core.enabled() ? "running" : "disabled");
    }
    if (path === "/daily") {
      if (!this.env.HISTORY || !this.env.ARCHIVE) return new Response("no database", { status: 503 });
      const out = await dailyJob(this.env.HISTORY, this.env.ARCHIVE, Date.now());
      await this.state.storage.put("db", { ...out.db, at: new Date().toISOString() });
      await this.state.storage.put("daily", out);
      return Response.json(out);
    }
    if (path === "/status") {
      return Response.json({
        enabled: this.core.enabled(),
        active: this.core.engine?.recorderActive() ?? null,
        cycles: this.core.cycles,
        totals: this.core.totals,
        daily: (await this.state.storage.get("daily")) || null,
      });
    }
    return new Response("not found", { status: 404 });
  }

  async alarm() {
    if (!this.core.enabled()) {
      await this.core.save();
      return; // not re-armed: the cron's /ensure re-arms once enabled
    }
    const started = Date.now();
    await this.core.cycle(started);
    await this.state.storage.setAlarm(Math.max(started + CYCLE_MS, Date.now() + 1000));
  }
}
