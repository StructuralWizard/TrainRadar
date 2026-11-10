#!/usr/bin/env python3
"""Accumulate the stop pairs that Renfe's live long-distance trains run between,
for `refdata-build validate-net`.

Renfe's live map lists only the trains running right now, each with its stops
in order (`p`: five-digit station code). Run this several times a day: every
run adds the pairs it sees to the TSV (a, b, snapshots seen, a few trains).

    python3 -I tools/collect-renfe-ld.py gtfs/renfe-ld-pairs.tsv

Source: https://tiempo-real.largorecorrido.renfe.com/ (Renfe Operadora).
"""
import json
import os
import sys
import urllib.request

URL = "https://tiempo-real.largorecorrido.renfe.com/renfe-visor/trenesConEstacionesLD.json"
UA = {"User-Agent": "TrainRadar refdata build (github.com/StructuralWizard/TrainRadar)"}
MAX_TRAINS = 5


def load(path):
    pairs = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                if line.startswith("#"):
                    continue
                a, b, n, trains = (line.rstrip("\n").split("\t") + ["", "", "0", ""])[:4]
                if a and b:
                    pairs[(a, b)] = [int(n or 0), [t for t in trains.split(",") if t]]
    return pairs


def main(out):
    with urllib.request.urlopen(urllib.request.Request(URL, headers=UA), timeout=60) as r:
        data = json.load(r)
    pairs = load(out)
    seen_now = set()
    for train in data.get("trenes", []):
        stops = [str(s.get("p", "")).zfill(5) for s in train.get("estaciones", []) if s.get("p")]
        for a, b in zip(stops, stops[1:]):
            if a == b:
                continue
            k = (a, b) if a <= b else (b, a)
            entry = pairs.setdefault(k, [0, []])
            if k not in seen_now:
                entry[0] += 1
                seen_now.add(k)
            tid = str(train.get("idTren", ""))
            if tid and tid not in entry[1] and len(entry[1]) < MAX_TRAINS:
                entry[1].append(tid)
    tmp = out + ".part"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"# from\tto\tsnapshots\ttrains  (last update {data.get('fechaActualizacion', '')})\n")
        for (a, b), (n, trains) in sorted(pairs.items()):
            f.write(f"{a}\t{b}\t{n}\t{','.join(trains)}\n")
    os.replace(tmp, out)
    print(f"{out}: {len(data.get('trenes', []))} trains now, {len(seen_now)} pairs now, {len(pairs)} pairs in total")


if __name__ == "__main__":
    main(sys.argv[1])
