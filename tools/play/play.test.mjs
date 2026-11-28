// Run with: node --test tools/play/play.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseListings, parseNotes, productionRelease } from "./play.mjs";

test("the release notes in the repository parse, every language under 500 characters", () => {
  const md = readFileSync(new URL("../../docs/releases/v3.7.0.md", import.meta.url), "utf8");
  const notes = parseNotes(md.slice(md.indexOf("## Google Play")));
  assert.equal(notes.length, 21);
  assert.deepEqual(notes.slice(0, 2).map((n) => n.language), ["es-ES", "en-GB"]);
  assert.ok(notes.some((n) => n.language === "zh-HK") && notes.some((n) => n.language === "fil"));
  assert.throws(() => parseNotes(`<en-GB>\n${"x".repeat(501)}\n</en-GB>`), /500/);
});

test("the store listings in docs/play-store.md parse: 21 languages within Play's limits", () => {
  const list = parseListings(readFileSync(new URL("../../docs/play-store.md", import.meta.url), "utf8"));
  assert.equal(list.length, 21);
  const en = list.find((l) => l.language === "en-GB");
  assert.ok(en.title.startsWith("TrainRadar"));
  assert.ok(en.fullDescription.length > 1000 && !en.fullDescription.includes("```"));
  assert.ok(list.every((l) => [...l.title].length <= 30 && [...l.shortDescription].length <= 80));
});

test("production releases: staged below 100 %, complete at 100 %", () => {
  assert.deepEqual(productionRelease(30700, 20, [], "3.7.0"), { name: "3.7.0", versionCodes: ["30700"], releaseNotes: [], status: "inProgress", userFraction: 0.2 });
  assert.equal(productionRelease(30700, 100, []).status, "completed");
  assert.throws(() => productionRelease(30700, 0, []), /percent/);
  assert.throws(() => productionRelease(30700, 150, []), /percent/);
});
