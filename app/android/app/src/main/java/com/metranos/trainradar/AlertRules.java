package com.metranos.trainradar;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Delay alerts (TrainRadar Pro, phase C5c), as pure logic so it can be
 * unit-tested: which favourite trains crossed a threshold since the last
 * check. Same rules as web/js/alerts.js (the in-app check).
 *
 * Levels: 0 on time, 1 minor (≥ minor min), 2 major (≥ major min),
 * 3 cancelled. A train is notified when its level rises above the highest
 * level already notified today, so a train hovering around a threshold
 * notifies once.
 */
public final class AlertRules {
    private AlertRules() {}

    public static final class Alert {
        public final String trainNo;
        public final int level;
        public final String title;
        public final String body;

        Alert(String trainNo, int level, String title, String body) {
            this.trainNo = trainNo;
            this.level = level;
            this.title = title;
            this.body = body;
        }
    }

    static String number(String s) {
        return s == null ? "" : s.replaceFirst("^0+", "");
    }

    public static int level(JSONObject train, int minor, int major) {
        if ("cancelled".equals(train.optString("status"))) return 3;
        if (train.isNull("delayMin")) return 0;
        int d = train.optInt("delayMin", 0);
        return d >= major ? 2 : d >= minor ? 1 : 0;
    }

    /**
     * @param favourites the app's favourites (JSON array, as stored)
     * @param summary rt/summary.json
     * @param state the alert state as stored: {"day": "...", "levels": {trainNo: level}}
     *     — updated in place
     */
    public static List<Alert> decide(JSONArray favourites, JSONArray summary, JSONObject state, String day,
            int minor, int major, String lang) throws JSONException {
        if (!day.equals(state.optString("day"))) {
            state.put("day", day);
            state.put("levels", new JSONObject());
        }
        JSONObject levels = state.optJSONObject("levels");
        if (levels == null) {
            levels = new JSONObject();
            state.put("levels", levels);
        }
        List<Alert> out = new ArrayList<>();
        for (int i = 0; i < favourites.length(); i++) {
            JSONObject f = favourites.optJSONObject(i);
            if (f == null || !"train".equals(f.optString("type"))) continue;
            String no = number(f.optString("number"));
            JSONObject t = find(summary, no);
            if (t == null) continue;
            int lv = level(t, minor, major);
            int before = levels.optInt(no, 0);
            if (lv > before) {
                levels.put(no, lv);
                String label = f.optString("label", no);
                out.add(new Alert(no, lv, label, text(lang, lv, t.optInt("delayMin", 0))));
            }
        }
        return out;
    }

    static JSONObject find(JSONArray summary, String no) {
        for (int i = 0; i < summary.length(); i++) {
            JSONObject t = summary.optJSONObject(i);
            if (t != null && number(t.optString("trainNo")).equals(no)) return t;
        }
        return null;
    }

    static String text(String lang, int level, int delayMin) {
        boolean en = "en".equals(lang);
        if (level == 3) return en ? "Cancelled" : "Cancelado";
        return en ? String.format(Locale.ROOT, "%d min late", delayMin)
                : String.format(Locale.ROOT, "%d min de retraso", delayMin);
    }

    /** Pro from the app's cached entitlement (see web/js/entitlement.js): a
     * Play answer cached up to 7 days. */
    public static boolean isPro(String entitlementJson, long nowMs) {
        if (entitlementJson == null) return false;
        try {
            JSONObject e = new JSONObject(entitlementJson);
            return e.optBoolean("pro") && nowMs - e.optLong("checkedAt") <= 7L * 86_400_000L;
        } catch (JSONException ex) {
            return false;
        }
    }
}
