# Search engines and AI assistants (SEO / GEO)

How mytrainradar.com is made easy for Google, Bing and AI assistants (ChatGPT,
Gemini, Perplexity, Claude, Google AI Overviews) to read, understand and
recommend, and what has to be done outside the code.

## In the site

- **The map page** (`web/index.html`): a descriptive title and description,
  canonical URL, Open Graph and Twitter preview (`og-image.jpg`, 1200 × 630),
  a screen-reader `<h1>`, and structured data (JSON-LD: `Organization`
  Metranos Ltd, `WebSite`, `WebApplication` with price 0 and its features).
  JSON-LD is a data block, never executed, so the CSP is unchanged.
- **Text without JavaScript**: most AI crawlers don't run JavaScript, so the
  map is invisible to them. A `<noscript>` block says what TrainRadar is and
  links to the guides.
- **Guide pages**: static HTML, no scripts, strict CSP, Spanish and English,
  with `hreflang` pairs, `Article`, `BreadcrumbList`, `FAQPage` (and
  `HowTo`) data. Every FAQ in the data is also shown on the page.
  - `/retrasos-trenes-renfe/` ↔ `/en/spain-train-delays/`: how to check a
    Renfe train's delay live.
  - `/indemnizacion-retrasos-renfe/` ↔ `/en/renfe-delay-compensation/`: Renfe's
    punctuality commitment, the EU minimum, the Sustainable Mobility Act, how
    to claim, with sources.
- **Feature pages** (Spanish), each answering one question people ask
  assistants, with the answer in the first sentence and in `FAQPage` data:
  - `/separacion-entre-trenes/`: "¿hay alguna app para calcular la separación
    entre trenes?" (train ahead and behind, free);
  - `/registrar-viajes-tren/`: "¿hay alguna app para grabar tus viajes de
    tren?" (Mis viajes, Pro);
  - `/historico-trenes-renfe/`: "¿hay alguna app para ver el histórico del GPS
    de los trenes de España?" (moviola and punctuality history).
- **IndexNow**: `web/<key>.txt` holds a public key (public by design: it only
  proves the site owns it). On every push to main, the Deploy workflow sends
  the sitemap's URLs to IndexNow, so Bing (and with it ChatGPT search and
  Copilot) recrawls them in hours.
- **Crawl files**: `robots.txt` (everyone allowed, AI crawlers named, sitemap),
  `sitemap.xml` (with language alternates), `llms.txt` (a plain-text summary
  for language models, with the key facts and links) and `404.html` (so
  unknown URLs return a real 404 instead of the map).
- The About panel links to the guides (web only; the Android app doesn't
  bundle them).
- `web/js/seo.test.mjs` keeps it consistent: sitemap ↔ files, canonical,
  unique titles and descriptions, `hreflang` both ways, JSON-LD parses, FAQ
  shown on the page, `llms.txt` links. `live-smoke.mjs` loads two guides
  without JavaScript and fetches the crawl files.

## Keeping it right

- **The compensation pages are legal information.** Review them whenever
  Renfe or the law changes, and at least every 3 months: update the text,
  "Revisado el / Reviewed", `dateModified` in the JSON-LD, `lastmod` in
  `sitemap.xml` and the facts in `llms.txt`. As of 10 November 2026 the
  Sustainable Mobility Act provision (50 % from 15 min, 100 % from 30) is not
  applied by Renfe; when that changes, these pages must change the same day.
- A new page: add it to `sitemap.xml`, `tools/build-web.sh` (copy for the
  web, remove for Android) and, if useful to assistants, `llms.txt`.

## Why an assistant may still say "there's no such app"

Assistants answer from a search index (ChatGPT and Copilot: Bing; Gemini and
AI Overviews: Google; Perplexity: its own and Bing) or from training data.
A page they haven't indexed doesn't exist for them, however good it is. In
November 2026 a web search for "mytrainradar.com" found nothing: the site
wasn't indexed yet. Being indexed takes days to weeks after submitting the
sitemap; being *recommended* also needs other sites to mention TrainRadar.

## Outside the code (maintainer)

1. **Cloudflare: don't block AI crawlers.** Cloudflare can block AI bots for a
   domain (Security → Bots, "Block AI bots" / AI Crawl Control) and can
   replace `robots.txt` with a managed one. For mytrainradar.com, set AI
   crawlers to *allowed* and turn the managed `robots.txt` off, or this
   work has no effect on ChatGPT, Claude or Perplexity.
2. **One address.** Redirect `www.mytrainradar.com` and `trainradar.pages.dev`
   to `https://mytrainradar.com/` with a 301 (Cloudflare → Rules → Redirect
   Rules, or Bulk Redirects). The pages already declare the canonical URL.
3. **Google Search Console**: add the domain property, submit
   `https://mytrainradar.com/sitemap.xml`, and request indexing of the four
   guides. Check "Enhancements" for structured-data errors.
4. **Bing Webmaster Tools**: same (import from Search Console works). Bing's
   index feeds ChatGPT search and Copilot.
5. **When the app is public on Google Play**: set `playUrl` in
   `web/js/config.js`, and add the Play URL to the `WebApplication` /
   `Organization` `sameAs` in `web/index.html` and to `llms.txt`.
6. **Mentions elsewhere** matter more than anything on the site: answer
   engines quote sources that others cite. The GitHub README, a Play listing,
   forum and Reddit answers about Renfe delays and compensation, and press
   coverage of punctuality figures all help.

## Ideas for later

- A page per Cercanías network and per high-speed corridor with live links
  and the line's punctuality.
- A monthly punctuality report (from the history recorder): original numbers
  are what assistants and journalists cite most.
