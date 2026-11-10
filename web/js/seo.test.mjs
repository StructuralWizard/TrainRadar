// Run with: node --test web/js/seo.test.mjs
// What search engines and AI assistants read: the crawl files and the guide
// pages stay consistent (sitemap ↔ pages ↔ canonical ↔ hreflang), and the
// structured data stays valid JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://mytrainradar.com/";
const read = (p) => readFileSync(join(WEB, p), "utf8");

/** Site URL → file in web/ ("/x/" → x/index.html). */
const fileFor = (url) => {
  const path = url.slice(SITE.length);
  return path === "" || path.endsWith("/") ? `${path}index.html` : path;
};
const sitemapUrls = () => [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const pages = () => sitemapUrls().filter((u) => !u.includes("/legal/"));
const attr = (html, re) => html.match(re)?.[1];
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test("robots.txt allows crawling and points to the sitemap", () => {
  const robots = read("robots.txt");
  assert.match(robots, /^User-agent: \*\nAllow: \/$/m);
  assert.doesNotMatch(robots, /^Disallow: \/\s*$/m);
  assert.match(robots, new RegExp(`^Sitemap: ${SITE}sitemap.xml$`, "m"));
});

test("every sitemap URL is a page in web/", () => {
  for (const url of sitemapUrls()) {
    assert.ok(url.startsWith(SITE), url);
    assert.ok(existsSync(join(WEB, fileFor(url))), `${url} → ${fileFor(url)}`);
  }
});

test("pages: canonical is their own URL, titles and descriptions unique and sized", () => {
  const titles = new Set();
  const descs = new Set();
  for (const url of pages()) {
    const html = read(fileFor(url));
    assert.equal(attr(html, /<link rel="canonical" href="([^"]+)">/), url, `${url} canonical`);
    const title = attr(html, /<title>([^<]+)<\/title>/);
    const desc = attr(html, /<meta name="description" content="([^"]+)">/);
    assert.ok(title && !titles.has(title), `${url} title`);
    assert.ok(desc && !descs.has(desc), `${url} description`);
    assert.ok(desc.length >= 70 && desc.length <= 200, `${url} description is ${desc.length} characters`);
    titles.add(title);
    descs.add(desc);
    assert.match(html, /<meta property="og:image" content="https:\/\/mytrainradar\.com\/og-image\.jpg">/);
  }
});

test("hreflang alternates point both ways and exist", () => {
  for (const url of pages()) {
    const html = read(fileFor(url));
    const alts = Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]));
    if (Object.keys(alts).length === 0) continue; // no translation (the map page is bilingual)
    const lang = attr(html, /<html lang="([^"]+)">/);
    assert.equal(alts[lang], url, `${url} names itself for ${lang}`);
    for (const [hl, other] of Object.entries(alts)) {
      if (hl === "x-default" || other === url) continue;
      const back = read(fileFor(other));
      assert.ok(back.includes(`hreflang="${lang}" href="${url}"`), `${other} links back to ${url}`);
    }
  }
});

test("structured data parses and names TrainRadar's publisher", () => {
  for (const url of pages()) {
    const html = read(fileFor(url));
    const blocks = jsonLd(html);
    assert.ok(blocks.length >= 1, `${url} has JSON-LD`);
    const text = JSON.stringify(blocks);
    assert.ok(text.includes("Metranos Ltd"), `${url} names the publisher`);
    for (const b of blocks) assert.equal(b["@context"], "https://schema.org");
    // FAQ answers must also be on the page, not only in the data.
    for (const node of blocks.flatMap((b) => b["@graph"] ?? [b])) {
      if (node["@type"] !== "FAQPage") continue;
      const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
      for (const q of node.mainEntity) assert.ok(main.includes(`<dt>${q.name}</dt>`), `${url}: "${q.name}" is shown on the page`);
    }
  }
});

test("guide pages are static: no scripts but structured data, strict CSP", () => {
  for (const url of pages().filter((u) => u !== SITE)) {
    const html = read(fileFor(url));
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
    assert.ok(scripts.every((a) => a === ' type="application/ld+json"'), `${url} scripts: ${scripts}`);
    assert.match(html, /content="default-src 'none'; style-src 'self'; img-src 'self'/);
  }
});

test("llms.txt links only to pages that exist", () => {
  const llms = read("llms.txt");
  assert.match(llms, /^# TrainRadar\n\n> /);
  for (const [, url] of llms.matchAll(/\]\((https:\/\/mytrainradar\.com\/[^)]*)\)/g)) {
    assert.ok(existsSync(join(WEB, fileFor(url))), url);
  }
});
