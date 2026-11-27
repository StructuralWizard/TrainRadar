#!/usr/bin/env python3
"""Country outlines for the map (tap another country to go there):
Natural Earth's 1:50m admin-0 countries (public domain), cut to the
countries TrainRadar shows, their far-off territories dropped, simplified
and rounded, as one small GeoJSON:

  python3 -I tools/outlines/build.py ne_50m_admin_0_countries.geojson web/countries.geojson

Download: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
"""
import json
import math
import sys

# Our code → Natural Earth's ADM0_A3, and each country's centre (lon, lat):
# parts further than MAX_KM from it (overseas territories) are left out.
COUNTRIES = {
    "es": ("ESP", (-3.7, 40.2)), "uk": ("GBR", (-2.6, 54.2)), "ie": ("IRL", (-7.9, 53.4)),
    "fr": ("FRA", (2.4, 46.6)), "lu": ("LUX", (6.13, 49.75)), "fi": ("FIN", (25.5, 62.8)),
    "no": ("NOR", (10.4, 62.5)), "nl": ("NLD", (5.3, 52.2)), "sk": ("SVK", (19.5, 48.7)),
    "ee": ("EST", (25.5, 58.7)), "ch": ("CHE", (8.2, 46.8)), "se": ("SWE", (15.5, 61.0)),
    "pl": ("POL", (19.4, 52.0)), "at": ("AUT", (13.3, 47.6)), "cz": ("CZE", (15.4, 49.8)),
    "it": ("ITA", (12.5, 42.3)), "dk": ("DNK", (10.6, 56.0)), "hu": ("HUN", (19.4, 47.2)),
    "de": ("DEU", (10.4, 51.2)), "be": ("BEL", (4.6, 50.6)), "au": ("AUS", (134.0, -27.0)),
    "nz": ("NZL", (172.5, -41.5)), "sg": ("SGP", (103.82, 1.35)),
    "pt": ("PRT", (-8.2, 39.6)), "jp": ("JPN", (138.0, 37.0)), "tw": ("TWN", (120.97, 23.7)),
}
MAX_KM = 2600
TOLERANCE = 0.03  # degrees (about 3 km): enough to tap, small to load
MIN_AREA = 0.02  # square degrees: smaller islands left out (Singapore excepted)


def km(a, b):
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    d = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(d))


def simplify(pts, tol):
    """Douglas–Peucker, iterative."""
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        n = math.hypot(dx, dy) or 1e-12
        best, at = -1.0, -1
        for k in range(i + 1, j):
            x, y = pts[k]
            d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / n if (dx or dy) else math.hypot(x - x1, y - y1)
            if d > best:
                best, at = d, k
        if best > tol:
            keep[at] = True
            stack += [(i, at), (at, j)]
    return [p for p, k in zip(pts, keep) if k]


def area(ring):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:]))) / 2


def main(src, out):
    by = {f["properties"]["ADM0_A3"]: f for f in json.load(open(src, encoding="utf-8"))["features"]}
    feats = []
    for code, (a3, centre) in COUNTRIES.items():
        g = by[a3]["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        kept = []
        for poly in polys:
            outer = poly[0]
            cx = sum(p[0] for p in outer) / len(outer)
            cy = sum(p[1] for p in outer) / len(outer)
            if km(centre, (cx, cy)) > MAX_KM or (code != "sg" and area(outer) < MIN_AREA):
                continue
            ring = simplify(outer, TOLERANCE if code != "sg" else 0.002)
            if len(ring) < 4:
                continue
            kept.append([[[round(x, 3), round(y, 3)] for x, y in ring]])
        if not kept:
            sys.exit(f"{code}: no outline left")
        feats.append({"type": "Feature", "properties": {"code": code}, "geometry": {"type": "MultiPolygon", "coordinates": kept}})
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "attribution": "Natural Earth (public domain)", "features": feats}, f, separators=(",", ":"))
    print(f"{out}: {len(feats)} countries")


if __name__ == "__main__":
    main(*sys.argv[1:3])
