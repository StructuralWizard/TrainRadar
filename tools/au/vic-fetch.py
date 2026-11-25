#!/usr/bin/env python3
"""Victoria's trains from Transport Victoria's GTFS Schedule.

    python3 -I tools/au/vic-fetch.py OUT_DIR [SOURCES.tsv]

The open data portal (CKAN) lists the dataset's files: take its GTFS zip
(one archive with a numbered folder per mode, each holding its own
google_transit.zip: 1 regional train, V/Line; 2 metropolitan train, Metro
Trains), and write those two as OUT_DIR/vline.zip and OUT_DIR/metro.zip.
AU_VIC_API_KEY, if set, goes only in the KeyID header (the static files
may not need it). Nothing secret is printed. Standard library only.
"""

import io
import json
import os
import re
import sys
import urllib.request
import zipfile

PORTAL = "https://opendata.transport.vic.gov.au"
UA = "Metranos-TrainRadar (+https://mytrainradar.com)"
MODES = {"1": "vline", "2": "metro"}


def get(url, timeout=120):
    h = {"User-Agent": UA}
    if os.environ.get("AU_VIC_API_KEY"):
        h["KeyID"] = os.environ["AU_VIC_API_KEY"]
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read(), r.headers


def main(argv):
    out = argv[0]
    sources = argv[1] if len(argv) > 1 else None
    os.makedirs(out, exist_ok=True)
    # The dataset's files, from the portal's catalogue.
    url = None
    for pid in ["gtfs-schedule", "timetable-and-geographic-information-gtfs"]:
        try:
            body, _ = get(f"{PORTAL}/api/3/action/package_show?id={pid}")
        except Exception as e:
            print(f"vic: catalogue {pid}: {type(e).__name__} {getattr(e, 'code', '')}")
            continue
        res = json.loads(body).get("result", {}).get("resources", [])
        for r in res:
            print(f"vic: {pid}: {r.get('name')!r} {r.get('format')} {r.get('url', '')[:140]}")
        zips = [r["url"] for r in res if re.search(r"\.zip($|\?)", r.get("url", ""), re.I) or (r.get("format") or "").lower() == "zip"]
        if zips:
            url = zips[0]
            break
    if not url:
        sys.exit("vic: no GTFS zip in the catalogue")
    body, headers = get(url, timeout=900)
    print(f"vic: {url.split('?')[0]}: {len(body) / 1e6:.0f} MB")
    z = zipfile.ZipFile(io.BytesIO(body))
    names = z.namelist()
    print("vic: archive holds", ", ".join(sorted({n.split('/')[0] for n in names}))[:300])
    got = 0
    for folder, name in MODES.items():
        inner = next((n for n in names if re.fullmatch(rf"{folder}/(google_transit|gtfs)\.zip", n)), None)
        if not inner:
            print(f"vic: no {folder}/google_transit.zip")
            continue
        with open(os.path.join(out, f"{name}.zip"), "wb") as f:
            f.write(z.read(inner))
        got += 1
        print(f"vic: {name}.zip from {inner}")
    if not got:
        sys.exit("vic: neither the regional nor the metropolitan train GTFS was found")
    if sources:
        with open(sources, "a") as f:
            f.write(f"Transport Victoria, GTFS Schedule\t{url.split('?')[0]}\t{headers.get('etag', '').strip(chr(34))}\t{headers.get('last-modified', '')}\n")


if __name__ == "__main__":
    main(sys.argv[1:])
