// Local development server for the web app. No dependencies.
//
//   node tools/dev-server.mjs                       # live: /rt/* via worker/src/index.js
//   FIXTURES=path/to/rt node tools/dev-server.mjs   # offline: /rt/* from .pb files
//   DATA=path/to/data PORT=8080 node tools/dev-server.mjs
//
// Serves web/ at http://localhost:8080, /data/* from $DATA (default web/data).
// In live mode the Worker's own code forwards feeds, so local behaviour
// matches production.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import worker from "../worker/src/index.js";

const ROOT = resolve(new URL("../web", import.meta.url).pathname);
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
  ".webmanifest": "application/manifest+json",
};

async function sendFile(res, base, rel) {
  const path = normalize(join(base, rel));
  if (!path.startsWith(base)) return send(res, 403, "forbidden");
  try {
    const p = (await stat(path)).isDirectory() ? join(path, "index.html") : path;
    res.writeHead(200, {
      "Content-Type": TYPES[extname(p)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(await readFile(p));
  } catch {
    send(res, 404, "not found");
  }
}

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/rt/")) {
    const path = url.pathname.slice(4);
    if (FIXTURES) return sendFile(res, FIXTURES, path);
    const r = await worker.fetch(new Request(`http://localhost/${path}`), {
      ALLOWED_ORIGINS: `http://localhost:${PORT}`,
    });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (url.pathname.startsWith("/data/")) return sendFile(res, DATA, url.pathname.slice(6));
  return sendFile(res, ROOT, decodeURIComponent(url.pathname));
}).listen(PORT, () => {
  console.log(`TrainRadar dev server: http://localhost:${PORT}/`);
  console.log(`  data: ${DATA}`);
  console.log(`  feeds: ${FIXTURES ? `fixtures in ${FIXTURES}` : "live via worker/src/index.js"}`);
});
