# Plan: travellers' reports

Status: **R1 and R2 built for the UK only (2026-11-28), off until set up** ([deploy.md](deploy.md#travellers-reports-uk-docsplan-crowd-reportsmd)).
The maintainer chose: option A (the check on the phone), the UK only (Metranos is a UK company;
no EU representative for now), the defaults below (phase 1 list, 3 phones and 5 for accidents),
no notifications from reports yet. Built:
- the app (`web/js/reports.js`): consent screen, "Tell other travellers" on the train sheet, the
  on-phone check, counts on the train sheet and station boards with "Not right?", Settings (on or
  off, delete my reports); Play Integrity (`TrainRadarPlugin.integrityToken`);
- the Worker (`backend-reports/`): `POST /v1/reports`, `/dispute`, `/forget`, a Durable Object
  per country, `uk/rt/reports.json`;
- the privacy policy and terms sections (drafts).

How long reports last (as built):
- **Shown:** once 3 phones agree within 20 minutes (5 for accidents); until 60 minutes after the
  last report; each "Not right?" from a non-reporter lowers the count.
- **Resolved by official data:** when the operator's data for the train (in the UK, TRUST's
  latest movement) is newer than the last report and says otherwise (a reported delay but now
  2 min late or less; "hasn't come" but now running), the app shows a muted "since then the
  official data says…" line instead of the warning, and leaves it off station boards. Accidents
  and incidents only expire.
- **Undo:** for a minute after sending (`POST /v1/reports/undo`, the phone's own code only).
- **Kept:** single reports and "Not right?" 48 hours; daily totals 60 days, without codes or
  trains. "Delete my reports" removes everything sent with this month's code at once.

Still to do before users see it: the short DPIA, a lawyer's look at the policy and terms, the Play
data safety form, `PLAY_INTEGRITY_CREDENTIALS`, then `REPORTS_ENABLED=true`. Not built: the map
badge, the trust statistics, notifications. Not checked server-side: that the train exists and
the station is on its route (the Worker has no timetable); Play Integrity, the limits and the
agreement of several phones stand in for it.

In the UK the UK GDPR still applies (consent, privacy policy, the DPIA the ICO expects for
location combined with an identifier) and Metranos needs to pay the ICO's data protection fee if
it doesn't already. The Online Safety Act's "limited functionality" exemption very likely covers
fixed-choice reports.

This is research for a plan, not legal advice. The policy texts are quoted in the
[appendix](#appendix-the-rules-quoted), checked on 2026-11-22.

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

1. **The check.** When someone reports, the app takes one location fix, in the foreground only. It
   compares the fix with what it already knows:
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
   - the check's result (on the train, or at station X) and a distance band (under 300 m, under
     1 km, under 3 km);
   - the fix's accuracy band;
   - the time;
   - the app version;
   - a Google Play Integrity token (see Backend);
   - a random token that changes every month.
3. **What the server checks:**
   - the train exists and is running;
   - the station is on its route and the time fits;
   - Play Integrity says it's the real app on a real phone;
   - limits per token: one report per train every 10 minutes, 20 a day;
   - impossible combinations: the same token on two trains at once, or "parado" while the train's
     GPS shows it moving fast.

**Precision.** The check needs a precise fix: an approximate one (about 3 km²) can't tell parallel
lines apart. The app already asks for precise location for "Usar mi ubicación".

### Option B: on the server

- The phone sends its fix once, rounded to about 100 m. The server checks it against its own train
  positions, keeps it only in memory, and discards it: never written to Durable Object storage, R2,
  D1 or logs.
- **The advantage:** a modified app can't fake the result of the check.
- **On Play's form:** handled like that, the location counts as "processed ephemerally". It is still
  declared in the form, but not shown on the store page.
- **The cost:** location leaves the phone.
  - The AGENTS.md hard rule "Location data never leaves the browser" changes, and with it the
    comments in the Android manifest and `web/js/location.js`. Only the maintainer can change that
    rule.
  - Coordinates passing through Cloudflare's edge need care everywhere: no request logging, no
    Workers Logs on that path.

**Why A is still recommended:** both options trust the position the phone gives. Someone set on
cheating can fake that position as easily as the check's result. What actually stops abuse is the
same in A and B:
- Play Integrity;
- the limits;
- several phones having to agree;
- other travellers saying "no es así".

A keeps coordinates on the phone, so the hard rule, the comments and the privacy policy's location
paragraph stay true.

### Not with every download

The location isn't attached to the app's regular data downloads:
- those downloads come from the CDN cache and never reach our code;
- sending a location with each one would follow people continuously. That would need heavier
  consent, a data protection impact assessment, and Play's background-location review (the alerts
  run in the background).

It's used only when someone reports.

## Showing reports

- **When:** only once **3 different phones** agree within 20 minutes (5 for "accidente").
- **How:** a count with its time window, next to what the official feed says: "5 viajeros en los
  últimos 20 min · Renfe: a su hora".
- **Wording:**
  - always "X viajeros informan…";
  - never "el tren va con retraso", because a sentence written by our code may count as our own
    statement.
- **Where:**
  - a small badge on the train on the map;
  - a line in the train sheet;
  - a line on the station board for the trains concerned.
- **"¿No es así?"** next to each count (like Waze's "There / Not there"). It lowers the count,
  counts towards abuse checks, and is the notice-and-action route the EU's Digital Services Act asks
  for.
- **For how long:**
  - a report expires 60 minutes after the last one, or when the train's run ends;
  - when the official feed confirms it, it says "confirmado por Renfe".
- **Disclaimer, always shown:** "Avisos de viajeros de TrainRadar en los últimos 20 min. No
  confirmados por el operador. Consulta Renfe/Adif." For "accidente", also "En una emergencia,
  llama al 112".
- **Reading is for everyone,** on the web too. Sending is only in the Android app, which can prove
  it's genuine.

### Can people trust it?

The status page publishes, for each report type:
- how often the official feed confirmed reports later;
- how many minutes earlier the travellers were (for example, "los avisos de viajeros se adelantaron
  6 min de media a Renfe").

That is the honest answer to "can I trust it?".

## Consent

The request asked for the switch to sit with the request to download train data. That works, with
care.

### Google Play's rules

- **A separate disclosure.** Play wants the explanation of what we collect, and why, to be its own
  disclosure. It "cannot be included with other disclosures unrelated to personal and sensitive user
  data collection".
- **Immediately before.** It must come immediately before the consent and the Android permission
  request.
- **An action.** Consent needs an affirmative action, such as a tap or a tick.

### The data protection rules

- **Free.** Consent must be freely given, so the download can't depend on it.
- **Separate.** It must be separate from everything else on the screen.
- **Not pre-ticked.** A pre-ticked switch isn't consent.

### The flow

1. **First run** ("¿Qué países quieres?", [plan-europe.md](plan-europe.md), A7):
   - a visually separate block with its own short text and a switch, **off by default**: "Compartir
     avisos con otros viajeros (anónimo)";
   - "Descargar" never turns it on, and the download is identical either way.
2. **Turning it on, here or later:**
   - opens a full-screen explanation of its own: what is sent, why, for how long, who processes it,
     how to withdraw, and the rules (no false or automated reports);
   - with "Aceptar" and "No, gracias";
   - "Aceptar" is followed at once by Android's location permission request ("while using the app"),
     if the app doesn't have it.
3. **First tap on "Avisar"** without consent: the same screen, then the permission.
4. **Settings → Avisos de viajeros:**
   - on or off, which withdraws consent as easily as it was given;
   - what is sent;
   - "borrar mis avisos", by the phone's current token.

## Backend

- **Address:** `POST /v1/reports`, on `backend/` for Spain and `backend-eu/` for the new countries.
- **In memory:** a Durable Object per country and service day keeps the live reports, restricted to
  the EU jurisdiction for EU countries.
- **What it publishes:** `<cc>/rt/reports.json`, with counts per train and report, only above the
  threshold. It's written every 30 s when something changed, and served from the CDN like the other
  live files, so reading costs nothing.
- **D1:**
  - single reports (hashed token, train, report, time, check result) for 48 hours, for abuse checks,
    then deleted;
  - daily totals per train and report, without tokens, for the statistics.
- **Play Integrity:**
  - The server decodes the token through Google's API. That needs a Google Cloud project linked in
    Play Console and a service-account credential: a new Worker secret,
    `PLAY_INTEGRITY_CREDENTIALS`, for the maintainer to approve.
  - The free daily quota is well above what we'd use; check it when setting up.
- **Costs:** negligible next to the live feeds.

## Notifications (Pro)

Saved journeys' alerts (J4) can add "Varios viajeros informan de un retraso en tu tren":
- only for delays and cancellations;
- only with 3 or more phones;
- never "accidente" until the official feed confirms it, to avoid alarm.

## Legal and store

1. **AGENTS.md.** With option A, the hard rule still holds; add a line saying what a report sends.
   With option B, the rule changes (maintainer only).
2. **Data protection.**
   - **Personal data:** a report is personal data while we process it. It says someone was on a
     train at a time, and it's pseudonymous at best, because of the token and the IP address that
     every request carries. The published counts are anonymous.
   - **Consent:** the legal basis. It also covers the EU ePrivacy rule, which applies once anything
     derived from the phone's location leaves the phone.
   - **Privacy policy**, at least: who we are, the purpose, what is sent, the legal basis, recipients
     (Cloudflare as processor, Google for Play Integrity), retention, how to withdraw, and the right
     to complain.
   - **Impact assessment:** a single fix, triggered by the user and deleted at once, probably meets
     only one high-risk criterion. But location data plus a unique id from a mobile app is two of
     the Spanish regulator's criteria, so **do a short DPIA**.
   - **Where it lives:** Durable Objects and R2 can be restricted to the EU. Workers run wherever the
     user is, so nothing on that path logs reports.
3. **Representatives in the EU.** A UK company offering this to people in Spain would likely need:
   - an EU representative for data protection (GDPR Art. 27; the exception for occasional, low-risk
     processing is for a lawyer to judge);
   - an EU legal representative under the Digital Services Act (Art. 13), which has no exemption
     for small companies.

   These are paid services. They are the most concrete new cost of this feature.
4. **Digital Services Act.** Storing reports makes TrainRadar a hosting service.
   - **An online platform?** Whether counts make it one is arguable. The exception for a "minor and
     purely ancillary feature" is a good argument, and even as a platform, a micro company is exempt
     from most platform duties (Art. 19).
   - **What remains:**
     - points of contact (Arts. 11–12);
     - terms that describe the moderation (Art. 14);
     - an easy notice-and-action route (Art. 16: "¿No es así?" and a contact form);
     - informing the authorities of threats to life or safety (Art. 18).
   - Statements of reasons (Art. 17) mostly don't apply, because reporters are anonymous.
5. **UK Online Safety Act.** Reports about trains, chosen from a fixed list, are a strong candidate
   for the "limited functionality" exemption: rating, scoring or voting on the provider's own
   content.
6. **Google Play.**
   - **User content.** There is no exemption for fixed choices or counts, so treat the reports as user
     content:
     - users accept the rules when they turn reports on;
     - the rules ban false or automated reports;
     - "¿No es así?" lets people flag a count;
     - we can drop reports and tokens.
   - **Data safety form.** It changes from "no data collected" to:
     - App activity (the reports): collected, optional, for app functionality and fraud prevention,
       not shared;
     - Device or other IDs (the hashed monthly token).

     With option B, add precise location: collected, processed ephemerally, optional.
   - **Disclosure and consent:** as in [Consent](#consent).
   - **Precise location declaration.** Every app that asks for precise location must complete a
     declaration in Play Console by **27 January 2027**. TrainRadar already asks for it ("Usar mi
     ubicación"), so this applies with or without reports: see
     [play-store.md](play-store.md#precise-location-declaration).
   - **Android 17.** For apps that target Android 17 (API 37), a one-off precise fix should come from
     Android's new location button. That's a native control, so the app would need a small native
     bridge (unverified for a WebView app).
7. **Liability.**
   - **Our own statements:** the hosting protections cover what users send, not what we write.
     That's why the app shows counts with a time window and never states that a train is late.
   - **The terms of use:** reports come from users; they may be wrong; they're never for safety
     decisions.

## Later

- **Automatic signals.** While the app is open and "¿Voy en este tren?" says yes, it could send
  "en el tren X: parado / en marcha" every few minutes, so stopped trains are spotted without anyone
  tapping. Same consent, but more data, so the DPIA would need redoing. Decide after phase 1.
- **Reputation.** Phones whose reports the feed later confirmed count for more. That needs a token
  that lasts longer than a month, so it isn't in phase 1.

## Steps

- **R0:** the maintainer's decisions, then a lawyer's review:
  - privacy policy and terms;
  - the DPIA;
  - the GDPR and DSA representatives;
  - the consent flow.
- **R1, Spain:**
  - the app: switch, consent screen, report button, on-phone check;
  - the backend: address, Durable Object, `reports.json`, D1;
  - Play Integrity;
  - ES and EN strings;
  - Play's data safety form;
  - closed testing.
- **R2:** showing reports (map badge, train sheet, station board, "¿No es así?"); the trust
  statistics; notifications.
- **R3:** the UK and each new country, with the same code.
- **R4:** the phase 2 reports.

## Decisions for the maintainer

1. **Option A** (checked on the phone, no coordinates leave it) **or B** (checked on the server,
   coordinates in memory only).
2. **The phase 1 list**, and the wording of "accidente".
3. **Thresholds:** 3 phones, and 5 for accidents.
4. **Notifications** from reports for Pro alerts.
5. **EU representatives:** whether to take on the GDPR and DSA representatives this feature brings.
   Without them, reports could be offered in the UK only.

## Appendix: the rules, quoted

Checked 2026-11-22. Not legal advice.

- **Google Play, User Data: prominent disclosure**
  ([10144311](https://support.google.com/googleplay/android-developer/answer/10144311)). The
  disclosure:
  - "Must be within the app itself, not only in the app description or on a website";
  - "Must be displayed in the normal usage of the app and not require the user to navigate into a
    menu or settings";
  - "Must describe the data being accessed or collected";
  - "Must explain how the data will be used and/or shared";
  - "Cannot only be placed in a privacy policy or terms of service";
  - "Cannot be included with other disclosures unrelated to personal and sensitive user data
    collection".

  And: "Requests for in-app user consent and runtime permission requests must be immediately preceded
  by an in-app disclosure". Consent "Must require affirmative user action (for example, tap to
  accept, tick a check-box)" and "Must not interpret navigation away from the disclosure … as
  consent".
- **Location permissions**
  ([9888170](https://support.google.com/googleplay/android-developer/answer/9888170)):
  - "Apps should request the minimum scope necessary (for example, coarse instead of fine, and
    foreground instead of background)".
  - Background location needs approval through the declaration process
    ([9799150](https://support.google.com/googleplay/android-developer/answer/9799150)).
- **Location button and the precise-location declaration**
  ([17033915](https://support.google.com/googleplay/android-developer/answer/17033915)):
  - "All apps requesting precise location (ACCESS_FINE_LOCATION) must complete a declaration in the
    Play Console".
  - Compliance is mandatory from 27 January 2027.
  - For apps targeting Android 17 and higher, the location button is "the required minimum scope
    method for obtaining precise location for 'transactional' (one-time) use cases".
- **User Generated Content**
  ([9876937](https://support.google.com/googleplay/android-developer/answer/9876937)):
  - The definition: "content that users contribute to an app, and which is visible to or accessible
    by at least a subset of the app's users".
  - The app must require that users "accept the app's terms of use and/or user policy before users
    can create or upload UGC", and must provide "an in-app system for reporting and blocking
    objectionable UGC and users".
- **Data safety**
  ([10787469](https://support.google.com/googleplay/android-developer/answer/10787469)):
  - "Collect" means "transmitting data from your app off a user's device".
  - Ephemeral processing is "accessing and using it while the data is only stored in memory and
    retained for no longer than necessary to service the specific request in real-time". Such data is
    declared in the form but not shown on the store page.
  - "User data collected pseudonymously must be disclosed."
- **GDPR:**
  - Art. 4(1) names "location data" as an identifier.
  - Recital 26: pseudonymised data is still personal data.
  - Art. 7(4) and recital 43: consent isn't free if a service depends on it.
  - Recital 32: "Silence, pre-ticked boxes or inactivity should not therefore constitute consent".
  - EDPB Guidelines 05/2020 §71: "the consent request has to be separate and distinct".
  - EDPB Guidelines 04/2020 §18: location data "cannot be anonymised on their own".
- **ePrivacy:** EDPB Guidelines 2/2023 §44 says on-device location is outside Art. 5(3) "as long as
  the information does not leave the device, but when this information or any derivation of this
  information is accessed, Article 5(3) ePD would apply".
- **Impact assessment:**
  - Two of the WP248 criteria usually mean a DPIA.
  - The AEPD's list covers "geolocalización" and "identificadores únicos… aplicaciones móviles".
  - The ICO says a DPIA is required for geolocation "when combined with any other criterion".
- **Digital Services Act (EU 2022/2065):**
  - Art. 19(1) exempts micro and small online platforms from Arts. 20–28 (except 24(3)).
  - Art. 13: a legal representative in the EU for providers outside it.
  - Art. 16: notice and action.
- **UK Online Safety Act 2023:** Schedule 1 para 4 exempts services where users only post comments
  or reviews on provider content, vote yes/no, or rate or score it.
