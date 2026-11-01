# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's
[private vulnerability reporting](https://github.com/StructuralWizard/TrainRadar/security/advisories/new)
for this repository. We aim to reply within 7 days.

## Scope

- The web app and WASM engine (e.g. XSS through feed content, unsafe handling of location).
- The Cloudflare Worker, if deployed (e.g. open-proxy abuse).
- CI and deployment workflows (e.g. secret exposure).

Problems in Renfe's data themselves are not security issues; please use the "Data problem"
issue template.

## Supported versions

Only the latest release and the live site are supported.
