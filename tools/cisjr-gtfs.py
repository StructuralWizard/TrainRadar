#!/usr/bin/env python3
"""Czechia's trains as GTFS, from the national timetable system CIS JŘ.

    python3 -I tools/cisjr-gtfs.py OUT.zip STATIONS.geojsonseq [DAYS]
        [--cache DIR] [--sources FILE] [--start YYYY-MM-DD] [--cancel-days N]

DAYS from yesterday (default 9; the deploy asks for 63, for its plan-ahead
timetables); cancellations are applied to the first N days (default 9).

CIS JŘ (Ministry of Transport; https://portal.cisjr.cz/pub/) publishes every
passenger train of every operator on Správa železnic's network, with no
registration, in two forms:

- NeTEx (`/pub/netex/`): one ZIP per timetable year (`NeTEx_GVD2027.zip`,
  one XML file per train path) and, once the year has started, one ZIP of
  new and changed paths per month (`NeTEx_GVD2026_updates_2026-11.zip`);
- CZPTT, Správa železnic's own XML (`/pub/draha/celostatni/szdc/<year>/
  <month>/`), the same paths one file each, and the cancellations
  (`cancel_PA_…_<first day>.xml.zip`, gzip), which the NeTEx updates leave
  out: thousands a month, mostly base trains replaced on some days by a
  changed path (engineering works).

So: trains from NeTEx (the base, then each month's updates, a later
publication of a path replacing the earlier one), minus the CZPTT
cancellations of the days built (a cancellation counts only if it's newer
than the path it cancels). One trip per path and its operating days in the
window, `trip_id` = the path's id (`PA/0054/KT----10018A/00/2027/` →
`KT10018A-00-2027`); stops are the stations where it stops for passengers.

CIS JŘ has no coordinates: stations are placed from OpenStreetMap (railway
stations and halts, a GeoJSON sequence made by osmium), by their UIC/SR70
number (`CZ36895` ↔ uic_ref 5436895…), else by name. Stations not found
are left out of their trains, and counted.

Downloads are cached in --cache (default: next to OUT). --sources appends
name, url, etag, last-modified lines (fetch-eu.sh's sources.tsv). Standard
library only; nothing secret is used.
"""

import collections
import csv
import datetime as dt
import gzip
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

PORTAL = "https://portal.cisjr.cz/pub/"
CLIENT = "Metranos-TrainRadar (+https://mytrainradar.com)"
N = "{http://www.netex.org.uk/netex}"

# Commercial train types (KADR code list, "Komerční druhy vlaků", v1.04):
# code → (abbreviation, long distance?).
CATEGORIES = {
    "50": ("EC", True), "63": ("IC", True), "69": ("Ex", True), "70": ("EN", True),
    "84": ("Os", False), "94": ("SC", True), "122": ("Sp", False), "157": ("R", True),
    "209": ("rj", True), "9000": ("Rx", False), "9001": ("TLX", True), "9002": ("TL", False),
    "9003": ("LE", True), "9004": ("RJ", True), "9005": ("AEx", True), "9006": ("NJ", True),
    "9007": ("LET", False), "9010": ("ES", True),
}


# ---------------------------------------------------------------- download

def opened(req, timeout=120):
    """urlopen, retried: the portal resets a connection now and then."""
    for attempt in range(5):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError:
            raise
        except OSError:
            if attempt == 4:
                raise
            time.sleep(5 * (attempt + 1))


def head(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": CLIENT})
    with opened(req, 60) as r:
        return f"{r.headers.get('Content-Length')} {r.headers.get('Last-Modified')}"


def fetch(url, out, sources=None, name=None, changes=False):
    """url → out, its headers to sources. A file already there is kept (the
    cancellations never change); with `changes`, only while its size and
    date on the server are the same (the NeTEx ZIPs are republished)."""
    stamp = head(url) if changes else None
    if stamp and os.path.exists(out):
        try:
            with open(out + ".stamp") as f:
                same = f.read() == stamp
        except OSError:
            same = False
        if not same:
            os.remove(out)
    if not os.path.exists(out):
        req = urllib.request.Request(url, headers={"User-Agent": CLIENT})
        for attempt in range(5):
            try:
                with opened(req, 300) as r, open(out + ".part", "wb") as f:
                    while chunk := r.read(1 << 20):
                        f.write(chunk)
                break
            except OSError as e:
                if attempt == 4:
                    raise SystemExit(f"{url}: {e}") from None
                time.sleep(5 * (attempt + 1))
        os.replace(out + ".part", out)
        if stamp:
            with open(out + ".stamp", "w") as f:
                f.write(stamp)
    if sources and name:
        with open(sources, "a", encoding="utf-8") as s:
            s.write(f"{name}\t{url}\t\t{stamp.split(' ', 1)[-1] if stamp else ''}\n")
    return out


def listing(path):
    """Names in one of the portal's directory listings."""
    req = urllib.request.Request(PORTAL + path, headers={"User-Agent": CLIENT})
    with opened(req) as r:
        html = r.read().decode("utf-8", "replace")
    return [h.rstrip("/").rsplit("/", 1)[-1] for h in re.findall(r'HREF="(/pub/[^"]+)"', html, re.I)
            if h.rstrip("/") != "/pub/" + path.rstrip("/").rsplit("/", 1)[0]]


def timetable_year(d):
    """Czech timetable years start on the Sunday after December's second
    Saturday (13 Dec 2026 starts 2027)."""
    dec1 = dt.date(d.year, 12, 1)
    first_sat = dec1 + dt.timedelta(days=(5 - dec1.weekday()) % 7)
    start = first_sat + dt.timedelta(days=8)  # Sunday after the second Saturday
    return d.year + 1 if d >= start else d.year


# ----------------------------------------------------------------- NeTEx

def local(tag):
    return tag.rsplit("}", 1)[-1]


def keyvalues(el):
    return {kv.findtext(N + "Key"): kv.findtext(N + "Value") for kv in el.iter(N + "KeyValue")}


def days_of(period):
    start = dt.date.fromisoformat(period.findtext(N + "FromDate")[:10])
    bits = period.findtext(N + "ValidDayBits") or ""
    return {start + dt.timedelta(days=i) for i, b in enumerate(bits) if b == "1"}


def hms_seconds(t, offset):
    h, m, s = (int(x) for x in t.split(":"))
    return int(offset or 0) * 86400 + h * 3600 + m * 60 + s


def parse_train(data, window):
    """One NeTEx train file → its journeys [(pa, published, days, info,
    stops)] with days inside the window (others are skipped early)."""
    root = ET.fromstring(data)
    published = root.findtext(N + "PublicationTimestamp") or ""
    periods = {p.get("id"): days_of(p) for p in root.iter(N + "UicOperatingPeriod")}
    daytype = collections.defaultdict(lambda: [set(), set()])
    for a in root.iter(N + "DayTypeAssignment"):
        ref = a.find(N + "DayTypeRef")
        op = a.find(N + "OperatingPeriodRef")
        if ref is None:
            continue
        if op is not None:
            ds = periods.get(op.get("ref"), set())
        elif a.findtext(N + "Date"):
            ds = {dt.date.fromisoformat(a.findtext(N + "Date")[:10])}
        else:
            continue
        on = (a.findtext(N + "isAvailable") or "true") != "false"
        daytype[ref.get("ref")][0 if on else 1] |= ds
    names = {s.get("id"): s.findtext(N + "Name") or "" for s in root.iter(N + "ScheduledStopPoint")}
    operators = {o.get("id"): o.findtext(N + "LegalName") or o.findtext(N + "Name") or "" for o in root.iter(N + "Operator")}
    lines = {l.get("id"): l.findtext(N + "PublicCode") or l.findtext(N + "Name") or "" for l in root.iter(N + "Line")}
    patterns = {}
    for p in root.iter(N + "ServiceJourneyPattern"):
        line = p.find(f"{N}RouteView/{N}LineRef")
        pts = {}
        for sp in p.iter(N + "StopPointInJourneyPattern"):
            ref = sp.find(N + "ScheduledStopPointRef").get("ref")
            pts[sp.get("id")] = (ref, sp.findtext(N + "StopUse") or "", keyvalues(sp), int(sp.get("order") or 0))
        patterns[p.get("id")] = (line.get("ref") if line is not None else None, pts)
    out = []
    for sj in root.iter(N + "ServiceJourney"):
        days = set()
        for ref in sj.iter(N + "DayTypeRef"):
            on, off = daytype.get(ref.get("ref"), (set(), set()))
            days |= on - off
        days &= window
        if not days:
            continue
        ids = [kv.findtext(N + "Value") for kv in sj.find(N + "keyList") or []
               if kv.findtext(N + "Key") == "PlannedTransportIdentifiers"]
        pa = next((i for i in ids if i.startswith("PA/")), None) or sj.get("id").rsplit(":", 1)[-1]
        line_ref, pts = patterns.get(sj.find(N + "ServiceJourneyPatternRef").get("ref"), (None, {}))
        stops = []
        first_kv = None
        for tpt in sj.iter(N + "TimetabledPassingTime"):
            ref = tpt.find(N + "StopPointInJourneyPatternRef").get("ref")
            ssp, use, kv, order = pts.get(ref, (None, "", {}, 0))
            if first_kv is None and kv.get("CommercialTrafficType"):
                first_kv = kv
            if ssp is None or use in ("noBoardingOrAlighting", "passthrough"):
                continue
            arr = tpt.findtext(N + "ArrivalTime")
            dep = tpt.findtext(N + "DepartureTime")
            if not arr and not dep:
                continue
            a = hms_seconds(arr, tpt.findtext(N + "ArrivalDayOffset")) if arr else None
            d = hms_seconds(dep, tpt.findtext(N + "DepartureDayOffset")) if dep else None
            stops.append((ssp.rsplit(":", 1)[-1], names.get(ssp, ""), a if a is not None else d,
                          d if d is not None else a, order))
        kv = first_kv or {}
        op = sj.find(N + "OperatorRef")
        info = {
            "number": lines.get(line_ref) or kv.get("OperationalTrainNumber") or "",
            "category": kv.get("CommercialTrafficType") or "",
            "operator": operators.get(op.get("ref") if op is not None else kv.get("OperatorRef"), "")
            or operators.get(kv.get("OperatorRef"), ""),
        }
        out.append((pa, published, days, info, stops))
    return out


def cancellation(data):
    """A CZPTT cancellation → (PA id, its time, the days cancelled)."""
    root = ET.fromstring(data)
    pa = None
    for ident in root.iter("PlannedTransportIdentifiers"):
        if ident.findtext("ObjectType") == "PA":
            pa = "PA/{}/{}/{}/{}/".format(*(ident.findtext(k) or "" for k in ("Company", "Core", "Variant", "TimetableYear")))
    cal = root.find("PlannedCalendar")
    if pa is None or cal is None:
        return None
    start = dt.date.fromisoformat(cal.findtext("ValidityPeriod/StartDateTime")[:10])
    bits = cal.findtext("BitmapDays") or ""
    return pa, root.findtext("CZPTTCancelation") or "", {start + dt.timedelta(days=i) for i, b in enumerate(bits) if b == "1"}


# -------------------------------------------------------------- stations

ABBREV = [
    (r"\bhl\.\s*n\.", "hlavní nádraží"), (r"\bhor\.\s*n\.", "horní nádraží"),
    (r"\bdol\.\s*n\.", "dolní nádraží"), (r"\bměsto\b", "město"), (r"\bzast\.", "zastávka"),
    (r"\bn\.\s*", "nad "), (r"\bp\.\s*", "pod "), (r"\bu\s", "u "), (r"\bnádr\.", "nádraží"),
    (r"\bzastávka\b", "zastávka"), (r"\bstřed\b", "střed"),
]


def norm(name):
    s = (name or "").lower()
    for pat, rep in ABBREV:
        s = re.sub(pat, rep, s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def osm_stations(path):
    """OSM railway stations/halts → (by code, by normalised name)."""
    by_code, by_name = {}, collections.defaultdict(list)
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            feat = json.loads(line)
            geom = feat.get("geometry") or {}
            coords = geom.get("coordinates")
            if geom.get("type") != "Point" or not coords:
                continue
            tags = feat.get("properties") or {}
            pos = (round(coords[1], 6), round(coords[0], 6))
            for k, v in tags.items():
                if not re.search(r"uic|sr70|railway:ref|^ref", k):
                    continue
                for digits in re.findall(r"\d{5,8}", str(v)):
                    if len(digits) >= 7 and digits.startswith("54"):
                        by_code.setdefault(digits[2:7], (pos, k))
                    elif len(digits) == 6:  # SR70: 5 digits and a check digit
                        by_code.setdefault(digits[:5], (pos, k))
                    elif len(digits) == 5:
                        by_code.setdefault(digits, (pos, k))
            for k in ("name", "official_name", "alt_name", "short_name"):
                if tags.get(k):
                    by_name[norm(tags[k])].append(pos)
    return by_code, by_name


def place(stop_id, name, by_code, by_name, how):
    m = re.fullmatch(r"CZ(\d{5})", stop_id)
    if m and m.group(1) in by_code:
        pos, key = by_code[m.group(1)]
        how[f"code ({key})"] += 1
        return pos
    hits = by_name.get(norm(name)) or []
    if hits and max(abs(a[0] - hits[0][0]) + abs(a[1] - hits[0][1]) for a in hits) < 0.05:
        how["name"] += 1
        return hits[0]
    how["not found"] += 1
    return None


# ------------------------------------------------------------------ main

def trip_id(pa):
    parts = [p for p in pa.split("/") if p]
    core = parts[2].replace("-", "") if len(parts) > 2 else pa
    return "-".join([core, *parts[3:5]]) if len(parts) >= 5 else re.sub(r"[^A-Za-z0-9]+", "-", pa).strip("-")


def hms(n):
    return f"{n // 3600:02d}:{n % 3600 // 60:02d}:{n % 60:02d}"


def convert(netex_zips, cancel_files, stations_path, window):
    """GTFS tables and counts."""
    journeys = {}  # pa → (published, days, info, stops)
    counts = collections.Counter()
    for path in netex_zips:
        with zipfile.ZipFile(path) as z:
            for name in sorted(z.namelist(), key=lambda n: (n[-12:], n)):
                if not name.endswith(".xml"):
                    continue
                counts["files"] += 1
                for pa, published, days, info, stops in parse_train(z.read(name), window):
                    old = journeys.get(pa)
                    if old is None or published >= old[0]:
                        journeys[pa] = (published, days, info, stops)
    for data in cancel_files:
        c = cancellation(data)
        if not c:
            continue
        pa, when, days = c
        j = journeys.get(pa)
        if j and when >= j[0] and days & j[1]:
            counts["cancelled_days"] += len(days & j[1])
            j[1].difference_update(days)
    by_code, by_name = osm_stations(stations_path)
    how = collections.Counter()
    placed = {}
    agencies, routes, trips, times, dates, used = {}, {}, [], [], [], {}
    for pa, (_, days, info, stops) in sorted(journeys.items()):
        if not days:
            counts["all_cancelled"] += 1
            continue
        rows = []
        for sid, name, arr, dep, order in stops:
            if sid not in placed:
                placed[sid] = place(sid, name, by_code, by_name, how)
            if placed[sid] is None:
                counts["stops_without_position"] += 1
                continue
            used[sid] = name
            rows.append([sid, arr, max(dep, arr)])
        if len(rows) < 2:
            counts["short"] += 1
            continue
        abbr, _long = CATEGORIES.get(info["category"], (info["category"] or "Os", False))
        operator = info["operator"] or "CIS JŘ"
        agency = re.sub(r"[^A-Za-z0-9]+", "", unicodedata.normalize("NFKD", operator))[:24] or "CISJR"
        agencies.setdefault(agency, operator)
        route = f"{agency}:{abbr}"
        routes.setdefault(route, (agency, abbr))
        tid = trip_id(pa)
        trips.append([route, tid, tid, used[rows[-1][0]], info["number"] if info["number"].isdigit() else ""])
        dates.extend([tid, d.strftime("%Y%m%d"), 1] for d in sorted(days))
        times.extend([tid, hms(a), hms(d), sid, i + 1] for i, (sid, a, d) in enumerate(rows))
        counts["trips"] += 1
        counts["categories:" + abbr] += 1
    tables = {
        "agency.txt": [["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang"]]
        + [[a, n, "https://portal.cisjr.cz", "Europe/Prague", "cs"] for a, n in sorted(agencies.items())],
        "routes.txt": [["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"]]
        + [[r, a, abbr, agencies[a], 2] for r, (a, abbr) in sorted(routes.items())],
        "trips.txt": [["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name"]] + trips,
        "stop_times.txt": [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]] + times,
        "calendar_dates.txt": [["service_id", "date", "exception_type"]] + dates,
        "stops.txt": [["stop_id", "stop_name", "stop_lat", "stop_lon"]]
        + [[s, used[s], placed[s][0], placed[s][1]] for s in sorted(used)],
        "feed_info.txt": [["feed_publisher_name", "feed_publisher_url", "feed_lang"]]
        + [["Ministerstvo dopravy ČR, CIS JŘ", "https://portal.cisjr.cz/pub/", "cs"]],
    }
    counts["stations"] = len(used)
    counts["journeys"] = len(journeys)
    return tables, counts, how


def write(path, tables):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, rows in tables.items():
            s = io.StringIO()
            csv.writer(s, lineterminator="\n").writerows(rows)
            z.writestr(name, s.getvalue())


def download(window, cache, sources, cancel_days=9):
    """The NeTEx ZIPs, and the CZPTT cancellations of the window's first
    `cancel_days` days (further ahead, a plan: they'd be tens of thousands
    of files)."""
    os.makedirs(cache, exist_ok=True)
    years = sorted({timetable_year(d) for d in window})
    netex = listing("netex/")
    zips = []
    for year in years:
        base = next((n for n in netex if n.lower() == f"netex_gvd{year}.zip"), None)
        if not base:
            raise SystemExit(f"no NeTEx_GVD{year}.zip on the portal")
        zips.append(fetch(PORTAL + "netex/" + base, os.path.join(cache, base), sources, f"cz netex {year}", True))
        for u in sorted(n for n in netex if n.lower().startswith(f"netex_gvd{year}_updates_")):
            zips.append(fetch(PORTAL + "netex/" + u, os.path.join(cache, u), sources, f"cz netex {u[-11:-4]}", True))
    # Cancellations whose first day is in the window or up to 3 days before
    # (nearly all are for one day). Kept in the cache between runs (CI
    # caches it), so a day's run downloads only the new ones.
    first = min(window) - dt.timedelta(days=3)
    last = min(max(window), min(window) + dt.timedelta(days=cancel_days - 1))
    cancels = []
    for year in years:
        try:
            months = [m for m in listing(f"draha/celostatni/szdc/{year}/") if re.fullmatch(r"\d{4}-\d{2}", m)]
        except OSError:
            continue
        for month in months:
            m0 = dt.date.fromisoformat(month + "-01")
            if m0 > last or (m0.replace(day=28) + dt.timedelta(days=4)).replace(day=1) <= first - dt.timedelta(days=31):
                continue
            for name in listing(f"draha/celostatni/szdc/{year}/{month}/"):
                m = re.fullmatch(r"cancel_.*_(\d{8})\.xml\.zip", name)
                if m and first <= dt.datetime.strptime(m.group(1), "%Y%m%d").date() <= last:
                    cancels.append(f"draha/celostatni/szdc/{year}/{month}/{name}")
    cdir = os.path.join(cache, "cancel")
    os.makedirs(cdir, exist_ok=True)
    data = []
    from concurrent.futures import ThreadPoolExecutor

    def one(p):
        out = os.path.join(cdir, p.rsplit("/", 1)[-1])
        try:
            fetch(PORTAL + p, out)
            with open(out, "rb") as f:
                raw = f.read()
            return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else zipfile.ZipFile(io.BytesIO(raw)).read(
                zipfile.ZipFile(io.BytesIO(raw)).namelist()[0])
        except (OSError, SystemExit, zipfile.BadZipFile, IndexError) as e:
            print(f"cancellation {p.rsplit('/', 1)[-1]}: {e}", file=sys.stderr)
            return None

    with ThreadPoolExecutor(8) as pool:
        data = [d for d in pool.map(one, cancels) if d]
    if sources:
        with open(sources, "a", encoding="utf-8") as s:
            s.write(f"cz czptt cancellations\t{PORTAL}draha/celostatni/szdc/\t\t\n")
    print(f"{len(zips)} NeTEx files, {len(data)} of {len(cancels)} cancellations ({first} to {last})")
    return zips, data


def main(argv):
    opts, args, i = {}, [], 0
    while i < len(argv):
        if argv[i].startswith("--"):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            args.append(argv[i])
            i += 1
    if len(args) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    out, stations = args[0], args[1]
    days = int(args[2]) if len(args) > 2 else 9
    start = dt.date.fromisoformat(opts["start"]) if "start" in opts else dt.date.today() - dt.timedelta(days=1)
    window = {start + dt.timedelta(days=i) for i in range(days)}
    cache = opts.get("cache") or os.path.join(os.path.dirname(os.path.abspath(out)), "cisjr")
    if "netex" in opts:  # tests: local files, no download
        zips = opts["netex"].split(",")
        cancels = []
        for p in filter(None, opts.get("cancels", "").split(",")):
            with open(p, "rb") as f:
                raw = f.read()
            cancels.append(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)
    else:
        zips, cancels = download(window, cache, opts.get("sources"), int(opts.get("cancel-days", 9)))
    tables, c, how = convert(zips, cancels, stations, window)
    write(out, tables)
    cats = ", ".join(f"{k.split(':')[1]} {v}" for k, v in sorted(c.items()) if k.startswith("categories:"))
    print(f"{out}: {c['files']} NeTEx files, {c['journeys']} paths in the window, {c['trips']} trips "
          f"({cats}), {c['stations']} stations; {c['cancelled_days']} days cancelled, "
          f"{c['all_cancelled']} paths cancelled on every day, {c['short']} too short")
    print("stations placed: " + ", ".join(f"{k} {v}" for k, v in how.most_common())
          + f"; {c['stops_without_position']} stop calls dropped")
    return 0 if c["trips"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
