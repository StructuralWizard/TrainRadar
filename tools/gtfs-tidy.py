#!/usr/bin/env python3
"""Rewrite one GTFS feed before it is merged or built: prefix its ids, and
take names from its translations.txt.

    python3 -I tools/gtfs-tidy.py IN.zip OUT.zip [--prefix=ft:] [--keep-trips]
        [--lang=en] [--bilingual] [--merge-platforms] [--short=ID:NAME,...]
        [--route-type=N]

--prefix      put PREFIX before every id (agency, route, service, trip, stop,
              shape, block), so feeds whose ids clash (Fertagus' and Lisbon
              Metro's are both small numbers) can go into tools/gtfs-rail.py
              together. --keep-trips leaves trip ids as they are (live feeds
              name trips by the timetable's ids).
--lang        names from translations.txt in that language: routes' names,
              trips' headsigns and the agency's name; stops get it too, and
              with --bilingual keep their own name after it ("Shinjuku 新宿"),
              as Japanese station signs do. A stop with no translation in
              that language but a kana reading (ja-Hrkt) gets the reading in
              Hepburn romaji ("いの" → "Ino"); a trip with no translated
              headsign gets its last stop's name.
--short       routes' short names by route id (Toei's line letters: 1:A,…),
              where the feed has none.
--merge-platforms  stops with the same name less than 150 m apart become one
              (a tram stop's two platforms, one per direction, as Tosaden's).
--route-type  every route gets this route_type: for feeds that file their
              trains as buses (3), as Toyama's tram (0) and Asa's DMV (2).

Fares, translations and other tables the build doesn't read are left out.
Standard library only.
"""

import csv
import io
import math
import sys
import zipfile

# Table → id columns to prefix ("trip_id" only without --keep-trips).
IDS = {
    "agency.txt": ["agency_id"],
    "routes.txt": ["route_id", "agency_id"],
    "trips.txt": ["route_id", "service_id", "trip_id", "shape_id", "block_id"],
    "stop_times.txt": ["trip_id", "stop_id"],
    "stops.txt": ["stop_id", "parent_station"],
    "calendar.txt": ["service_id"],
    "calendar_dates.txt": ["service_id"],
    "shapes.txt": ["shape_id"],
    "frequencies.txt": ["trip_id"],
    "transfers.txt": ["from_stop_id", "to_stop_id", "from_route_id", "to_route_id", "from_trip_id", "to_trip_id"],
}
KEEP = list(IDS) + ["feed_info.txt"]
# Table → (field to translate, id column for translations keyed by record_id).
NAMED = {
    "agency.txt": [("agency_name", "agency_id")],
    "routes.txt": [("route_long_name", "route_id"), ("route_short_name", "route_id")],
    "trips.txt": [("trip_headsign", "trip_id")],
    "stops.txt": [("stop_name", "stop_id")],
}


# Hepburn romaji for kana readings (ja-Hrkt), for feeds that give no
# English names (Tosaden's stops).
_KANA = {}
for row in """a あ ア|i い イ|u う ウ|e え エ|o お オ|ka か カ|ki き キ|ku く ク|ke け ケ|ko こ コ|sa さ サ|shi し シ|su す ス|se せ セ|so そ ソ|ta た タ|chi ち チ|tsu つ ツ|te て テ|to と ト|na な ナ|ni に ニ|nu ぬ ヌ|ne ね ネ|no の ノ|ha は ハ|hi ひ ヒ|fu ふ フ|he へ ヘ|ho ほ ホ|ma ま マ|mi み ミ|mu む ム|me め メ|mo も モ|ya や ヤ|yu ゆ ユ|yo よ ヨ|ra ら ラ|ri り リ|ru る ル|re れ レ|ro ろ ロ|wa わ ワ|wi ゐ ヰ|we ゑ ヱ|o を ヲ|n ん ン|ga が ガ|gi ぎ ギ|gu ぐ グ|ge げ ゲ|go ご ゴ|za ざ ザ|ji じ ジ|zu ず ズ|ze ぜ ゼ|zo ぞ ゾ|da だ ダ|ji ぢ ヂ|zu づ ヅ|de で デ|do ど ド|ba ば バ|bi び ビ|bu ぶ ブ|be べ ベ|bo ぼ ボ|pa ぱ パ|pi ぴ ピ|pu ぷ プ|pe ぺ ペ|po ぽ ポ|vu ゔ ヴ|a ぁ ァ|i ぃ ィ|u ぅ ゥ|e ぇ ェ|o ぉ ォ""".split("|"):
    r, h, k = row.split()
    _KANA[h] = _KANA[k] = r
_SMALL = {"ゃ": "ya", "ゅ": "yu", "ょ": "yo", "ャ": "ya", "ュ": "yu", "ョ": "yo"}


def romaji(kana):
    """Hepburn for a kana string: きょう → kyō is written "kyo" (long vowels
    unmarked, as on most station signs), っ doubles the next consonant, ん
    before b/m/p stays n. Characters that aren't kana are kept."""
    out = []
    i, n = 0, len(kana)
    double = False
    while i < n:
        c = kana[i]
        if c in "っッ":
            double = True
            i += 1
            continue
        if c == "ー":
            i += 1
            continue
        r = _KANA.get(c)
        if r is None:
            out.append(c)
            double = False
            i += 1
            continue
        if i + 1 < n and kana[i + 1] in _SMALL and r.endswith("i") and r not in ("i",):
            y = _SMALL[kana[i + 1]]
            r = (r[:-1] + y[1:]) if r[:-1] in ("sh", "ch", "j") else r[:-1] + y
            i += 1
        if double and r[0] not in "aiueon":
            r = ("t" if r.startswith("ch") else r[0]) + r
        double = False
        out.append(r)
        i += 1
    s = "".join(out)
    # ou and uu read as long o/u: written o and u.
    s = s.replace("ou", "o").replace("uu", "u")
    return s[:1].upper() + s[1:]


def table(z, name):
    try:
        f = z.open(name)
    except KeyError:
        return None, []
    r = csv.reader(io.TextIOWrapper(f, "utf-8-sig", newline=""))
    return next(r, None), r


def translations(z, lang):
    """(table, field, value) → text and (table, field, record_id) → text.
    Stops with only a kana reading get it in romaji."""
    by_value, by_record = {}, {}
    kana_value, kana_record = {}, {}
    head, rows = table(z, "translations.txt")
    if not head:
        return by_value, by_record
    h = {c: i for i, c in enumerate(head)}
    need = ("table_name", "field_name", "language", "translation")
    if not all(c in h for c in need):
        return by_value, by_record
    for r in rows:
        if len(r) < len(head) or not r[h["translation"]].strip():
            continue
        l = r[h["language"]]
        if l == lang:
            vals, recs = by_value, by_record
        elif l == "ja-Hrkt" and r[h["table_name"]] == "stops":
            vals, recs = kana_value, kana_record
        else:
            continue
        tname, field, text = r[h["table_name"]], r[h["field_name"]], r[h["translation"]].strip()
        if vals is kana_value:
            text = romaji(text)
        if "field_value" in h and r[h["field_value"]]:
            vals[(tname, field, r[h["field_value"]])] = text
        if "record_id" in h and r[h["record_id"]]:
            recs[(tname, field, r[h["record_id"]])] = text
    for k, v in kana_value.items():
        by_value.setdefault(k, v)
    for k, v in kana_record.items():
        by_record.setdefault(k, v)
    return by_value, by_record


def main(argv):
    opts = [a for a in argv if a.startswith("--")]
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    src, out = args
    prefix = next((a[9:] for a in opts if a.startswith("--prefix=")), "")
    lang = next((a[7:] for a in opts if a.startswith("--lang=")), "")
    keep_trips = "--keep-trips" in opts
    bilingual = "--bilingual" in opts
    merge = "--merge-platforms" in opts
    short = dict(p.split(":", 1) for a in opts if a.startswith("--short=") for p in a[8:].split(",") if ":" in p)
    rtype = next((a[13:] for a in opts if a.startswith("--route-type=")), "")
    if rtype and not rtype.isdigit():
        print(f"--route-type: {rtype!r} is not a number", file=sys.stderr)
        return 2
    named = 0
    same = {}  # stop_id → the stop it is merged into
    with zipfile.ZipFile(src) as z, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as w:
        by_value, by_record = translations(z, lang) if lang else ({}, {})
        names = set(z.namelist())
        if merge:
            head, rows = table(z, "stops.txt")
            if head and all(c in head for c in ("stop_id", "stop_name", "stop_lat", "stop_lon")):
                si, ni, la, lo = (head.index(c) for c in ("stop_id", "stop_name", "stop_lat", "stop_lon"))
                firsts = {}
                for r in rows:
                    try:
                        y, x = float(r[la]), float(r[lo])
                    except (ValueError, IndexError):
                        continue
                    for fid, fy, fx in firsts.get(r[ni].strip(), []):
                        d = math.hypot((x - fx) * 111_320 * math.cos(math.radians(y)), (y - fy) * 110_540)
                        if d < 150:
                            same[r[si]] = fid
                            break
                    else:
                        firsts.setdefault(r[ni].strip(), []).append((r[si], y, x))
        # A trip's headsign when the feed doesn't translate it: its last
        # stop's name in the language asked for.
        last_stop = {}
        stop_text = {}
        by_name = {}  # a stop's own name → a translation another stop of that name has
        if lang:
            head, rows = table(z, "stops.txt")
            if head and "stop_id" in head and "stop_name" in head:
                si, ni = head.index("stop_id"), head.index("stop_name")
                for r in rows:
                    if len(r) > max(si, ni):
                        t = by_record.get(("stops", "stop_name", r[si])) or by_value.get(("stops", "stop_name", r[ni].strip()))
                        if t:
                            stop_text[r[si]] = t
                            by_name.setdefault(r[ni].strip(), t)
            head, rows = table(z, "stop_times.txt")
            if head and "trip_id" in head:
                ti, si, qi = head.index("trip_id"), head.index("stop_id"), head.index("stop_sequence")
                best = {}
                for r in rows:
                    if len(r) > max(ti, si, qi):
                        r[si] = same.get(r[si], r[si])
                        try:
                            q = int(r[qi])
                        except ValueError:
                            continue
                        if r[ti] not in best or q > best[r[ti]]:
                            best[r[ti]] = q
                            last_stop[r[ti]] = r[si]
        for name in KEEP:
            if name not in names:
                continue
            head, rows = table(z, name)
            if not head:
                continue
            cols = [c for c in IDS.get(name, []) if not (keep_trips and c in ("trip_id", "from_trip_id", "to_trip_id"))]
            idx = [head.index(c) for c in cols if c in head]
            fields = [(head.index(f), head.index(k), f) for f, k in NAMED.get(name, []) if f in head and k in head]
            buf = io.StringIO()
            wr = csv.writer(buf, lineterminator="\n")
            wr.writerow(head)
            tname = name[:-4]
            stop_cols = [head.index(c) for c in ("stop_id", "from_stop_id", "to_stop_id", "parent_station") if c in head]
            for r in rows:
                if len(r) < len(head):
                    r = r + [""] * (len(head) - len(r))
                if same:
                    if name == "stops.txt" and r[head.index("stop_id")] in same:
                        continue
                    for i in stop_cols:
                        r[i] = same.get(r[i], r[i])
                for fi, ki, f in fields:
                    own = r[fi].strip()
                    text = by_record.get((tname, f, r[ki])) or by_value.get((tname, f, own))
                    if not text and name == "trips.txt" and f == "trip_headsign":
                        text = stop_text.get(last_stop.get(r[ki], ""))
                    # A station whose platforms are translated but not itself
                    # (Ise Railway's): their translation.
                    if not text and name == "stops.txt":
                        text = by_name.get(own)
                    if text and text != own:
                        named += 1
                        r[fi] = f"{text} {own}" if bilingual and name == "stops.txt" and own else text
                if short and name == "routes.txt" and "route_short_name" in head:
                    r[head.index("route_short_name")] = short.get(r[head.index("route_id")], r[head.index("route_short_name")])
                if rtype and name == "routes.txt" and "route_type" in head:
                    r[head.index("route_type")] = rtype
                if prefix:
                    for i in idx:
                        if r[i]:
                            r[i] = prefix + r[i]
                wr.writerow(r)
            w.writestr(name, buf.getvalue())
    print(f"{out}: ids prefixed {prefix!r}" if prefix else f"{out}: ids kept",
          f"; {named} names from translations ({lang})" if lang else "", f"; {len(same)} platforms merged" if merge else "")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
