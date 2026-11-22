# Plan: capture incidents, and tell users when a feed fails

Status: **proposed 2026-11-22**, nothing built yet.

The maintainer's request: a way to capture incidents, from three sources:
- automatic checks reported by the apps;
- reports from users;
- checks on our servers.

Failures of the data feeds are shown to users as they happen.

## What exists

- **Status files.** Each backend writes `status.json`. Spain's shows each feed's `ok`,
  `fetchedAt` and errors; the UK's shows drains, logins and back-off. The recorder also writes
  `recorder.json`.
- **Live check.** The Live check workflow runs every 30 minutes. It fails, and GitHub emails the
  maintainer, when a feed hasn't been fetched for 5 minutes or the recorder has stopped. The UK
  and Northern Ireland also have feed checks.
- **In the app:** a coloured dot (live, stale, failing) and "Sin respuesta de Renfe.
  Reintentando…".
- **User reports:** through GitHub's issue templates (bug, data problem, idea), which needs a
  GitHub account.
- **Crashes:** Play Console's Android vitals shows crashes and freezes.

## One incident model

**What an incident is:** anything wrong that users may notice:
- a feed that's down or stale;
- wrong data, such as missing trains or positions that are off;
- the site or a data domain down;
- a failed nightly build;
- an app fault seen on many phones.

**Where incidents are kept:** an `incidents` table in D1 (`backend/`) with:
- `id`;
- `source` (server, app, user or build);
- `country`, and the feed or feature;
- `kind`;
- `severity` (info, minor, major);
- `state` (open or resolved), with `started`, `last_seen` and `resolved`;
- `count`;
- `public`: whether users see it;
- a message key with its values, so the app shows it in the user's language;
- a note that only the maintainer sees.

**What users get:** every minute, the public incidents go into `status/incidents.json` on the live
domain (served from the CDN): the open ones and the last 7 days.

## 1. Checks on our servers

Every minute, a check in each backend (a Durable Object timer) turns the state of its feeds into
incidents:

- **Stale:** no new data for three times the feed's usual interval (Renfe 15–20 s → 1 min;
  Network Rail's 1-minute drain → 3 min).
- **Failing:** HTTP errors, refused logins or timeouts, several times in a row.
- **Broken:** the file doesn't decode, or is empty.
- **Mismatch:** fewer than 90 % of live updates match a trip in the timetable (the timetable and the
  live feed disagree, for example after a timetable change).
- **Volume:** far fewer trains than at the same hour last week. The delay history in D1 gives the
  baseline, Spain first.
- **Build:** the nightly reference data, or its `verify` step, failed. The previous data stays,
  with the incident "Horarios de <país> sin actualizar desde <fecha>".
- **Outside watchdog:** the GitHub Live check stays, because it also notices when Cloudflare itself
  is down.

An incident closes itself after its check has passed for 5 minutes. Countries added later get these
checks for their feeds from the country registry ([plan-europe.md](plan-europe.md), A1).

## 2. Automatic checks from the apps

The apps see problems our servers can't:
- a CDN edge serving old files;
- a data file that fails on some phones;
- the engine failing;
- a phone that can't reach a feed.

**What they send:**
- Each app counts what goes wrong, per check: `feed-fetch`, `feed-stale`, `data-load`,
  `engine-error`, `map-tiles`, `billing`, `alerts-worker`…
- With the counts: the country, the app version and the platform.
- No ids and no location. We keep no IP addresses.

**How they send it:**
- At most once an hour, and only if something was counted, to `POST /v1/health`.
- The server adds the counts up per hour.
- A count that jumps opens an incident (for example, many phones failing to load a country's data
  after a deploy).

**Consent:**
- Anonymous and on by default, with a switch "Enviar informes de errores anónimos" on the first-run
  screen and in Settings.
- The privacy policy and Play's data safety answers change: Play's form will no longer say "no data
  collected" (it gets Diagnostics, optional).
- Legal basis: legitimate interest, for a lawyer to confirm.
- Crashes stay with Android vitals: no crash-reporting SDK.

## 3. Reports from users

- **Where:** "Informar de un problema" on the train and station sheets and in Settings.
- **The choices:**
  - position wrong;
  - delay wrong;
  - train missing;
  - train shouldn't be here;
  - platform wrong;
  - station in the wrong place;
  - timetable wrong;
  - app problem;
  - other.
- **Text:** an optional short text (200 characters). Only the maintainer sees it, never other users,
  so it isn't user content in Play's sense.
- **Context the app attaches:**
  - the country, the train or station, and the time;
  - the app and data versions;
  - the feed's status at that moment.
- **Location:** never, unless the user ticks "incluir mi ubicación" (off by default), for "station
  in the wrong place".
- **Where it goes:** `POST /v1/problems`, into D1, kept 90 days.
- **Abuse:** a Cloudflare rate-limiting rule on the address. It works by IP address, but we never
  see or store the address.
- **When it becomes an incident:** several reports about the same train or station within an hour
  open one (for example, "posiciones erróneas en la línea C-5").
- The GitHub issue templates stay for people who prefer them.

## 4. Telling users

- **In the app:** a banner, in the user's language, when an open incident affects the country
  shown. It says what's wrong and what it means: "Los datos en directo de Renfe no se actualizan
  desde las 08:12. Los trenes se sitúan por horario."
  - It replaces the generic "Reintentando…".
  - Tapping it shows since when, what's affected, and updates.
- **Saved journeys (Pro alerts):** when live data for a watched journey's country has been down for
  10 minutes, one notification: "Sin datos en directo de Renfe: los avisos de tu trayecto pueden
  fallar". And one when it's back.
- **A status page on the site** (`/estado`, `/en/status`):
  - each feed (live, stale, down);
  - open incidents and the last 7 days;
  - each feed's uptime per month.
- **During an incident** the app keeps working with the last data and timetable positions, as now.

## 5. For the maintainer

- **A private page,** behind Cloudflare Access with the maintainer's login. It lists:
  - incidents;
  - the apps' counts by check and version;
  - user reports.

  From it, the maintainer can hide an incident from the public file, add a note, or mark reports as
  done.
- **Emails:** when a major incident opens and when it closes, plus a daily summary of reports. They
  are sent through Cloudflare Email Routing to the maintainer's address, with no third-party
  service.
- **GitHub's Live check emails** stay, as the outside watchdog.

## Privacy

| Source | Personal data | Kept |
|---|---|---|
| Server checks | none | incidents: 1 year |
| App counts | none (no ids, no location; IP addresses not stored) | hourly totals: 90 days |
| User reports | whatever someone types, and their location only if they tick it | 90 days, deleted on request |

**What this changes for Play and the privacy policy:**
- **Play's data safety form** no longer says "no data collected". It declares diagnostics (app
  counts) and user content (problem reports): collected, optional, not shared. Cloudflare is a
  service provider, not a third party.
- **The privacy policy** describes both.
- **EU representative.** Problem reports can contain personal data. Once they do, a UK company
  serving people in the EU may need a data protection representative in the EU (GDPR Art. 27).
  The same question comes up for [travellers' reports](plan-crowd-reports.md#legal-and-store).
  For a lawyer to confirm.

## Steps

- **I1:**
  - the incident model and server checks for Spain and the UK;
  - `incidents.json`;
  - the app banner;
  - the status page.
- **I2:** the apps' counts and `/v1/health`, with the switch, privacy policy and data safety.
- **I3:** user reports, the private page and the emails.
- **I4:** outage alerts for saved journeys (Android).
