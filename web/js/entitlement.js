// TrainRadar Pro entitlement (phase C5). The app is open source and has no
// accounts or server: Google Play is the only source of truth, read on the
// phone, and the last answer is cached so Pro keeps working offline.
//
// How Play's subscription states reach the app (client side, no server):
//   active, or in its grace period  → Play lists the purchase, renewing
//   cancelled, paid period not over → Play lists it, not renewing
//   on hold, paused, expired        → Play no longer lists it
// So: listed → Pro; not listed while Play answered → not Pro; Play not
// reachable → the cached answer, for up to OFFLINE_DAYS.

export const OFFLINE_DAYS = 7;
const DAY = 86_400_000;

/**
 * `play`: what Play said just now — `{ owned, renewing }` — or null when it
 * couldn't be asked (offline, Play services missing). `cache`: the last
 * result. Returns `{ pro, state, checkedAt }`, state one of
 * "active" | "cancelled" | "expired" | "none" | "offline".
 */
export function decide(play, cache, now) {
  if (play) {
    if (play.owned) return { pro: true, state: play.renewing ? "active" : "cancelled", checkedAt: now };
    return { pro: false, state: cache?.pro ? "expired" : "none", checkedAt: now };
  }
  if (cache?.pro && now - cache.checkedAt <= OFFLINE_DAYS * DAY) {
    return { pro: true, state: "offline", checkedAt: cache.checkedAt };
  }
  return { pro: false, state: cache?.pro ? "expired" : "none", checkedAt: cache?.checkedAt ?? 0 };
}

export function parseCache(json) {
  try {
    const c = JSON.parse(json || "null");
    if (c && typeof c.pro === "boolean" && Number.isFinite(c.checkedAt)) return c;
  } catch {
    // ignore
  }
  return null;
}
