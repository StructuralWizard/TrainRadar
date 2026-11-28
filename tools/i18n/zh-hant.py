#!/usr/bin/env python3
"""Traditional Chinese (zh-Hant: Taiwan, Hong Kong) from the Simplified
Chinese texts, regenerated whenever those change:

    pip install opencc-python-reimplemented
    python3 tools/i18n/zh-hant.py

OpenCC's Simplified → Taiwan standard with Taiwan's own words (s2twp:
软件 → 軟體, 视频 → 影片), then the railway words it gets wrong for an app
about trains: a train 運行 (runs), not 執行 (executes); 即時 for live;
月台 for a platform; 帳戶; 小工具 for a home-screen widget. Writes:

- web/js/i18n-zh-hant.js       from web/js/i18n-zh.js (export ZH_HANT)
- tools/i18n/android/zh-Hant.json   from zh.json (then tools/i18n/android-table.py)
- app/android/app/src/main/res/values-b+zh+Hant/strings.xml from values-b+zh+Hans

Reviewed by hand once (2026-11-28); a new Simplified text gets the same
conversion and fixes.
"""

import os
import re
import sys

try:
    import opencc
except ImportError:
    sys.exit("pip install opencc-python-reimplemented")

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
# Simplified words kept apart from OpenCC's software sense: replaced before
# the conversion by a marker, after it by the railway word.
BEFORE = {"运行": "\uE000"}
AFTER = {
    "\uE000": "運行",
    "實時": "即時",
    "站臺": "月台",
    "賬戶": "帳戶",
    "賬號": "帳號",
    "小部件": "小工具",
    "有軌電車": "路面電車",
    # The language's own name.
    "簡體中文": "繁體中文",
}

cc = opencc.OpenCC("s2twp")


def convert(text):
    for a, b in BEFORE.items():
        text = text.replace(a, b)
    text = cc.convert(text)
    for a, b in AFTER.items():
        text = text.replace(a, b)
    return text


def rw(src, dst, edit=lambda s: s):
    with open(os.path.join(ROOT, src), encoding="utf-8") as f:
        s = f.read()
    out = edit(convert(s))
    path = os.path.join(ROOT, dst)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"{dst}: {len(out)} bytes")


def js(s):
    s = s.replace("export const ZH = {", "export const ZH_HANT = {", 1)
    # Its header: what it is and where it comes from.
    return re.sub(r"\A//[^\n]*\n", "// Interface strings in Traditional Chinese (zh-Hant: Taiwan, Hong Kong), generated from\n"
                  "// i18n-zh.js by tools/i18n/zh-hant.py: do not edit, change the Simplified text and regenerate.\n", s, count=1)


def main():
    rw("web/js/i18n-zh.js", "web/js/i18n-zh-hant.js", js)
    rw("tools/i18n/android/zh.json", "tools/i18n/android/zh-Hant.json")
    rw("app/android/app/src/main/res/values-b+zh+Hans/strings.xml", "app/android/app/src/main/res/values-b+zh+Hant/strings.xml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
