# Plan: future timetables ("plan ahead")

Status: **agreed 2026-11-21**. The maintainer's decisions:
- **How far:** as far as each source publishes, until its timetable changes. The engine and files allow
  up to 9 weeks (63 days).
- **Where:** a date and time picker on **station departures and arrivals**, **train search** (a
  train number on a date) and **Cómo llegar** (journeys with changes).

## F1. Data: plan-ahead files

- A train's running days were a 16-bit mask, so files could cover at most 16 days. The mask is now 64
  bits (`TripRec.days: u64`).
  - Postcard writes both as the same varint, so today's files (8 days) are byte for byte what
    installed apps read (test `day_masks_wider_but_same_bytes`). The format version stays 5.
  - The engine checks the bits with `network::runs_on` against each file's own window.
- `refdata-build build --days N` accepts up to 64. Each region in the manifest gets `until`: the last
  day any of its trains runs in the window, which is where the published timetable ends.
- The deploy builds a second set without track, over 63 days from yesterday:
  - Spain in `data/plan/`;
  - the UK in `data/uk/plan/` (Great Britain and Northern Ireland).
  - Each set has its own manifest and stations file. If the build fails, the site works as before.
- The Refdata workflow builds Spain's plan set on PRs too, and reports sizes and each region's
  `until`.

## F2. App: pick a date

- **A second engine, timetable only.** For a date or time beyond what is loaded, the app creates a
  second engine with no live feeds and loads `plan/`: its stations, then only the regions it needs
  (long distance, plus the Cercanías of the stations asked about). Live delays never touch future
  dates.
- **Station sheet:** "Ahora ▾" opens a date and time picker; the departures and arrivals from then,
  timetable only ("según horario").
- **Cómo llegar:** "Salir ahora ▾", the same picker; journeys with changes from then.
- **Train search:** "3045 el 12 dic": the train's stops and times that day, or "no circula ese día".
- The picker's last day is the latest `until`. Beyond a region's `until`: "Renfe aún no ha publicado
  horarios para ese día".
- Saving a journey found for a future date works as usual: it saves the trains and the days.

## Later

- "Llegar antes de…" (arrive by).
- More than 9 weeks, if a source publishes further ahead (calendar ranges instead of a bit per day).
