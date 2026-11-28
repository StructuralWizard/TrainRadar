// Run with: node --test web/js/i18n.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, STRINGS, locale, nextLang, pickLang, t } from "./i18n.js";

test("Spanish by default", () => {
  assert.equal(pickLang(null), "es");
  assert.equal(pickLang("xx"), "es");
  assert.equal(pickLang("fr"), "fr");
  assert.equal(pickLang("en"), "en");
});

test("placeholders", () => {
  assert.equal(t("es", "trains", { n: 456 }), "456 trenes");
  assert.equal(t("en", "late", { m: 7 }), "+7 min");
});

test("both languages have the same keys", () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.es).sort());
});

test("every other language: every key, the same placeholders and tags as English", () => {
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
  const tags = (s) => (String(s).match(/<[^>]+>/g) || []).length;
  for (const l of LANGS.filter((l) => l !== "es" && l !== "en")) {
    assert.deepEqual(Object.keys(STRINGS[l]).sort(), Object.keys(STRINGS.en).sort(), l);
    for (const k of Object.keys(STRINGS.en)) {
      assert.equal(ph(STRINGS[l][k]), ph(STRINGS.en[k]), `${l}.${k} placeholders`);
      assert.equal(tags(STRINGS[l][k]), tags(STRINGS.en[k]), `${l}.${k} tags`);
    }
  }
  assert.equal(t("pt", "moreLanguageValue"), "Português");
  assert.equal(t("ja", "moreLanguageValue"), "日本語");
  assert.equal(t("fr", "moreLanguageValue"), "Français");
  assert.equal(t("de", "moreLanguageValue"), "Deutsch");
  // Each language's name is its own.
  const names = LANGS.map((l) => t(l, "moreLanguageValue"));
  assert.equal(new Set(names).size, LANGS.length);
});

test("the browser's language picks the app's language the first time; a choice made wins", () => {
  assert.equal(pickLang(null, ["pt-PT", "en"]), "pt");
  assert.equal(pickLang(null, ["ja"]), "ja");
  assert.equal(pickLang(null, ["en-GB"]), "es");
  assert.equal(pickLang("en", ["ja-JP"]), "en");
  assert.equal(pickLang(null, ["en-GB", "de-CH"]), "de");
  assert.equal(pickLang(null, ["no"]), "nb");
  assert.equal(pickLang(null, ["nn-NO"]), "nb");
  assert.equal(pickLang(null, ["zh-SG"]), "zh");
  // Three Chinese: Hong Kong's (and Macau's), Taiwan's, and Simplified.
  for (const l of ["zh-HK", "zh-MO", "zh-Hant-HK", "zh-hk"]) assert.equal(pickLang(null, [l]), "zh-HK", l);
  for (const l of ["zh-TW", "zh-Hant", "zh-Hant-TW"]) assert.equal(pickLang(null, [l]), "zh-TW", l);
  for (const l of ["zh-CN", "zh-Hans", "zh-SG", "zh"]) assert.equal(pickLang(null, [l]), "zh", l);
  // Tagalog: Filipino (fil) or Tagalog (tl), Philippines or not.
  for (const l of ["fil", "fil-PH", "tl", "tl-PH"]) assert.equal(pickLang(null, [l]), "tl", l);
  assert.equal(pickLang(null, ["ru"]), "es");
  assert.equal(nextLang("es"), "en");
  assert.equal(nextLang(LANGS.at(-1)), "es");
  assert.equal(locale("nb"), "nb-NO");
  assert.equal(locale("pt"), "pt-PT");
});
