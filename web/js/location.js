// Browser geolocation, only after the user taps "Use my location".
// watchPosition runs only while location is on and the tab is visible.
// Fixes stay in this page: nothing is sent, logged or stored.

export class Locator {
  constructor({ onFix, onError }) {
    this.onFix = onFix;
    this.onError = onError;
    this.active = false;
    this.watch = null;
    this.last = null;
    this.onVisibility = () => this.visibility();
  }

  static supported() {
    return "geolocation" in navigator && window.isSecureContext;
  }

  start() {
    if (this.active) return;
    this.active = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.watchNow();
  }

  stop() {
    this.active = false;
    this.last = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.clear();
  }

  watchNow() {
    if (this.watch !== null || document.visibilityState === "hidden") return;
    this.watch = navigator.geolocation.watchPosition(
      (p) => {
        this.last = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
          t: p.timestamp || Date.now(),
        };
        this.onFix(this.last);
      },
      (e) => {
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
        const kind = e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable";
        if (kind === "denied") this.stop();
        this.onError(kind);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  clear() {
    if (this.watch !== null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
  }

  visibility() {
    if (!this.active) return;
    if (document.visibilityState === "hidden") this.clear();
    else this.watchNow();
  }
}

/** GeoJSON polygon approximating a circle of `radius` metres. */
export function circlePolygon(lon, lat, radius, steps = 48) {
  const dLat = radius / 111_320;
  const dLon = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}
