// TrainRadar Europe ingest (docs/plan-europe.md A5). One Durable Object per
// country, each with its own timer, back-off and status, so a failing feed
// never touches another:
// - Ireland: the NTA's GTFS-Realtime, filtered to Iarnród Éireann → ie/rt/
//   (IE_ENABLED, and the Worker secret IE_NTA_API_KEY);
// - France: SNCF's GTFS-Realtime → fr/rt/ (FR_ENABLED; no key);
// - Finland (FI_ENABLED), Norway (NO_ENABLED) and the Netherlands
//   (NL_ENABLED): open GTFS-Realtime, no key → fi/rt/, no/rt/, nl/rt/.
// - Switzerland (CH_ENABLED, Worker secrets CH_OTD_GTFSRT_KEY,
//   CH_OTD_GTFSSA_KEY, CH_OTD_GTFSSA_PLANNED_KEY) → ch/rt/;
// - Poland (PL_ENABLED, Worker secret PL_PLK_API_KEY): PLK's live running,
//   turned into GTFS-Realtime → pl/rt/.
// - Sweden (SE_ENABLED, Worker secret SE_TRAFIKLAB_RT_KEY): Trafiklab's
//   regional feeds, kept to our trains → se/rt/.
// - Czechia (CZ_ENABLED; no key): Golemio's PID feeds, kept to trains → cz/rt/.
// - Denmark (DK_ENABLED, Worker secret DK_NAP_CLIENT_SECRET): Rejseplanen's
//   SIRI-ET from the national access point's Service Bus → dk/rt/.
// - Germany (DE_ENABLED, Worker secrets DE_DB_CLIENT_ID, DE_DB_API_KEY):
//   DB's OpenBoards station boards, merged into trip updates → de/rt/.
// - Belgium (BE_ENABLED, Worker secret BE_SNCB_KEY): SNCB's GTFS-Realtime
//   trip updates and alerts → be/rt/.
// - New South Wales (AU_ENABLED, Worker secret AU_NSW_API_KEY): Transport for
//   NSW's GPS, trip updates and alerts → au/rt/.
// - New Zealand (NZ_ENABLED, Worker secrets NZ_METLINK_API_KEY, NZ_AT_API_KEY):
//   Metlink's and Auckland Transport's GPS, trip updates and alerts, kept to
//   trains → nz/rt/.
// - Singapore (SG_ENABLED, Worker secret SG_LTA_ACCOUNT_KEY): LTA DataMall's
//   train service alerts → sg/rt/ (its trains are estimated, no live data).
// - Japan (JP_ENABLED, no key): Toei's GTFS-Realtime from ODPT's public API
//   → jp/rt/.
// Each *_ENABLED variable is that country's kill switch.

import { emptyState, runCycle } from "./cycle.js";
import { CH, PL } from "./central.js";
import { FR } from "./france.js";
import { IE } from "./ireland.js";
import { SE } from "./sweden.js";
import { CZ } from "./czechia.js";
import { DK } from "./denmark.js";
import { DE } from "./germany.js";
import { BE } from "./belgium.js";
import { AU } from "./australia.js";
import { NZ } from "./newzealand.js";
import { SG } from "./singapore.js";
import { JP } from "./japan.js";
import { EVERY_MIN, writeWorld } from "./world.js";
import { FI, NL, NO } from "./nordic.js";

export const COUNTRIES = { ie: IE, fr: FR, fi: FI, no: NO, nl: NL, ch: CH, pl: PL, se: SE, cz: CZ, dk: DK, de: DE, be: BE, au: AU, nz: NZ, sg: SG, jp: JP };

export class FeedIngest {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  /** Which country this object serves: set by the first /ensure call. The
   * object made before France existed is Ireland's. */
  async country() {
    return COUNTRIES[(await this.ctx.storage.get("country")) || "ie"];
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/ensure") return new Response("not found", { status: 404 });
    const code = url.searchParams.get("c") || "ie";
    if (!COUNTRIES[code]) return new Response("unknown country", { status: 400 });
    await this.ctx.storage.put("country", code);
    const enabled = COUNTRIES[code].enabled(this.env);
    if (enabled && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return new Response("armed");
    }
    return new Response(enabled ? "running" : "disabled");
  }

  async alarm() {
    const country = await this.country();
    if (!country.enabled(this.env)) return;
    const started = Date.now();
    const state = (await this.ctx.storage.get("state")) || emptyState();
    try {
      await runCycle({ state, env: this.env, now: started, country });
    } finally {
      await this.ctx.storage.put("state", state);
      await this.ctx.storage.setAlarm(started + country.cycleMs);
    }
  }
}

export default {
  // Every minute: re-arm each enabled country's alarm in case it stopped.
  async scheduled(event, env) {
    for (const [code, country] of Object.entries(COUNTRIES)) {
      if (!country.enabled(env)) continue;
      const stub = env.FEED_INGEST.get(env.FEED_INGEST.idFromName(code));
      await stub.fetch(`https://ingest/ensure?c=${code}`);
    }
    // Every ten minutes: the world view's live counts (R2 reads only).
    const at = event?.scheduledTime ?? Date.now();
    if (new Date(at).getUTCMinutes() % EVERY_MIN === 0) await writeWorld(env, at);
  },
  async fetch() {
    return new Response("TrainRadar Europe ingest: see <country>/rt/status.json on the live domain (ie, fr, fi, no, nl, ch, pl, se).\n");
  },
};
