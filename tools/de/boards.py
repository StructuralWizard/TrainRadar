#!/usr/bin/env python3
"""The German stations whose boards the live Worker asks for, busiest first.

    python3 -I tools/de/boards.py GTFS.zip OUT.txt [N=2000]

From the trains-only GTFS (tools/fetch-eu.sh de): each station's departures
over the feed, its DHID (de:…) only, the N busiest, one per line. The
deploy publishes it as data/de/boards.txt; backend-eu/src/germany.js reads
it. Standard library only.
"""

import collections
import csv
import io
import sys
import zipfile


def main(argv):
    gtfs, out = argv[0], argv[1]
    n = int(argv[2]) if len(argv) > 2 else 2000
    count = collections.Counter()
    with zipfile.ZipFile(gtfs) as z:
        r = csv.DictReader(io.TextIOWrapper(z.open("stop_times.txt"), "utf-8-sig"))
        for row in r:
            sid = row["stop_id"]
            if sid.startswith("de:") and row.get("pickup_type", "0") != "1":
                count[sid] += 1
    busiest = [s for s, _ in count.most_common(n)]
    with open(out, "w") as f:
        f.write("\n".join(busiest) + "\n")
    print(f"{out}: {len(busiest)} of {len(count)} German stations (the busiest; "
          f"the last has {count[busiest[-1]] if busiest else 0} departures in the feed)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
