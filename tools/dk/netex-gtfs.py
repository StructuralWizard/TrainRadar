#!/usr/bin/env python3
"""Denmark's trains as GTFS, from Rejseplanen's NeTEx on the national access
point (Dataudveksleren dataset 242, Rejsekort & Rejseplan A/S).

    python3 -I tools/dk/netex-gtfs.py OUT.zip NETEX.zip [DAYS] [--start YYYY-MM-DD]

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
import io
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

N = "{http://www.netex.org.uk/netex}"
RAIL = b"<TransportMode>rail</TransportMode>"


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
    m = re.search(r"ScheduledStopPoint:(\d{7})", ref or "")
    return m.group(1) if m else re.sub(r"[^A-Za-z0-9]+", "_", ref or "").strip("_")


def read_file(data, window, out, counts):
    """One NeTEx file's rail journeys in the window into `out`."""
    root = ET.fromstring(data)
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
        sid = stop_id(p.get("id"))
        if lat and lon and sid not in stops:
            stops[sid] = (text(p, "Name") or sid, float(lat), float(lon))
    operators = {o.get("id"): text(o, "Name") or text(o, "ShortName") or "" for o in root.iter(N + "Operator")}
    lines = {}
    for line in root.iter(N + "Line"):
        op = line.find(f"{N}additionalOperators/{N}OperatorRef")
        if op is None:
            op = line.find(N + "OperatorRef")
        lines[line.get("id")] = (text(line, "PublicCode") or text(line, "Name") or "", text(line, "TransportMode"),
                                 operators.get(op.get("ref")) if op is not None else None)
    displays = {d.get("id"): text(d, "FrontText") or text(d, "SideText") for d in root.iter(N + "DestinationDisplay")}
    patterns = {}
    for p in root.iter(N + "ServiceJourneyPattern"):
        lref = p.find(f"{N}RouteView/{N}LineRef")
        pts = {}
        for sp in p.iter(N + "StopPointInJourneyPattern"):
            ssp = sp.find(N + "ScheduledStopPointRef")
            dd = sp.find(N + "DestinationDisplayRef")
            pts[sp.get("id")] = (ssp.get("ref") if ssp is not None else None, text(sp, "ForBoarding") != "false" or text(sp, "ForAlighting") != "false",
                                 displays.get(dd.get("ref")) if dd is not None else None)
        patterns[p.get("id")] = (lref.get("ref") if lref is not None else None, pts)
    for sj in root.iter(N + "ServiceJourney"):
        if text(sj, "TransportMode") not in (None, "rail"):
            continue
        pref = sj.find(N + "ServiceJourneyPatternRef")
        line_ref, pts = patterns.get(pref.get("ref") if pref is not None else None, (None, {}))
        code, mode, operator = lines.get(line_ref, ("", None, None))
        if (text(sj, "TransportMode") or mode) != "rail":
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
        rows, headsign = [], None
        for tpt in sj.iter(N + "TimetabledPassingTime"):
            ref = tpt.find(N + "StopPointInJourneyPatternRef")
            ssp, public, display = pts.get(ref.get("ref") if ref is not None else None, (None, False, None))
            if ssp is None or not public:
                continue
            arr, dep = text(tpt, "ArrivalTime"), text(tpt, "DepartureTime")
            if not arr and not dep:
                continue
            a = seconds(arr, text(tpt, "ArrivalDayOffset")) if arr else None
            d = seconds(dep, text(tpt, "DepartureDayOffset")) if dep else None
            a = a if a is not None else d
            d = d if d is not None else a
            rows.append((stop_id(ssp), a, max(a, d)))
            headsign = headsign or display
        if len(rows) < 2:
            counts["short"] += 1
            continue
        jid = re.sub(r"[^0-9_]+", "", sj.get("id").split(":")[-3] if sj.get("id").count(":") >= 3 else sj.get("id")) or sj.get("id")
        out["trips"].append({
            "id": jid, "number": trip_nr, "line": code, "operator": operator or "DSB",
            "submode": text(sj, f"TransportSubmode/{N}RailSubmode"), "days": days, "rows": rows,
            "headsign": headsign,
        })


def hms(n):
    return f"{n // 3600:02d}:{n % 3600 // 60:02d}:{n % 60:02d}"


def convert(netex_zip, window):
    out = {"stops": {}, "trips": []}
    counts = collections.Counter()
    with zipfile.ZipFile(netex_zip) as z:
        for info in z.infolist():
            if not info.filename.endswith(".xml"):
                continue
            counts["files"] += 1
            data = z.read(info.filename)
            if RAIL not in data:
                continue
            counts["rail_files"] += 1
            read_file(data, window, out, counts)
    agencies, routes, trips, times, dates, used = {}, {}, [], [], [], set()
    for t in out["trips"]:
        if any(r[0] not in out["stops"] for r in t["rows"]):
            t["rows"] = [r for r in t["rows"] if r[0] in out["stops"]]
            counts["stop_calls_without_position"] += 1
            if len(t["rows"]) < 2:
                continue
        agency = re.sub(r"[^A-Za-z0-9]+", "", t["operator"]) or "DSB"
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
        + [[a, n, "https://www.rejseplanen.dk", "Europe/Copenhagen", "da"] for a, n in sorted(agencies.items())],
        "routes.txt": [["route_id", "agency_id", "route_short_name", "route_desc", "route_type"]]
        + [[r, a, code, sub, 2] for r, (a, code, sub) in sorted(routes.items())],
        "trips.txt": [["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name"]] + trips,
        "stop_times.txt": [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]] + times,
        "calendar_dates.txt": [["service_id", "date", "exception_type"]] + dates,
        "stops.txt": [["stop_id", "stop_name", "stop_lat", "stop_lon"]]
        + [[s, *out["stops"][s]] for s in sorted(used)],
        "feed_info.txt": [["feed_publisher_name", "feed_publisher_url", "feed_lang"]]
        + [["Rejsekort & Rejseplan A/S, via Dataudveksleren", "https://www.rejseplanen.dk", "da"]],
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
    start = None
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
    tables, c = convert(src, window)
    write(out, tables)
    subs = ", ".join(f"{k.split(':', 1)[1]} {v}" for k, v in sorted(c.items()) if k.startswith("submode:"))
    print(f"{out}: {c['files']} NeTEx files, {c['rail_files']} with trains, {c['rail_journeys']} rail journeys, "
          f"{c['trips']} in the window ({subs}), {c['stations']} stations; {c['short']} too short, "
          f"{c['stop_calls_without_position']} trips with a stop without a position")
    return 0 if c["trips"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
