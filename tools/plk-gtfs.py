#!/usr/bin/env python3
"""Poland's timetable as GTFS, from PKP PLK's open railway data API.

    PL_PLK_API_KEY=… python3 -I tools/plk-gtfs.py OUT.zip [DAYS] [--sample FILE]

PKP PLK ("Otwarte Dane Kolejowe", https://pdp-api.plk-sa.pl/) publishes
every passenger train of every operator on its network as JSON:
`/api/v1/schedules` (routes with their operating dates and stations) and
`/api/v1/dictionaries/stations` (ids, names, WGS84 positions). This writes
them as a GTFS file the refdata build reads like any other:

- one trip per route, `trip_id` = `<scheduleId>_<orderId>` (the same key
  the live `/operations` feed uses, so delays match: backend-eu/src/poland.js);
- stops = PLK's numeric station ids (also the live feed's);
- one service per route, its operating dates as calendar_dates;
- routes per operator and commercial category (IC, TLK, EIP, R…);
- only the stations where the train stops for passengers (not technical
  stops or passing points).

The key goes in the X-API-Key header, never in a URL or the output, and is
never printed. `--sample FILE` reads a saved /schedules response instead of
calling the API (tests). Standard library only.
"""

import csv
import datetime as dt
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

BASE = "https://pdp-api.plk-sa.pl/api/v1/"
CLIENT = "Metranos-TrainRadar"
# Stop types that aren't passenger stops (PLK's stop-type names, Polish):
# technical stops, passing points, stops "for the needs of the operator".
NOT_PASSENGER = re.compile(r"techn|bez zatrzym|przejazd|przelot|służb|sluzb", re.I)


def get(path, key):
    req = urllib.request.Request(
        BASE + path,
        headers={"X-API-Key": key, "Accept": "application/json", "User-Agent": CLIENT, "Accept-Encoding": "identity"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def seconds(day, t):
    """A PLK time (a .NET TimeSpan "08:15:00", "1.02:10:00" or ISO
    "PT8H15M") on day offset `day`, as GTFS seconds after midnight."""
    if not t:
        return None
    m = re.fullmatch(r"(?:(\d+)\.)?(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?", t)
    if m:
        d, h, mi, s = (int(x or 0) for x in m.groups())
        return (int(day or 0) + d) * 86400 + h * 3600 + mi * 60 + s
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?", t)
    if m:
        d, h, mi, s = (int(x or 0) for x in m.groups())
        return (int(day or 0) + d) * 86400 + h * 3600 + mi * 60 + s
    raise ValueError(f"time {t!r}")


def hms(n):
    return f"{n // 3600:02d}:{n % 3600 // 60:02d}:{n % 60:02d}"


def ymd(d):
    return str(d)[:10].replace("-", "")


def convert(sched, stations, stop_types=None, today=None):
    """GTFS tables (name → rows, header first) and counts, from a /schedules
    response and the station list ({id: {name, latitude, longitude}})."""
    dicts = sched.get("dictionaries") or {}
    carriers = dicts.get("carriers") or {}
    stop_types = {**(dicts.get("stopTypes") or {}), **(stop_types or {})}
    for sid, s in (dicts.get("stations") or {}).items():
        stations.setdefault(str(s.get("id", sid)), s)
    agencies, routes, trips, times, dates, used = {}, {}, [], [], [], set()
    counts = {"routes": 0, "trips": 0, "stop_times": 0, "skipped_stops": 0, "no_position": 0, "short": 0}
    for r in sched.get("routes") or []:
        counts["routes"] += 1
        carrier = r.get("carrierCode") or "PLK"
        category = (r.get("commercialCategorySymbol") or "").strip() or "R"
        agencies.setdefault(carrier, carriers.get(carrier) or carrier)
        route_id = f"{carrier}:{category}"
        routes.setdefault(route_id, (carrier, category))
        trip_id = f"{r['scheduleId']}_{r['orderId']}"
        rows = []
        for s in sorted(r.get("stations") or [], key=lambda s: s.get("orderNumber") or 0):
            kind = s.get("stopTypeName") or stop_types.get(str(s.get("stopTypeId")), "")
            arr = seconds(s.get("arrivalDay"), s.get("arrivalTime"))
            dep = seconds(s.get("departureDay"), s.get("departureTime"))
            if (arr is None and dep is None) or NOT_PASSENGER.search(kind or ""):
                counts["skipped_stops"] += 1
                continue
            sid = str(s["stationId"])
            st = stations.get(sid)
            if not st or not st.get("latitude") or not st.get("longitude"):
                counts["no_position"] += 1
                continue
            arr = arr if arr is not None else dep
            dep = dep if dep is not None else arr
            rows.append([trip_id, hms(arr), hms(max(dep, arr)), sid, s.get("orderNumber") or len(rows) + 1,
                         s.get("departurePlatform") or s.get("arrivalPlatform") or ""])
        if len(rows) < 2:
            counts["short"] += 1
            continue
        days = sorted({ymd(d) for d in r.get("operatingDates") or []})
        if not days:
            continue
        number = r.get("nationalNumber") or r.get("internationalDepartureNumber") or ""
        name = (r.get("name") or "").strip()
        last = stations.get(rows[-1][3], {}).get("name", "")
        trips.append([route_id, trip_id, trip_id, last, number, name])
        dates.extend([trip_id, d, 1] for d in days)
        times.extend(rows)
        used.update(x[3] for x in rows)
        counts["trips"] += 1
        counts["stop_times"] += len(rows)
    tables = {
        "agency.txt": [["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang"]]
        + [[a, n, "https://www.plk-sa.pl", "Europe/Warsaw", "pl"] for a, n in sorted(agencies.items())],
        "routes.txt": [["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"]]
        + [[rid, c, cat, agencies.get(c, c), 2] for rid, (c, cat) in sorted(routes.items())],
        "trips.txt": [["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name", "trip_long_name"]] + trips,
        "stop_times.txt": [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "platform"]] + times,
        "calendar_dates.txt": [["service_id", "date", "exception_type"]] + dates,
        "stops.txt": [["stop_id", "stop_name", "stop_lat", "stop_lon"]]
        + [[sid, stations[sid].get("name", sid), stations[sid]["latitude"], stations[sid]["longitude"]] for sid in sorted(used)],
        "feed_info.txt": [["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_version"]]
        + [["PKP Polskie Linie Kolejowe S.A.", "https://pdp-api.plk-sa.pl/", "pl", sched.get("generatedAt", today or "")]],
    }
    counts["stops"] = len(used)
    return tables, counts


def write(path, tables):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, rows in tables.items():
            s = io.StringIO()
            csv.writer(s, lineterminator="\n").writerows(rows)
            z.writestr(name, s.getvalue())


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    sample = argv[argv.index("--sample") + 1] if "--sample" in argv else None
    if sample in args:
        args.remove(sample)
    if not args:
        print(__doc__, file=sys.stderr)
        return 2
    out = args[0]
    days = int(args[1]) if len(args) > 1 else 9
    today = dt.date.today()
    if sample:
        sched = json.load(open(sample, encoding="utf-8"))
        stations, kinds = {}, {}
    else:
        key = os.environ.get("PL_PLK_API_KEY", "")
        if not key:
            print("PL_PLK_API_KEY is not set", file=sys.stderr)
            return 2
        start, end = today - dt.timedelta(days=1), today + dt.timedelta(days=days - 2)
        st = get("dictionaries/stations?pageSize=10000", key)
        stations = {str(s["id"]): s for s in st.get("stations") or []}
        kinds_raw = get("dictionaries/stop-types", key)
        kinds = {}
        for k in kinds_raw.get("stopTypes") or kinds_raw.get("items") or []:
            if isinstance(k, dict):
                kinds[str(k.get("id"))] = k.get("name") or k.get("description") or ""
        print(f"stop types: {json.dumps(kinds_raw, ensure_ascii=False)[:600]}")
        sched = get(f"schedules?dateFrom={start}&dateTo={end}&fullRoute=true&dictionaries=true", key)
    tables, c = convert(sched, stations, kinds, str(today))
    write(out, tables)
    print(f"{out}: {c['routes']} PLK routes, {c['trips']} trips, {c['stop_times']} stop times, {c['stops']} stations "
          f"({c['skipped_stops']} non-passenger stops, {c['no_position']} without a position, {c['short']} too short)")
    return 0 if c["trips"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
