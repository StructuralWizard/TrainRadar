#!/usr/bin/env python3
"""Trains as GTFS, from a national NeTEx timetable (EU profile):

    python3 -I tools/netex-gtfs.py OUT.zip NETEX(.zip|.xml|.xml.gz) [DAYS]
        [--start YYYY-MM-DD] [--profile dk|it]

Profiles (what differs between publishers):

- `dk`: Rejseplanen's NeTEx on Denmark's national access point
  (Dataudveksleren dataset 242). The train number is the journey's TripNr;
  routes are lines (Line PublicCode).
- `it`: Trenitalia's NeTEx on Italy's national access point (CCISS,
  "OAP Trenitalia – NeTEx Livello 1", one .xml.gz). The train number is the
  journey's Name; routes are categories (Line ShortName "0083_FR" → FR);
  journeys of mode rail or other (the "sfm" and "Metropolitano" services),
  not the replacement buses ("Autobus").
- `italo`: Italo's NeTEx on the same access point ("OAP Italo – NeTEx
  Livello 1"), added to Trenitalia's with `--add FILE:italo`. Stations are
  3-letter codes ("OUE" Torino Porta Susa), joined to the nearest station of
  the main file within 600 m; the train number is the first number of the
  line's name ("9963_9944" → 9963); times carry no day offset, so a time
  earlier than the one before it is the next day. Its file also lists
  itineraries with a change ("8953-8907") and Italobus connections: only
  each train's own journey ("8953-1-1-1") is kept, its bus stops dropped.

Denmark's file, in detail:

The ZIP holds one file per line, in a folder per operator and area
(`DSB_000002/…`, `DSB_000022/…` for S-tog, `MOV_LOKT/…` for Lokaltog…), buses
and boats included. A file is read only if it has a rail journey
(`<TransportMode>rail</TransportMode>`); metro and light rail are other
modes and stay out. Each file carries its own frames:

- stops: `ScheduledStopPoint` ids hold the UIC station number
  (`DK::ScheduledStopPoint:8600655_DSB_::`, Hellerup), the number the live
  SIRI-ET uses as StopPointRef, with a name and coordinates: stop_id = 8600655;
- calendar: `DayTypeAssignment` → `UicOperatingPeriod` (`FromDate` and
  `ValidDayBits`, one bit a day) or a single `Date`;
- journeys: `ServiceJourney` (mode rail, `TripNr` in its key list), its
  `ServiceJourneyPattern` (line, stops, boarding and alighting) and passing
  times with day offsets.

One trip per journey with days in the window (`trip_id` = the journey's
number, `trip_short_name` = TripNr), stops where passengers can board or
alight. Standard library only; nothing secret is read.
"""

import collections
import csv
import datetime as dt
import gzip
import io
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

N = "{http://www.netex.org.uk/netex}"
RAIL = b"<TransportMode>rail</TransportMode>"

PROFILES = {
    "dk": {"modes": {"rail"}, "tz": "Europe/Copenhagen", "lang": "da", "url": "https://www.rejseplanen.dk",
           "publisher": "Rejsekort & Rejseplan A/S, via Dataudveksleren", "agency": "DSB"},
    "it": {"modes": {"rail", "other"}, "tz": "Europe/Rome", "lang": "it", "url": "https://www.trenitalia.com",
           "publisher": "Trenitalia, via the Punto di Accesso Nazionale (CCISS)", "agency": "Trenitalia"},
    "italo": {"modes": {"rail"}, "tz": "Europe/Rome", "lang": "it", "url": "https://www.italotreno.com",
              "publisher": "Italo, via the Punto di Accesso Nazionale (CCISS)", "agency": "Italo"},
}


def text(el, path):
    v = el.findtext(N + path) if el is not None else None
    return v.strip() if v else None


def seconds(t, offset):
    h, m, s = (int(x) for x in t.split(":"))
    return int(offset or 0) * 86400 + h * 3600 + m * 60 + s


def days_of(period):
    """A UicOperatingPeriod's days (or an OperatingPeriod's: every day)."""
    start = dt.date.fromisoformat(text(period, "FromDate")[:10])
    bits = text(period, "ValidDayBits")
    if bits is not None:
        return {start + dt.timedelta(days=i) for i, b in enumerate(bits) if b == "1"}
    end = dt.date.fromisoformat(text(period, "ToDate")[:10])
    return {start + dt.timedelta(days=i) for i in range((end - start).days + 1)}


def stop_id(ref):
    # DK::ScheduledStopPoint:8600655_DSB_:: (UIC) or
    # IT::ScheduledStopPoint:railTRENITALIA:830001020 (station code).
    m = re.search(r"ScheduledStopPoint:(?:[A-Za-z]+:)?(\d{6,9})", ref or "")
    return m.group(1) if m else re.sub(r"[^A-Za-z0-9]+", "_", ref or "").strip("_")


def read_file(data, window, out, counts, profile="dk"):
    """One NeTEx file's rail journeys in the window into `out`."""
    root = ET.fromstring(data)
    # Italo's stops are 3-letter codes, kept apart until joined to the main
    # file's stations (convert).
    sid_of = (lambda ref: "ITA-" + (ref or "").split(":")[-1]) if profile == "italo" else stop_id
    periods = {p.get("id"): days_of(p) for tag in ("UicOperatingPeriod", "OperatingPeriod") for p in root.iter(N + tag)}
    daytypes = collections.defaultdict(lambda: [set(), set()])
    for a in root.iter(N + "DayTypeAssignment"):
        ref = a.find(N + "DayTypeRef")
        if ref is None:
            continue
        op = a.find(N + "OperatingPeriodRef")
        if op is not None:
            ds = periods.get(op.get("ref"), set())
        elif text(a, "Date"):
            ds = {dt.date.fromisoformat(text(a, "Date")[:10])}
        else:
            continue
        daytypes[ref.get("ref")][0 if text(a, "isAvailable") != "false" else 1] |= ds
    stops = out["stops"]
    for p in root.iter(N + "ScheduledStopPoint"):
        loc = p.find(N + "Location")
        lat, lon = text(loc, "Latitude"), text(loc, "Longitude")
        sid = sid_of(p.get("id"))
        if lat and lon and sid not in stops:
            stops[sid] = (text(p, "Name") or sid, float(lat), float(lon))
    operators = {o.get("id"): text(o, "Name") or text(o, "ShortName") or "" for o in root.iter(N + "Operator")}
    prof = PROFILES[profile]
    lines = {}
    for line in root.iter(N + "Line"):
        op = line.find(f"{N}additionalOperators/{N}OperatorRef")
        if op is None:
            op = line.find(N + "OperatorRef")
        if profile == "italo":
            code = "ITA"
        elif profile == "it":
            # "0083_FR" → FR; the line's Name is the category ("Frecciarossa").
            code = (text(line, "ShortName") or "").split("_")[-1] or text(line, "Name") or ""
        else:
            code = text(line, "PublicCode") or text(line, "Name") or ""
        lines[line.get("id")] = (code, text(line, "TransportMode"), operators.get(op.get("ref")) if op is not None else None)
    displays = {d.get("id"): text(d, "FrontText") or text(d, "SideText") for d in root.iter(N + "DestinationDisplay")}
    patterns = {}
    for p in root.iter(N + "ServiceJourneyPattern"):
        lref = p.find(f"{N}RouteView/{N}LineRef")
        pts = {}
        for sp in p.iter(N + "StopPointInJourneyPattern"):
            ssp = sp.find(N + "ScheduledStopPointRef")
            dd = sp.find(N + "DestinationDisplayRef")
            pts[sp.get("id")] = (ssp.get("ref") if ssp is not None else None, text(sp, "ForBoarding") != "false" or text(sp, "ForAlighting") != "false",
                                 displays.get(dd.get("ref")) if dd is not None else None, int(sp.get("order") or 0))
        patterns[p.get("id")] = (lref.get("ref") if lref is not None else None, pts, text(p, "Name"))
    # Italo: its trains' stations are the ones some journey without an
    # Italobus stop ("… BUS") calls at; a journey with a bus connection
    # keeps only those (Longarone-Zoldo is on the Cortina bus, unlabelled).
    is_bus = lambda ref: bool(re.search(r"\bBUS$", stops.get(sid_of(ref), ("",))[0] or ""))
    train_stops = set()
    if profile == "italo":
        for _, pts_, _ in patterns.values():
            refs = [v[0] for v in pts_.values()]
            if not any(is_bus(r) for r in refs):
                train_stops.update(sid_of(r) for r in refs)
    for sj in root.iter(N + "ServiceJourney"):
        if text(sj, "TransportMode") not in (None, *prof["modes"]):
            continue
        pref = sj.find(N + "ServiceJourneyPatternRef")
        line_ref, pts, pname = patterns.get(pref.get("ref") if pref is not None else None, (None, {}, None))
        code, mode, operator = lines.get(line_ref, ("", None, None))
        if (text(sj, "TransportMode") or mode) not in prof["modes"] or pname == "Autobus":
            continue
        counts["rail_journeys"] += 1
        days = set()
        for ref in sj.iter(N + "DayTypeRef"):
            on, off = daytypes.get(ref.get("ref"), (set(), set()))
            days |= on - off
        days &= window
        if not days:
            continue
        trip_nr = next((text(kv, "Value") for kv in sj.iter(N + "KeyValue") if text(kv, "Key") == "TripNr"), "") or ""
        if not trip_nr and profile == "it":
            trip_nr = text(sj, "Name") or ""
        if profile == "italo" and not re.fullmatch(r"\d{4}(--\d+)?-\d+-\d+-\d+", sj.get("id").split(":")[-1]):
            # "8953-8907-…": an itinerary with a change of train (or an
            # Italobus and a train), sold as one journey; each train is also
            # a journey of its own ("8953-1-1-1"), kept.
            counts["italo_itineraries"] += 1
            continue
        if profile == "italo":
            # The line's name: "9963_9944" → 9963.
            line_el = next((l for l in root.iter(N + "Line") if l.get("id") == line_ref), None)
            # "1061_8927": an Italobus (1xxx) and the train (8xxx, 9xxx).
            nums = re.findall(r"\d+", text(line_el, "Name") or "") if line_el is not None else []
            trip_nr = next((n for n in nums if int(n) >= 8000), nums[0] if nums else "")
        rows, headsign, last = [], None, None
        # In the pattern's order (Italo lists ":1", ":10", ":11", ":2"…).
        def order_of(tpt):
            r = tpt.find(N + "StopPointInJourneyPatternRef")
            return pts.get(r.get("ref") if r is not None else None, (None, False, None, 0))[3]
        for tpt in sorted(sj.iter(N + "TimetabledPassingTime"), key=order_of):
            ref = tpt.find(N + "StopPointInJourneyPatternRef")
            ssp, public, display, _ = pts.get(ref.get("ref") if ref is not None else None, (None, False, None, 0))
            if ssp is None or not public:
                continue
            # Italobus connections: the train only.
            if profile == "italo" and (is_bus(ssp) or sid_of(ssp) not in train_stops):
                continue
            arr, dep = text(tpt, "ArrivalTime"), text(tpt, "DepartureTime")
            if not arr and not dep:
                continue
            a = seconds(arr, text(tpt, "ArrivalDayOffset")) if arr else None
            d = seconds(dep, text(tpt, "DepartureDayOffset")) if dep else None
            a = a if a is not None else d
            d = d if d is not None else a
            # No day offsets (Italo): a time before the last one is the next day.
            if last is not None and text(tpt, "ArrivalDayOffset") is None and text(tpt, "DepartureDayOffset") is None:
                while a < last:
                    a += 86400
                while d < a:
                    d += 86400
            last = max(a, d)
            rows.append((sid_of(ssp), a, max(a, d)))
            headsign = headsign or display
        if len(rows) < 2:
            counts["short"] += 1
            continue
        if profile == "italo":
            jid = "ITA-" + re.sub(r"[^A-Za-z0-9_-]+", "", sj.get("id").split(":")[-1])
        elif profile == "it":
            # IT::VehicleJourney:railTRENITALIA:0083_10083_0_p_1-10201-D5C-0083_p_…
            jid = re.sub(r"[^A-Za-z0-9_-]+", "", sj.get("id").split(":", 3)[-1])[:80]
        else:
            jid = re.sub(r"[^0-9_]+", "", sj.get("id").split(":")[-3] if sj.get("id").count(":") >= 3 else sj.get("id")) or sj.get("id")
        out["trips"].append({
            "id": jid, "number": trip_nr, "line": code, "operator": operator or "DSB",
            "submode": text(sj, f"TransportSubmode/{N}RailSubmode") or pname, "days": days, "rows": rows,
            "headsign": headsign,
        })


def hms(n):
    return f"{n // 3600:02d}:{n % 3600 // 60:02d}:{n % 60:02d}"


def read_source(netex, window, out, counts, profile):
    if netex.endswith(".zip"):
        with zipfile.ZipFile(netex) as z:
            for info in z.infolist():
                if not info.filename.endswith(".xml"):
                    continue
                counts["files"] += 1
                data = z.read(info.filename)
                if RAIL not in data:
                    continue
                counts["rail_files"] += 1
                read_file(data, window, out, counts, profile)
    else:
        counts["files"] = counts["rail_files"] = 1
        with (gzip.open(netex) if netex.endswith(".gz") else open(netex, "rb")) as f:
            read_file(f.read(), window, out, counts, profile)


def join_stops(out, counts, radius_m=600):
    """Italo's stations ("ITA-OUE") onto the nearest station of the other
    sources within radius_m; those without one keep their own stop."""
    import math
    main = [(s, v) for s, v in out["stops"].items() if not s.startswith("ITA-")]
    remap = {}
    for sid, (name, lat, lon) in list(out["stops"].items()):
        if not sid.startswith("ITA-"):
            continue
        best, dist = None, radius_m
        for other, (_, la, lo) in main:
            d = math.hypot((la - lat) * 111_320, (lo - lon) * 111_320 * math.cos(math.radians(lat)))
            if d < dist:
                best, dist = other, d
        if best:
            remap[sid] = best
            counts["italo_stations_joined"] += 1
        else:
            counts["italo_stations_own"] += 1
    for t in out["trips"]:
        t["rows"] = [(remap.get(s, s), a, d) for s, a, d in t["rows"]]


def dedupe_italo(out, counts):
    """Italo lists a train once per product (the train alone, or with an
    Italobus connection): with the buses gone, one train, one day, several
    trips. Each day keeps the trip with the most stops; another whose calls
    are all in it loses that day."""
    by_number = collections.defaultdict(list)
    for t in out["trips"]:
        if t["id"].startswith("ITA-") and t["number"]:
            by_number[t["number"]].append(t)
    for trips in by_number.values():
        trips.sort(key=lambda t: -len(t["rows"]))
        for i, big in enumerate(trips):
            calls = {(s, d) for s, _, d in big["rows"]}
            for small in trips[i + 1:]:
                if small["days"] & big["days"] and {(s, d) for s, _, d in small["rows"]} <= calls:
                    counts["italo_duplicate_days"] += len(small["days"] & big["days"])
                    small["days"] = small["days"] - big["days"]
    out["trips"] = [t for t in out["trips"] if t["days"]]


def convert(netex, window, profile="dk", extra=()):
    out = {"stops": {}, "trips": []}
    counts = collections.Counter()
    prof = PROFILES[profile]
    read_source(netex, window, out, counts, profile)
    for path, p in extra:
        read_source(path, window, out, counts, p)
    if any(p == "italo" for _, p in extra):
        join_stops(out, counts)
        dedupe_italo(out, counts)
    agencies, routes, trips, times, dates, used = {}, {}, [], [], [], set()
    for t in out["trips"]:
        if any(r[0] not in out["stops"] for r in t["rows"]):
            t["rows"] = [r for r in t["rows"] if r[0] in out["stops"]]
            counts["stop_calls_without_position"] += 1
            if len(t["rows"]) < 2:
                continue
        agency = re.sub(r"[^A-Za-z0-9]+", "", t["operator"]) or prof["agency"]
        agencies.setdefault(agency, t["operator"])
        route = f"{agency}:{t['line'] or t['submode'] or 'rail'}"
        routes.setdefault(route, (agency, t["line"] or "", t["submode"] or ""))
        tid = t["id"]
        trips.append([route, tid, tid, t["headsign"] or out["stops"][t["rows"][-1][0]][0],
                      t["number"] if t["number"].isdigit() else ""])
        dates.extend([tid, d.strftime("%Y%m%d"), 1] for d in sorted(t["days"]))
        times.extend([tid, hms(a), hms(d), s, i + 1] for i, (s, a, d) in enumerate(t["rows"]))
        used.update(r[0] for r in t["rows"])
        counts["trips"] += 1
        counts[f"submode:{t['submode']}"] += 1
    tables = {
        "agency.txt": [["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang"]]
        + [[a, n, prof["url"], prof["tz"], prof["lang"]] for a, n in sorted(agencies.items())],
        "routes.txt": [["route_id", "agency_id", "route_short_name", "route_desc", "route_type"]]
        + [[r, a, code, sub, 2] for r, (a, code, sub) in sorted(routes.items())],
        "trips.txt": [["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name"]] + trips,
        "stop_times.txt": [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]] + times,
        "calendar_dates.txt": [["service_id", "date", "exception_type"]] + dates,
        "stops.txt": [["stop_id", "stop_name", "stop_lat", "stop_lon"]]
        + [[s, *out["stops"][s]] for s in sorted(used)],
        "feed_info.txt": [["feed_publisher_name", "feed_publisher_url", "feed_lang"]]
        + [[prof["publisher"], prof["url"], prof["lang"]]],
    }
    counts["stations"] = len(used)
    return tables, counts


def write(path, tables):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, rows in tables.items():
            s = io.StringIO()
            csv.writer(s, lineterminator="\n").writerows(rows)
            z.writestr(name, s.getvalue())


def main(argv):
    start, profile, extra = None, "dk", []
    while "--add" in argv:
        i = argv.index("--add")
        path, _, p = argv[i + 1].rpartition(":")
        extra.append((path, p))
        argv = argv[:i] + argv[i + 2:]
    if "--profile" in argv:
        i = argv.index("--profile")
        profile = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if "--start" in argv:
        i = argv.index("--start")
        start = dt.date.fromisoformat(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    out, src = argv[0], argv[1]
    days = int(argv[2]) if len(argv) > 2 else 9
    start = start or dt.date.today() - dt.timedelta(days=1)
    window = {start + dt.timedelta(days=i) for i in range(days)}
    tables, c = convert(src, window, profile, extra)
    write(out, tables)
    subs = ", ".join(f"{k.split(':', 1)[1]} {v}" for k, v in sorted(c.items()) if k.startswith("submode:"))
    print(f"{out}: {c['files']} NeTEx files, {c['rail_files']} with trains, {c['rail_journeys']} rail journeys, "
          f"{c['trips']} in the window ({subs}), {c['stations']} stations; {c['short']} too short, "
          f"{c['stop_calls_without_position']} trips with a stop without a position"
          + (f"; Italo stations: {c['italo_stations_joined']} joined, {c['italo_stations_own']} on their own, "
             f"{c['italo_itineraries']} itineraries with a change skipped, "
             f"{c['italo_duplicate_days']} duplicate train-days merged" if extra else ""))
    return 0 if c["trips"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
