# Plan: journeys with changes, saved commutes with their trains, commute alerts

Status: **agreed and built 2026-11-21** (J1–J4, Spain). The UK comes next; the engine is shared.

The maintainer's decisions:
- **Route search with changes** for everyone: "Cómo llegar" finds journeys of up to two changes, not
  only direct trains.
- **Saving them is Pro.** A saved journey follows **those exact trains** (e.g. MD 18021 at 08:05 and
  AVE 03063 at 09:30, Monday to Friday). If one is cancelled, the app suggests the next option.
- It **extends Trayectos habituales**: an existing commute (origin → destination) keeps working, and can
  now also hold the chosen trains, the time and the days.
- **Notifications (Pro)** for a saved journey:
  1. a delay (5 / 15 min) or cancellation of any of its trains;
  2. a connection at risk: a delay leaves less than the minimum change time;
  3. a reminder before leaving (e.g. 30 min): "your 08:05 is on time" / "running 10 min late";
  4. track or platform changes, where the feed has them (Renfe's rarely does);
  5. station notices on the way: lifts and escalators, works, replacement buses, other disruptions.

## J1. Engine: journeys with changes

`crates/engine/src/journeys.rs`, `Engine.journeysJson(from, to, nowMs, maxChanges, limit, windowSecs)`.

- A round-based search (RAPTOR) over the loaded timetables. Round k gives the earliest arrival at each
  station with k trains. The answer is one journey per number of changes that arrives sooner. Asking
  again a minute after the first departure gives the next options.
- **Changes**:
  - at the same station (ids are shared across Cercanías and long-distance regions): at least 5 min,
    and 10 min onto a long-distance train;
  - or a walk to a station within 700 m (straight line × 1.3 at 1.1 m/s, plus 3 min), such as Atocha
    Cercanías ↔ Puerta de Atocha.
- **Live**:
  - a train's current delay moves its times;
  - cancelled runs are skipped;
  - each journey reports its tightest change, for "connection at risk".
- The ends are sets of stations, so a city can be an end (`route.js` `endStations`).
- Timed on the real data in the Refdata workflow (`examples/journeys_bench.rs`).

## J2. "Cómo llegar" shows journeys with changes

- The route sheet lists journeys: departure → arrival, duration, changes, and each train (line, number,
  from → to, times, delay) with the change between them ("cambio en Atocha, 12 min", or a walk).
- It loads the Cercanías of both ends first (the long-distance region is always loaded).
- A change that live delays have made too short is shown in amber: "enlace en riesgo".
- Free, on the web and in the app.

## J3. Save a journey (Pro), in Trayectos habituales

- "Guardar" on a journey (Pro) saves it in a commute: `{from, to, journey: {legs: [{number, trip_id,
  from, to, dep: "08:05", arr}], days: [1..5], notify: {…}}}`. Old commutes stay valid; they just have
  no journey.
- The commute screen shows today's run of the saved trains with live delays. If one is cancelled or
  the change is broken, it shows "alternativa" from a fresh search.
- Free users see the journeys but get the Pro screen on "Guardar".

## J4. Commute notifications (Pro, Android)

How it was built:
- `AlertsWorker` runs every 15 minutes with the alerts switch on. Saving the first journey turns the
  switch on. It reads Spain's commutes (`commute`).
- `JourneyRules` (unit-tested) watches each saved journey on its days, from an hour before leaving
  (or the reminder, if earlier) until half an hour after arriving.
- **Before a train leaves**, its run comes from `GET /v1/live/run/:station/:number` (the station
  board: delay and cancelled, including a cancellation before it starts). **After it leaves**, it
  comes from `rt/summary.json`.
- Each event is notified once a day:
  - delay ≥ 5, then ≥ 15 min, or cancelled ("mira otras opciones");
  - a change with less than 5 min after the walk ("enlace en riesgo"), or missed;
  - the reminder, `remind` minutes before leaving (within the 15-minute check), with the first train's
    state;
  - a platform change: `summary.json` now carries Renfe's platform at the next stop, and a change
    after the first one seen is notified;
  - station notices: `GET /v1/live/notices/all` gives every notice with its station ids, and those at
    the journey's stations are notified (lifts and access, works, strikes, disruptions such as
    replacement buses).
- Each alert type is switched per journey on the commute screen.
- The web app has no Pro (Pro is in the Android app), so there are no web alerts. The commute screen
  shows the same state live.

## Later

- The UK: the same search on Great Britain's timetables (and Northern Ireland's). The change time for
  each station could come from the timetable's minimum connection times.
- Walking between stations by real paths instead of straight lines.
