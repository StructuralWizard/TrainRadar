// Feed check: verifies, from a real browser on a different HTTPS origin,
// whether each Renfe endpoint is reachable with CORS, plus HTTPS, size,
// caching headers and how often the content actually changes.
//
// Usage: node check.mjs [--watch-seconds 180] > report.md
// Needs network access to the Renfe hosts (runs in GitHub Actions).

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const watchSeconds = Number(args[args.indexOf("--watch-seconds") + 1] || 0) || 0;
const cfg = JSON.parse(await readFile(new URL("./endpoints.json", import.meta.url)));
const ORIGIN = "https://trainradar-check.example";
const out = [];
const log = (s = "") => out.push(s);
const kb = (n) => (n == null ? "?" : `${(n / 1024).toFixed(1)} KB`);
const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

// 1. Server-side view: status, headers, size (Origin header set so the
//    server can answer with Access-Control-Allow-Origin if it supports CORS).
async function probe(url, method = "GET") {
  try {
    const r = await fetch(url, { method, headers: { Origin: ORIGIN }, redirect: "follow" });
    const body = method === "GET" ? Buffer.from(await r.arrayBuffer()) : null;
    const h = (k) => r.headers.get(k);
    return {
      status: r.status,
      finalUrl: r.url,
      type: h("content-type"),
      len: body ? body.length : Number(h("content-length")) || null,
      acao: h("access-control-allow-origin"),
      lastModified: h("last-modified"),
      cacheControl: h("cache-control"),
      etag: h("etag"),
      encoding: h("content-encoding"),
      body,
    };
  } catch (e) {
    return { error: String(e.cause?.code || e.message) };
  }
}

async function plainHttp(url) {
  const u = url.replace(/^https:/, "http:");
  try {
    const r = await fetch(u, { method: "HEAD", redirect: "manual" });
    return `${r.status}${r.headers.get("location") ? " → " + r.headers.get("location") : ""}`;
  } catch (e) {
    return `error ${e.cause?.code || e.message}`;
  }
}

// 2. Browser view: a page on a fake HTTPS origin calls fetch() exactly like
//    the web app would. A CORS or mixed-content block shows up as TypeError.
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(`${ORIGIN}/**`, (r) =>
  r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>check</title>" }),
);
await page.goto(`${ORIGIN}/`);
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

async function browserFetch(url) {
  return page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { cache: "no-store" });
      const b = await r.arrayBuffer();
      return { ok: true, status: r.status, len: b.byteLength };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  }, url);
}

log(`# Renfe feed check`);
log();
log(`Run at ${new Date().toISOString()} from page origin \`${ORIGIN}\` (headless Chromium).`);
log();
log(`## Realtime endpoints (browser fetch)`);
log();
log(`| URL | HTTP | Type | Size | ACAO header | Browser fetch | Cache-Control | Last-Modified | http:// |`);
log(`|---|---|---|---|---|---|---|---|---|`);
const live = [];
for (const url of cfg.realtime) {
  const p = await probe(url);
  const b = await browserFetch(url);
  const http = await plainHttp(url);
  if (p.error) {
    log(`| ${url} | ${p.error} | | | | ${b.ok ? "✅" : "❌"} | | | ${http} |`);
    continue;
  }
  if (p.status === 200) live.push(url);
  log(
    `| ${url} | ${p.status} | ${p.type ?? ""} | ${kb(p.len)}${p.encoding ? ` (${p.encoding})` : ""} | ${p.acao ?? "—"} | ${b.ok ? `✅ ${b.status}` : `❌ ${b.err}`} | ${p.cacheControl ?? "—"} | ${p.lastModified ?? "—"} | ${http} |`,
  );
}
log();

log(`## Static files (fetched in CI only, CORS irrelevant)`);
log();
log(`| URL | HTTP | Type | Size | Last-Modified | ETag |`);
log(`|---|---|---|---|---|---|`);
for (const url of cfg.static) {
  const p = await probe(url, "HEAD");
  log(p.error ? `| ${url} | ${p.error} | | | | |` : `| ${url} | ${p.status} | ${p.type ?? ""} | ${kb(p.len)} | ${p.lastModified ?? "—"} | ${p.etag ?? "—"} |`);
}
log();

// 3. Official metadata from the CKAN API (licence, frequency, resource URLs).
log(`## data.renfe.com dataset metadata (CKAN package_show)`);
log();
for (const slug of cfg.ckan_datasets) {
  const p = await probe(`${cfg.ckan_api}/package_show?id=${slug}`);
  if (p.error || p.status !== 200) {
    log(`- **${slug}**: ${p.error ?? "HTTP " + p.status}`);
    continue;
  }
  const d = JSON.parse(p.body.toString("utf8")).result;
  const extra = Object.fromEntries((d.extras ?? []).map((e) => [e.key, e.value]));
  log(`### ${d.title} (\`${slug}\`)`);
  log(`- Licence: ${d.license_title ?? "?"} ${d.license_url ?? ""} (id \`${d.license_id ?? "?"}\`)`);
  log(`- Modified: ${d.metadata_modified ?? "?"}; frequency: ${d.frequency ?? extra.frequency ?? extra.accrualPeriodicity ?? "?"}`);
  log(`- Notes: ${(d.notes ?? "").replace(/\s+/g, " ").slice(0, 400)}`);
  for (const r of d.resources ?? []) {
    log(`  - ${r.name} [${r.format}] ${r.url} ${r.description ? "— " + r.description.replace(/\s+/g, " ").slice(0, 200) : ""}`);
  }
  log();
}

// 4. Refresh behaviour: poll each live endpoint and record when it changes.
if (watchSeconds > 0 && live.length) {
  const step = 10;
  log(`## Refresh behaviour (polled every ${step}s for ${watchSeconds}s)`);
  log();
  const state = Object.fromEntries(live.map((u) => [u, { last: null, changes: [] }]));
  const t0 = Date.now();
  while (Date.now() - t0 < watchSeconds * 1000) {
    for (const u of live) {
      const p = await probe(u);
      if (!p.body) continue;
      const id = `${sha(p.body)}|${p.lastModified ?? ""}`;
      const s = state[u];
      if (s.last !== null && s.last !== id) s.changes.push(Math.round((Date.now() - t0) / 1000));
      s.last = id;
    }
    await new Promise((r) => setTimeout(r, step * 1000));
  }
  log(`| URL | Content changes at (s) | Mean gap (s) |`);
  log(`|---|---|---|`);
  for (const u of live) {
    const c = state[u].changes;
    const gaps = c.slice(1).map((v, i) => v - c[i]);
    const mean = gaps.length ? Math.round(gaps.reduce((a, b) => a + b) / gaps.length) : "—";
    log(`| ${u} | ${c.join(", ") || "no change"} | ${mean} |`);
  }
  log();
}

if (consoleErrors.length) {
  log(`## Browser console errors`);
  log();
  for (const e of [...new Set(consoleErrors)]) log(`- ${e}`);
}

await browser.close();
console.log(out.join("\n"));
