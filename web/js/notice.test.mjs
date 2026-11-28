// Run with: node --test web/js/notice.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTICE_KINDS, noticeText } from "./notice.js";

const stops = [
  { name: "Madrid-Atocha", time: 1000 },
  { name: "Getafe", time: 2000 },
  { name: "Parla", time: 3000 },
];

test("the message: the train, the choice, where it is and the official delay", () => {
  const info = { number: "C3 12345", destination: "Aranjuez", next_stop: "Getafe", delay: 720 };
  const s = noticeText("es", "stopped", info, { title: "C3 12345", stops, nowSecs: 1500 });
  assert.equal(s, "⚠️ C3 12345 → Aranjuez: Está parado · Ahora: entre Madrid-Atocha y Getafe · Dato oficial: +12 min\nAviso de un viajero, compartido desde TrainRadar");
  const en = noticeText("en", "late", { ...info, delay: 0 }, { title: "C3 12345", stops, nowSecs: 1500 });
  assert.match(en, /Running late · Now: between Madrid-Atocha and Getafe · Official: On time\n/);
});

test("no official part for timetable-only trains; cancelled says so", () => {
  const s = noticeText("en", "noshow", { number: "1", timetable_only: true, delay: null }, { stops: [], nowSecs: 0 });
  assert.equal(s, "⚠️ 1: Hasn't turned up\nA traveller's heads-up, shared from TrainRadar");
  assert.match(noticeText("en", "noshow", { number: "1", canceled: true }, {}), /Official: Cancelled/);
  assert.deepEqual(NOTICE_KINDS, ["late", "stopped", "noshow", "crowded", "incident"]);
});
