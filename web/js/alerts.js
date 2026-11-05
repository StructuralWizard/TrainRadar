// Delay alerts (TrainRadar Pro, phase C5c): which favourite trains crossed
// a threshold since the last check. The same rules run natively in the
// background every 15 min (app/android/…/AlertRules.java, same tests); this
// copy checks while the app is open, from the live engine. Both share the
// stored state, so a train is notified once per level and day.

export const ALERT_CONFIG_KEY = "alert-config";
export const ALERT_STATE_KEY = "alert-state";
export const MINOR = 5;
export const MAJOR = 15;

const num = (s) => String(s ?? "").replace(/^0+/, "");

/** 0 on time, 1 minor, 2 major, 3 cancelled. `t`: {delayMin, status}. */
export function alertLevel(t, minor = MINOR, major = MAJOR) {
  if (t.status === "cancelled") return 3;
  if (t.delayMin === null || t.delayMin === undefined) return 0;
  return t.delayMin >= major ? 2 : t.delayMin >= minor ? 1 : 0;
}

export function alertText(lang, level, delayMin) {
  if (level === 3) return lang === "en" ? "Cancelled" : "Cancelado";
  return lang === "en" ? `${delayMin} min late` : `${delayMin} min de retraso`;
}

/**
 * `trains`: trainNo → {delayMin, status} (summary.json rows, or the live
 * engine's). Returns `{ alerts: [{trainNo, title, body, level}], state }`.
 */
export function decideAlerts(favourites, trains, state, day, { minor = MINOR, major = MAJOR, lang = "es" } = {}) {
  const st = state?.day === day ? { day, levels: { ...(state.levels || {}) } } : { day, levels: {} };
  const alerts = [];
  for (const f of favourites) {
    if (f.type !== "train") continue;
    const no = num(f.number);
    const t = trains.get(no);
    if (!t) continue;
    const lv = alertLevel(t, minor, major);
    if (lv > (st.levels[no] || 0)) {
      st.levels[no] = lv;
      alerts.push({ trainNo: no, level: lv, title: f.label || no, body: alertText(lang, lv, t.delayMin) });
    }
  }
  return { alerts, state: st };
}

/** From the engine's popup info to the summary's shape. */
export function liveState(info) {
  return {
    delayMin: info.delay === null || info.delay === undefined ? null : Math.round(info.delay / 60),
    status: info.canceled ? "cancelled" : "running",
  };
}
