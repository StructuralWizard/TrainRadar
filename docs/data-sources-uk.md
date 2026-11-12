# UK data sources (Network Rail open data)

Status: **measured on 2026-11-12** by the "UK feed check" workflow
(`.github/workflows/uk-feed-check.yml`, run 1, from GitHub's runners) with the maintainer's
Network Rail open data account. Re-run it any time; the plan is [plan-uk.md](plan-uk.md).

## Live topics (STOMP)

`publicdatafeeds.networkrail.co.uk:61618`, plain STOMP over TCP; TCP connect 157 ms.
The broker is **ActiveMQ Artemis 2.44** (STOMP 1.2), not classic ActiveMQ: durable
subscriptions use `client-id` on CONNECT and `durable-subscription-name` on SUBSCRIBE
(the check sends both that and the classic `activemq.subscriptionName`).

Two minutes on a Thursday at 17:22 UK time (evening peak):

| Topic | Messages/min | Bytes/min | Frames/min | Types seen |
|---|---:|---:|---:|---|
| `TRAIN_MVT_ALL_TOC` (TRUST) | 424 | 308 KB | 17 | 0003 movement ×816, 0001 activation ×29, 0002 cancellation ×2 |
| `VSTP_ALL` | 0 | 0 | 0 | none in 2 min (short-notice changes are occasional) |
| `TD_ALL_SIG_AREA` | 4,112 | 400 KB | 129 | SF ×5766, CA ×1976, CC ×212, CB ×139, CT ×120, SG ×10, SH ×1 |

First message 0.9 s after subscribing. Each frame is a JSON array of messages.

- **TRUST is small**: about 300 KB a minute at peak. Draining a minute's worth at once is
  easy for the UK ingest Worker (plan decision 1).
- **TD** is ten times the messages but similar bytes; it's for 3.1.

TRUST movement (0003) fields: `train_id`, `actual_timestamp`, `loc_stanox`,
`gbtt_timestamp`, `planned_timestamp`, `planned_event_type`, `event_type`, `event_source`,
`correction_ind`, `offroute_ind`, `direction_ind`, `platform`, `route`,
`train_service_code`, `division_code`, `toc_id`, `timetable_variation`,
`variation_status`, `next_report_stanox`, `next_report_run_time`, `train_terminated`,
`delay_monitoring_point`, `reporting_stanox`, `auto_expected`.

The delay is `timetable_variation` (minutes) with `variation_status` (EARLY, ON TIME, LATE,
OFF ROUTE); the place is `loc_stanox` (CORPUS gives its TIPLOC and name). Movements are
linked to a timetable by the activation (0001), which carries the schedule's UID and date.

## Files (HTTPS, basic auth, redirect to a signed download)

| File | Download (gzip) | Uncompressed | Records |
|---|---:|---:|---|
| SCHEDULE daily update (`CIF_ALL_UPDATE_DAILY`, `toc-update-<day>`) | 1.5 MB | 37.5 MB | 9,961 schedules, 2,320 associations |
| SCHEDULE full (`CIF_ALL_FULL_DAILY`, `toc-full`) | 135.8 MB | 3.57 GB | 724,656 schedules, 81,435 associations, 12,114 TIPLOCs; read in 19 s |
| CORPUS | 789 KB | 7.3 MB | 55,997 locations (TIPLOC, STANOX, CRS, NLC, names) |
| SMART | 365 KB | 7.1 MB | 34,298 berth steps |

- The full SCHEDULE is big but streams fast: one JSON object per line. The reference-data
  build reads it once a day on GitHub's runner and keeps only passenger trains running in
  the app's window (yesterday to +6 days), as for Renfe.
- The schedule's 724,656 entries include long-running permanent schedules and short-term
  (STP) overlays, new schedules and cancellations. For each train and day the one with the
  highest STP priority wins (C, N, O, P).

## To read next

The second run of the check (with this doc's PR) prints one shortened real record of each
kind in the job log, tests a durable subscription (messages kept while disconnected), and
reads NaPTAN for station coordinates. Its findings go here.

## Licence

Network Rail open data: Open Government Licence v3.0. Attribution: "Contains information of
Network Rail Infrastructure Limited licensed under the Open Government Licence v3.0".
NaPTAN (DfT): Open Government Licence v3.0.
