// The administrator dashboard's page (backend-ops): one HTML file, no
// external scripts or fonts, that reads /api/summary and draws it. Light
// and dark, readable on a phone. Behind Cloudflare Access (access.js).

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>TrainRadar ops</title>
<style>
:root { --bg:#f6f7f9; --card:#fff; --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --ok:#15803d; --warn:#b45309; --bad:#b91c1c; --brand:#1d4ed8; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1020; --card:#131a2e; --ink:#e5e7eb; --muted:#9ca3af; --line:#243049; --ok:#4ade80; --warn:#fbbf24; --bad:#f87171; --brand:#93c5fd; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 16px; }
h1 { font-size: 20px; margin: 0; } h2 { font-size: 15px; margin: 0 0 8px; }
main { display: grid; gap: 12px; padding: 0 16px 24px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; overflow-x: auto; }
section.wide { grid-column: 1 / -1; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--line); vertical-align: top; white-space: nowrap; }
td.wrap { white-space: normal; } th { color: var(--muted); font-weight: 600; font-size: 12px; }
.muted { color: var(--muted); } .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid currentColor; }
.err { color: var(--bad); font-size: 12px; white-space: normal; }
.bar { height: 6px; background: var(--brand); border-radius: 3px; }
button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; }
</style>
</head>
<body>
<header><h1>TrainRadar ops</h1><span id="who" class="muted"></span><span id="at" class="muted"></span>
<button id="reload" type="button">Refresh</button> <button id="testmail" type="button">Send a test alert</button></header>
<main id="main"><section class="wide muted">Loading…</section></main>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ago = (iso) => { const t = Date.parse(iso); if (!t) return "—"; const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + " min" : m < 2880 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d"; };
const num = (n) => n == null || Number.isNaN(n) ? "—" : Number(n).toLocaleString("en-GB");
const bytes = (n) => n == null ? "—" : n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB";
const pct = (x) => x == null || Number.isNaN(x) ? "—" : (100 * x).toFixed(2) + " %";
const err = (o) => o && o.error ? '<p class="err">' + esc(o.error) + "</p>" : "";
const table = (head, rows) => "<table><tr>" + head.map((h) => "<th>" + h + "</th>").join("") + "</tr>" + rows.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</table>";
function section(title, body, wide) { return '<section class="' + (wide ? "wide" : "") + '"><h2>' + title + "</h2>" + body + "</section>"; }
function render(d) {
  $("#who").textContent = d.user ? "signed in as " + d.user : "";
  $("#at").textContent = "updated " + new Date(d.at).toLocaleTimeString();
  const out = [];
  const open = Object.values(d.alerts || {});
  out.push(section("Open alerts", open.length ? table(["Country", "Problem", "Since"], open.map((a) => [esc(a.country.toUpperCase()), '<span class="bad">' + esc(a.text) + "</span>", ago(new Date(a.since).toISOString())])) : '<p class="ok">None. Every live feed and data set is fine.</p>', true));
  out.push(section("Live feeds", table(["Country", "Status", "Updated", "Calls today", "Feeds", ""], (d.feeds || []).map((f) => [
    "<b>" + esc(f.country.toUpperCase()) + "</b>",
    f.off ? '<span class="muted">off</span>' : f.ok ? '<span class="pill ok">ok</span>' : '<span class="pill bad">failing</span>',
    ago(f.updatedAt),
    f.dailyCap ? num(f.callsToday) + " / " + num(f.dailyCap) + '<div class="bar" style="width:' + Math.min(100, (100 * f.callsToday) / f.dailyCap).toFixed(0) + '%"></div>' : "",
    (f.feeds || []).map((x) => esc(x.name) + ' <span class="' + (x.ok === false ? "bad" : "muted") + '">' + ago(x.fetchedAt) + (x.kept != null ? " · " + num(x.kept) : "") + "</span>").join("<br>"),
    f.error ? '<span class="err">' + esc(f.error) + "</span>" : "",
  ])), true));
  out.push(section("Reference data", table(["Country", "Built", "Age"], (d.data || []).map((x) => ["<b>" + esc(x.country.toUpperCase()) + "</b>", x.generatedAt ? esc(x.generatedAt.slice(0, 16).replace("T", " ")) : '<span class="muted">not deployed</span>', x.generatedAt ? '<span class="' + (Date.now() - Date.parse(x.generatedAt) > 36 * 3600e3 ? "bad" : "ok") + '">' + ago(x.generatedAt) + "</span>" : ""]))));
  const cf = d.cloudflare || {};
  out.push(section("Workers, last 24 h", err(cf) + err(cf.workers) + (Array.isArray(cf.workers) ? table(["Worker", "Requests", "Errors", "Subrequests"], cf.workers.map((w) => [esc(w.script), num(w.requests), '<span class="' + (w.errors ? "warn" : "") + '">' + num(w.errors) + "</span>", num(w.subrequests)])) : "")));
  out.push(section("Storage", err(cf.r2) + (Array.isArray(cf.r2) ? table(["R2 bucket", "Size", "Objects", "Reads / writes (24 h)"], cf.r2.map((b) => [esc(b.bucket), bytes(b.bytes), num(b.objects), Object.entries(b.ops).map(([k, v]) => esc(k) + " " + num(v)).join("<br>")])) : "") + err(cf.d1) + (Array.isArray(cf.d1) ? table(["D1 database", "Size", "Rows read", "Rows written"], cf.d1.map((x) => [esc(String(x.database).slice(0, 8)), bytes(x.bytes), num(x.rowsRead), num(x.rowsWritten)])) : "")));
  out.push(section("Website, last 7 days", err(cf.site) + (cf.site && cf.site.days ? table(["Day", "Visitors", "Page views", "Requests"], cf.site.days.map((x) => [esc(x.date), num(x.visitors), num(x.pageViews), num(x.requests)])) + "<h2 style='margin-top:12px'>Requests by country</h2>" + table(["Country", "Requests"], cf.site.countries.map(([c, n]) => [esc(c), num(n)])) : "")));
  const p = d.play || {};
  out.push(section("Google Play: ratings", err(p) + err(p.reviews) + (p.reviews && p.reviews.recent ? "<p>" + num(p.reviews.count) + " reviews in the last 7 days, average " + (p.reviews.average ? p.reviews.average.toFixed(2) + " ★" : "—") + "</p>" + table(["★", "Lang", "Version", "Review"], p.reviews.recent.map((r) => [num(r.stars), esc(r.lang), esc(r.version), '<span class="wrap">' + esc(r.text) + "</span>"])) : "")));
  const vit = (rows, k1, k2) => Array.isArray(rows) ? table(["Day", "Rate", "User-perceived", "Users"], rows.map((r) => [esc(r.date), pct(r[k1]), pct(r[k2]), num(r.distinctUsers)])) : "";
  out.push(section("Google Play: crashes and ANRs", "<h2>Crashes</h2>" + err(p.crashes) + vit(p.crashes, "crashRate", "userPerceivedCrashRate") + "<h2 style='margin-top:12px'>Not responding</h2>" + err(p.anrs) + vit(p.anrs, "anrRate", "userPerceivedAnrRate")));
  const byCountry = (x) => x && x.countries ? "<p class='muted'>" + esc(x.file) + ", " + esc(x.date) + "</p>" + table(["Country", ...Object.keys(Object.values(x.countries)[0] || {})], Object.entries(x.countries).sort((a, b) => (Object.values(b[1])[0] || 0) - (Object.values(a[1])[0] || 0)).slice(0, 25).map(([c, v]) => [esc(c), ...Object.values(v).map(num)])) : (x === null ? "<p class='muted'>No report this month yet.</p>" : "");
  out.push(section("Google Play: installs by country", err(p.installs) + byCountry(p.installs)));
  out.push(section("Google Play: subscriptions by country", err(p.subscriptions) + byCountry(p.subscriptions)));
  $("#main").innerHTML = out.join("");
}
async function load() {
  try {
    const r = await fetch("api/summary", { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    render(await r.json());
  } catch (e) { $("#main").innerHTML = '<section class="wide err">Could not load: ' + esc(e.message) + "</section>"; }
}
$("#reload").onclick = load;
$("#testmail").onclick = async () => {
  const r = await fetch("api/test-mail", { method: "POST", credentials: "same-origin" });
  alert(r.ok ? "Test alert sent." : "Test alert failed: " + (await r.text()));
};
load();
setInterval(load, 5 * 60000);
</script>
</body>
</html>`;
