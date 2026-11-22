# Plan: TrainRadar Pro for life, €9.99

Status: **proposed 2026-11-22**, nothing built yet. This is roadmap item C8 ("yearly / lifetime,
later"): yearly is already live (`pro_yearly`, €1.99 a year), and this adds lifetime.

## The product

- **Where:** Play Console → Monetise with Play → Products → **One-time products**.
- **What:** `pro_lifetime`, with a single "buy" purchase option.
- **Non-consumable:** Play Console has no setting for that. A product stays non-consumable because
  the app acknowledges it instead of consuming it.
- **Digital content or service:** Play Console asks which it is, and the answer changes the EU
  right of withdrawal. Choose with the terms below.
- **Billing library:** the app uses Play Billing Library 9 (through `cordova-plugin-purchase`
  13.19.1), which supports the new one-time products.
- **Price:** €9.99 in Spain, VAT included. Play converts it for the other countries, or the
  maintainer sets them.
  - That is five years of the yearly price.
  - The large tip is also €9.99, but it unlocks nothing.

## App

- **`CONFIG.products`:** add `{ id: "pro_lifetime", kind: "lifetime", pro: true }`.
- **`Billing` already handles it** (`web/js/billing.js`):
  - it registers `lifetime` as a non-consumable;
  - it acknowledges approved purchases (`t.finish()`).

  Play refunds a purchase that isn't acknowledged within three days, so the tests cover the
  acknowledgement.
- **Entitlement:**
  - `proStatus()` reports `lifetime: true` when `pro_lifetime` is owned.
  - `entitlement.decide()` gets a `lifetime` state. Today an owned product that doesn't renew reads
    as "cancelled", which would be wrong here.
  - Offline, a lifetime purchase stays valid for 30 days instead of a subscription's 7. A refund
    still removes it, the next time Play answers.
- **Pro screen:** two choices, "1,99 € al año" and "9,99 € para siempre (un solo pago)". The prices
  come from Play, as now.
- **Someone who has the yearly subscription and buys lifetime:**
  - Before paying, the app says "Tu suscripción anual seguirá renovándose: cancélala en Google
    Play", with the link to Play's subscriptions page.
  - The Pro screen repeats it while the subscription is still renewing.
  - The app can't cancel a subscription itself: that needs a server with a Play service account.
- **Restore purchases** already covers it: Play lists the purchase on any phone with the same
  Google account.

## Terms

- **"For life":** it means for as long as TrainRadar Pro is offered. The Pro screen's small print
  and the terms page both say so.
- **If Pro closes:** the wind-down clause applies to lifetime buyers too ([plan-c.md](plan-c.md),
  section 6):
  - at least 60 days' notice;
  - a final release whose on-device features keep working.
- **To decide:** whether buyers get a partial refund if Pro closes within, say, two years of their
  purchase. A lawyer should confirm what's owed:
  - The EU Digital Content Directive (Art. 16) refunds any price paid in advance for the part of a
    contract that would have remained. For an open-ended "lifetime", what that means is unclear.
  - No rule about the word "lifetime" itself was found. Play forbids misleading users about
    content, and the UK's DMCC Act counts true information "presented in a misleading way" as
    misleading.
- **Data safety:** no change.
- **Store listing:** mention the lifetime option.
- **The UK's subscription rules (DMCC):** they don't apply to a one-time purchase.

## Tests

- **Unit tests:**
  - `decide()` with lifetime, online and offline;
  - the catalogue shows both choices;
  - a subscription and lifetime together.
- **Closed testing, with a licence tester:**
  - buy;
  - restore on a second phone;
  - refund from Play Console's order management, after which Pro goes at the next check.

## Steps

- **L1:** the config, entitlement, Pro screen, ES and EN strings, and tests.
- **Then the maintainer:**
  - creates the product in Play Console;
  - runs the closed test;
  - writes the release notes.
