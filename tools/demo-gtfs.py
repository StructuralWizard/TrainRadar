#!/usr/bin/env python3
"""Write a small synthetic GTFS (two AV/LD/MD lines and Cercanías Madrid C3)
for offline development and UI tests. Not real timetables.

    python3 tools/demo-gtfs.py OUT_DIR   # writes OUT_DIR/{ld,cercanias,ouigo}.zip
"""
import math
import sys
import zipfile
from pathlib import Path

LD_LINES = {
    "MAD-BCN": ("AVE", [
        ("60000", "Madrid-Puerta de Atocha", 40.4065, -3.6895),
        ("70600", "Guadalajara-Yebes", 40.5916, -3.1834),
        ("72400", "Calatayud", 41.3530, -1.6431),
        ("04040", "Zaragoza-Delicias", 41.6586, -0.9113),
        ("78400", "Lleida", 41.6205, 0.6326),
        ("04104", "Camp de Tarragona", 41.1914, 1.2700),
        ("71801", "Barcelona-Sants", 41.3793, 2.1404),
    ]),
    "MAD-SVQ": ("ALVIA", [
        ("60000", "Madrid-Puerta de Atocha", 40.4065, -3.6895),
        ("37200", "Ciudad Real", 38.9856, -3.9278),
        ("37300", "Puertollano", 38.6929, -4.1064),
        ("50500", "Córdoba", 37.8888, -4.7894),
        ("51003", "Sevilla-Santa Justa", 37.3917, -5.9750),
    ]),
}
C3 = [
    ("60000", "Madrid-Atocha Cercanías", 40.4065, -3.6895),
    ("18002", "Villaverde Bajo", 40.3460, -3.7110),
    ("18003", "Getafe Industrial", 40.3115, -3.7186),
    ("35600", "Pinto", 40.2433, -3.7016),
    ("35602", "Valdemoro", 40.1905, -3.6763),
    ("60200", "Aranjuez", 40.0358, -3.6157),
]
CAL = "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[2], a[3], b[2], b[3]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def t(sec):
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def stops_txt(stops):
    rows = {s[0]: s for s in stops}
    return "stop_id,stop_name,stop_lat,stop_lon\n" + "".join(
        f"{i},{n},{la},{lo}\n" for i, n, la, lo in rows.values())


def write(path, files):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in files.items():
            z.writestr(name, body)


def main(out):
    out.mkdir(parents=True, exist_ok=True)
    # AV/LD/MD: hourly 06:00–21:00 both ways, 250 km/h, 2 min stops.
    routes, trips, times, all_stops = [], [], [], []
    number = 3000
    for rid, (name, stops) in LD_LINES.items():
        all_stops += stops
        routes.append(f"{rid},{name},2")
        for direction, seq in ((0, stops), (1, stops[::-1])):
            for hour in range(6, 22):
                number += 1
                tid = f"{number:05d}1DEMO"
                trips.append(f"{rid},ALL,{tid},{number:05d}")
                s = hour * 3600 + direction * 1800
                for i, st in enumerate(seq):
                    if i:
                        s += int(km(seq[i - 1], st) / 250 * 3600)
                    dep = s + (120 if 0 < i < len(seq) - 1 else 0)
                    times.append(f"{tid},{t(s)},{t(dep)},{st[0]},{i + 1}")
                    s = dep
    write(out / "ld.zip", {
        "stops.txt": stops_txt(all_stops),
        "routes.txt": "route_id,route_short_name,route_type\n" + "\n".join(routes) + "\n",
        "calendar.txt": CAL + "ALL,1,1,1,1,1,1,1,20260101,20271231\n",
        "trips.txt": "route_id,service_id,trip_id,trip_short_name\n" + "\n".join(trips) + "\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" + "\n".join(times) + "\n",
    })

    # Cercanías C3: every 10 min 05:00–23:50, 4 min between stops, 30 s dwell.
    trips, times = [], []
    for direction, (rid, seq) in enumerate((("10T0001C3", C3), ("10T0002C3", C3[::-1]))):
        for k in range(19 * 6):
            num = 20000 + direction * 1000 + k
            tid = f"1004D{num}C3"
            trips.append(f"{rid},1004D,{tid},10_C3")
            s = 5 * 3600 + k * 600 + direction * 300
            for i, st in enumerate(seq):
                if i:
                    s += 240
                dep = s + (30 if 0 < i < len(seq) - 1 else 0)
                times.append(f"{tid},{t(s)},{t(dep)},{st[0]},{i + 1}")
                s = dep
    shape = "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" + "".join(
        f"10_C3,{la},{lo},{i + 1}\n" for i, (_, _, la, lo) in enumerate(C3))
    write(out / "cercanias.zip", {
        "stops.txt": stops_txt(C3),
        "routes.txt": "route_id,route_short_name,route_long_name,route_type,route_color\n"
                      "10T0001C3,C3,Atocha-Aranjuez,2,943F90\n10T0002C3,C3,Aranjuez-Atocha,2,943F90\n",
        "calendar.txt": CAL + "1004D,1,1,1,1,1,1,1,20260101,20271231\n",
        "trips.txt": "route_id,service_id,trip_id,shape_id\n" + "\n".join(trips) + "\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" + "\n".join(times) + "\n",
        "shapes.txt": shape,
    })


def write_ouigo(out):
    """A tiny OUIGO-style feed (UIC station codes, as on the NAP)."""
    stops = LD_LINES["MAD-BCN"][1]
    uic = {s[0]: "0071" + s[0] for s in stops}
    times, trips = [], []
    for k, hour in enumerate(range(7, 21, 2)):
        tid = str(k + 1)
        trips.append(f"{tid},1,1,BARCELONA-SANTS,TGV {6100 + k}")
        s = hour * 3600 + 900
        for i, st in enumerate(stops):
            if i:
                s += int(km(stops[i - 1], st) / 260 * 3600)
            dep = s + (120 if 0 < i < len(stops) - 1 else 0)
            times.append(f"{tid},{i + 1},{uic[st[0]]},{t(s)},{t(dep)},0,0")
            s = dep
    write(out / "ouigo.zip", {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\n3780,OUIGO Espana,http://uic.org/,Europe/Paris\n",
        "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type\n1,3780,TGV,MADRID -- BARCELONA,101\n",
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\n" + "".join(
            f"{uic[i]},{n.upper()},{la},{lo}\n" for i, n, la, lo in stops),
        "calendar.txt": "service_id,start_date,end_date,monday,tuesday,wednesday,thursday,friday,saturday,sunday\n1,20260101,20271231,1,1,1,1,1,1,1\n",
        "trips.txt": "trip_id,route_id,service_id,trip_headsign,trip_short_name\n" + "\n".join(trips) + "\n",
        "stop_times.txt": "trip_id,stop_sequence,stop_id,arrival_time,departure_time,drop_off_type,pickup_type\n" + "\n".join(times) + "\n",
    })


if __name__ == "__main__":
    main(Path(sys.argv[1]))
    write_ouigo(Path(sys.argv[1]))
