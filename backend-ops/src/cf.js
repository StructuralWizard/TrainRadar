// Cloudflare's own numbers for the dashboard (backend-ops), from its GraphQL
// Analytics API with a read-only token (CLOUDFLARE_ANALYTICS_TOKEN): Worker
// requests and errors, R2 storage and operations, D1 queries and size, and
// the website's requests and visitors by country. Aggregates only. Each
// query on its own: one that fails shows its error, the others still show.

const GQL = "https://api.cloudflare.com/client/v4/graphql";
const REST = "https://api.cloudflare.com/client/v4";

async function gql(env, fetchFn, query, variables) {
  const r = await fetchFn(GQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors?.length) throw new Error((j.errors || []).map((e) => e.message).join("; ") || `HTTP ${r.status}`);
  return j.data;
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export const QUERIES = {
  workers: `query($a: String!, $since: Time!) { viewer { accounts(filter: { accountTag: $a }) {
    workersInvocationsAdaptive(limit: 50, filter: { datetime_geq: $since }) { sum { requests errors subrequests } dimensions { scriptName } } } } }`,
  r2: `query($a: String!, $since: Time!) { viewer { accounts(filter: { accountTag: $a }) {
    r2StorageAdaptiveGroups(limit: 10, filter: { datetime_geq: $since }) { max { payloadSize objectCount } dimensions { bucketName } }
    r2OperationsAdaptiveGroups(limit: 50, filter: { datetime_geq: $since }) { sum { requests } dimensions { bucketName actionType } } } } }`,
  d1: `query($a: String!, $d: Date!) { viewer { accounts(filter: { accountTag: $a }) {
    d1AnalyticsAdaptiveGroups(limit: 10, filter: { date_geq: $d }) { sum { readQueries writeQueries rowsRead rowsWritten } dimensions { databaseId } }
    d1StorageAdaptiveGroups(limit: 10, filter: { date_geq: $d }) { max { databaseSizeBytes } dimensions { databaseId } } } } }`,
  site: `query($z: String!, $d: Date!) { viewer { zones(filter: { zoneTag: $z }) {
    httpRequests1dGroups(limit: 7, filter: { date_geq: $d }) {
      dimensions { date } sum { requests pageViews countryMap { clientCountryName requests } } uniq { uniques } } } } }`,
};

/** The zone's id by its name (CLOUDFLARE_ZONE_ID if set). */
async function zoneId(env, fetchFn) {
  if (env.CLOUDFLARE_ZONE_ID) return env.CLOUDFLARE_ZONE_ID;
  const host = new URL(env.SITE_URL || "https://mytrainradar.com/").hostname;
  const r = await fetchFn(`${REST}/zones?name=${encodeURIComponent(host)}`, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}` } });
  const j = await r.json().catch(() => ({}));
  const id = j.result?.[0]?.id;
  if (!id) throw new Error(`zone ${host}: not found with this token (give it Zone → Analytics: Read, or set CLOUDFLARE_ZONE_ID)`);
  return id;
}

/** Everything the dashboard shows from Cloudflare: { name: data | { error } }. */
export async function cloudflare(env, fetchFn = fetch, now = Date.now()) {
  if (!env.CLOUDFLARE_ANALYTICS_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return { error: "CLOUDFLARE_ANALYTICS_TOKEN or CLOUDFLARE_ACCOUNT_ID not set" };
  const a = env.CLOUDFLARE_ACCOUNT_ID;
  const since = new Date(now - 86_400_000).toISOString();
  const out = {};
  const run = async (name, f) => {
    try {
      out[name] = await f();
    } catch (e) {
      out[name] = { error: String(e?.message || e).slice(0, 300) };
    }
  };
  await run("workers", async () => {
    const d = await gql(env, fetchFn, QUERIES.workers, { a, since });
    return (d.viewer.accounts[0]?.workersInvocationsAdaptive || [])
      .map((x) => ({ script: x.dimensions.scriptName, requests: x.sum.requests, errors: x.sum.errors, subrequests: x.sum.subrequests }))
      .sort((p, q) => q.requests - p.requests);
  });
  await run("r2", async () => {
    const acc = (await gql(env, fetchFn, QUERIES.r2, { a, since })).viewer.accounts[0] || {};
    const ops = {};
    for (const x of acc.r2OperationsAdaptiveGroups || []) {
      const b = (ops[x.dimensions.bucketName] ||= {});
      b[x.dimensions.actionType] = (b[x.dimensions.actionType] || 0) + x.sum.requests;
    }
    return (acc.r2StorageAdaptiveGroups || []).map((x) => ({ bucket: x.dimensions.bucketName, bytes: x.max.payloadSize, objects: x.max.objectCount, ops: ops[x.dimensions.bucketName] || {} }));
  });
  await run("d1", async () => {
    const acc = (await gql(env, fetchFn, QUERIES.d1, { a, d: day(now - 86_400_000) })).viewer.accounts[0] || {};
    const size = Object.fromEntries((acc.d1StorageAdaptiveGroups || []).map((x) => [x.dimensions.databaseId, x.max.databaseSizeBytes]));
    return (acc.d1AnalyticsAdaptiveGroups || []).map((x) => ({ database: x.dimensions.databaseId, ...x.sum, bytes: size[x.dimensions.databaseId] ?? null }));
  });
  await run("site", async () => {
    const z = await zoneId(env, fetchFn);
    const days = (await gql(env, fetchFn, QUERIES.site, { z, d: day(now - 7 * 86_400_000) })).viewer.zones[0]?.httpRequests1dGroups || [];
    const countries = {};
    for (const g of days) for (const c of g.sum.countryMap || []) countries[c.clientCountryName] = (countries[c.clientCountryName] || 0) + c.requests;
    return {
      days: days.map((g) => ({ date: g.dimensions.date, requests: g.sum.requests, pageViews: g.sum.pageViews, visitors: g.uniq.uniques })).sort((p, q) => p.date.localeCompare(q.date)),
      countries: Object.entries(countries).sort((p, q) => q[1] - p[1]).slice(0, 25),
    };
  });
  return out;
}
