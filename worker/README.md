# trainradar-proxy (Cloudflare Worker)

Renfe's realtime feeds send no CORS headers, so a browser on another site can't
read them. This Worker is the smallest possible fix:

- Only five paths are allowed: the GTFS-RT `.pb` feeds listed in
  `src/index.js`. Everything else is a 404, and Renfe is never contacted for it.
- The response body is Renfe's bytes, **unchanged**. No parsing or logic.
- CORS is granted only to TrainRadar's own origins (`ALLOWED_ORIGINS` in
  `wrangler.toml`), so other websites can't use it.
- Edge cache: 15 s, the fastest feed refresh. `Cache-Control: max-age=15`.

Test: `node --test worker/test/index.test.mjs`. Deployed by `.github/workflows/deploy.yml`
(see `docs/deploy.md`), with `ALLOWED_ORIGINS` set to the live site's URL.

Free-tier note: Cloudflare Workers allow 100,000 requests per day. With
polling every 30 s, one visitor with AV/LD/MD plus one Cercanías region open
makes ~480 requests per hour, so the free tier covers roughly 200 hours of
viewing per day. Polling pauses when the tab is hidden.
