#!/usr/bin/env python3
"""Download DELFI's national GTFS (Germany) from opendata-oepnv.de.

    DE_DELFI_USERNAME=… DE_DELFI_PASSWORD=… python3 -I tools/delfi-fetch.py OUT.zip [SOURCES.tsv]

The file is published on Mondays as
/fileadmin/datasets/delfi/YYYYMMDD_fahrplaene_gesamtdeutschland_gtfs.zip,
and (Nov 2026) downloads without a login: try the link on the dataset page,
then the last three weeks' Mondays and their next days. Only if none
answers with a ZIP, log in through the portal's login form (TYPO3; the
password goes only in the body of that POST) and take the page's link with
the session cookie. Nothing secret is printed or written: the log shows
status codes, the link's path and sizes. SOURCES.tsv, if given, gets the
file's line (name, url without query, etag, last-modified).
Standard library only.
"""

import datetime as dt
import html
import http.cookiejar
import os
import re
import sys
import urllib.parse
import urllib.error
import urllib.request

BASE = "https://www.opendata-oepnv.de"
PAGE = (
    BASE + "/ht/de/organisation/delfi/startseite?tx_vrrkit_view%5Baction%5D=details"
    "&tx_vrrkit_view%5Bcontroller%5D=View&tx_vrrkit_view%5Bdataset_formats%5D%5B0%5D=ZIP"
    "&tx_vrrkit_view%5Bdataset_name%5D=deutschlandweite-sollfahrplandaten-gtfs"
    "&cHash=01414d5793fcd0abb0f3a2e35176752c"
)
UA = "Metranos-TrainRadar (+https://mytrainradar.com)"


def main():
    out = sys.argv[1]
    sources = sys.argv[2] if len(sys.argv) > 2 else None
    user, password = os.environ.get("DE_DELFI_USERNAME"), os.environ.get("DE_DELFI_PASSWORD")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", UA)]

    def get(url, data=None):
        with opener.open(url, data=data, timeout=120) as r:
            return r.status, r.read().decode("utf-8", "replace")

    status, page = get(PAGE)
    # 1. Without a login.
    for url in candidates(page):
        if download(opener, url, out, sources):
            return
    if not user or not password:
        sys.exit("delfi: no file without a login, and DE_DELFI_USERNAME, DE_DELFI_PASSWORD are not set")
    # 2. Logged in.
    form = next((f for f in re.findall(r"<form\b.*?</form>", page, re.S) if "felogin" in f), None)
    if not form:
        sys.exit(f"delfi: no login form on the dataset page (HTTP {status})")
    action = html.unescape(re.search(r'action="([^"]+)"', form).group(1))
    fields = {}
    for tag in re.findall(r"<input\b[^>]*>", form):
        name = re.search(r'name="([^"]+)"', tag)
        if not name or 'type="checkbox"' in tag:
            continue
        value = re.search(r'value="([^"]*)"', tag)
        fields.setdefault(html.unescape(name.group(1)), html.unescape(value.group(1)) if value else "")
    fields.update({"user": user, "pass": password, "logintype": "login", "submit": "Login", "permalogin": "0"})
    status, page = get(urllib.parse.urljoin(BASE, action), urllib.parse.urlencode(fields).encode())
    logged_in = "logintype=logout" in page or 'value="logout"' in page or "Abmelden" in page
    print(f"delfi: login HTTP {status}, {'logged in' if logged_in else 'NOT logged in'}")
    if not logged_in:
        sys.exit("delfi: login refused (check DE_DELFI_USERNAME and DE_DELFI_PASSWORD)")

    status, page = get(PAGE)
    links = [h for h in candidates(page, guess=False)]
    for h in links[:4]:
        print("delfi: link", urllib.parse.urlsplit(h).path)
    for url in links:
        if download(opener, url, out, sources):
            return
    sys.exit(f"delfi: no ZIP behind the dataset page's links after login (HTTP {status})")


def candidates(page, guess=True):
    """The page's links ending in _gtfs.zip, then (guess) the file names of
    recent Mondays and the day after (a Hessian holiday moves it)."""
    links = [urllib.parse.urljoin(BASE, html.unescape(h)) for h in re.findall(r'href="([^"]+)"', page)]
    out = [h for h in links if urllib.parse.urlsplit(h).path.lower().endswith("_gtfs.zip")]
    if guess:
        today = dt.date.today()
        for back in range(0, 22):
            d = today - dt.timedelta(days=back)
            if d.weekday() in (0, 1, 5):  # Monday, the next day, or the Saturday before it
                out.append(f"{BASE}/fileadmin/datasets/delfi/{d:%Y%m%d}_fahrplaene_gesamtdeutschland_gtfs.zip")
    return list(dict.fromkeys(out))


def download(opener, url, out, sources):
    """Fetch url to out if it is a ZIP; True when it was."""
    try:
        r = opener.open(urllib.request.Request(url), timeout=900)
    except urllib.error.HTTPError as e:
        print(f"delfi: {urllib.parse.urlsplit(url).path}: HTTP {e.code}")
        return False
    with r, open(out + ".part", "wb") as f:
        etag, modified = r.headers.get("etag", ""), r.headers.get("last-modified", "")
        ctype = r.headers.get("content-type", "")
        n = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            n += len(chunk)
    with open(out + ".part", "rb") as f:
        magic = f.read(2)
    if magic != b"PK":
        os.remove(out + ".part")
        print(f"delfi: {urllib.parse.urlsplit(url).path}: {n} bytes of {ctype or 'unknown type'}, not a ZIP")
        return False
    os.replace(out + ".part", out)
    print(f"delfi: {urllib.parse.urlsplit(url).path}: {n / 1e6:.0f} MB, last modified {modified or 'unknown'}")
    if sources:
        clean = urllib.parse.urlunsplit(urllib.parse.urlsplit(url)._replace(query="", fragment=""))
        with open(sources, "a") as f:
            f.write(f"DELFI e.V., Deutschland GTFS (opendata-oepnv.de)\t{clean}\t{etag.strip(chr(34))}\t{modified}\n")
    return True


if __name__ == "__main__":
    main()
