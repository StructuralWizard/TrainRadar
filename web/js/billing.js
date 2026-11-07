// Google Play Billing through cordova-plugin-purchase (window.CdvPurchase,
// only inside the Android app). Products come from CONFIG.products, so more
// can be added later (yearly, lifetime: phase C8) without UI changes.
// No receipt server: purchases are acknowledged on the phone (see
// entitlement.js for what that means for Pro).

export const ENTITLEMENT_KEY = "pro-entitlement";

export class Billing {
  /** `cdv`: the CdvPurchase namespace; `products`: CONFIG.products. */
  constructor(cdv, products, { onChange = () => {}, onTip = () => {}, onError = () => {} } = {}) {
    this.cdv = cdv;
    this.products = products;
    this.onChange = onChange;
    this.onTip = onTip;
    this.onError = onError;
    this.ready = false;
  }

  static available() {
    return typeof window !== "undefined" && !!window.CdvPurchase?.store;
  }

  async start() {
    const { store, ProductType, Platform } = this.cdv;
    const type = (p) => (p.kind === "subscription" ? ProductType.PAID_SUBSCRIPTION : p.kind === "lifetime" ? ProductType.NON_CONSUMABLE : ProductType.CONSUMABLE);
    store.register(this.products.map((p) => ({ id: p.id, type: type(p), platform: Platform.GOOGLE_PLAY })));
    store
      .when()
      .approved((t) => t.finish()) // acknowledge (subscriptions) or consume (tips)
      .finished((t) => {
        for (const p of t.products || []) {
          if (this.products.find((x) => x.id === p.id)?.kind === "tip") this.onTip(p.id);
        }
        this.onChange();
      })
      .productUpdated(() => this.onChange())
      .receiptUpdated(() => this.onChange());
    store.error((e) => this.onError(e));
    const errors = (await store.initialize([Platform.GOOGLE_PLAY])) || [];
    for (const e of errors) this.onError(e);
    // A product missing from Play Console (e.g. a tip not created yet) isn't
    // a failure: the others still load and can be bought.
    const missing = this.cdv.ErrorCode?.INVALID_PRODUCT_ID;
    this.ready = !errors.some((e) => e?.code !== missing);
    this.failed = !this.ready; // the Pro screen says so instead of waiting
    this.onChange();
    return this.ready;
  }

  /** What Play says about Pro now, for entitlement.decide(); null if unknown. */
  proStatus() {
    if (!this.ready) return null;
    const { store } = this.cdv;
    const pro = this.products.filter((p) => p.pro);
    let owned = false;
    let renewing = false;
    for (const p of pro) {
      const prod = store.get(p.id);
      if (prod?.owned) {
        owned = true;
        const tx = store.localTransactions?.find((t) => t.products?.some((x) => x.id === p.id));
        renewing ||= tx?.renewalIntent !== "Lapse" && tx?.isAutoRenewing !== false;
      }
    }
    return { owned, renewing };
  }

  /** Products with Play's localized title and price, for the Pro screen. */
  catalogue() {
    const { store } = this.cdv;
    return this.products.map((p) => {
      const prod = this.ready ? store.get(p.id) : null;
      const offer = prod?.getOffer?.();
      const price = offer?.pricingPhases?.[0]?.price ?? prod?.pricing?.price ?? null;
      return { ...p, title: prod?.title || null, price, canBuy: !!(offer && prod?.canPurchase !== false) };
    });
  }

  async buy(id) {
    const offer = this.cdv.store.get(id)?.getOffer?.();
    if (!offer) throw new Error(`${id} not available`);
    const err = await offer.order();
    if (err && err.code !== this.cdv.ErrorCode?.PAYMENT_CANCELLED) throw new Error(err.message || String(err.code));
  }

  restore() {
    return this.cdv.store.restorePurchases();
  }

  manage() {
    return this.cdv.store.manageSubscriptions();
  }
}
