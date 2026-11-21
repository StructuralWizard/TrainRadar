#!/usr/bin/env bash
# Synthetic UK data for the browser tests (plans 3 and 4): a London Euston –
# Watford Junction – Milton Keynes Central line every 10 minutes all day, in
# Network Rail's SCHEDULE shape, built into demo/data/uk/ with refdata-build;
# and the UK ingest's files in demo/rt/uk/ (trip updates with delays and a
# cancellation, status.json, National Rail notices), written with the
# Worker's own encoder. Needs cargo and node. No downloads.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/naptan.csv" <<'CSV'
ATCOCode,CommonName,StopType,Longitude,Latitude,Status
9100EUSTON,London Euston Rail Station,RLY,-0.1337,51.5282,active
9100WATFDJ,Watford Junction Rail Station,RLY,-0.3967,51.6636,active
9100MKNSCEN,Milton Keynes Central Rail Station,RLY,-0.7741,52.0344,active
CSV
python3 -I - "$tmp" <<'PY'
import gzip, json, sys
tmp = sys.argv[1]
hm = lambda m: f"{m // 60 % 24:02d}{m % 60:02d}"
with gzip.open(f"{tmp}/schedule.json.gz", "wt") as f:
    for i in range(144):
        m = i * 10
        f.write(json.dumps({"JsonScheduleV1": {
            "CIF_stp_indicator": "P", "CIF_train_uid": f"A{i:05d}", "atoc_code": "LM",
            "schedule_days_runs": "1111111", "schedule_start_date": "2026-01-01",
            "schedule_end_date": "2030-12-31", "train_status": "P", "transaction_type": "Create",
            "schedule_segment": {"signalling_id": f"2K{i % 100:02d}", "schedule_location": [
                {"location_type": "LO", "tiploc_code": "EUSTON", "public_departure": hm(m)},
                {"location_type": "LI", "tiploc_code": "WATFDJ", "public_arrival": hm(m + 18), "public_departure": hm(m + 19)},
                {"location_type": "LT", "tiploc_code": "MKNSCEN", "public_arrival": hm(m + 45)}]}}}) + "\n")
PY
# Northern Ireland (plan 4): Belfast Lanyon Place – Lisburn every 20 minutes,
# in Translink's TransXChange shape (two platforms at Lanyon Place).
python3 -I - "$tmp" <<'PY'
import sys
tmp = sys.argv[1]
vjs = "".join(
    f"<VehicleJourney><PrivateCode>rai-90-2-_-r13-1-{i + 1}-TA</PrivateCode><ServiceRef>NI1</ServiceRef>"
    f"<LineRef>NI1</LineRef><JourneyPatternRef>JP1</JourneyPatternRef>"
    f"<DepartureTime>{i * 20 // 60:02d}:{i * 20 % 60:02d}:00</DepartureTime></VehicleJourney>"
    for i in range(72))
stop = lambda atco, name, lon, lat: (f"<StopPoint><AtcoCode>{atco}</AtcoCode><Descriptor><CommonName>{name}</CommonName></Descriptor>"
    f"<Place><Location><Longitude>{lon}</Longitude><Latitude>{lat}</Latitude></Location></Place></StopPoint>")
xml = f"""<?xml version="1.0" encoding="windows-1252"?>
<TransXChange xmlns="http://www.transxchange.org.uk/" SchemaVersion="2.4">
<StopPoints>{stop("9000LP1", "Lanyon Place Train Station", -5.9171, 54.5947)}{stop("9000LP2", "Lanyon Place Train Station", -5.9169, 54.5949)}
{stop("9000LB1", "Lisburn Train Station", -6.0436, 54.5141)}</StopPoints>
<JourneyPatternSections><JourneyPatternSection id="JPS1"><JourneyPatternTimingLink id="L1">
<From><StopPointRef>9000LP1</StopPointRef></From><To><StopPointRef>9000LB1</StopPointRef></To><RunTime>PT18M</RunTime>
</JourneyPatternTimingLink></JourneyPatternSection></JourneyPatternSections>
<Services><Service><ServiceCode>NI1</ServiceCode><Lines><Line id="NI1"><LineName>Portadown Line</LineName></Line></Lines>
<OperatingPeriod><StartDate>2026-01-01</StartDate><EndDate>2030-12-31</EndDate></OperatingPeriod>
<OperatingProfile><RegularDayType><DaysOfWeek><MondayToSunday /></DaysOfWeek></RegularDayType></OperatingProfile>
<StandardService><JourneyPattern id="JP1"><JourneyPatternSectionRefs>JPS1</JourneyPatternSectionRefs></JourneyPattern></StandardService>
</Service></Services><VehicleJourneys>{vjs}</VehicleJourneys></TransXChange>"""
open(f"{tmp}/ni-txc.xml", "w", encoding="cp1252").write(xml)
PY
cargo run -q --release -p trainradar-refdata-build -- build --out demo/data/uk \
  --uk-schedule "$tmp/schedule.json.gz" --naptan "$tmp/naptan.csv" --ni-txc "$tmp/ni-txc.xml" > /dev/null
mkdir -p demo/rt/uk
node --input-type=module - <<'JS'
import { encodeTripUpdates } from "./backend-uk/src/gtfsrt.js";
import { incidentsDoc, parseIncidents } from "./backend-uk/src/kb.js";
import { readFileSync, writeFileSync } from "node:fs";
const now = Date.now();
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now).replaceAll("-", "");
const id = (i) => `A${String(i).padStart(5, "0")}:2026-01-01:P`;
// Even trains late (7 min every fourth, else 1 min); every train ending in 3 cancelled.
const ups = [];
for (let i = 0; i < 144; i++) {
  if (i % 10 === 3) ups.push({ id: `c${i}`, tripId: id(i), startDate: day, canceled: true, timestamp: Math.round(now / 1000) });
  else if (i % 2 === 0) ups.push({ id: `t${i}`, tripId: id(i), startDate: day, delay: i % 4 === 0 ? 420 : 60, timestamp: Math.round(now / 1000) });
}
writeFileSync("demo/rt/uk/trip_updates.pb", encodeTripUpdates(ups, Math.round(now / 1000)));
const at = new Date(now).toISOString();
writeFileSync("demo/rt/uk/status.json", JSON.stringify({ updatedAt: at, ok: true, feeds: { "trip_updates.pb": { ok: true, fetchedAt: at, renfeLastModified: new Date(now).toUTCString() } } }));
const xml = readFileSync("backend-uk/test/kb.test.mjs", "utf8").match(/const XML = `([\s\S]*?)`;/)[1];
writeFileSync("demo/rt/uk/incidents.json", JSON.stringify(incidentsDoc(parseIncidents(xml), now)));
JS
echo "UK demo: demo/data/uk, demo/rt/uk"
