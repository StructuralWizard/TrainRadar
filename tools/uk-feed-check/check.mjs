// Network Rail open data feed check (phase 3a): logs in with the
// maintainer's account (NETWORK_RAIL_USERNAME / NETWORK_RAIL_PASSWORD, from
// GitHub Actions secrets), listens to the live topics for a while and
// downloads the reference files, then writes:
//
//   report.md          — what arrived: rates, sizes, message types, fields
//   samples/*.json     — a few real messages and records of each kind
//
// Never prints the credentials. Usage:
//   node check.mjs --seconds 120 [--full-schedule] [--out DIR]
import net from "node:net";
import zlib from "node:zlib";
import readline from "node:readline";
import { Readable } from "node:stream";
import { mkdir, writeFile } from "node:fs/promises";
import { StompSession } from "../../backend-uk/src/stomp.js";

const HOST = "publicdatafeeds.networkrail.co.uk";
const STOMP_PORT = 61618;
const TOPICS = ["/topic/TRAIN_MVT_ALL_TOC", "/topic/VSTP_ALL", "/topic/TD_ALL_SIG_AREA"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : args[i + 1];
};
const seconds = Number(arg("seconds", "120"));
const out = arg("out", ".");
const fullSchedule = args.includes("--full-schedule");

const login = process.env.NETWORK_RAIL_USERNAME || "";
const passcode = process.env.NETWORK_RAIL_PASSWORD || "";
const report = [];
const say = (s = "") => report.push(s);
const fmtBytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${n} B`);

await mkdir(`${out}/samples`, { recursive: true });
const sample = (name, v) => writeFile(`${out}/samples/${name}.json`, JSON.stringify(v, null, 2));
// One shortened record of each kind, printed in the log (public data), so
// the formats can be read without downloading the artifact.
const shown = [];
const show = (label, v, max = 1500) => {
  const j = JSON.stringify(v);
  shown.push(`**${label}**`, "", "```json", j.length > max ? `${j.slice(0, max)} …(${j.length} chars)` : j, "```", "");
};

say("# Network Rail open data: feed check");
say();
say(`Run: ${new Date().toISOString()} · listening ${seconds} s · full schedule: ${fullSchedule ? "yes" : "no"}`);
say();
if (!login || !passcode) {
  say("**No credentials.** Add `NETWORK_RAIL_USERNAME` and `NETWORK_RAIL_PASSWORD` as repository **secrets** (Settings → Secrets and variables → Actions → Secrets; not Variables).");
  await finish(1);
}

// ---- Live topics (STOMP) ----
async function live() {
  say("## Live topics (STOMP)");
  say();
  const stats = new Map(); // topic → { frames, bytes, msgs, types: Map, kept: [] }
  const topicOf = (d) => TOPICS.find((t) => d.endsWith(t.split("/").pop())) || d;
  let firstAt = null;
  const sock = net.connect(STOMP_PORT, HOST);
  const opened = new Promise((resolve, reject) => {
    sock.once("connect", resolve);
    sock.once("error", reject);
    setTimeout(() => reject(new Error("TCP connect timed out")), 20_000);
  });
  const session = new StompSession(
    { write: (b) => sock.write(b), close: () => sock.end() },
    {
      onMessage: (f) => {
        firstAt ??= Date.now();
        const topic = topicOf(f.headers.destination || "");
        const s = stats.get(topic) || { frames: 0, bytes: 0, msgs: 0, types: new Map(), kept: [] };
        stats.set(topic, s);
        s.frames += 1;
        s.bytes += f.body.length;
        let items;
        try {
          items = JSON.parse(new TextDecoder().decode(f.body));
        } catch {
          items = [];
        }
        if (!Array.isArray(items)) items = [items];
        s.msgs += items.length;
        for (const m of items) {
          // TRUST: { header: { msg_type } }; TD: { CA_MSG: … }; VSTP: { VSTPCIFMsgV1: … }
          const type = m?.header?.msg_type || Object.keys(m || {})[0] || "?";
          s.types.set(type, (s.types.get(type) || 0) + 1);
          const same = s.kept.filter((k) => k.type === type).length;
          if (same < 3) s.kept.push({ type, message: m });
        }
      },
    },
  );
  sock.on("data", (d) => session.receive(new Uint8Array(d)));
  let dropped = null;
  sock.on("error", (e) => (dropped = e.message));
  sock.on("close", () => (dropped ??= firstAt ? null : "connection closed by the broker"));
  const t0 = Date.now();
  try {
    await opened;
    say(`- TCP ${HOST}:${STOMP_PORT}: connected in ${Date.now() - t0} ms`);
    const h = await session.connect({ host: HOST, login, passcode, heartbeat: "0,0" });
    say(`- Login: OK (broker: ${h.server || "?"}, STOMP ${h.version || "?"})`);
  } catch (e) {
    say(`- **Failed:** ${e.message}`);
    sock.destroy();
    return;
  }
  for (const t of TOPICS) session.subscribe(t);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  session.disconnect();
  if (dropped) say(`- **Connection ended early:** ${dropped}`);
  say(`- First message after ${firstAt ? ((firstAt - t0) / 1000).toFixed(1) : "—"} s`);
  say();
  say("| Topic | Frames | Messages | Messages/min | Bytes | Bytes/min |");
  say("|---|---:|---:|---:|---:|---:|");
  for (const t of TOPICS) {
    const s = stats.get(t);
    const per = (n) => Math.round((n * 60) / seconds);
    say(s ? `| ${t} | ${s.frames} | ${s.msgs} | ${per(s.msgs)} | ${fmtBytes(s.bytes)} | ${fmtBytes(per(s.bytes))} |` : `| ${t} | 0 | 0 | 0 | 0 | 0 |`);
  }
  say();
  for (const [t, s] of stats) {
    say(`**${t}** message types: ${[...s.types].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(", ")}`);
    say();
    await sample(t.split("/").pop(), s.kept);
    const seenTypes = new Set();
    for (const k of s.kept) if (!seenTypes.has(k.type)) seenTypes.add(k.type), show(`${t} ${k.type}`, k.message, 1200);
  }
  // TRUST movements (0003): which fields carry the delay.
  const trust = stats.get("/topic/TRAIN_MVT_ALL_TOC");
  const mv = trust?.kept.find((k) => k.type === "0003")?.message?.body;
  if (mv) say(`TRUST movement fields: \`${Object.keys(mv).join("`, `")}\``), say();
}

// ---- Files over HTTPS (basic auth; they redirect to a signed download) ----
async function download(label, url, { lines = false, keep = 3 } = {}) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, { headers: { authorization: `Basic ${Buffer.from(`${login}:${passcode}`).toString("base64")}` }, redirect: "follow" });
  } catch (e) {
    say(`| ${label} | **error**: ${e.message} | | | |`);
    return;
  }
  if (!res.ok) {
    say(`| ${label} | **HTTP ${res.status}** | | | |`);
    await res.body?.cancel();
    return;
  }
  let gz = 0;
  const counted = new Readable({ read() {} });
  const reader = res.body.getReader();
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return counted.push(null);
      gz += value.length;
      counted.push(value);
    }
  })();
  const unzipped = counted.pipe(zlib.createGunzip());
  let raw = 0;
  const kinds = new Map();
  const kept = new Map();
  const statuses = new Map(); // train_status/STP indicator → count
  if (lines) {
    // Schedule: one JSON object per line, keyed by record type.
    const rl = readline.createInterface({ input: unzipped, crlfDelay: Infinity });
    for await (const line of rl) {
      raw += line.length + 1;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const k = Object.keys(o)[0];
      kinds.set(k, (kinds.get(k) || 0) + 1);
      const list = kept.get(k) || [];
      if (list.length < keep) list.push(o), kept.set(k, list);
      // A passenger train with public times, and one STP overlay / cancellation.
      const sch = o.JsonScheduleV1;
      if (sch) {
        const tag = sch.train_status === "P" && sch.CIF_stp_indicator === "P" ? "passenger" : ["O", "C", "N"].includes(sch.CIF_stp_indicator) ? `stp-${sch.CIF_stp_indicator}` : null;
        if (tag && !kept.has(`JsonScheduleV1:${tag}`)) kept.set(`JsonScheduleV1:${tag}`, [o]);
        statuses.set(`${sch.train_status}/${sch.CIF_stp_indicator}`, (statuses.get(`${sch.train_status}/${sch.CIF_stp_indicator}`) || 0) + 1);
      }
    }
    if (statuses.size) (statusLine = [...statuses].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(", "));
  } else {
    const chunks = [];
    for await (const c of unzipped) chunks.push(c), (raw += c.length);
    const doc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    for (const [k, v] of Object.entries(doc)) {
      kinds.set(k, Array.isArray(v) ? v.length : 1);
      kept.set(k, Array.isArray(v) ? v.slice(0, keep * 3) : v);
    }
  }
  await sample(label.replace(/\W+/g, "-").toLowerCase(), Object.fromEntries(kept));
  if (!label.startsWith("SCHEDULE full")) {
    for (const [k, v] of kept) show(`${label}: ${k}`, Array.isArray(v) ? v.slice(0, k.startsWith("JsonScheduleV1:") ? 1 : 2) : v, k === "JsonScheduleV1:passenger" ? 6000 : 1500);
  }
  say(`| ${label} | OK | ${fmtBytes(gz)} | ${fmtBytes(raw)} | ${[...kinds].map(([k, n]) => `${k} ×${n}`).join(", ")} (${((Date.now() - t0) / 1000).toFixed(0)} s) |`);
}

let statusLine = "";

async function files() {
  say("## Reference files (HTTPS)");
  say();
  say("| File | Result | Download (gzip) | Uncompressed | Records |");
  say("|---|---|---:|---:|---|");
  const base = `https://${HOST}/ntrod`;
  // Yesterday's daily update (published early each morning, UK time).
  const day = DAYS[new Date(Date.now() - 86_400_000).getUTCDay()];
  await download(`SCHEDULE update (${day})`, `${base}/CifFileAuthenticate?type=CIF_ALL_UPDATE_DAILY&day=toc-update-${day}`, { lines: true });
  if (fullSchedule) await download("SCHEDULE full", `${base}/CifFileAuthenticate?type=CIF_ALL_FULL_DAILY&day=toc-full`, { lines: true });
  await download("CORPUS", `${base}/SupportingFileAuthenticate?type=CORPUS`);
  await download("SMART", `${base}/SupportingFileAuthenticate?type=SMART`);
  say();
  if (statusLine) say(`Schedules by train_status/STP indicator (last file read): ${statusLine}`), say();
}

// ---- NaPTAN (public): station coordinates by TIPLOC ----
async function naptan() {
  say("## NaPTAN (public)");
  say();
  const url = "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv";
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    return say(`- **error**: ${e.message}`), say();
  }
  if (!res.ok) return say(`- **HTTP ${res.status}**`), say();
  const rl = readline.createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity });
  let header = null;
  let rows = 0;
  let bytes = 0;
  const types = new Map();
  const rail = [];
  const split = (l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  for await (const line of rl) {
    bytes += line.length + 1;
    if (!header) {
      header = split(line);
      continue;
    }
    rows += 1;
    const r = split(line);
    const type = r[header.indexOf("StopType")];
    types.set(type, (types.get(type) || 0) + 1);
    if (type === "RLY" && rail.length < 3) rail.push(Object.fromEntries(header.map((h, i) => [h, r[i]])));
  }
  say(`- ${rows} rows, ${fmtBytes(bytes)}; rail stops (RLY): ${types.get("RLY") || 0}, entrances (RSE): ${types.get("RSE") || 0}, platforms (RPL): ${types.get("RPL") || 0}`);
  say(`- Columns: \`${(header || []).join("`, `")}\``);
  say();
  show("NaPTAN RLY rows", rail, 3000);
}

// ---- Durable subscription (Artemis): messages kept while disconnected ----
async function durable() {
  say("## Durable subscription");
  say();
  const name = "trainradar-feedcheck";
  const open = async (onMessage) => {
    const sock = net.connect(STOMP_PORT, HOST);
    await new Promise((resolve, reject) => {
      sock.once("connect", resolve);
      sock.once("error", reject);
    });
    sock.on("error", () => {});
    const session = new StompSession({ write: (b) => sock.write(b), close: () => sock.end() }, { onMessage });
    sock.on("data", (d) => session.receive(new Uint8Array(d)));
    await session.connect({ host: HOST, login, passcode, extra: { "client-id": name } });
    return session;
  };
  const headers = { "durable-subscription-name": name, "activemq.subscriptionName": name };
  try {
    let n1 = 0;
    const a = await open(() => n1++);
    const id = a.subscribe("/topic/TRAIN_MVT_ALL_TOC", headers);
    await new Promise((r) => setTimeout(r, 5000));
    a.disconnect();
    await new Promise((r) => setTimeout(r, 30_000)); // away for 30 s
    let n2 = 0;
    const t0 = Date.now();
    let firstBurst = 0;
    const b = await open(() => (n2++, Date.now() - t0 < 1500 && firstBurst++));
    b.subscribe("/topic/TRAIN_MVT_ALL_TOC", headers);
    await new Promise((r) => setTimeout(r, 3000));
    // Remove the subscription so the broker doesn't keep queueing for it.
    b.unsubscribe(id, headers);
    await new Promise((r) => setTimeout(r, 500));
    b.disconnect();
    say(`- First 5 s: ${n1} frames. After 30 s away: ${firstBurst} frames in the first 1.5 s, ${n2} in 3 s.`);
    say(`- ${firstBurst >= 5 ? "**Kept while away**: durable subscriptions work (client-id + durable-subscription-name)." : "Nothing queued while away: durable subscriptions may not be allowed; plan B is a connection held open."}`);
  } catch (e) {
    say(`- **Failed:** ${e.message}`);
  }
  say();
}

async function finish(code = 0) {
  if (shown.length) say("## Samples (shortened)"), say(), report.push(...shown);
  const md = report.join("\n");
  // Belt and braces: the report must never contain the credentials.
  for (const s of [login, passcode]) if (s && s.length > 3 && md.includes(s)) throw new Error("report would contain a credential");
  await writeFile(`${out}/report.md`, md + "\n");
  console.log(md);
  process.exit(code);
}

await live();
await durable();
await files();
await naptan();
await finish(0);
