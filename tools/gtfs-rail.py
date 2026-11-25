#!/usr/bin/env python3
"""Cut GTFS feeds down to their trains, streaming, and merge them into one.

    python3 -I tools/gtfs-rail.py OUT.zip IN.zip [IN.zip ...] [--parents] [--also=401,1]

For countries whose national GTFS covers every mode (the Netherlands' is
1.3 GB of stop times) or comes one file per operator (Norway's): the
refdata build then reads a small file. Keeps routes of GTFS `route_type` 2
or 100-117 (rail), their trips, stop times, stops, services and shapes.
With --parents, each stop time points at its stop's parent station
(platforms merged into their station, as the live feeds' trips stay the
same). Ids must not clash between inputs (Entur's and OVapi's are
prefixed or global). Standard library only.
"""

import csv
import io
import sys
import zipfile

RAIL = {"2"} | {str(n) for n in range(100, 118)}


def rows(z, name):
    """(header, row iterator) of a table, or (None, []) if missing."""
    try:
        f = z.open(name)
    except KeyError:
        return None, iter(())
    r = csv.reader(io.TextIOWrapper(f, "utf-8-sig", newline=""))
    return next(r, None), r


def good(d):
    """Whether a stop row has a usable position."""
    try:
        return abs(float(d.get("stop_lat") or 0)) > 0.1 and abs(float(d.get("stop_lon") or 0)) > 0.01
    except ValueError:
        return False


class Table:
    """A table written to the output zip as rows come, with the union of
    the inputs' columns (each input's header is known before its rows)."""

    def __init__(self, name):
        self.name = name
        self.cols = []
        self.buf = []  # (header, row) until all inputs are read

    def add(self, header, row):
        for c in header:
            if c not in self.cols:
                self.cols.append(c)
        self.buf.append((header, row))

    def write(self, out):
        if not self.cols:
            return
        s = io.StringIO()
        w = csv.writer(s, lineterminator="\n")
        w.writerow(self.cols)
        for header, row in self.buf:
            d = dict(zip(header, row))
            w.writerow([d.get(c, "") for c in self.cols])
        out.writestr(self.name, s.getvalue())


def main(argv):
    parents = "--parents" in argv
    # Other route types to keep too (Sydney Metro is type 401 or 1).
    also = {t for a in argv if a.startswith("--also=") for t in a[7:].split(",") if t}
    rail = RAIL | also
    args = [a for a in argv if a != "--parents" and not a.startswith("--also=")]
    if len(args) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    out_path, inputs = args[0], args[1:]
    tables = {n: Table(n) for n in ["agency.txt", "routes.txt", "trips.txt", "stops.txt",
                                     "calendar.txt", "calendar_dates.txt", "shapes.txt", "feed_info.txt"]}
    # stop_times is the big one: written straight to the zip, input by input.
    st_cols = ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence",
               "pickup_type", "drop_off_type", "stop_headsign", "shape_dist_traveled"]
    counts = {"routes": 0, "trips": 0, "stop_times": 0, "stops": 0}
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as out:
        with out.open("stop_times.txt", "w", force_zip64=True) as stf:
            stw = io.TextIOWrapper(stf, "utf-8", newline="")
            sw = csv.writer(stw, lineterminator="\n")
            sw.writerow(st_cols)
            for path in inputs:
                with zipfile.ZipFile(path) as z:
                    h, r = rows(z, "routes.txt")
                    routes = set()
                    agencies = set()
                    for row in r:
                        d = dict(zip(h, row))
                        if d.get("route_type", "").strip() in rail:
                            routes.add(d["route_id"])
                            agencies.add(d.get("agency_id", ""))
                            tables["routes.txt"].add(h, row)
                    counts["routes"] += len(routes)
                    h, r = rows(z, "agency.txt")
                    for row in r:
                        d = dict(zip(h, row))
                        if d.get("agency_id", "") in agencies or len(agencies) <= 1:
                            tables["agency.txt"].add(h, row)
                    h, r = rows(z, "trips.txt")
                    trips, services, shapes = set(), set(), set()
                    for row in r:
                        d = dict(zip(h, row))
                        if d["route_id"] in routes:
                            trips.add(d["trip_id"])
                            services.add(d["service_id"])
                            if d.get("shape_id"):
                                shapes.add(d["shape_id"])
                            tables["trips.txt"].add(h, row)
                    counts["trips"] += len(trips)
                    # Stops: which parent each platform has.
                    h, r = rows(z, "stops.txt")
                    stops = {row[h.index("stop_id")]: dict(zip(h, row)) for row in r}
                    sh = h
                    parent_of = {}
                    if parents and sh and "parent_station" in sh:
                        for sid, d in stops.items():
                            p = d.get("parent_station", "")
                            if p and p in stops:
                                parent_of[sid] = p
                    used = set()
                    h, r = rows(z, "stop_times.txt")
                    ti = h.index("trip_id")
                    si = h.index("stop_id")
                    for row in r:
                        if row[ti] not in trips:
                            continue
                        d = dict(zip(h, row))
                        sid = parent_of.get(row[si], row[si])
                        d["stop_id"] = sid
                        used.add(sid)
                        sw.writerow([d.get(c, "") for c in st_cols])
                        counts["stop_times"] += 1
                    # A parent without a position (OVapi has some at 0,0)
                    # takes its first platform's.
                    child_at = {}
                    for c, p in parent_of.items():
                        d = stops[c]
                        if p not in child_at and good(d):
                            child_at[p] = (d["stop_lat"], d["stop_lon"])
                    for sid in used:
                        d = dict(stops[sid])
                        if not good(d) and sid in child_at:
                            d["stop_lat"], d["stop_lon"] = child_at[sid]
                        if parents:
                            d["parent_station"] = ""
                            d["location_type"] = "0"
                        tables["stops.txt"].add(list(d.keys()), list(d.values()))
                    counts["stops"] += len(used)
                    for name in ["calendar.txt", "calendar_dates.txt"]:
                        h, r = rows(z, name)
                        if h:
                            k = h.index("service_id")
                            for row in r:
                                if row[k] in services:
                                    tables[name].add(h, row)
                    h, r = rows(z, "shapes.txt")
                    if h:
                        k = h.index("shape_id")
                        for row in r:
                            if row[k] in shapes:
                                tables["shapes.txt"].add(h, row)
                    if not tables["feed_info.txt"].buf:
                        h, r = rows(z, "feed_info.txt")
                        for row in r:
                            tables["feed_info.txt"].add(h, row)
            stw.flush()
            stw.detach()
        for t in tables.values():
            t.write(out)
    print(f"{out_path}: {counts['routes']} rail routes, {counts['trips']} trips, "
          f"{counts['stop_times']} stop times, {counts['stops']} stops from {len(inputs)} file(s)")
    return 0 if counts["trips"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
