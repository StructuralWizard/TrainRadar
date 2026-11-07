import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKUP_SCHEMA, backupName, makeBackup, mergeFavourites, mergeTrips, parseBackup } from "./backup.js";
import { Billing } from "./billing.js";
import { OFFLINE_DAYS, decide, parseCache } from "./entitlement.js";

const DAY = 86_400_000;

test("entitlement: none → active → cancelled → expired, offline cache, restore", () => {
  let e = decide({ owned: false, renewing: false }, null, 0);
  assert.deepEqual(e, { pro: false, state: "none", checkedAt: 0 });
  e = decide({ owned: true, renewing: true }, e, 1000);
  assert.equal(e.state, "active");
  assert.ok(e.pro);
  // Grace period: Play still lists it, renewing.
  assert.equal(decide({ owned: true, renewing: true }, e, 2000).state, "active");
  // Cancelled but paid up: still Pro.
  const c = decide({ owned: true, renewing: false }, e, 3000);
  assert.deepEqual([c.pro, c.state], [true, "cancelled"]);
  // On hold / expired: Play no longer lists it.
  const x = decide({ owned: false, renewing: false }, c, 4000);
  assert.deepEqual([x.pro, x.state], [false, "expired"]);
  // Offline: the cached Pro holds for OFFLINE_DAYS, then lapses.
  assert.deepEqual(decide(null, e, 1000 + OFFLINE_DAYS * DAY), { pro: true, state: "offline", checkedAt: 1000 });
  assert.equal(decide(null, e, 1001 + OFFLINE_DAYS * DAY).pro, false);
  assert.equal(decide(null, null, 5).pro, false);
  // New install: no cache, Play lists the purchase after restore → Pro.
  assert.ok(decide({ owned: true, renewing: true }, null, 9).pro);
  assert.deepEqual(parseCache(JSON.stringify(e)), e);
  assert.equal(parseCache("{bad"), null);
  assert.equal(parseCache('{"pro":"yes"}'), null);
});

function fakeCdv({ owned = false, initErrors = [] } = {}) {
  const handlers = {};
  const products = {
    pro_monthly: { id: "pro_monthly", title: "TrainRadar Pro", owned, getOffer: () => ({ pricingPhases: [{ price: "1,99 €" }], order: async () => { fake.ordered.push("pro_monthly"); } }) },
    tip_small: { id: "tip_small", title: "Propina", owned: false, getOffer: () => ({ pricingPhases: [{ price: "1,99 €" }], order: async () => ({ code: 6777006, message: "cancelled" }) }) },
  };
  const when = { approved: (f) => ((handlers.approved = f), when), finished: (f) => ((handlers.finished = f), when), productUpdated: (f) => ((handlers.updated = f), when), receiptUpdated: () => when };
  const fake = {
    ordered: [],
    handlers,
    ProductType: { PAID_SUBSCRIPTION: "sub", CONSUMABLE: "cons", NON_CONSUMABLE: "nc" },
    Platform: { GOOGLE_PLAY: "android-playstore" },
    ErrorCode: { PAYMENT_CANCELLED: 6777006, INVALID_PRODUCT_ID: 6777010 },
    store: {
      registered: null,
      register(p) { this.registered = p; },
      when: () => when,
      error() {},
      initialize: async () => initErrors,
      get: (id) => products[id],
      localTransactions: owned ? [{ products: [{ id: "pro_monthly" }], isAutoRenewing: true }] : [],
      restorePurchases: async () => "restored",
      manageSubscriptions: () => "managed",
    },
  };
  return fake;
}

const PRODUCTS = [{ id: "pro_monthly", kind: "subscription", pro: true }, { id: "tip_small", kind: "tip" }];

test("billing: registers products, reads Pro and prices, tips are consumed and thanked", async () => {
  const cdv = fakeCdv({ owned: true });
  const tips = [];
  const b = new Billing(cdv, PRODUCTS, { onTip: (id) => tips.push(id) });
  assert.equal(b.proStatus(), null, "unknown before start");
  assert.ok(await b.start());
  assert.deepEqual(cdv.store.registered.map((p) => [p.id, p.type]), [["pro_monthly", "sub"], ["tip_small", "cons"]]);
  assert.deepEqual(b.proStatus(), { owned: true, renewing: true });
  assert.deepEqual(b.catalogue().map((p) => [p.id, p.price, p.canBuy]), [["pro_monthly", "1,99 €", true], ["tip_small", "1,99 €", true]]);
  await b.buy("pro_monthly");
  assert.deepEqual(cdv.ordered, ["pro_monthly"]);
  await b.buy("tip_small"); // user cancelled: not an error
  let finished = false;
  cdv.handlers.approved({ finish: () => (finished = true) });
  assert.ok(finished, "approved purchases are acknowledged/consumed");
  cdv.handlers.finished({ products: [{ id: "tip_small" }] });
  assert.deepEqual(tips, ["tip_small"]);
  assert.equal(await b.restore(), "restored");
});

test("billing: Play unavailable → status unknown (cache decides)", async () => {
  const b = new Billing(fakeCdv({ initErrors: [{ code: 1 }] }), PRODUCTS);
  assert.equal(await b.start(), false);
  assert.equal(b.proStatus(), null);
  assert.equal(Billing.available(), false, "no CdvPurchase outside the app");
});

test("billing: a product missing from Play Console doesn't block the others", async () => {
  const errors = [];
  const b = new Billing(fakeCdv({ initErrors: [{ code: 6777010, message: "Product with id tip_large not found." }] }), PRODUCTS, { onError: (e) => errors.push(e.code) });
  assert.equal(await b.start(), true);
  assert.equal(b.failed, false);
  assert.deepEqual(errors, [6777010], "still reported");
  assert.equal(b.catalogue()[0].canBuy, true);
});

test("billing: Play failing marks the store failed (the Pro screen stops waiting)", async () => {
  const b = new Billing(fakeCdv({ initErrors: [{ code: 6777010 }, { code: 6777003 }] }), PRODUCTS);
  assert.equal(await b.start(), false);
  assert.equal(b.failed, true);
});

test("backup: round trip, validation, merge without duplicates and within the limit", () => {
  const fav = [{ type: "train", number: "03020", label: "AVE 03020" }];
  const text = makeBackup({ favourites: fav, settings: { lang: "en", basemap: "satellite", secret: "x" } }, new Date("2026-11-05T10:00:00Z"));
  assert.equal(backupName(new Date("2026-11-05T10:00:00Z")), "trainradar-backup-20261105.json");
  const b = parseBackup(text);
  assert.deepEqual(b.favourites, fav);
  assert.deepEqual(b.settings, { lang: "en", basemap: "satellite" });
  assert.equal(JSON.parse(text).schema, BACKUP_SCHEMA);
  for (const [bad, why] of [["nope", /JSON/], ['{"app":"other"}', /not a TrainRadar/], ['{"app":"trainradar","schema":99}', /newer/]]) {
    assert.throws(() => parseBackup(bad), why);
  }
  const st = { type: "station", id: "18000", name: "Atocha", lon: -3.69, lat: 40.4 };
  const third = { type: "train", number: "19", label: "C5 19" };
  const m = mergeFavourites(fav, [...fav, st, third], 2);
  assert.deepEqual(m, { list: [fav[0], st], added: 1, skipped: 1 });
  assert.equal(mergeFavourites(fav, [st, third], Infinity).added, 2);
});

test("backup carries the trips log; import merges by id", () => {
  const trip = (id, at) => ({ id, day: "2026-11-05", trainNo: "19", label: "C5 19", origin: "A", destination: "B", stops: [], startedAt: at, endedAt: at + 1 });
  const b = parseBackup(makeBackup({ trips: [trip("a", 1), trip("b", 2)] }));
  assert.deepEqual(b.trips.map((t) => t.id), ["a", "b"]);
  assert.deepEqual(mergeTrips([trip("b", 2), trip("c", 3)], b.trips).map((t) => t.id), ["a", "b", "c"]);
  assert.deepEqual(parseBackup(makeBackup({})).trips, [], "older backups without trips still import");
});
