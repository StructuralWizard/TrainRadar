#!/usr/bin/env python3
"""Chinese in traditional characters, Taiwan's (zh-TW) and Hong Kong's
(zh-HK), from the Simplified Chinese texts (zh, mainland), regenerated
whenever those change:

    pip install opencc-python-reimplemented
    python3 tools/i18n/zh-hant.py

Taiwan: OpenCC's Simplified → Taiwan standard with Taiwan's own words
(s2twp: 软件 → 軟體, 视频 → 影片, 出租车 → 計程車). Hong Kong: Simplified →
Hong Kong standard (s2hk), whose words stay close to the mainland's (軟件,
網絡, 數據 are Hong Kong's too), then Hong Kong's own (的士, 預設, 用戶).
Both then get the railway words the conversion gets wrong in an app about
trains: a train 運行 (runs), not 執行 (executes); 月台 for a platform;
帳戶; 小工具 for a home-screen widget; the language's own name. Writes:

- web/js/i18n-zh-tw.js, i18n-zh-hk.js   from web/js/i18n-zh.js (ZH_TW, ZH_HK)
- tools/i18n/android/zh-TW.json, zh-HK.json   from zh.json (then
  tools/i18n/android-table.py)
- app/android/…/res/values-zh-rTW, values-zh-rHK (and values-b+zh+Hant,
  Taiwan's, for other traditional locales) from values-b+zh+Hans

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
BEFORE = {"运行": ""}
VARIANTS = {
    "TW": {
        "config": "s2twp",
        "name": "繁體中文（台灣）",
        "fix": {
            "": "運行",
            "實時": "即時",
            "站臺": "月台",
            "賬戶": "帳戶",
            "賬號": "帳號",
            "小部件": "小工具",
            "有軌電車": "路面電車",
        },
    },
    "HK": {
        "config": "s2hk",
        "name": "繁體中文（香港）",
        "fix": {
            "": "運行",
            "站臺": "月台",
            "站台": "月台",
            "出租車": "的士",
            "默認": "預設",
            "登錄": "登入",
            "用户": "用戶",
            "賬户": "帳戶",
            "賬戶": "帳戶",
            "賬號": "帳號",
            "小部件": "小工具",
            "有軌電車": "電車",
            "視頻": "影片",
            "信息": "資訊",
            "設置": "設定",
            "閲": "閱",
        },
    },
}


def convert(text, variant):
    v = VARIANTS[variant]
    cc = opencc.OpenCC(v["config"])
    for a, b in BEFORE.items():
        text = text.replace(a, b)
    text = cc.convert(text)
    for a, b in v["fix"].items():
        text = text.replace(a, b)
    # The language's own name (the Simplified file names itself 简体中文).
    for simp in ("簡體中文", "简体中文"):
        text = text.replace(simp, v["name"])
    return text


def rw(src, dst, variant, edit=lambda s: s):
    with open(os.path.join(ROOT, src), encoding="utf-8") as f:
        s = f.read()
    out = edit(convert(s, variant))
    path = os.path.join(ROOT, dst)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"{dst}: {len(out)} bytes")


def js(variant):
    where = {"TW": "Taiwan", "HK": "Hong Kong"}[variant]

    def edit(s):
        s = s.replace("export const ZH = {", f"export const ZH_{variant} = {{", 1)
        return re.sub(
            r"\A//[^\n]*\n",
            f"// Interface strings in Traditional Chinese for {where} (zh-{variant}), generated from\n"
            "// i18n-zh.js by tools/i18n/zh-hant.py: do not edit, change the Simplified text and regenerate.\n",
            s,
            count=1,
        )

    return edit


def main():
    res = "app/android/app/src/main/res"
    for v in VARIANTS:
        rw("web/js/i18n-zh.js", f"web/js/i18n-zh-{v.lower()}.js", v, js(v))
        rw("tools/i18n/android/zh.json", f"tools/i18n/android/zh-{v}.json", v)
        rw(f"{res}/values-b+zh+Hans/strings.xml", f"{res}/values-zh-r{v}/strings.xml", v)
    # Other traditional locales (Macau, "zh-Hant"): Taiwan's.
    rw(f"{res}/values-b+zh+Hans/strings.xml", f"{res}/values-b+zh+Hant/strings.xml", "TW")
    return 0


if __name__ == "__main__":
    sys.exit(main())
