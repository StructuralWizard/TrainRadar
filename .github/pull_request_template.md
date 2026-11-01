## What changed

<!-- Short summary. Link the issue: Closes #123 -->

## How to test

<!-- Commands to run, pages to open, what you should see. -->

## Checklist

- [ ] `cargo fmt --all` and `cargo clippy --workspace --all-targets -- -D warnings` pass
- [ ] `cargo test --workspace` passes, with tests for new logic
- [ ] WASM size change noted (see the CI size report)
- [ ] No secrets, downloaded GTFS or generated `.bin` files committed
- [ ] Everything still runs in the browser; location never leaves the device
- [ ] Attribution updated if a new data source or map layer was added
