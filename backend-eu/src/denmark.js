// Denmark: Rejsekort & Rejseplan's SIRI Estimated Timetable on the national
// access point (Dataudveksleren, run by Vejdirektoratet), one Azure Service
// Bus topic per operator (tools/dk/topics.json). The access point pushes
// over AMQP; a Worker can't hold that connection, so it uses Service Bus's
// HTTPS receive instead (peek-lock, then complete), one topic per cycle, in
// turn. Each message updates journeys; a journey state per topic (kept in
// R2 between cold starts) becomes that topic's trip updates, and all topics'
// together make trip_updates.pb.
//
// Login: Microsoft Entra ID client credentials. The secret
// (DK_NAP_CLIENT_SECRET, AGENTS.md) goes only in the body of the token
// request; a refused login stops the country (a lost secret can't be
// recovered: a new service account is needed), it isn't retried in a loop.
// There are no GPS positions; updates start about an hour before each
// departure, so silence at night is normal, not a failure.

import topics from "../../tools/dk/topics.json" with { type: "json" };
import { JourneyState, parseSiriEt } from "./siri.js";
import { tripUpdatesFeed } from "./encode.js";

const TENANT = "f1044067-8c60-4022-98d8-69306c5f7238";
const CLIENT_ID = "a63b12fe-eeae-489c-b1ca-be8a135289f5";
const SCOPE = "https://servicebus.azure.net/.default";
/** At most this many messages per topic per cycle, so a cycle stays short. */
const MAX_MESSAGES = 60;
/** Receives in flight at once. */
const PARALLEL = 6;

let token = { value: null, until: 0 };
export const resetToken = () => (token = { value: null, until: 0 });

/** A login the access point refused: stop, don't retry. */
export class AuthError extends Error {
  constructor(status) {
    super(`login refused (HTTP ${status}): DK_NAP_CLIENT_SECRET is wrong or lost; a new service account is needed`);
    this.fatal = true;
  }
}

export async function serviceBusToken(env, fetchFn, now) {
  if (token.value && now < token.until - 60_000) return token.value;
  const tenant = env.DK_NAP_TENANT_ID || TENANT;
  const body = new URLSearchParams({
    client_id: env.DK_NAP_CLIENT_ID || CLIENT_ID,
    client_secret: env.DK_NAP_CLIENT_SECRET,
    scope: SCOPE,
    grant_type: "client_credentials",
  });
  const r = await fetchFn(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) throw new Error(`login: HTTP ${r.status}`);
  const j = await r.json();
  token = { value: j.access_token, until: now + (j.expires_in || 3600) * 1000 };
  return token.value;
}

/** One topic's journeys, in memory and in R2 (`dk/rt/state-<dataset>.json`). */
const states = new Map();
async function stateFor(env, dataset) {
  if (states.has(dataset)) return states.get(dataset);
  const o = await env.LIVE.get(`dk/rt/state-${dataset}.json`);
  const st = JourneyState.from(o ? JSON.parse(await o.text()) : []);
  states.set(dataset, st);
  return st;
}
export const resetStates = () => states.clear();

/** Receive up to MAX_MESSAGES from a topic's subscription over HTTPS and
 * merge them; returns { messages, journeys, expired }. */
export async function receiveTopic(topic, { env, fetchFn, now }) {
  const auth = { authorization: `Bearer ${await serviceBusToken(env, fetchFn, now)}` };
  const base = `https://${topics.namespace}/${topic.topic}/subscriptions/${topic.subscription}/messages`;
  const st = await stateFor(env, topic.dataset);
  let messages = 0;
  let journeys = 0;
  let empty = false;
  while (!empty && messages < MAX_MESSAGES) {
    const round = await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        const r = await fetchFn(`${base}/head?timeout=1`, { method: "POST", headers: auth });
        if (r.status === 204) return null; // nothing waiting
        // The bus refusing a token we hold: get a new one next cycle (a
        // refused login, above, is what stops the country).
        if (r.status === 401) resetToken();
        if (r.status !== 201) throw new Error(`${topic.topic}: receive HTTP ${r.status}`);
        const props = JSON.parse(r.headers.get("brokerproperties") || "{}");
        const xml = await r.text();
        const parsed = parseSiriEt(xml);
        // Completed once read: a message that can't be parsed won't parse
        // next time either.
        const del = await fetchFn(`${base}/${encodeURIComponent(props.MessageId)}/${props.LockToken}`, { method: "DELETE", headers: auth });
        if (!del.ok && del.status !== 404) throw new Error(`${topic.topic}: complete HTTP ${del.status}`);
        return parsed;
      }),
    );
    for (const p of round) {
      if (p === null) {
        empty = true;
        continue;
      }
      messages++;
      journeys += st.apply(p, now);
    }
  }
  const expired = st.expire(now);
  await env.LIVE.put(`dk/rt/state-${topic.dataset}.json`, JSON.stringify(st), {
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
  });
  return { messages, journeys, expired, kept: st.journeys.size, st };
}

const feeds = topics.topics.map((t) => ({
  name: `tu_${t.dataset}.pb`,
  path: t.topic,
  part: "trip_updates.pb",
  topic: t,
  produce: async (ctx) => {
    const r = await receiveTopic(t, ctx);
    console.log(JSON.stringify({ country: "dk", topic: t.topic, operator: t.operator, messages: r.messages, journeys: r.journeys, expired: r.expired, kept: r.kept }));
    return { bytes: tripUpdatesFeed(r.st.tripUpdates(), Math.floor(ctx.now / 1000)), messages: r.messages };
  },
}));

export const DK = {
  code: "dk",
  prefix: "dk/rt/",
  base: `https://${topics.namespace}/`,
  // A topic every 5 s: each about every 30 s.
  cycleMs: 5_000,
  rotate: true,
  feeds,
  parts: { "trip_updates.pb": feeds.map((f) => f.name) },
  source: "Rejsekort & Rejseplan A/S, SIRI-ET via Dataudveksleren (Vejdirektoratet), as GTFS-Realtime",
  // The Worker's DK_ENABLED is set from the GitHub variable DK_LIVE_ENABLED.
  enabled: (env) => env.DK_ENABLED === "true" && !!env.DK_NAP_CLIENT_SECRET,
  missing: (env) => (env.DK_NAP_CLIENT_SECRET ? null : "no client secret (DK_NAP_CLIENT_SECRET)"),
  headers: () => ({}),
  keep: () => null,
};
