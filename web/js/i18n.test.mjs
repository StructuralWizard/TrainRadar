// Run with: node --test web/js/i18n.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS, locale, nextLang, pickLang, t } from "./i18n.js";

test("Spanish by default", () => {
  assert.equal(pickLang(null), "es");
  assert.equal(pickLang("fr"), "es");
  assert.equal(pickLang("en"), "en");
});

test("placeholders", () => {
  assert.equal(t("es", "trains", { n: 456 }), "456 trenes");
  assert.equal(t("en", "late", { m: 7 }), "+7 min");
});

test("both languages have the same keys", () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.es).sort());
});

test("Portuguese and Japanese: every key, the same placeholders and tags as English", () => {
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
  const tags = (s) => (String(s).match(/<[^>]+>/g) || []).length;
  for (const l of ["pt", "ja"]) {
    assert.deepEqual(Object.keys(STRINGS[l]).sort(), Object.keys(STRINGS.en).sort(), l);
    for (const k of Object.keys(STRINGS.en)) {
      assert.equal(ph(STRINGS[l][k]), ph(STRINGS.en[k]), `${l}.${k} placeholders`);
      assert.equal(tags(STRINGS[l][k]), tags(STRINGS.en[k]), `${l}.${k} tags`);
    }
  }
  assert.equal(t("pt", "moreLanguageValue"), "Português");
  assert.equal(t("ja", "moreLanguageValue"), "日本語");
});

test("the browser's language picks Portuguese or Japanese the first time; a choice made wins", () => {
  assert.equal(pickLang(null, ["pt-PT", "en"]), "pt");
  assert.equal(pickLang(null, ["ja"]), "ja");
  assert.equal(pickLang(null, ["en-GB"]), "es");
  assert.equal(pickLang("en", ["ja-JP"]), "en");
  assert.equal(nextLang("es"), "en");
  assert.equal(nextLang("ja"), "es");
  assert.equal(locale("pt"), "pt-PT");
});
