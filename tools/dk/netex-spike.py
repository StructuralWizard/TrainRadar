#!/usr/bin/env python3
"""Denmark spike: download Rejseplanen's NeTEx (Dataudveksleren dataset 242)
and describe it, before writing the converter.

    DK_NAP_CLIENT_SECRET=… python3 -I tools/dk/netex-spike.py OUT_DIR

Logs in with the service account (Microsoft Entra ID client credentials;
scope = the service account's own id, as the access point's guide says),
downloads the latest ZIP and prints: its files and sizes, the NeTEx
element counts of the largest files, and the first train ServiceJourney
it finds, trimmed. The secret is read from the environment, sent only in
the token request's body and never printed. Standard library only.
"""

import collections
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

TENANT = os.environ.get("DK_NAP_TENANT_ID") or "f1044067-8c60-4022-98d8-69306c5f7238"
CLIENT = os.environ.get("DK_NAP_CLIENT_ID") or "a63b12fe-eeae-489c-b1ca-be8a135289f5"
URL = "https://distribution.dataudveksler.app.vd.dk/api/dataset/242/latest/Zip"
UA = "Metranos-TrainRadar"


def token(secret):
    body = urllib.parse.urlencode({
        "client_id": CLIENT, "client_secret": secret, "scope": f"{CLIENT}/.default", "grant_type": "client_credentials",
    }).encode()
    req = urllib.request.Request(f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token", data=body,
                                 headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)["access_token"]
    except urllib.error.HTTPError as e:
        raise SystemExit(f"dk netex: LOGIN REFUSED (HTTP {e.code}): the secret is wrong or lost") from None


def main(out):
    secret = os.environ.get("DK_NAP_CLIENT_SECRET")
    if not secret:
        print("dk netex: DK_NAP_CLIENT_SECRET is not set: skipped.")
        return 0
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "netex.zip")
    req = urllib.request.Request(URL, headers={"Authorization": f"Bearer {token(secret)}", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
            print(f"dk netex: HTTP {r.status}, type {r.headers.get('Content-Type')}, "
                  f"last modified {r.headers.get('Last-Modified')}")
            while chunk := r.read(1 << 20):
                f.write(chunk)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"dk netex: download HTTP {e.code}: {e.read(300)!r}") from None
    print(f"dk netex: {os.path.getsize(path) / 1e6:.1f} MB")
    z = zipfile.ZipFile(path)
    infos = sorted(z.infolist(), key=lambda i: -i.file_size)
    print(f"dk netex: {len(infos)} files, {sum(i.file_size for i in infos) / 1e6:.0f} MB unpacked; largest:")
    for i in infos[:15]:
        print(f"  {i.file_size / 1e6:8.1f} MB  {i.filename}")
    names = [i.filename for i in infos]
    print("dk netex: file name patterns:", collections.Counter(re.sub(r"\d+", "#", n) for n in names).most_common(12))
    # Per operator folder: files, size, and the modes of one file each.
    dirs = collections.defaultdict(lambda: [0, 0, None])
    for i in infos:
        d = i.filename.split("/")[0]
        dirs[d][0] += 1
        dirs[d][1] += i.file_size
    for d, v in dirs.items():
        small = min((i for i in infos if i.filename.startswith(d + "/") and i.filename.endswith(".xml")), key=lambda i: i.file_size, default=None)
        if small:
            head = z.read(small.filename)[:4_000_000].decode("utf-8", "replace")
            v[2] = dict(collections.Counter(re.findall(r"<TransportMode>(\w+)</TransportMode>", head)))
    print("dk netex: folders (files, MB, modes in one file):")
    for d, (n, size, modes) in sorted(dirs.items(), key=lambda kv: -kv[1][1]):
        print(f"  {d}: {n} files, {size / 1e6:.0f} MB, {modes}")
    others = [i.filename for i in infos if "_LINE_" not in i.filename]
    print("dk netex: shared files:", others[:20])
    # One DSB train file, in detail.
    rail = [i for i in infos if i.filename.startswith("DSB") and i.filename.endswith(".xml")]
    rail.sort(key=lambda i: i.file_size)
    if not rail:
        print("dk netex: no DSB folder")
        return 0
    f = rail[len(rail) // 2]
    data = z.read(f.filename).decode("utf-8", "replace")
    print(f"dk netex: {f.filename} ({f.file_size / 1e6:.1f} MB)")
    tags = collections.Counter(re.findall(r"<(?:\w+:)?([A-Z]\w+)[\s>/]", data))
    print(f"dk netex:   elements: {tags.most_common(70)}")
    print(f"dk netex:   modes: {dict(collections.Counter(re.findall(r'<TransportMode>(\w+)</TransportMode>', data)))}")
    print(f"dk netex:   keys: {dict(collections.Counter(re.findall(r'<Key>(\w+)</Key>', data)).most_common(20))}")
    for tag, n in [("Line", 1200), ("ServiceJourney", 3000), ("ScheduledStopPoint", 600), ("PassengerStopAssignment", 600),
                   ("StopPlace", 1500), ("DayType", 400), ("DayTypeAssignment", 600), ("OperatingPeriod", 600),
                   ("UicOperatingPeriod", 600), ("OperatingDay", 400), ("Operator", 600), ("ServiceJourneyPattern", 1500),
                   ("DestinationDisplay", 400)]:
        m = re.search(rf"<{tag}[ >][\s\S]*?</{tag}>", data)
        if m:
            print(f"dk netex:   first {tag}: " + re.sub(r">\s+<", "><", m.group(0))[:n])
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
