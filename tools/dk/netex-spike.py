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
    # Element counts in the two largest XML files, and the first rail journey.
    shown = False
    for i in [x for x in infos if x.filename.endswith(".xml")][:3]:
        data = z.read(i.filename).decode("utf-8", "replace")
        tags = collections.Counter(re.findall(r"<(?:\w+:)?([A-Z]\w+)[\s>/]", data))
        print(f"dk netex: {i.filename}: {tags.most_common(40)}")
        modes = collections.Counter(re.findall(r"<TransportMode>(\w+)</TransportMode>", data))
        print(f"dk netex:   transport modes: {dict(modes)}")
        if not shown:
            m = re.search(r"<Line [\s\S]*?</Line>", data)
            if m:
                print("dk netex: first Line:", re.sub(r">\s+<", "><", m.group(0))[:1500])
            m = re.search(r"<ServiceJourney [\s\S]*?</ServiceJourney>", data)
            if m:
                print("dk netex: first ServiceJourney:", re.sub(r">\s+<", "><", m.group(0))[:2500])
                shown = True
            m = re.search(r"<StopPlace [\s\S]*?</StopPlace>", data)
            if m:
                print("dk netex: first StopPlace:", re.sub(r">\s+<", "><", m.group(0))[:1200])
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
