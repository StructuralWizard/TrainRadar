// Google Play's numbers for the dashboard (backend-ops), with the service
// account GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (a Worker secret) and read-only
// scopes only, whatever else the account may do in Play Console:
// - recent ratings and reviews (Android Publisher API, last 7 days);
// - Android vitals: crash and ANR rates (Play Developer Reporting API);
// - installs and subscriptions by country, from Play's monthly CSV reports
//   in its Cloud Storage bucket, when PLAY_REPORTS_BUCKET names it
//   (Play Console → Download reports → "Copy Cloud Storage URI").
// The account's key signs a short-lived token here (WebCrypto); neither is
// logged or returned.

export const PACKAGE = "com.metranos.trainradar";
const SCOPES = [
  "https://www.googleapis.com/auth/androidpublisher",
  "https://www.googleapis.com/auth/playdeveloperreporting",
  "https://www.googleapis.com/auth/devstorage.read_only",
];

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

/** An OAuth access token for the service account (JWT bearer grant). */
export async function accessToken(saJson, fetchFn = fetch, now = Date.now()) {
  const sa = JSON.parse(saJson);
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlText(
    JSON.stringify({ iss: sa.client_email, scope: SCOPES.join(" "), aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3000 }),
  )}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google token: HTTP ${r.status} ${j.error || ""}`.trim());
  return j.access_token;
}

/** A CSV report (Play writes them in UTF-16) as rows of objects. */
export function parseCsv(bytes) {
  const u8 = new Uint8Array(bytes);
  const utf16 = (u8[0] === 0xff && u8[1] === 0xfe) || (u8.length > 1 && u8[1] === 0);
  const text = new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(u8).replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const split = (l) => l.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
  const head = split(lines[0] || "");
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

/** The latest date's rows of a daily report, summed by country: { country: { column: n } }. */
export function latestByCountry(rows) {
  const dates = rows.map((r) => r.Date).filter(Boolean).sort();
  const last = dates[dates.length - 1];
  const out = {};
  for (const r of rows) {
    if (r.Date !== last) continue;
    const c = r.Country || r["Country Code"] || "?";
    const o = (out[c] ||= {});
    for (const [k, v] of Object.entries(r)) {
      if (k === "Date" || k === "Package Name" || k === "Country" || k === "Product ID") continue;
      const n = Number(v);
      if (Number.isFinite(n)) o[k] = (o[k] || 0) + n;
    }
  }
  return { date: last || null, countries: out };
}

const ymd = (ms) => {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

/** Everything the dashboard shows from Play: { name: data | { error } }. */
export async function play(env, fetchFn = fetch, now = Date.now()) {
  if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) return { error: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not set" };
  let token;
  try {
    token = await accessToken(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, fetchFn, now);
  } catch (e) {
    return { error: String(e?.message || e).slice(0, 200) };
  }
  const auth = { Authorization: `Bearer ${token}` };
  const out = {};
  const run = async (name, f) => {
    try {
      out[name] = await f();
    } catch (e) {
      out[name] = { error: String(e?.message || e).slice(0, 300) };
    }
  };
  const json = async (url, init = {}) => {
    const r = await fetchFn(url, { ...init, headers: { ...auth, ...(init.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${j.error?.message || ""}`.slice(0, 200));
    return j;
  };
  await run("reviews", async () => {
    const j = await json(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/reviews?maxResults=50`);
    const list = (j.reviews || []).map((r) => {
      const c = r.comments?.find((x) => x.userComment)?.userComment || {};
      return { stars: c.starRating, lang: c.reviewerLanguage, version: c.appVersionName, at: c.lastModified?.seconds ? new Date(c.lastModified.seconds * 1000).toISOString() : null, text: String(c.text || "").trim().slice(0, 200) };
    });
    const stars = list.map((r) => r.stars).filter(Boolean);
    return { count: list.length, average: stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : null, recent: list.slice(0, 10) };
  });
  // Vitals: the last 7 complete days (the API lags about two days).
  const timeline = { aggregationPeriod: "DAILY", startTime: ymd(now - 9 * 86_400_000), endTime: ymd(now - 2 * 86_400_000) };
  const vitals = async (set, metrics) => {
    const j = await json(`https://playdeveloperreporting.googleapis.com/v1beta1/apps/${PACKAGE}/${set}:query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timelineSpec: timeline, metrics }),
    });
    return (j.rows || []).map((r) => ({
      date: `${r.startTime?.year}-${String(r.startTime?.month).padStart(2, "0")}-${String(r.startTime?.day).padStart(2, "0")}`,
      ...Object.fromEntries((r.metrics || []).map((m) => [m.metric, Number(m.decimalValue?.value ?? NaN)])),
    }));
  };
  await run("crashes", () => vitals("crashRateMetricSet", ["crashRate", "userPerceivedCrashRate", "distinctUsers"]));
  await run("anrs", () => vitals("anrRateMetricSet", ["anrRate", "userPerceivedAnrRate", "distinctUsers"]));
  // Reports in Play's bucket: this month's installs and subscriptions by country.
  const bucket = (env.PLAY_REPORTS_BUCKET || "").replace(/^gs:\/\//, "").replace(/\/.*$/, "");
  if (bucket) {
    const month = new Date(now).toISOString().slice(0, 7).replace("-", "");
    const latest = async (prefix, match) => {
      const j = await json(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?prefix=${encodeURIComponent(prefix)}`);
      const items = (j.items || []).filter((o) => match(o.name)).sort((a, b) => a.name.localeCompare(b.name));
      if (!items.length) return null;
      const name = items[items.length - 1].name;
      const r = await fetchFn(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`, { headers: auth });
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      return { file: name.split("/").pop(), ...latestByCountry(parseCsv(await r.arrayBuffer())) };
    };
    await run("installs", () => latest(`stats/installs/installs_${PACKAGE}_`, (n) => n.endsWith(`_${month}_country.csv`)));
    await run("subscriptions", () => latest("financial-stats/subscriptions/", (n) => n.includes(PACKAGE) && n.includes(month) && n.endsWith("_country.csv")));
  } else {
    out.installs = out.subscriptions = { error: "PLAY_REPORTS_BUCKET not set (Play Console → Download reports → Copy Cloud Storage URI)" };
  }
  return out;
}
