// Run with: node --test web/js/i18n.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS, pickLang, t } from "./i18n.js";

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
