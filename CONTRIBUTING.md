# Contributing to TrainRadar

Thanks for helping! Bug reports, data problems, ideas and pull requests are all welcome.

## Ground rules

- **Browser-first.** All fetching, parsing, matching and rendering runs in the browser.
  No server-side processing. The only allowed exception is a pass-through Cloudflare Worker
  that adds CORS headers and forwards bytes unchanged.
- **Be kind to Renfe's servers.** Never poll faster than a feed refreshes. Keep jitter,
  backoff and the hidden-tab pause.
- **Privacy.** Location stays in the browser. Never send, log or persist it.
- **No secrets or data in the repo.** Don't commit Renfe GTFS downloads or generated `.bin` files.

## Workflow

1. Open an issue first for anything bigger than a small fix.
2. Branch from `main`, e.g. `feat/nearest-stations` or `fix/delay-rounding`.
3. Use [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`,
   `docs:`, `chore:`, `refactor:`, `test:`, `ci:`.
4. Before pushing:
   ```sh
   cargo fmt --all
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --workspace
   tools/build-wasm.sh
   ```
5. Open a PR using the template. CI must pass.

## Adding another country or operator

Operator-specific parsing lives behind the `SourceAdapter` trait in
`crates/engine/src/source.rs`. Implement it for the new source rather than changing the
matching or rendering code.

## Licence of contributions

By contributing you agree your work is dual-licensed under MIT OR Apache-2.0, as described in
the README.
