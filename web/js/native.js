// The Android app's native side (Capacitor, app/), used only when present:
// on the web every function falls back to the browser. Plugins are reached
// through the bridge Capacitor injects (window.Capacitor.Plugins), so the
// web code needs no bundler.

function cap() {
  return typeof window !== "undefined" ? window.Capacitor : undefined;
}

export function isNative() {
  return !!cap()?.isNativePlatform?.();
}

function plugin(name) {
  return isNative() ? cap().Plugins?.[name] : undefined;
}

/** Key–value storage: Android's shared preferences (included in Android's
 * backup), else this browser's localStorage. */
export const prefs = {
  async get(key) {
    const p = plugin("Preferences");
    if (p) return (await p.get({ key })).value ?? null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    const p = plugin("Preferences");
    if (p) return p.set({ key, value });
    try {
      localStorage.setItem(key, value);
    } catch {
      // private mode: not remembered
    }
  },
};

/** Android back button: `handler()` returns true when it closed something;
 * otherwise the app goes to the background, like other apps. */
export function onBackButton(handler) {
  const app = plugin("App");
  if (!app) return;
  app.addListener("backButton", () => {
    if (!handler()) app.minimizeApp();
  });
}

/** Links that open the app (trainradar://…), at launch and while running. */
export async function onAppLink(handler) {
  const app = plugin("App");
  if (!app) return;
  app.addListener("appUrlOpen", (e) => handler(e.url));
  const launch = await app.getLaunchUrl().catch(() => null);
  if (launch?.url) handler(launch.url);
}

/** Share sheet (Android, or the browser's when it has one). False when
 * sharing isn't available or the user cancelled. */
export async function share({ title, text, url }) {
  const p = plugin("Share");
  try {
    if (p) {
      await p.share({ title, text, url, dialogTitle: title });
      return true;
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title, text, url });
      return true;
    }
  } catch {
    // cancelled
  }
  return false;
}

export function canShare() {
  return !!plugin("Share") || (typeof navigator !== "undefined" && !!navigator.share);
}

/** Android status bar in the app's colours. */
export function styleStatusBar() {
  const p = plugin("StatusBar");
  p?.setStyle?.({ style: "LIGHT" }).catch(() => {});
}

/**
 * What a link asks to open: `trainradar://train/03020`,
 * `trainradar://station/18000`, or the web's `?train=` / `?station=`.
 * Returns `{type: "train", number}`, `{type: "station", id}` or null.
 */
export function parseLink(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const ok = (s) => (/^[A-Za-z0-9._-]{1,40}$/.test(s || "") ? s : null);
  if (u.protocol === "trainradar:") {
    // trainradar://train/03020 → host "train", path "/03020"
    const parts = [u.host, ...u.pathname.split("/")].filter(Boolean);
    const [kind, id] = parts;
    if (kind === "train" && ok(id)) return { type: "train", number: id };
    if (kind === "station" && ok(id)) return { type: "station", id };
    return null;
  }
  const train = ok(u.searchParams.get("train"));
  if (train) return { type: "train", number: train };
  const station = ok(u.searchParams.get("station"));
  if (station) return { type: "station", id: station };
  return null;
}
