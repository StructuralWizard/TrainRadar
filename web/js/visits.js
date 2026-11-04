// "Get the Android app" banner (phase C2): shown once, from the 3rd visit,
// only when there's a Play listing, and gone for good once dismissed. The
// visit count and the dismissal live in this browser's localStorage only:
// no cookies, nothing sent anywhere. Every storage access is guarded
// (private mode, blocked storage).

export const BANNER_FROM_VISIT = 3;
const VISITS = "visits";
const DISMISSED = "appBannerDismissed";

function get(storage, k) {
  try {
    return storage?.getItem(k) ?? null;
  } catch {
    return null;
  }
}

function set(storage, k, v) {
  try {
    storage?.setItem(k, v);
  } catch {
    /* storage unavailable: the banner just may show again */
  }
}

/** Count this visit; returns the visit number (1 for the first). */
export function countVisit(storage) {
  const n = (Number.parseInt(get(storage, VISITS) || "0", 10) || 0) + 1;
  set(storage, VISITS, String(n));
  return n;
}

/** Show the app banner on this visit? */
export function showAppBanner(storage, visit, { playUrl, platform }) {
  if (!playUrl || platform !== "web") return false;
  if (get(storage, DISMISSED) === "1") return false;
  return visit >= BANNER_FROM_VISIT;
}

export function dismissAppBanner(storage) {
  set(storage, DISMISSED, "1");
}
