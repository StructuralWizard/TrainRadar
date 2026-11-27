#!/usr/bin/env python3
"""List the cab-ride videos YouTube no longer serves.

    python3 -I tools/cabrides/check.py refdata/cabrides/videos.csv OUT.txt

Asks YouTube's public oEmbed address (no key, YouTube's own interface for
looking up a video) about every video the app shows, one request every
half second, and writes the ids that answer 404 (deleted) or 400 (no such
id) to OUT, one per line. A 401 (private, or embedding turned off) is not
counted: many such videos still play on YouTube. Network errors are retried
twice, then skipped (kept). tools/cabrides/build.py --gone=OUT leaves the
listed videos out. Standard library only.
"""

import csv
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CLIENT = "Metranos-TrainRadar (+https://mytrainradar.com)"
OEMBED = "https://www.youtube.com/oembed?format=json&url="


def status(vid):
    url = OEMBED + urllib.parse.quote(f"https://www.youtube.com/watch?v={vid}", safe="")
    req = urllib.request.Request(url, headers={"User-Agent": CLIENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(30 * (attempt + 1))
                continue
            return e.code
        except OSError:  # URLError, timeouts, refused connections
            time.sleep(5 * (attempt + 1))
    return None


def main(argv):
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    src, out = argv
    with open(src, newline="", encoding="utf-8") as f:
        ids = [r["video_id"] for r in csv.DictReader(f) if r["app_scope"] != "out" and r["timestamp_quality"] != "none"]
    gone, unknown = [], 0
    for i, vid in enumerate(ids):
        s = status(vid)
        if s in (400, 404):
            gone.append(vid)
        elif s is None:
            unknown += 1
        time.sleep(0.5)
        if (i + 1) % 500 == 0:
            print(f"{i + 1}/{len(ids)} checked, {len(gone)} gone", flush=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(f"# cab-ride videos YouTube no longer serves ({time.strftime('%Y-%m-%d')}): {len(gone)} of {len(ids)}\n")
        f.writelines(v + "\n" for v in gone)
    print(f"{len(ids)} videos checked: {len(gone)} gone, {unknown} not answered (kept)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
