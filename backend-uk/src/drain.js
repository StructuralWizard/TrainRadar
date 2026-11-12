// One drain of Network Rail's durable subscription (plan 3, decision 1):
// connect, log in with a fixed client-id, subscribe durably, read what the
// broker queued since last time until it goes quiet, disconnect. The broker
// keeps queueing while we're away (measured: docs/data-sources-uk.md).
//
// `open()` returns a transport { write(bytes): Promise, read(): Promise<{
// value, done }>, close() }: Cloudflare's connect() socket in the Worker, a
// Node socket or a fake in tests.

import { StompSession } from "./stomp.js";

export const HOST = "publicdatafeeds.networkrail.co.uk";
export const PORT = 61618;
export const TOPIC = "/topic/TRAIN_MVT_ALL_TOC";
/** Our durable subscription's name (and client-id): one per deployment.
 * "-2" since 2026-11-12: the first one's client-id was held by a connection
 * left open across a redeploy (no heart-beats then); see OLD_SUBSCRIPTIONS. */
export const SUBSCRIPTION = "trainradar-uk-2";
/** Earlier subscriptions to remove (the broker keeps queueing for them). */
export const OLD_SUBSCRIPTIONS = ["trainradar-uk"];
/** We promise a heart-beat this often, so the broker drops a connection we
 * lost (a restart mid-drain) within seconds, freeing our client-id. */
export const HEARTBEAT_MS = 5_000;
const LF = new Uint8Array([10]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns { frames, messages, bytes, ms, quiet }. `onMessages(list)` gets each
 * frame's JSON array. Stops when no frame arrived for `idleMs` (after the
 * first one, or `firstMs` if none comes), or after `maxMs`.
 */
export async function drain({ open, login, passcode, onMessages, maxMs = 25_000, idleMs = 2_500, firstMs = 6_000, name = SUBSCRIPTION, now = () => Date.now() }) {
  const t0 = now();
  const sock = await open();
  let frames = 0;
  let messages = 0;
  let bytes = 0;
  let last = 0;
  let closed = false;
  const session = new StompSession(
    { write: (b) => sock.write(b), close: () => sock.close() },
    {
      onMessage: (f) => {
        frames += 1;
        bytes += f.body.length;
        last = now();
        let list;
        try {
          list = JSON.parse(new TextDecoder().decode(f.body));
        } catch {
          return;
        }
        if (!Array.isArray(list)) list = [list];
        messages += list.length;
        onMessages(list);
      },
    },
  );
  // Read in the background; frames are handled as they arrive.
  const pump = (async () => {
    for (;;) {
      const { value, done } = await sock.read();
      if (done) break;
      session.receive(value instanceof Uint8Array ? value : new Uint8Array(value));
    }
    closed = true;
  })().catch(() => {
    closed = true;
  });
  // Heart-beats (a bare newline) for as long as we're connected.
  const beat = setInterval(() => {
    if (!closed) Promise.resolve(sock.write(LF)).catch(() => {});
  }, HEARTBEAT_MS);
  try {
    await Promise.race([
      session.connect({ host: HOST, login, passcode, heartbeat: `${HEARTBEAT_MS},0`, extra: { "client-id": name } }),
      sleep(15_000).then(() => {
        throw new Error("STOMP login timed out");
      }),
    ]);
    session.subscribe(TOPIC, { "durable-subscription-name": name, "activemq.subscriptionName": name });
    for (;;) {
      await sleep(250);
      const t = now();
      if (closed || t - t0 > maxMs) break;
      if (last ? t - last > idleMs : t - t0 > firstMs) break;
    }
  } finally {
    clearInterval(beat);
    session.disconnect();
    // Wait for the connection to close, so the broker has let go of our
    // client-id before the next minute's login (else AMQ339009).
    await Promise.race([Promise.all([pump, sock.closed || Promise.resolve()]), sleep(5000)]);
  }
  return { frames, messages, bytes, ms: now() - t0, quiet: !closed && now() - t0 <= maxMs + 1000 };
}

/**
 * Remove an old durable subscription: log in with its client-id, subscribe
 * and unsubscribe with its name (Artemis then deletes it), disconnect.
 * Throws if the broker refuses (its client-id may still be held).
 */
export async function removeSubscription({ open, login, passcode, name }) {
  const sock = await open();
  const session = new StompSession({ write: (b) => sock.write(b), close: () => sock.close() });
  const pump = (async () => {
    for (;;) {
      const { value, done } = await sock.read();
      if (done) break;
      session.receive(value instanceof Uint8Array ? value : new Uint8Array(value));
    }
  })().catch(() => {});
  try {
    await Promise.race([
      session.connect({ host: HOST, login, passcode, heartbeat: `${HEARTBEAT_MS},0`, extra: { "client-id": name } }),
      sleep(15_000).then(() => {
        throw new Error("STOMP login timed out");
      }),
    ]);
    const headers = { "durable-subscription-name": name, "activemq.subscriptionName": name };
    const id = session.subscribe(TOPIC, headers);
    session.unsubscribe(id, headers);
    await sleep(500);
  } finally {
    session.disconnect();
    await Promise.race([Promise.all([pump, sock.closed || Promise.resolve()]), sleep(3000)]);
  }
}
