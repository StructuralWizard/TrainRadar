#!/usr/bin/env node
// Google Play publishing (approved by the maintainer on 2026-11-29), run only
// from .github/workflows/play.yml, which the maintainer starts by hand:
//
//   node tools/play/play.mjs upload  <signed.aab> <notes.txt>   → internal testing
//   node tools/play/play.mjs promote <versionCode> <percent>    → production, staged
//   node tools/play/play.mjs listings <docs/play-store.md>      → store listings, all languages
//
// Each command is one Play "edit", committed at the end or not at all. The
// service account key comes from GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (never
// printed); DRY_RUN=1 prints what would be sent (without the key) and calls
// nothing. Production only ever comes from "promote", never from "upload".

import { readFileSync } from "node:fs";

export const PACKAGE = "com.metranos.trainradar";
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
/** Play's limits: release notes per language; listing fields. */
export const LIMITS = { notes: 500, title: 30, short: 80, full: 4000 };

// ---- Parsing what's in the repository (tested) ----

/** "What's new" per language from a release's Play section ("<es-ES>\n…\n</es-ES>"). */
export function parseNotes(text) {
  const out = [];
  for (const m of text.matchAll(/<([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)?)>\n([\s\S]*?)\n<\/\1>/g)) {
    const t = m[2].trim();
    if (t.length > LIMITS.notes) throw new Error(`release notes for ${m[1]}: ${t.length} characters (Play allows ${LIMITS.notes})`);
    out.push({ language: m[1], text: t });
  }
  if (!out.length) throw new Error("no release notes found");
  return out;
}

/** The store listings in docs/play-store.md: each "### <lang>" section with
 * its app name, short description and the full description's code block. */
export function parseListings(md) {
  const out = [];
  const sections = md.split(/^### /m).slice(1);
  for (const sec of sections) {
    const language = sec.slice(0, sec.indexOf("\n")).trim();
    const title = sec.match(/\*\*App name\*\*[^`]*`([^`]+)`/)?.[1];
    const short = sec.match(/\*\*Short description\*\*[^`]*`([^`]+)`/)?.[1];
    const full = sec.match(/\*\*Full description\*\*[\s\S]*?```\n([\s\S]*?)\n```/)?.[1];
    if (!title || !short || !full) continue; // not a listing ("Graphics", …)
    for (const [k, v] of [["title", title], ["short", short], ["full", full]]) {
      if ([...v].length > LIMITS[k]) throw new Error(`${language} ${k}: ${[...v].length} characters (Play allows ${LIMITS[k]})`);
    }
    out.push({ language, title, shortDescription: short, fullDescription: full });
  }
  if (!out.length) throw new Error("no listings found");
  return out;
}

/** A production release at `percent` % (100 = everyone). */
export function productionRelease(versionCode, percent, releaseNotes, name) {
  const p = Number(percent);
  if (!(p > 0 && p <= 100)) throw new Error(`rollout percent must be in (0, 100]: ${percent}`);
  const r = { name, versionCodes: [String(versionCode)], releaseNotes };
  return p === 100 ? { ...r, status: "completed" } : { ...r, status: "inProgress", userFraction: p / 100 };
}

// ---- Google Play's API ----

const b64url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken(saJson) {
  const sa = JSON.parse(saJson);
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Buffer.from(pem, "base64"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${b64url(
    Buffer.from(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3000 })),
  )}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(unsigned));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(new Uint8Array(sig))}` }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google token: HTTP ${r.status}`);
  return j.access_token;
}

class Edit {
  constructor(dry) {
    this.dry = dry;
  }
  async open() {
    if (this.dry) return (this.id = "dry-run");
    this.token = await accessToken(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "");
    this.id = (await this.call("POST", `${API}/edits`, {})).id;
  }
  async call(method, url, body, raw) {
    if (this.dry) {
      console.log(method, url.replace(API, "…"), raw ? `<${raw.length} bytes>` : JSON.stringify(body ?? null, null, 1).slice(0, 2000));
      return {};
    }
    const r = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": raw ? "application/octet-stream" : "application/json" },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${url.replace(API, "").replace(UPLOAD, "")}: HTTP ${r.status} ${j.error?.message || ""}`.trim());
    return j;
  }
  path(p) {
    return `${API}/edits/${this.id}${p}`;
  }
  commit() {
    return this.call("POST", this.path(":commit"));
  }
}

async function upload(aabPath, notesPath, dry) {
  const notes = parseNotes(readFileSync(notesPath, "utf8"));
  const e = new Edit(dry);
  await e.open();
  const bundle = await e.call("POST", `${UPLOAD}/edits/${e.id}/bundles?uploadType=media`, undefined, readFileSync(aabPath));
  const versionCode = bundle.versionCode ?? "(from the bundle)";
  await e.call("PUT", e.path("/tracks/internal"), {
    track: "internal",
    releases: [{ name: process.env.RELEASE_NAME || undefined, versionCodes: [String(versionCode)], status: "completed", releaseNotes: notes }],
  });
  await e.commit();
  console.log(`Uploaded versionCode ${versionCode} to internal testing, with notes in ${notes.length} languages.`);
  return versionCode;
}

async function promote(versionCode, percent, dry) {
  const e = new Edit(dry);
  await e.open();
  // The notes come from the internal release of the same versionCode.
  const internal = await e.call("GET", e.path("/tracks/internal"));
  const rel = (internal.releases || []).find((r) => (r.versionCodes || []).includes(String(versionCode)));
  if (!rel && !dry) throw new Error(`versionCode ${versionCode} isn't on internal testing: upload it first`);
  await e.call("PUT", e.path("/tracks/production"), { track: "production", releases: [productionRelease(versionCode, percent, rel?.releaseNotes || [], rel?.name)] });
  await e.commit();
  console.log(`Production: versionCode ${versionCode} at ${percent}%.`);
}

async function listings(mdPath, dry) {
  const list = parseListings(readFileSync(mdPath, "utf8"));
  const e = new Edit(dry);
  await e.open();
  for (const l of list) await e.call("PUT", e.path(`/listings/${encodeURIComponent(l.language)}`), l);
  await e.commit();
  console.log(`Store listings updated: ${list.map((l) => l.language).join(", ")}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b] = process.argv.slice(2);
  const dry = process.env.DRY_RUN === "1";
  const run = { upload: () => upload(a, b, dry), promote: () => promote(a, b, dry), listings: () => listings(a, dry) }[cmd];
  if (!run) {
    console.error("usage: play.mjs upload <aab> <notes> | promote <versionCode> <percent> | listings <play-store.md>");
    process.exit(2);
  }
  run().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
