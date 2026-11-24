// Denmark spike: receive a few messages from one Dataudveksleren topic and
// save them raw, to see the real SIRI-ET before writing the parser.
//
//   DK_NAP_CLIENT_SECRET=… node tools/dk/spike.mjs [DATASET=785] [COUNT=10] [OUT=samples/dk]
//
// Two ways in, both tried:
//  1. AMQP (@azure/service-bus), as the access point intends;
//  2. Service Bus's HTTPS REST receive (one message per call), which a
//     Cloudflare Worker could use; it reports whether that works too.
// Messages are completed (acknowledged) once saved. The secret comes from
// the environment and is never printed; an authentication failure stops at
// once (a lost secret can't be recovered: a new service account is needed).

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { ClientSecretCredential } from "@azure/identity";
import { ServiceBusClient } from "@azure/service-bus";

const cfg = JSON.parse(readFileSync(new URL("./topics.json", import.meta.url), "utf8"));
const [dataset = "785", count = "10", out = "samples/dk"] = process.argv.slice(2);
const topic = cfg.topics.find((t) => String(t.dataset) === String(dataset));
if (!topic) throw new Error(`no dataset ${dataset} in topics.json`);

const tenant = process.env.DK_NAP_TENANT_ID || "f1044067-8c60-4022-98d8-69306c5f7238";
const client = process.env.DK_NAP_CLIENT_ID || "a63b12fe-eeae-489c-b1ca-be8a135289f5";
const secret = process.env.DK_NAP_CLIENT_SECRET;
if (!secret) {
  console.log("dk: DK_NAP_CLIENT_SECRET is not set: skipped.");
  process.exit(0);
}
const credential = new ClientSecretCredential(tenant, client, secret);
mkdirSync(out, { recursive: true });

/** The message body as text (the access point sends XML as bytes or a string). */
const text = (body) =>
  typeof body === "string" ? body : Buffer.isBuffer(body) || body instanceof Uint8Array ? Buffer.from(body).toString("utf8") : JSON.stringify(body);
const trim = (xml, n = 2500) => xml.replace(/>\s+</g, "><").slice(0, n);

// 0. The token: a wrong or lost secret fails here, once.
let token;
try {
  token = await credential.getToken("https://servicebus.azure.net/.default");
  console.log(`dk: Entra token ok (expires ${new Date(token.expiresOnTimestamp).toISOString()})`);
} catch (e) {
  console.log(`dk: AUTHENTICATION FAILED (${e.name}${e.statusCode ? ` ${e.statusCode}` : ""}). The secret is wrong or lost:`);
  console.log("dk: create a new service account (Profile → Service accounts) and re-associate it with the 6 datasets.");
  process.exit(3);
}

// 1. AMQP.
const want = Number(count);
const sb = new ServiceBusClient(cfg.namespace, credential);
const receiver = sb.createReceiver(topic.topic, topic.subscription, { receiveMode: "peekLock" });
const got = [];
const started = Date.now();
try {
  while (got.length < want && Date.now() - started < 180_000) {
    const batch = await receiver.receiveMessages(want - got.length, { maxWaitTimeInMs: 30_000 });
    for (const m of batch) {
      const xml = text(m.body);
      const n = got.length + 1;
      writeFileSync(`${out}/${topic.dataset}-${String(n).padStart(2, "0")}.xml`, xml);
      got.push({ id: m.messageId, size: xml.length, contentType: m.contentType, subject: m.subject, enqueued: m.enqueuedTimeUtc, props: m.applicationProperties });
      await receiver.completeMessage(m);
    }
    if (!batch.length) console.log(`dk: amqp: nothing in 30 s (${got.length} so far)`);
  }
} catch (e) {
  console.log(`dk: amqp error: ${e.name} ${e.code || ""} ${String(e.message).slice(0, 200)}`);
} finally {
  await receiver.close();
  await sb.close();
}
console.log(`dk: amqp: ${got.length} messages from ${topic.topic} (${topic.operator}) in ${Math.round((Date.now() - started) / 1000)} s`);
for (const g of got) console.log(`dk:   ${g.id} ${g.size} bytes, type ${g.contentType || "-"}, subject ${g.subject || "-"}, enqueued ${g.enqueued?.toISOString?.() || g.enqueued}, props ${JSON.stringify(g.props || {})}`);

// 2. HTTPS REST receive (peek-lock, then complete), three messages.
const base = `https://${cfg.namespace}/${topic.topic}/subscriptions/${topic.subscription}/messages`;
const auth = { authorization: `Bearer ${(await credential.getToken("https://servicebus.azure.net/.default")).token}` };
for (let i = 0; i < 3; i++) {
  const r = await fetch(`${base}/head?timeout=30`, { method: "POST", headers: auth });
  if (r.status !== 201) {
    console.log(`dk: rest: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    break;
  }
  const props = JSON.parse(r.headers.get("brokerproperties") || "{}");
  const xml = await r.text();
  writeFileSync(`${out}/${topic.dataset}-rest-${i + 1}.xml`, xml);
  const del = await fetch(`${base}/${encodeURIComponent(props.MessageId)}/${props.LockToken}`, { method: "DELETE", headers: auth });
  console.log(`dk: rest: message ${props.MessageId}, ${xml.length} bytes, completed: HTTP ${del.status}`);
}

if (got.length) {
  const first = readFileSync(`${out}/${topic.dataset}-01.xml`, "utf8");
  console.log("dk: first message, trimmed:");
  console.log(trim(first));
}
