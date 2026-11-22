# Registrations, secrets and variables, for every country

Part of [the Europe plan](README.md). Written 2026-11-22 for the maintainer: what to open, where,
and what to store in GitHub, so registrations run alongside the coding.

**Rules (AGENTS.md):**
- Open every account as **Metranos Ltd**, with a shared company mailbox, never a personal address.
- Keep passwords and two-factor codes in your password manager.
- Keep a private register (not in this repository) of each account: its terms, renewal date and
  contact.
- **Adding a secret to GitHub counts as your approval of it.** The PR that first uses it adds it to
  AGENTS.md's list.
- Never paste a key into a chat, an issue, a PR or a commit.

## How to store things in GitHub

Repository → **Settings → Secrets and variables → Actions**:
- **Secrets tab → New repository secret:** keys, passwords, tokens. Nobody can read them back,
  including you.
- **Variables tab → New repository variable:** on/off switches such as `FR_ENABLED`. Not secret.

**Switches.** Each country gets a `<CC>_ENABLED` variable, like `UK_ENABLED` and `IE_ENABLED`.
- Set it to `true` only when I say that country's merge is in.
- Before that it does nothing. Afterwards it starts the daily data build and the live Worker.

**How the Worker gets the key.** The deploy workflow passes each secret to the Cloudflare Worker
through stdin. You don't need to touch Cloudflare.

## The merges

Today each country takes up to four PRs. Grouping countries by the kind of feed they use cuts the
total to about seven merges for all of Europe. A country in a merge that isn't ready ships switched
off, behind its own variable, so it doesn't hold the others back.

| Merge | Countries | Why together | Needs from you before it can go live |
|---|---|---|---|
| **M1** (built) | France (and Monaco, Eurostar), Luxembourg's timetable, Ireland I3 (the Enterprise joined to NI, operator links) | Cross-border trains and shared stations are built once (plan-europe E0f) | Nothing. `FR_IDFM_PRIM_KEY` is optional (Paris suburban trains) |
| **M2** (built) | Netherlands, Finland, Norway | Open GTFS and GTFS-Realtime with no key; Finland and Norway add real GPS | Nothing (contact headers only) |
| **M3** | Switzerland, Sweden | GTFS-Realtime behind a free key, with tight quotas | `CH_OTD_*`, `SE_TRAFIKLAB_KEY`, `SE_TRAFIKVERKET_KEY` |
| **M4** | Austria, Slovakia, Slovenia, Estonia, Latvia, Lithuania, Hungary | Timetables only: no live server, the same build for all | `AT_MVO_*`; Hungary's form |
| **M5** | Germany, Poland | Each needs its own live adapter, behind a key | `DE_*`, `PL_PLK_API_KEY` |
| **M6** | Czechia, Denmark | Both need the NeTEx reader | Denmark's access point login |
| **M7** | Portugal, Belgium, Italy, Croatia, Romania, Greece | Only when the letters bring permission | Replies to the letters |

**The trade-off.** Bigger PRs take longer to review, and one failing test holds the whole merge.
Inside each PR I keep one commit per country, and each country has its own tests and switch.

## What to register, in order

Status: **needed** blocks a merge; **optional** improves it; **later** waits for a decision.

### Already done

| GitHub name | Kind | For |
|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | secrets | deploys |
| `NAP_API_KEY` | secret | Spain, OUIGO's timetable |
| `NETWORK_RAIL_USERNAME`, `NETWORK_RAIL_PASSWORD`, `NATIONAL_RAIL_KB_KEY` | secrets | UK |
| `UK_ENABLED` | variable | UK |
| `IE_NTA_API_KEY` | secret | Ireland. Keep the NTA's **secondary** key in your password manager, for rotation only |
| `IE_ENABLED` | variable | Ireland |

### M1: France, Luxembourg, Ireland I3

1. **Île-de-France Mobilités PRIM** (optional: Transilien and RER live data).
   - Where: `prim.iledefrance-mobilites.fr` → create an account → subscribe to the real-time APIs
     ("Prochains passages" / GTFS-RT).
   - You get: an API key.
   - GitHub: secret `FR_IDFM_PRIM_KEY`.
2. **data.gouv.fr** (later: only if republishing a derived timetable turns out to be required).
   - Where: `www.data.gouv.fr` → account → profile → API key.
   - GitHub: secret `FR_DATAGOUV_API_KEY`.
3. **Luxembourg, ATP** (later: live departures).
   - Their key goes in the URL, which AGENTS.md forbids. **Don't register yet.** First email
     `opendata-api@atp.etat.lu` asking whether the key can be sent in a header instead.
   - GitHub, if they agree: secret `LU_ATP_API_KEY`.
4. **Variables:** `FR_ENABLED` and `LU_ENABLED`, once M1 is merged. Then run the Deploy workflow once
   (Actions → Deploy → Run workflow), so the live Worker starts France's feed.

### M2: Netherlands, Finland, Norway

No accounts needed. The code sends headers that name the app: `Metranos/TrainRadar` plus the
company's contact address, which I'll ask you for when building M2.
1. **NS API portal** (optional: Dutch disruptions).
   - Where: `apiportal.ns.nl` → sign up → Products → subscribe to "Ns-App" (disruptions).
   - You get: a primary and a secondary key; store the primary.
   - GitHub: secret `NL_NS_API_KEY`.
2. **Bane NOR API portal** (optional; only if its SIRI adds something to Entur). Wait until I ask.
   - GitHub: secret `NO_BANENOR_KEY`.
3. **Variables:** `NL_ENABLED`, `FI_ENABLED` and `NO_ENABLED`, set before merging M2 (the merge's
   deploy then reads them).

### M3: Switzerland, Sweden

1. **opentransportdata.swiss** (needed).
   - Where: `api-manager.opentransportdata.swiss` → register as a company → create one key per API:
     - "GTFS-RT" → secret `CH_OTD_GTFSRT_KEY`;
     - "SIRI-SX" (disruptions) → secret `CH_OTD_SIRISX_KEY`.
   - Free under the limits (a few calls a minute); a paid contract above them.
2. **Trafiklab** (needed).
   - Where: `www.trafiklab.se` → account → create a project → add "GTFS Sweden 3" (static and
     realtime) and "GTFS Sverige 2".
   - Ask for the **Silver** level on the project (free, usually granted); Bronze is too small.
   - GitHub: secret `SE_TRAFIKLAB_KEY`. If the project gives separate keys for static and realtime,
     add both as `SE_TRAFIKLAB_STATIC_KEY` and `SE_TRAFIKLAB_RT_KEY` instead, and tell me.
3. **Trafikverket open API** (needed).
   - Where: `data.trafikverket.se` → register → create an API key.
   - GitHub: secret `SE_TRAFIKVERKET_KEY`.
4. **Variables when I say:** `CH_ENABLED`, `SE_ENABLED`.

### M4: timetable-only countries

1. **Mobilitätsverbünde Österreich** (needed for Austria).
   - Where: `data.mobilitaetsverbuende.at` → register → accept the data licence → request
     "Fahrplandaten Eisenbahn (GTFS)".
   - Read the licence when you accept it, and tell me if it limits commercial use.
   - GitHub: secrets `AT_MVO_USERNAME`, `AT_MVO_PASSWORD`.
2. **MÁV GTFS** (needed for Hungary).
   - Where: `mavcsoport.hu/gtfs-igenybejelento` → choose rail → company details.
   - What it gives is unverified. Tell me what arrives (a link, a login or a key) and I'll name the
     secret; probably `HU_MAV_GTFS_KEY`. Ask in the same form whether GTFS-RT is included.
3. **Nothing to register** for Slovakia, Slovenia, Estonia, Latvia or Lithuania.
4. **Variables when I say:** `AT_ENABLED`, `HU_ENABLED`, `SK_ENABLED`, `SI_ENABLED`,
   `EE_ENABLED`, `LV_ENABLED`, `LT_ENABLED`.

### M5: Germany, Poland

1. **opendata-oepnv.de, DELFI** (needed: the national timetable).
   - Where: `www.opendata-oepnv.de` → register as a company, with a short project description
     ("TrainRadar, a live train map and journey planner") → request the "Deutschland GTFS" dataset.
   - The form is `www.opendata-oepnv.de/ht/de/standards/registrierung`: tick **DELFI** under
     "Datensätze". Questions go to the portal's OpenData team, `opendata-oepnv@vrr.de` (from its
     Impressum).
   - Ignore the portal's "API" page: those are regional journey planners (VRR, HVV, MVV…), not
     DELFI's national timetable.
   - GitHub: secrets `DE_DELFI_USERNAME`, `DE_DELFI_PASSWORD`.
2. **DB API Marketplace** (needed: live departures).
   - Where: `developers.deutschebahn.com` → sign in with a DB account → create an application →
     subscribe it to "OpenBoards" (free plan) and "FaSta" (lifts).
   - DB activates subscriptions by hand, and nobody is entitled to one.
   - Read OpenBoards' terms, the bahnhof.de "Web Bahnhofstafel" terms, before accepting, and send me
     anything about commercial use.
   - Questions: `api-marketplace@deutschebahn.com` (from the portal's contact page).
   - GitHub: secrets `DE_DB_CLIENT_ID`, `DE_DB_API_KEY`.
3. **PKP PLK "Otwarte Dane Kolejowe"** (needed for Poland).
   - Where: the "Wniosek o Klucz API" form on `pdp-api.plk-sa.pl`. The key is shown once, at once;
     confirm the email link within 7 days, then an administrator approves it in 3–5 working days.
   - The key goes in the `X-API-Key` header. A forgotten key can be replaced without a new
     application ("Zmień klucz bez nowego wniosku").
   - **Read "Regulamin v1.0" before accepting.** PLK may charge for real-time access.
   - GitHub: secret `PL_PLK_API_KEY`.
4. **Variables when I say:** `DE_ENABLED`, `PL_ENABLED`.

**Start M5's registrations first, even though M5 comes later.** DB's and PLK's approvals are manual.

### M6: Czechia, Denmark

1. **Dataudveksleren** (needed for Denmark; Vejdirektoratet's national access point).
   - It logs in with MitID. First check whether a UK company can get a profile; if not, email
     Vejdirektoratet asking for another route.
   - GitHub: tell me what it gives and I'll name it (`DK_NAP_…`).
2. **Czechia:** nothing to register.
3. **Variables when I say:** `CZ_ENABLED`, `DK_ENABLED`.

### M7: countries waiting for permission

1. **Belgium's access point.**
   - Where: `transportdata.be` → account → subscribe to SNCB's GTFS and GTFS-RT.
   - You get: a subscription key → secret `BE_SNCB_KEY`.
   - Register only once SNCB says yes in writing to commercial use. The access point marks the data
     non-commercial.
2. **Letters** from Metranos Ltd; nothing to store until they reply:
   - Portugal: CP (`institucional@cp.pt`, the email already drafted) and IP;
   - Belgium: SNCB;
   - Ireland: the NTA (confirm the fair-use clause) and Irish Rail (its realtime API);
   - Austria: ÖBB (live data);
   - Czechia: SŽ; Slovakia: ŽSR; Hungary: MÁV; Romania: ARF/Infofer; Croatia: HŽPP;
   - Estonia: Elron;
   - Italy: Trenitalia and RFI;
   - Greece: Hellenic Train and the Ministry.
3. **Variables when I say:** `PT_ENABLED`, `BE_ENABLED`, `IT_ENABLED`, `HR_ENABLED`,
   `RO_ENABLED`, `GR_ENABLED`.

### Not countries: the other plans

1. **YouTube Data API** (optional: chapters for the cab-ride videos, V3).
   - Where: `console.cloud.google.com` → new project "TrainRadar" → APIs & Services → enable
     "YouTube Data API v3" → Credentials → Create API key → restrict it to that API only.
   - GitHub: secret `YOUTUBE_API_KEY`.
2. **Play Integrity** (later: travellers' reports, if you choose that option).
   - Where: Google Cloud, in the project linked to the Play Console → a service account with the
     Play Integrity API → create a JSON key.
   - GitHub: secret `PLAY_INTEGRITY_CREDENTIALS`, the whole JSON file pasted as the value.

## Checklist

| GitHub name | Kind | Merge | Status |
|---|---|---|---|
| `FR_IDFM_PRIM_KEY` | secret | M1 | optional |
| `FR_DATAGOUV_API_KEY` | secret | M1 | later |
| `LU_ATP_API_KEY` | secret | M1 | later (header question first) |
| `NL_NS_API_KEY` | secret | M2 | optional |
| `NO_BANENOR_KEY` | secret | M2 | later |
| `CH_OTD_GTFSRT_KEY`, `CH_OTD_SIRISX_KEY` | secrets | M3 | needed |
| `SE_TRAFIKLAB_KEY` | secret | M3 | needed |
| `SE_TRAFIKVERKET_KEY` | secret | M3 | needed |
| `AT_MVO_USERNAME`, `AT_MVO_PASSWORD` | secrets | M4 | needed |
| `HU_MAV_GTFS_KEY` (name to confirm) | secret | M4 | needed |
| `DE_DELFI_USERNAME`, `DE_DELFI_PASSWORD` | secrets | M5 | needed; start now |
| `DE_DB_CLIENT_ID`, `DE_DB_API_KEY` | secrets | M5 | needed; start now |
| `PL_PLK_API_KEY` | secret | M5 | needed; start now |
| `DK_NAP_…` (name to confirm) | secret | M6 | needed |
| `BE_SNCB_KEY` | secret | M7 | after SNCB's permission |
| `YOUTUBE_API_KEY` | secret | cab rides | optional |
| `PLAY_INTEGRITY_CREDENTIALS` | secret | reports | later |
| `<CC>_ENABLED` | variable | each | when I say |
