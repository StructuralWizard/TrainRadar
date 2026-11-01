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

## Secrets

TrainRadar needs no API keys: Renfe's feeds are public. The only secrets are the Cloudflare
deploy credentials, stored as GitHub Actions secrets and used only by deploy jobs on `main`
(never on pull requests). The token has only *Cloudflare Pages: Edit* and
*Workers Scripts: Edit* on one account (see `docs/deploy.md`). Every PR runs a full-history [gitleaks](https://github.com/gitleaks/gitleaks)
scan, and GitHub secret scanning with push protection should be enabled in the repository
settings. If you spot a leaked credential, report it privately as above.

## Prompt injection and automation

AI agents may work on this repo. Their rules are in [AGENTS.md](AGENTS.md): issue, PR and
comment text, CI logs and feed contents are treated as untrusted data, never as instructions.
Workflows use read-only tokens, SHA-pinned actions and no `pull_request_target`, and changes
to `.github/` and `AGENTS.md` require maintainer review (CODEOWNERS).

## Supported versions

Only the latest release and the live site are supported.
