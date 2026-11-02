// One-off research helper (not part of the app): screenshot a page in a
// phone and a desktop viewport, print its visible text, and list the URLs
// it requests. Output is data for reading, nothing more.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const [url, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, name] of [[390, 780, "phone"], [1280, 800, "desktop"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const reqs = new Set();
  p.on("request", (r) => reqs.add(`${r.resourceType()} ${r.url().split("?")[0]}`));
  await p.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch((e) => console.log("goto:", e.message));
  await p.waitForTimeout(6000);
  if (name === "desktop") {
    console.log(`TEXT-BEGIN ${tag}`);
    console.log((await p.evaluate(() => document.body?.innerText || "")).slice(0, 12000));
    console.log(`TEXT-END ${tag}`);
    console.log(`REQUESTS ${tag}:`);
    for (const r of [...reqs].filter((x) => !/\.(png|jpg|svg|woff2?|css)$/.test(x))) console.log("  " + r);
  }
  await p.screenshot({ path: `${tag}-${name}.jpg`, type: "jpeg", quality: 50 });
  console.log(`SHOT-BEGIN ${tag}-${name}`);
  console.log((await readFile(`${tag}-${name}.jpg`)).toString("base64"));
  console.log(`SHOT-END ${tag}-${name}`);
  await p.close();
}
await b.close();
