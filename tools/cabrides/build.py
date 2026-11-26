#!/usr/bin/env python3
"""Write each country's cab-ride videos next to its data: cabrides.json.

    python3 -I tools/cabrides/build.py refdata/cabrides build/data [--gone FILE]

Reads videos.csv, video_stops.csv and aliases.csv (refdata/cabrides/, from
the branch data/cab-ride-videos; docs/plan-cab-rides.md) and writes
DATA/cabrides.json for Spain and DATA/<code>/cabrides.json for every other
country whose data folder exists. A video goes to the country in its
`country` column (Great Britain, Northern Ireland and the Isle of Man: uk).

Kept: videos not marked `out`, with at least one station that has a time.
Waypoints (junctions, tunnels) are left out. `--gone` lists video ids, one
per line, that YouTube no longer serves (tools/cabrides/check.py): left out.

Each file: {"v": 1, "alias": {name_key: station_key}, "videos": [[id, title,
channel, quality, view, [[station_key, name, t, real], ...]], ...]}, best
first: main line before extended, precise before approximate before
estimated, cab before front view. `real` is 1 when the time is the
uploader's own chapter, 0 when it is estimated. Standard library only.
"""

import csv
import json
import os
import sys
from collections import defaultdict

# Video country → the app's country code.
COUNTRY = {"GB": "uk", "NI": "uk", "IM": "uk"}
QUALITY = {"precise": 0, "approximate": 1, "estimated": 2, "unverified": 2}
VIEW = {"cab": 0, "front": 1}
SCOPE = {"core": 0, "extended": 1}


def rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def main(argv):
    opts = [a for a in argv if a.startswith("--")]
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    src, out = args
    gone = set()
    for o in opts:
        if o.startswith("--gone="):
            p = o[7:]
            if os.path.exists(p):
                gone = {l.strip() for l in open(p, encoding="utf-8") if l.strip() and not l.startswith("#")}
    total = sum(1 for v in rows(os.path.join(src, "videos.csv")) if v["app_scope"] != "out")
    if len(gone) > total / 3:
        # More than a third "gone" is a broken check, not deleted videos.
        print(f"cab rides: ignoring the gone list ({len(gone)} of {total} videos)", file=sys.stderr)
        gone = set()
    alias = {r["name_key"]: r["station_key"] for r in rows(os.path.join(src, "aliases.csv"))}
    stops = defaultdict(list)
    for s in rows(os.path.join(src, "video_stops.csv")):
        if s["point_type"] != "station" or not s["t_seconds"]:
            continue
        stops[s["video_id"]].append((int(s["seq"]), s["station_key"], s["name"], int(s["t_seconds"]), 1 if s["t_source"] == "uploader_chapter" else 0))
    by = defaultdict(list)
    dropped = 0
    for v in rows(os.path.join(src, "videos.csv")):
        vid = v["video_id"]
        if v["app_scope"] == "out" or v["timestamp_quality"] not in QUALITY or vid in gone:
            continue
        st = sorted(stops.get(vid, []))
        if not st:
            continue
        cc = COUNTRY.get(v["country"], v["country"].lower())
        key = (SCOPE.get(v["app_scope"], 2), QUALITY[v["timestamp_quality"]], VIEW.get(v["view_type"], 2), v["title"])
        by[cc].append((key, [vid, v["title"], v["channel"], v["timestamp_quality"], v["view_type"], [[k, n, t, r] for _, k, n, t, r in st]]))
    written = []
    for cc, vids in sorted(by.items()):
        folder = out if cc == "es" else os.path.join(out, cc)
        if not os.path.isdir(folder):
            dropped += len(vids)
            continue
        vids.sort(key=lambda x: x[0])
        doc = {"v": 1, "alias": alias, "videos": [v for _, v in vids]}
        path = os.path.join(folder, "cabrides.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        written.append(f"{cc} {len(vids)}")
    print(f"cab rides: {sum(len(v) for v in by.values()) - dropped} videos in {len(written)} countries ({', '.join(written)});"
          f" {dropped} in countries the site doesn't have; {len(gone)} gone from YouTube left out")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
