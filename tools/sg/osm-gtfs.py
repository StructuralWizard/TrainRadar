#!/usr/bin/env python3
"""An estimated GTFS for Singapore's MRT and LRT, from OpenStreetMap.

    python3 -I tools/sg/osm-gtfs.py ROUTES.opl LINES.tsv OUT.zip [DAYS]

LTA publishes no rail timetable. This draws one from what is published:
OpenStreetMap's route relations (route=subway / light_rail: the stations in
order and the track; osmium cat -f opl) and LINES.tsv (each line's service
hours and headways, tools/sg/lines.tsv). Running times come from the
distance along the track at the line's speed plus a dwell at each station.
Every trip is an estimate: trains leave each end every `headway` minutes
from the first to the last train. Trip ids start with "est-".

Lines are told apart by the station codes OSM gives (NS1, EW24, CG2…): a
route's line is the code prefix most of its stations share. A line with a
single relation (one direction mapped) gets the other direction by reversal;
a loop (Sengkang, Punggol) runs as mapped. Standard library only.
"""

import csv
import datetime as dt
import io
import math
import re
import sys
import zipfile
from collections import Counter, defaultdict

# Singapore, with a margin (Johor Bahru's lines are left out by the codes).
BBOX = (103.55, 1.13, 104.15, 1.50)
UNESC = re.compile(r"%([0-9a-fA-F]+)%")


def unesc(s):
    return UNESC.sub(lambda m: chr(int(m.group(1), 16)), s)


def tags_of(field):
    out = {}
    if not field:
        return out
    for kv in field.split(","):
        if "=" in kv:
            k, v = kv.split("=", 1)
            out[unesc(k)] = unesc(v)
    return out


def read_opl(path):
    nodes, ways, rels = {}, {}, {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split(" ")
            kind, oid = parts[0][0], parts[0][1:]
            fields = {p[0]: p[1:] for p in parts[1:] if p}
            tags = tags_of(fields.get("T", ""))
            if kind == "n":
                try:
                    nodes[oid] = (float(fields["x"]), float(fields["y"]), tags)
                except (KeyError, ValueError):
                    pass
            elif kind == "w":
                ways[oid] = ([n[1:] for n in fields.get("N", "").split(",") if n], tags)
            elif kind == "r":
                members = []
                for m in fields.get("M", "").split(","):
                    if not m:
                        continue
                    ref, _, role = m.partition("@")
                    members.append((ref[0], ref[1:], unesc(role)))
                rels[oid] = (members, tags)
    return nodes, ways, rels


def dist(a, b):
    """Metres between (lon, lat) points."""
    lat = math.radians((a[1] + b[1]) / 2)
    dx = math.radians(b[0] - a[0]) * math.cos(lat) * 6_371_000
    dy = math.radians(b[1] - a[1]) * 6_371_000
    return math.hypot(dx, dy)


def chain(way_ids, nodes, ways):
    """The route's ways joined end to end, as [(lon, lat)]."""
    out = []
    for wid in way_ids:
        if wid not in ways:
            continue
        pts = [nodes[n][:2] for n in ways[wid][0] if n in nodes]
        if len(pts) < 2:
            continue
        if not out:
            out = pts
            continue
        end, start = out[-1], out[0]
        if dist(end, pts[0]) < 1:
            out += pts[1:]
        elif dist(end, pts[-1]) < 1:
            out += pts[::-1][1:]
        elif len(out) == len(pts) or dist(start, pts[0]) < 1 or dist(start, pts[-1]) < 1:
            # The first way ran the other way round.
            out = out[::-1]
            out += pts[1:] if dist(out[-1], pts[0]) < 1 else pts[::-1][1:]
        else:
            out += pts  # a gap in the mapping: joined straight
    return out


def project(line, p):
    """Distance along `line` of the point nearest p (metres)."""
    best, best_d, run = 0.0, float("inf"), 0.0
    for a, b in zip(line, line[1:]):
        seg = dist(a, b)
        if seg == 0:
            continue
        # Flat projection is fine at these scales.
        ax, ay = a
        bx, by = b
        t = ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)
        t = min(1.0, max(0.0, t))
        q = (ax + t * (bx - ax), ay + t * (by - ay))
        d = dist(p, q)
        if d < best_d:
            best, best_d = run + t * seg, d
        run += seg
    return best, best_d


def codes(tags):
    """Station codes a node carries ("NS1;EW24" → [("NS", "NS1"), ("EW", "EW24")])."""
    out = []
    for key in ("ref", "local_ref", "ref:mrt"):
        for c in re.split(r"[;,/ ]+", tags.get(key, "")):
            m = re.fullmatch(r"([A-Z]{2})(\d+[A-Z]?)", c.strip().upper())
            if m:
                out.append((m.group(1), m.group(0)))
    return out


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def hm(s):
    h, m = s.split(":")
    return int(h) * 3600 + int(m) * 60


def gtfs_time(s):
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    opl, lines_tsv, out_zip = argv[:3]
    days = int(argv[3]) if len(argv) > 3 else 70
    lines = {}
    with open(lines_tsv, encoding="utf-8") as f:
        for row in csv.reader((l for l in f if l.strip() and not l.startswith("#")), delimiter="\t"):
            ref, name, operator, first, last, peak, off, weekend, kmh, dwell = row
            lines[ref] = dict(name=name, operator=operator, first=hm(first), last=hm(last), peak=float(peak),
                              off=float(off), weekend=float(weekend), mps=float(kmh) / 3.6, dwell=int(dwell))

    nodes, ways, rels = read_opl(opl)
    print(f"osm: {len(nodes)} nodes, {len(ways)} ways, {len(rels)} relations")

    # Each route relation → (line, [stops], [track]).
    patterns = defaultdict(list)
    skipped = Counter()
    for rid, (members, tags) in rels.items():
        if tags.get("type") != "route" or tags.get("route") not in ("subway", "light_rail", "train", "monorail"):
            continue
        stop_nodes = [nodes[m[1]] for m in members if m[0] == "n" and m[2].startswith("stop") and m[1] in nodes]
        plat_codes = []
        for kind, ref, role in members:
            if role.startswith("platform"):
                t = nodes[ref][2] if kind == "n" and ref in nodes else ways[ref][1] if kind == "w" and ref in ways else {}
                plat_codes += codes(t)
        if len(stop_nodes) < 2:
            skipped["fewer than 2 stops"] += 1
            continue
        if not all(BBOX[0] <= n[0] <= BBOX[2] and BBOX[1] <= n[1] <= BBOX[3] for n in stop_nodes):
            skipped["outside Singapore"] += 1
            continue
        prefixes = Counter(p for n in stop_nodes for p, _ in codes(n[2])) + Counter(p for p, _ in plat_codes)
        line = next((p for p, _ in prefixes.most_common() if p in lines), None)
        if not line:
            # The relation's own ref ("NSL", "NS") or name.
            r = tags.get("ref", "").upper()
            line = next((k for k in lines if r.startswith(k)), None) or next(
                (k for k, v in lines.items() if v["name"].lower() in tags.get("name", "").lower()), None)
        if not line:
            skipped[f"no line ({tags.get('name', rid)})"] += 1
            continue
        names = []
        for n in stop_nodes:
            nm = n[2].get("name:en") or n[2].get("name") or ""
            nm = re.sub(r"\s+(MRT|LRT)?\s*(Station|Stn)?$", "", nm, flags=re.I).strip() or f"{n[0]:.5f},{n[1]:.5f}"
            names.append((nm, n[:2]))
        # Consecutive duplicates (two stop positions of one station).
        stops = [s for i, s in enumerate(names) if i == 0 or s[0] != names[i - 1][0]]
        track = chain([m[1] for m in members if m[0] == "w" and not m[2]], nodes, ways)
        patterns[line].append(dict(rel=rid, name=tags.get("name", ""), stops=stops, track=track, colour=tags.get("colour", "")))
    for why, n in skipped.items():
        print(f"osm: {n} route relations skipped: {why}")

    # Stations: one per name, at the mean of its stop positions.
    where = defaultdict(list)
    for pats in patterns.values():
        for p in pats:
            for nm, xy in p["stops"]:
                where[nm].append(xy)
    stations = {nm: (sum(x for x, _ in v) / len(v), sum(y for _, y in v) / len(v)) for nm, v in where.items()}

    today = dt.date.today()
    start, end = today - dt.timedelta(days=1), today + dt.timedelta(days=days)
    files = {n: io.StringIO() for n in ["agency", "routes", "stops", "trips", "stop_times", "calendar", "shapes", "feed_info"]}
    w = {n: csv.writer(s, lineterminator="\n") for n, s in files.items()}
    w["agency"].writerow(["agency_id", "agency_name", "agency_url", "agency_timezone"])
    for op in sorted({l["operator"] for l in lines.values()}):
        url = "https://www.smrt.com.sg/" if op.startswith("SMRT") else "https://www.sbstransit.com.sg/"
        w["agency"].writerow([slug(op), op, url, "Asia/Singapore"])
    w["feed_info"].writerow(["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_version"])
    w["feed_info"].writerow(["TrainRadar estimate (OpenStreetMap, published frequencies)", "https://mytrainradar.com/", "en",
                             f"est-{today:%Y%m%d}"])
    w["stops"].writerow(["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type"])
    for nm, (x, y) in sorted(stations.items()):
        w["stops"].writerow([f"sg-{slug(nm)}", nm, f"{y:.6f}", f"{x:.6f}", 0])
    w["calendar"].writerow(["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
                            "start_date", "end_date"])
    w["calendar"].writerow(["WK", 1, 1, 1, 1, 1, 0, 0, f"{start:%Y%m%d}", f"{end:%Y%m%d}"])
    w["calendar"].writerow(["WE", 0, 0, 0, 0, 0, 1, 1, f"{start:%Y%m%d}", f"{end:%Y%m%d}"])
    w["routes"].writerow(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color"])
    w["trips"].writerow(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id", "shape_id"])
    w["stop_times"].writerow(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "shape_dist_traveled"])
    w["shapes"].writerow(["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"])

    peaks = [(hm("07:00"), hm("09:30")), (hm("17:00"), hm("20:00"))]
    n_trips = 0
    for line, pats in sorted(patterns.items()):
        info = lines[line]
        colour = next((p["colour"].lstrip("#") for p in pats if re.fullmatch(r"#?[0-9A-Fa-f]{6}", p["colour"])), "")
        w["routes"].writerow([line, slug(info["operator"]), line, info["name"], 1, colour.upper()])
        # One pattern per direction: the longest relation from each end.
        by_ends = {}
        for p in pats:
            key = (p["stops"][0][0], p["stops"][-1][0])
            if key not in by_ends or len(p["stops"]) > len(by_ends[key]["stops"]):
                by_ends[key] = p
        chosen = list(by_ends.values())
        loop = all(p["stops"][0][0] == p["stops"][-1][0] for p in chosen)
        if len(chosen) == 1 and not loop:
            p = chosen[0]
            chosen.append(dict(rel=p["rel"] + "r", name=p["name"] + " (reversed)", stops=p["stops"][::-1],
                               track=p["track"][::-1], colour=p["colour"]))
        print(f"{line}: {len(pats)} relations, {len(chosen)} patterns: "
              + "; ".join(f"{p['stops'][0][0]} → {p['stops'][-1][0]} ({len(p['stops'])} stops, "
                          f"{'track' if len(p['track']) > 1 else 'straight'})" for p in chosen))
        for d, p in enumerate(chosen):
            shape = f"{line}-{d}"
            track = p["track"] if len(p["track"]) > 1 else [xy for _, xy in p["stops"]]
            # Along-track distance of each stop; straight lines where the
            # track and the stops don't agree (more than 300 m off).
            along, far = [], 0
            for nm, xy in p["stops"]:
                a, off = project(track, xy)
                far += off > 300
                along.append(a)
            if far or any(b < a for a, b in zip(along, along[1:])):
                track = [xy for _, xy in p["stops"]]
                along = [0.0]
                for a, b in zip(track, track[1:]):
                    along.append(along[-1] + dist(a, b))
            run = 0.0
            for i, (x, y) in enumerate(track):
                if i:
                    run += dist(track[i - 1], (x, y))
                w["shapes"].writerow([shape, f"{y:.6f}", f"{x:.6f}", i, f"{run:.1f}"])
            offsets = [0]
            for a, b in zip(along, along[1:]):
                offsets.append(offsets[-1] + info["dwell"] + round((b - a) / info["mps"]) + 20)
            head = p["stops"][-1][0]
            for service in ("WK", "WE"):
                t = info["first"]
                while t <= info["last"]:
                    trip = f"est-{line}-{d}-{service}-{gtfs_time(t).replace(':', '')}"
                    w["trips"].writerow([line, service, trip, head, d % 2, shape])
                    for i, ((nm, _), off) in enumerate(zip(p["stops"], offsets)):
                        at = gtfs_time(t + off)
                        w["stop_times"].writerow([trip, at, at, f"sg-{slug(nm)}", i,
                                                  f"{along[i]:.1f}"])
                    n_trips += 1
                    if service == "WE":
                        h = info["weekend"]
                    elif any(a <= t < b for a, b in peaks):
                        h = info["peak"]
                    else:
                        h = info["off"]
                    t += round(h * 60)
    missing = sorted(set(lines) - set(patterns))
    if missing:
        print(f"no route relations found for: {', '.join(missing)}")
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for n, s in files.items():
            z.writestr(f"{n}.txt", s.getvalue())
    print(f"{out_zip}: {len(patterns)} lines, {len(stations)} stations, {n_trips} estimated trips (a weekday and a weekend day) "
          f"({start} to {end})")
    return 0 if patterns else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
