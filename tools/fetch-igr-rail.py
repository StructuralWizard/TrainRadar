#!/usr/bin/env python3
"""Download the railway links of the IGN national transport network (IGR-RT,
CC BY 4.0, rail data from ADIF) and keep what we use: number of tracks,
electrification and gauge, with 2D geometry. Writes GeoJSON lines.

    python3 -I tools/fetch-igr-rail.py gtfs/igr-rail.geojsonseq

Source: https://api-features.idee.es/collections/railwaylink (OGC API
Features). © Instituto Geográfico Nacional (SCNE, IGR-RT), CC BY 4.0.
"""
import json
import sys
import time
import urllib.request

BASE = "https://api-features.idee.es/collections/railwaylink/items?f=json&limit=10000"


def get(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "TrainRadar refdata build (github.com/StructuralWizard/TrainRadar)"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except Exception as e:  # network hiccups: retry with backoff
            if attempt == 4:
                raise
            print(f"retry after {e}", file=sys.stderr)
            time.sleep(5 * 2 ** attempt)


def main(out):
    url, kept, seen = BASE, 0, 0
    with open(out, "w", encoding="utf-8") as f:
        while url:
            page = get(url)
            for feat in page["features"]:
                seen += 1
                p, g = feat["properties"], feat.get("geometry") or {}
                attrs = {"t": p.get("numberoftracks"), "e": p.get("electrified"), "g": p.get("nominalgauge")}
                if g.get("type") != "LineString" or all(v is None for v in attrs.values()):
                    continue
                coords = [[round(c[0], 6), round(c[1], 6)] for c in g["coordinates"]]
                f.write(json.dumps({"p": attrs, "c": coords}, separators=(",", ":")) + "\n")
                kept += 1
            url = next((l["href"] for l in page["links"] if l["rel"] == "next"), None)
            if url and "f=json" not in url:
                url += "&f=json"
    print(f"{out}: {kept} of {seen} railway links with attributes")
    if kept < 1000:
        sys.exit("too few railway links: the API probably changed")


if __name__ == "__main__":
    main(sys.argv[1])
