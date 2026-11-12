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

## Second run (2026-11-12, 17:48): formats, durable subscription, NaPTAN

**Durable subscriptions work.** Subscribed with `client-id` + `durable-subscription-name`,
disconnected for 30 s, reconnected: 18 frames arrived in the first 1.5 s, the movements
queued while away. So the UK Worker can connect once a minute and miss nothing (plan
decision 1). The check removes its subscription afterwards (`UNSUBSCRIBE` with the same
name), so the broker doesn't keep queueing for it.

**TRUST** (all fields strings; times are milliseconds since 1970):

- Activation `0001`: `train_id` (10 characters, e.g. `512J06MX12`), `train_uid` (the
  schedule's `CIF_train_uid`), `schedule_start_date`, `schedule_end_date`,
  `schedule_type` (the STP indicator), `tp_origin_timestamp` (the service date),
  `origin_dep_timestamp`, `sched_origin_stanox`, `toc_id`.
- Movement `0003`: `train_id`, `loc_stanox`, `event_type` (ARRIVAL/DEPARTURE),
  `planned_timestamp`, `gbtt_timestamp` (public time, empty at non-stops),
  `actual_timestamp`, `timetable_variation` (minutes) + `variation_status`, `platform`,
  `next_report_stanox`, `next_report_run_time` (minutes), `train_terminated`, `offroute_ind`.
- Cancellation `0002`: `train_id`, `loc_stanox`, `canx_type` (AT ORIGIN, EN ROUTE, …),
  `canx_reason_code`.
- To check in summer: whether TRUST's millisecond times are true UTC or UK local time
  written as UTC (a known quirk of the feed). In November they're the same.

**SCHEDULE** records (one JSON object per line):

- `JsonScheduleV1`: `CIF_train_uid`, `CIF_stp_indicator` (P permanent, O overlay,
  N new, C cancellation), `schedule_start_date`/`schedule_end_date`, `schedule_days_runs`
  (`"0000001"`, Monday first), `train_status` (P/1 passenger, 5 bus, F/2 freight, T/3 trip),
  `atoc_code` (operator, e.g. SR = ScotRail, TP = TransPennine), `transaction_type`
  (`Create`/`Delete` in the daily updates), and `schedule_segment`: `signalling_id`
  (headcode, e.g. `2H09`), `CIF_train_category`, `CIF_power_type`, `CIF_speed`, and
  `schedule_location[]`: `location_type` LO (origin), LI (intermediate), LT (terminus),
  `tiploc_code`, `arrival`/`departure`/`pass` (working times, `H` = half minute),
  `public_arrival`/`public_departure` (HHMM; null where the train doesn't stop for
  passengers), `platform`, `line`, `path`.
- Statuses in a daily update: P/O 2575, N 2240 (no status: deletes), 1/N 1582, 5/N 492
  (buses), C 429, 2/N 397, F/O 202, …
- `JsonAssociationV1`: joins and splits (`main_train_uid`, `assoc_train_uid`, `location`).
- `TiplocV1` (full file only): 12,114 timing points.
- **VSTP** (`VSTPCIFMsgV1`) is the same schedule in a different shape: times as `HHMMSS`
  (`scheduled_departure_time`, `public_departure_time`), `location.tiploc.tiploc_id`.

**CORPUS** (`TIPLOCDATA`): `TIPLOC`, `STANOX`, `3ALPHA` (CRS, the 3-letter station code),
`NLC`, `NLCDESC` (upper-case name). Empty values are a single space. This links TRUST's
STANOX to the schedule's TIPLOC.

**SMART** (`BERTHDATA`): `TD` area, `FROMBERTH`/`TOBERTH`, `STANOX`, `EVENT`, `PLATFORM`,
`BERTHOFFSET` (seconds): for TD in 3.1.

**NaPTAN** (public, `naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv`, 101.6 MB,
435,812 rows): **2,716 rail stations** (`StopType` RLY) with `Latitude`/`Longitude`. Their
`ATCOCode` is `9100` + the TIPLOC (`9100ABDARE` → `ABDARE`), so stations join the schedule
directly. `CommonName` ends in " Rail Station" for many (to strip). Heritage lines appear
too (e.g. Corfe Castle); they have no Network Rail schedules, so they drop out.

## Licence

Network Rail open data: Open Government Licence v3.0. Attribution: "Contains information of
Network Rail Infrastructure Limited licensed under the Open Government Licence v3.0".
NaPTAN (DfT): Open Government Licence v3.0.
