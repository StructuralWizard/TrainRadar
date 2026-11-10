// Local development server for the web app. No dependencies.
//
//   node tools/dev-server.mjs                       # live: /rt/* via worker/src/index.js
//   FIXTURES=path/to/rt node tools/dev-server.mjs   # offline: /rt/* from .pb files
//   DATA=path/to/data PORT=8080 node tools/dev-server.mjs
//   ROOT=dist node tools/dev-server.mjs              # serve a built dist/
//
// Serves web/ at http://localhost:8080, /data/* from $DATA (default web/data).
// In live mode the Worker's own code forwards feeds, so local behaviour
// matches production.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import worker from "../worker/src/index.js";

const ROOT = resolve(process.env.ROOT || new URL("../web", import.meta.url).pathname);
const DATA = resolve(process.env.DATA || join(ROOT, "data"));
const FIXTURES = process.env.FIXTURES && resolve(process.env.FIXTURES);
const PORT = Number(process.env.PORT || 8080);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
  ".pb": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
};

async function sendFile(res, base, rel) {
  const path = normalize(join(base, rel));
  if (!path.startsWith(base)) return send(res, 403, "forbidden");
  try {
    const st = await stat(path);
    const p = st.isDirectory() ? join(path, "index.html") : path;
    res.writeHead(200, {
      "Content-Type": TYPES[extname(p)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Last-Modified": st.mtime.toUTCString(),
    });
    res.end(await readFile(p));
  } catch {
    send(res, 404, "not found");
  }
}

const FEED_FILES = ["vehicle_positions_LD.pb", "trip_updates_LD.pb", "vehicle_positions.pb", "trip_updates.pb", "alerts.pb"];

async function sendStatus(res) {
  const feeds = {};
  for (const name of FEED_FILES) {
    try {
      const st = await stat(join(FIXTURES, name));
      feeds[name] = { renfeLastModified: st.mtime.toUTCString(), fetchedAt: new Date().toISOString(), ok: true, bytes: st.size };
    } catch {
      feeds[name] = { renfeLastModified: null, fetchedAt: null, ok: false, error: "missing" };
    }
  }
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ generatedAt: new Date().toISOString(), pollerEnabled: true, feeds }));
}

function sendFakeHistory(res, url) {
  const [, , , kind, raw] = url.pathname.split("/");
  const id = decodeURIComponent(raw || "");
  const n = Math.min(365, Number(url.searchParams.get("days")) || 7);
  const dates = [];
  for (let i = n; i >= 1; i--) dates.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  let body;
  if (kind === "train") {
    body = { trainNo: id.replace(/^0+/, ""), runs: dates.map((date, i) => ({ date, arr_delay_min: (i * 7) % 23, max_delay_min: (i * 7) % 23, cancelled: false, origin_id: "A", dest_id: "B", stops: [] })) };
  } else if (kind === "station") {
    body = { stopId: id, days: dates.map((date) => ({ date, calls: 100, on_time: 85, late_5: 15, late_15: 4, median_delay: 1, p90_delay: 7 })) };
  } else {
    const products = ["CERCANIAS", "AVE", "ALVIA", "MD", "AVLO", "AVANT", "REGIONAL", "INTERCITY"];
    const days = [];
    dates.forEach((date, i) => {
      for (const product of products) {
        days.push({ date, product, trips: 20, on_time: 17, late_5: 3, late_15: 1, cancelled: i === n - 3 ? 1 : 0, median_delay: 2, p90_delay: 8 });
      }
    });
    body = { line: id, days };
  }
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/rt/")) {
    const path = url.pathname.slice(4);
    // Like the central poller's status.json (backend/), from the fixtures'
    // modification times, so the app's live mode runs locally too.
    if (path === "status.json" && FIXTURES) return sendStatus(res);
    if (FIXTURES) return sendFile(res, FIXTURES, path);
    const r = await worker.fetch(new Request(`http://localhost/${path}`), {
      ALLOWED_ORIGINS: `http://localhost:${PORT}`,
    });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (url.pathname.startsWith("/data/")) return sendFile(res, DATA, url.pathname.slice(6));
  // A stand-in for the history API (backend/src/api.js): made-up days for any
  // line, train or station, so the history shows locally and in the tests.
  if (/^\/v1\/history\/(line|train|station)\//.test(url.pathname)) return sendFakeHistory(res, url);
  // Tests only: TEST_PLAY_URL fills CONFIG.playUrl, to test the app links.
  if (process.env.TEST_PLAY_URL && url.pathname === "/js/config.js") {
    const js = (await readFile(join(ROOT, "js/config.js"), "utf8")).replace('playUrl: ""', `playUrl: ${JSON.stringify(process.env.TEST_PLAY_URL)}`);
    res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" });
    return res.end(js);
  }
  return sendFile(res, ROOT, decodeURIComponent(url.pathname));
}).listen(PORT, () => {
  console.log(`TrainRadar dev server: http://localhost:${PORT}/`);
  console.log(`  data: ${DATA}`);
  console.log(`  feeds: ${FIXTURES ? `fixtures in ${FIXTURES}` : "live via worker/src/index.js"}`);
});
