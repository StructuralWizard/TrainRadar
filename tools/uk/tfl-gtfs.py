#!/usr/bin/env python3
"""London Underground, DLR and London Trams as GTFS, from TfL's Unified API:

    UK_TFL_APP_KEY=… python3 -I tools/uk/tfl-gtfs.py OUT.zip [DAYS] [--index=INDEX.json]

For each line: its stations and branches (/Line/{id}/Route/Sequence/all),
then the timetable from each terminus (/Line/{id}/Timetable/{stop}): every
departure for each day type ("Monday - Thursday", "Friday", "Saturday"…)
and the minutes to each station after it. One trip per departure, one
service per day type, valid for DAYS days from today (default 70). Trips
that start mid-line (from a depot) aren't in TfL's timetables: left out.

About 100 calls a run (TfL allows 500 a minute with a key). The key goes
only in the `app_key` request header (TfL reads it there as well as in the
query string), never in a URL; without one, TfL's anonymous limit applies
and the calls are spaced out. --index writes the same timetable compactly
for the UK ingest Worker (backend-uk/src/tfl.js), which matches TfL's live
arrivals to these trips: {"v": 1, "groups": [{"p": trip id prefix, "l":
line, "d": weekdays (0 = Monday), "iv": {interval id: [[stop, seconds after
the departure], ...]}, "j": [[departure seconds, interval id], ...]}]}; a
trip's id is "<p>:<index in j>". Licence: TfL open data, "Powered by TfL Open
Data"; contains OS data © Crown copyright and database rights.
Standard library only.
"""

import csv
import datetime
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile

API = "https://api.tfl.gov.uk"
CLIENT = "Metranos-TrainRadar (+https://mytrainradar.com)"
# Line id → (short name, GTFS route_type, colour, text colour). Colours are
# TfL's own line colours.
LINES = {
    "bakerloo": ("Bakerloo", 1, "B36305", "FFFFFF"),
    "central": ("Central", 1, "E32017", "FFFFFF"),
    "circle": ("Circle", 1, "FFD300", "000000"),
    "district": ("District", 1, "00782A", "FFFFFF"),
    "hammersmith-city": ("Hammersmith & City", 1, "F3A9BB", "000000"),
    "jubilee": ("Jubilee", 1, "A0A5A9", "000000"),
    "metropolitan": ("Metropolitan", 1, "9B0056", "FFFFFF"),
    "northern": ("Northern", 1, "000000", "FFFFFF"),
    "piccadilly": ("Piccadilly", 1, "003688", "FFFFFF"),
    "victoria": ("Victoria", 1, "0098D4", "FFFFFF"),
    "waterloo-city": ("Waterloo & City", 1, "95CDBA", "000000"),
    "dlr": ("DLR", 1, "00A4A7", "FFFFFF"),
    "tram": ("Trams", 0, "5FB526", "FFFFFF"),
}
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
SUFFIXES = (" Underground Station", " DLR Station", " Tram Stop", " (London) Rail Station", " Rail Station",
            " (Elizabeth line)", " Station")
calls = 0


def get(path):
    """GET a Unified API path as JSON; a few tries on 429/5xx, then give up."""
    global calls
    key = os.environ.get("UK_TFL_APP_KEY", "")
    headers = {"User-Agent": CLIENT, "Accept": "application/json"}
    if key:
        headers["app_key"] = key
    for attempt in range(4):
        calls += 1
        if not key:
            time.sleep(1.5)  # TfL's anonymous limit
        req = urllib.request.Request(API + path, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(int(e.headers.get("Retry-After") or 0) or 10 * (attempt + 1))
                continue
            raise SystemExit(f"TfL {path.split('?')[0]}: HTTP {e.code}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            raise SystemExit(f"TfL {path.split('?')[0]}: {type(e).__name__}") from None


def short_name(name):
    for s in SUFFIXES:
        if name.endswith(s):
            return name[: -len(s)].strip()
    return name.strip()


def days_of(name):
    """Weekdays (0 = Monday) a schedule's name covers: "Monday - Thursday",
    "Friday", "Saturday (also Good Friday)", "Monday - Friday", "Saturday
    and Sunday"…; empty if it names none (left out)."""
    n = re.sub(r"\(.*?\)", "", name.lower())
    found = [i for i, d in enumerate(DAYS) if d in n]
    if "-" in n and len(found) == 2:
        return list(range(found[0], found[1] + 1))
    if "weekday" in n:
        return [0, 1, 2, 3, 4]
    if "weekend" in n:
        return [5, 6]
    if "daily" in n or "every day" in n:
        return list(range(7))
    return found


def hhmmss(minutes):
    s = int(round(minutes * 60))
    return f"{s // 3600:02d}:{s // 60 % 60:02d}:{s % 60:02d}"


def main(argv):
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    index_path = next((a[8:] for a in argv if a.startswith("--index=")), "")
    argv = [a for a in argv if not a.startswith("--index=")]
    out = argv[0]
    span = int(argv[1]) if len(argv) > 1 else 70
    groups = []
    today = datetime.date.today()
    stops = {}  # station id → (name, lat, lon)
    routes, trips, stop_times, services = [], [], [], {}
    for line, (sname, rtype, colour, text) in LINES.items():
        seq = get(f"/Line/{line}/Route/Sequence/all?excludeCrowding=true")
        for s in seq.get("stations", []):
            if s.get("lat") and s.get("lon"):
                stops[s["id"]] = (short_name(s["name"]), s["lat"], s["lon"])
        for sp in seq.get("stopPointSequences", []):
            for s in sp.get("stopPoint", []):
                sid = s.get("stationId") or s["id"]
                if sid not in stops and s.get("lat"):
                    stops[sid] = (short_name(s["name"]), s["lat"], s["lon"])
        routes.append([f"tfl:{line}", "tfl", sname, "", rtype, colour, text])
        # Each terminus a timetable starts from: every route's first stop.
        origins = []
        for r in seq.get("orderedLineRoutes", []):
            ids = r.get("naptanIds") or []
            if ids and ids[0] not in origins:
                origins.append(ids[0])
        n_line = 0
        for origin in origins:
            tt = get(f"/Line/{line}/Timetable/{origin}")
            for ri, route in enumerate((tt.get("timetable") or {}).get("routes") or []):
                intervals = {int(iv["id"]): iv["intervals"] for iv in route.get("stationIntervals", [])}
                for si, sched in enumerate(route.get("schedules", [])):
                    days = days_of(sched.get("name", ""))
                    if not days:
                        continue
                    svc = "tfl:" + "".join(str(d) for d in days)
                    services[svc] = days
                    group = {"p": f"tfl:{line}:{origin}:{ri}:{si}", "l": line, "d": days, "iv": {}, "j": []}
                    groups.append(group)
                    for ji, j in enumerate(sched.get("knownJourneys", [])):
                        iv = intervals.get(int(j.get("intervalId", 0)))
                        if not iv:
                            continue
                        dep = int(j["hour"]) * 60 + int(j["minute"])
                        trip = f"tfl:{line}:{origin}:{ri}:{si}:{ji}"
                        ivid = str(int(j.get("intervalId", 0)))
                        if ivid not in group["iv"]:
                            run, prev_t = [[origin, 0]], 0.0
                            for x in iv:
                                prev_t = max(float(x["timeToArrival"]), prev_t)
                                run.append([x["stopId"], int(round(prev_t * 60))])
                            group["iv"][ivid] = run
                        # Every journey keeps its place: the trip id is its index.
                        while len(group["j"]) < ji:
                            group["j"].append(None)
                        group["j"].append([dep * 60, int(ivid)])
                        last = iv[-1]["stopId"]
                        trips.append([f"tfl:{line}", svc, trip, stops.get(last, (short_name(last),))[0]])
                        stop_times.append([trip, hhmmss(dep), hhmmss(dep), origin, 1])
                        prev = 0.0
                        for k, x in enumerate(iv, start=2):
                            t = max(float(x["timeToArrival"]), prev)
                            prev = t
                            stop_times.append([trip, hhmmss(dep + t), hhmmss(dep + t), x["stopId"], k])
                        n_line += 1
        print(f"{line}: {len(origins)} termini, {n_line} trips")
    used = {r[3] for r in stop_times}
    missing = sorted(used - set(stops))
    if missing:
        print(f"stations without a position, their trips' calls dropped: {len(missing)} ({', '.join(missing[:5])}…)")
        stop_times = [r for r in stop_times if r[3] in stops]

    def table(head, rows):
        b = io.StringIO()
        w = csv.writer(b, lineterminator="\n")
        w.writerow(head)
        w.writerows(rows)
        return b.getvalue()

    end = today + datetime.timedelta(days=span)
    cal = [[svc] + [1 if d in days else 0 for d in range(7)] + [today.strftime("%Y%m%d"), end.strftime("%Y%m%d")]
           for svc, days in sorted(services.items())]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("agency.txt", table(["agency_id", "agency_name", "agency_url", "agency_timezone"],
                                       [["tfl", "Transport for London", "https://tfl.gov.uk/", "Europe/London"]]))
        z.writestr("routes.txt", table(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type",
                                        "route_color", "route_text_color"], routes))
        z.writestr("stops.txt", table(["stop_id", "stop_name", "stop_lat", "stop_lon"],
                                      [[k, v[0], v[1], v[2]] for k, v in sorted(stops.items()) if k in used]))
        z.writestr("trips.txt", table(["route_id", "service_id", "trip_id", "trip_headsign"], trips))
        z.writestr("stop_times.txt", table(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
                                           stop_times))
        z.writestr("calendar.txt", table(["service_id"] + DAYS + ["start_date", "end_date"], cal))
    if index_path:
        with open(index_path, "w", encoding="utf-8") as f:
            json.dump({"v": 1, "generated": today.isoformat(), "groups": groups}, f, separators=(",", ":"))
        print(f"{index_path}: {len(groups)} groups, {os.path.getsize(index_path) // 1024} KB")
    print(f"{out}: {len(routes)} lines, {len(trips)} trips, {len(stop_times)} stop times, "
          f"{len(used & set(stops))} stations; {calls} calls to TfL")
    return 0 if trips else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
