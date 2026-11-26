#!/usr/bin/env python3
"""Areas for the area drop-down of countries whose timetable has none (the
UK's regions, Ireland's, Sweden's counties…): Natural Earth's 1:10m
admin-1 states and provinces (public domain), grouped into regions where
Natural Earth names them, as boxes with their names in the app's languages:

  python3 -I tools/outlines/areas.py ne_10m_admin_1_states_provinces.geojson web/areas.json

Download: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson

The app offers an area only when some of the country's stations are in
it (areas.js), so islands and regions without trains drop out.
"""
import json
import sys

# Our code → Natural Earth's adm0_a3. Countries whose timetable already has
# areas (Spain, France, Germany, Australia, New Zealand, Japan) aren't here.
COUNTRIES = {
    "uk": "GBR", "ie": "IRL", "lu": "LUX", "fi": "FIN", "no": "NOR", "nl": "NLD", "sk": "SVK", "ee": "EST",
    "ch": "CHE", "se": "SWE", "pl": "POL", "at": "AUT", "cz": "CZE", "it": "ITA", "dk": "DNK", "hu": "HUN",
    "be": "BEL", "pt": "PRT", "sg": "SGP",
}
# Countries drawn by Natural Earth's regions (groups of counties/provinces)
# rather than each one: the UK (England's regions, Scotland, Wales, Northern
# Ireland), Ireland, Hungary, Italy and Portugal.
BY_REGION = {"uk", "ie", "hu", "it", "pt"}
# Region names in the app's languages (es, en, pt, ja); Italy's are its own.
NAMES = {
    "Greater London": ("Londres", "London", "Londres", "ロンドン"),
    "South East": ("Sudeste de Inglaterra", "South East England", "Sudeste de Inglaterra", "南東イングランド"),
    "South West": ("Suroeste de Inglaterra", "South West England", "Sudoeste de Inglaterra", "南西イングランド"),
    "East": ("Este de Inglaterra", "East of England", "Leste de Inglaterra", "東イングランド"),
    "East Midlands": ("Midlands del Este", "East Midlands", "East Midlands", "イースト・ミッドランズ"),
    "West Midlands": ("Midlands del Oeste", "West Midlands", "West Midlands", "ウェスト・ミッドランズ"),
    "North East": ("Nordeste de Inglaterra", "North East England", "Nordeste de Inglaterra", "北東イングランド"),
    "North West": ("Noroeste de Inglaterra", "North West England", "Noroeste de Inglaterra", "北西イングランド"),
    "Yorkshire and the Humber": ("Yorkshire y Humber", "Yorkshire and the Humber", "Yorkshire e Humber", "ヨークシャー・アンド・ハンバー"),
    "Scotland": ("Escocia", "Scotland", "Escócia", "スコットランド"),
    "Wales": ("Gales", "Wales", "País de Gales", "ウェールズ"),
    "Northern Ireland": ("Irlanda del Norte", "Northern Ireland", "Irlanda do Norte", "北アイルランド"),
    "Dublin": ("Dublín", "Dublin", "Dublin", "ダブリン"),
    "Border": ("Border", "Border", "Border", "ボーダー"),
    "Mid-East": ("Centro-Este", "Mid-East", "Centro-Leste", "ミッドイースト"),
    "Mid-West": ("Centro-Oeste", "Mid-West", "Centro-Oeste", "ミッドウェスト"),
    "Midlands": ("Midlands", "Midlands", "Midlands", "ミッドランズ"),
    "South-East": ("Sudeste", "South-East", "Sudeste", "南東部"),
    "South-West": ("Suroeste", "South-West", "Sudoeste", "南西部"),
    "West": ("Oeste", "West", "Oeste", "西部"),
    "Central Hungary": ("Hungría Central", "Central Hungary", "Hungria Central", "中部ハンガリー"),
    "Central Transdanubia": ("Transdanubia Central", "Central Transdanubia", "Transdanúbia Central", "中部ドナウ以西"),
    "Western Transdanubia": ("Transdanubia Occidental", "Western Transdanubia", "Transdanúbia Ocidental", "西部ドナウ以西"),
    "Southern Transdanubia": ("Transdanubia Meridional", "Southern Transdanubia", "Transdanúbia Meridional", "南部ドナウ以西"),
    "Northern Hungary": ("Hungría Septentrional", "Northern Hungary", "Hungria Setentrional", "北ハンガリー"),
    "Northern Great Plain": ("Gran Llanura Septentrional", "Northern Great Plain", "Grande Planície Setentrional", "北大平原"),
    "Great Southern Plain": ("Gran Llanura Meridional", "Southern Great Plain", "Grande Planície Meridional", "南大平原"),
    "Norte": ("Norte", "North", "Norte", "北部"),
    "Centro": ("Centro", "Centre", "Centro", "中部"),
    "Lisbon": ("Lisboa", "Lisbon", "Lisboa", "リスボン"),
    "Alentejo": ("Alentejo", "Alentejo", "Alentejo", "アレンテージョ"),
    "Algarve": ("Algarve", "Algarve", "Algarve", "アルガルヴェ"),
}
ITALY = {"Sicily": "Sicilia", "Apulia": "Puglia"}


def points(geom):
    def walk(c):
        if isinstance(c[0], (int, float)):
            yield c
        else:
            for x in c:
                yield from walk(x)
    yield from walk(geom["coordinates"])


def grow(box, geom):
    for lon, lat in points(geom):
        box[0], box[1] = min(box[0], lat), min(box[1], lon)
        box[2], box[3] = max(box[2], lat), max(box[3], lon)


def region_of(cc, p):
    if cc == "uk":
        unit = p.get("geonunit")
        return p.get("region") if unit == "England" else unit
    if cc == "pt":
        r = p.get("region")
        return "Centro" if r == "Norte, Centro" else r
    return p.get("region")


def main(src, out):
    d = json.load(open(src, encoding="utf-8"))
    a3 = {v: k for k, v in COUNTRIES.items()}
    areas = {}
    for f in d["features"]:
        p = f["properties"]
        cc = a3.get(p.get("adm0_a3"))
        if not cc or not f.get("geometry"):
            continue
        if cc in BY_REGION:
            key = region_of(cc, p)
            if not key:
                continue  # Azores, Madeira: no region (and no trains)
            names = NAMES.get(key)
            if not names:
                local = ITALY.get(key, key)
                names = (local, local, local, local)
        else:
            key = p.get("adm1_code") or p.get("name")
            names = tuple(p.get(f"name_{l}") or p.get("name") for l in ("es", "en", "pt", "ja"))
        a = areas.setdefault(cc, {}).setdefault(key, {"names": names, "box": [90.0, 180.0, -90.0, -180.0]})
        grow(a["box"], f["geometry"])
    doc = {}
    for cc, by in sorted(areas.items()):
        rows = []
        for key, a in by.items():
            slug = "".join(ch if ch.isalnum() else "-" for ch in key.lower()).strip("-")
            es, en, pt, ja = a["names"]
            rows.append({"code": f"adm:{cc}:{slug}", "names": {"es": es, "en": en, "pt": pt, "ja": ja},
                         "bbox": [round(v, 3) for v in a["box"]]})
        doc[cc] = sorted(rows, key=lambda r: r["names"]["en"])
    with open(out, "w", encoding="utf-8") as w:
        json.dump(doc, w, ensure_ascii=False, separators=(",", ":"))
    print(f"{out}: " + ", ".join(f"{cc} {len(v)}" for cc, v in doc.items()))


if __name__ == "__main__":
    main(*sys.argv[1:3])
