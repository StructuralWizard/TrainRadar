# Plan: travellers' reports

Status: **proposed 2026-11-22**, nothing built yet. It needs the maintainer's decisions
([end of this page](#decisions-for-the-maintainer)) and a lawyer's review of the privacy changes
before any code. Not legal advice.

The maintainer's request:
- Travellers who agree tell each other about incidents before the official feed does: "5 viajeros
  informan de un retraso en este tren", or a cancellation, or an accident.
- Reports are fixed choices, never free text.
- The user's location is used, anonymously, to check that a report is plausible.
- The consent switch sits with the request to download train data.
- The aim: people can trust what they see.

## What travellers can report

Phase 1:

| Report | Where the reporter must be | Shown as |
|---|---|---|
| Retraso / parado | on the train | "5 viajeros informan de que este tren va con retraso" |
| No ha pasado / cancelado | at a station on its route, around its time there | "… de que este tren no ha pasado" |
| Accidente o incidente grave | on the train, or at a station on its route | "… de un accidente o incidente grave (sin confirmar)" |

Phase 2: crowding, a platform change, a lift out of service, a replacement bus.

## The location check

### Option A, recommended: on the phone

1. **The check.** When someone reports, the app takes one location fix, in the foreground only, with
   the permission it already asks for "Usar mi ubicación". It compares the fix with what it already
   knows:
   - **on the train:** within 300 m of the train's track between its previous and next stops, and
     within 3 km of where the engine places the train. "¿Voy en este tren?" (`onboard.rs`) already
     does this kind of check, but it needs the train to be moving; a stopped train needs this
     distance check instead;
   - **at a station:** within 400 m of a station on the train's route, between 30 minutes before
     and 90 minutes after the train's time there.

   If neither holds, nothing is sent: "Parece que no estás en este tren ni en una de sus
   estaciones".
2. **What leaves the phone. No coordinates.**
   - the train and the report;
   - the check's result (on the train or at station X) and a distance band (under 300 m, under
     1 km, under 3 km);
   - the fix's accuracy band;
   - the time;
   - the app version;
   - a Google Play Integrity token (see below);
   - a random token that changes every month.
3. **What the server checks:**
   - the train exists and is running;
   - the station is on its route and the time fits;
   - Play Integrity says it's the real app on a real phone;
   - limits per token: one report per train every 10 minutes, 20 a day;
   - impossible combinations: the same token on two trains at once, or "parado" while the train's
     GPS shows it moving fast.

### Option B: on the server

- The phone sends its fix once, rounded to about 100 m. The server checks it against its own train
  positions, then discards it: never stored, never logged.
- **The advantage:** a modified app can't fake the result of the check.
- **The cost:** location leaves the phone.
  - The AGENTS.md rule "Location data never leaves the browser" would have to change.
  - Play's data safety form would declare location as collected.
  - A data protection impact assessment would be clearly needed.

**Why A is still recommended:** both options trust the position the phone gives. Someone set on
cheating can fake that position as easily as the check's result. What actually stops abuse is the
same in A and B: Play Integrity, the limits, and several phones having to agree.

### Not with every download

The location isn't attached to the app's regular data downloads:
- those downloads come from the CDN cache and never reach our code;
- sending a location with each one would follow people continuously. That would need heavier
  consent, a data protection impact assessment, and Play's background-location review for the alerts
  that run in the background.

It's used only when someone reports, and, in option A, it never leaves the phone.

## Showing reports

- **When:** only once **3 different phones** agree within 20 minutes (5 for "accidente").
- **How:** the count and the age, "5 viajeros · hace 4 min", next to what the official feed says
  ("Renfe: a su hora").
- **Where:**
  - a small badge on the train on the map;
  - a line in the train sheet;
  - a line on the station board for the trains concerned.
- **For how long:**
  - a report expires 60 minutes after the last one, or when the train's run ends;
  - when the official feed confirms it, it says "confirmado por Renfe".
- **Always with the disclaimer:** "Avisos de viajeros, no confirmados por el operador. Pueden ser
  erróneos. En una emergencia, llama al 112."
- **Reading is for everyone,** on the web too. Sending is only in the Android app, which can prove
  it's genuine.

### Can people trust it?

The status page publishes, for each report type:
- how often the official feed confirmed reports later;
- how many minutes earlier the travellers were (for example, "los avisos de viajeros se adelantaron
  6 min de media a Renfe").

That is the honest answer to "can I trust it?".

## Consent: the first-run screen

- **Where:** the first-run screen asks which countries' train data to download
  ([plan-europe.md](plan-europe.md), A7). It also carries a **separate switch, off by default**:
  "Compartir avisos con otros viajeros (anónimo). Al enviar un aviso, la app mira tu ubicación para
  comprobar que vas en el tren; tu ubicación no sale del móvil." With "Más información".
- **The download doesn't depend on it:** it works the same whether the switch is on or off. Consent
  that a service depends on isn't freely given.
- **The permission:** turning the switch on asks for Android's location permission if the app
  doesn't have it yet ("while using the app" only), after our own explanation.
- **Settings → Avisos de viajeros:**
  - on or off;
  - what is sent;
  - "borrar mis avisos" (by the phone's current token).

## Backend

- **Address:** `POST /v1/reports`, on `backend/` for Spain and `backend-eu/` for the new countries.
- **In memory:** a Durable Object per country and service day keeps the live reports.
- **What it publishes:** `<cc>/rt/reports.json`, with counts per train and report, only above the
  threshold. It's written every 30 s when something changed, and served from the CDN like the other
  live files, so reading costs nothing.
- **D1:**
  - single reports (hashed token, train, report, time, check result) for 48 hours, for abuse
    checks, then deleted;
  - daily totals per train and report, without tokens, kept for the statistics.
- **Play Integrity:**
  - The server decodes the token through Google's API. That needs a Google Cloud project linked in
    Play Console and a service-account credential, which is a new Worker secret
    (`PLAY_INTEGRITY_CREDENTIALS`) for the maintainer to approve.
  - The free daily quota is well above what we'd use; check it when setting up.
- **Costs:** negligible next to the live feeds.

## Notifications (Pro)

Saved journeys' alerts (J4) can add "Varios viajeros informan de un retraso en tu tren":
- only for delays and cancellations;
- only with 3 or more phones;
- never "accidente" until the official feed confirms it, to avoid alarm.

## Legal and store

The verified policy texts are in the appendix.

1. **AGENTS.md:**
   - **Option A:** the hard rule still holds, because coordinates never leave the phone. Add a line
     on what a report sends.
   - **Option B:** the rule changes. Only the maintainer can change it.
2. **Data protection:**
   - **Personal data:** a report says that someone was on a train at a time, which is personal data
     even without coordinates (pseudonymous). The legal basis is consent (the switch).
   - **Privacy policy:** what is sent, why, for how long, the user's rights, how to withdraw, and the
     processors (Cloudflare, and Google for Play Integrity).
   - **An impact assessment** (DPIA) before launch, because the data comes from location and the use
     is new.
3. **Google Play:**
   - **Disclosure:** our own explanation before the permission request.
   - **Data safety form:** it changes from "no data collected" to optional collection:
     - location (approximate, inferred from the train);
     - device or other ids (the monthly token);
     - possibly user content (the reports).
   - **Listing:** the store listing mentions the feature.
4. **User content and platform rules:** see the appendix for whether fixed-choice reports shown as
   counts count as user content (Play), a hosting service (EU Digital Services Act) or a
   user-to-user service (UK Online Safety Act), and the minimum each asks.
5. **Wording:** "accidente" is only ever shown as "accidente o incidente grave (sin confirmar)",
   with 5 or more phones.

## Later

- **Automatic signals.** While the app is open and "¿Voy en este tren?" says yes, it could send
  "en el tren X: parado / en marcha" every few minutes, so stopped trains are spotted without anyone
  tapping. Same consent; more data; decide after phase 1.
- **Reputation.** Phones whose reports the feed later confirmed count for more. That needs a token
  that lasts longer than a month, so it isn't in phase 1.

## Steps

- **R0:** the maintainer's decisions; a lawyer's review of the privacy policy, terms and DPIA.
- **R1, Spain:**
  - the app: switch, report button, on-phone check;
  - the backend: address, Durable Object, `reports.json`, D1;
  - Play Integrity;
  - ES and EN strings;
  - closed testing.
- **R2:** showing reports (map badge, train sheet, station board); the trust statistics; the
  notifications.
- **R3:** the UK and each new country, with the same code.
- **R4:** the phase 2 reports.

## Decisions for the maintainer

1. **Option A** (checked on the phone, no coordinates leave it) **or B** (checked on the server).
2. **The phase 1 list**, and the wording of "accidente".
3. **Thresholds:** 3 phones, and 5 for accidents.
4. **Notifications** from reports for Pro alerts.
5. **Sending only from the Android app,** reading everywhere.

## Appendix: policy texts

To be completed with the verified quotes from Google Play's policies, the GDPR and EDPB guidance,
the EU Digital Services Act and the UK Online Safety Act.
