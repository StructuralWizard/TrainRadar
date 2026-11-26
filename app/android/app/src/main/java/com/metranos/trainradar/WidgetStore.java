package com.metranos.trainradar;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What each TrainRadar Pro widget shows (its own station or train, chosen
 * when it was added) and the last data downloaded for it. Kept in the
 * widgets' own preferences file, apart from the app's Capacitor
 * Preferences (which the app reads and backs up).
 */
final class WidgetStore {
    static final String FILE = "trainradar-widgets";
    static final String DEP = "dep";
    static final String ARR = "arr";
    static final String TRAIN = "train";
    static final String NOTICES = "notices";

    private WidgetStore() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** The app's Capacitor Preferences (favourites, Pro, settings). */
    static SharedPreferences app(Context ctx) {
        return ctx.getSharedPreferences(AlertsWorker.PREFS, Context.MODE_PRIVATE);
    }

    /** {kind, id, name}: a station (dep/arr) or train (id = number). */
    static JSONObject config(Context ctx, int widgetId) {
        try {
            return new JSONObject(prefs(ctx).getString("w:" + widgetId, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static void setConfig(Context ctx, int widgetId, String kind, String id, String name) {
        JSONObject c = new JSONObject();
        try {
            c.put("kind", kind).put("id", id).put("name", name);
        } catch (Exception ignored) {
            // can't happen with strings
        }
        prefs(ctx).edit().putString("w:" + widgetId, c.toString()).apply();
    }

    static void remove(Context ctx, int[] widgetIds) {
        SharedPreferences.Editor e = prefs(ctx).edit();
        for (int id : widgetIds) e.remove("w:" + id);
        e.apply();
    }

    static String cached(Context ctx, String key) {
        return prefs(ctx).getString("data:" + key, null);
    }

    static void putCached(Context ctx, String key, String json) {
        prefs(ctx).edit().putString("data:" + key, json).putLong("at:" + key, System.currentTimeMillis()).apply();
    }

    static long cachedAt(Context ctx, String key) {
        return prefs(ctx).getLong("at:" + key, 0);
    }

    static boolean pro(Context ctx) {
        return AlertRules.isPro(app(ctx).getString("pro-entitlement", null), System.currentTimeMillis());
    }

    /** {lang, apiBase} written by the app (web/main.js writeWidgetConfig). */
    static JSONObject appConfig(Context ctx) {
        try {
            return new JSONObject(app(ctx).getString("widget-config", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static boolean english(Context ctx) {
        return "en".equals(lang(ctx));
    }

    /** The app's language: es, en, pt or ja (Tr.pick). */
    static String lang(Context ctx) {
        return appConfig(ctx).optString("lang", "es");
    }

    /** Favourite stations or trains, in the order sorted in Favoritos. */
    static JSONArray favourites(Context ctx, String type) {
        JSONArray out = new JSONArray();
        try {
            JSONArray all = new JSONArray(app(ctx).getString("favourites", "[]"));
            for (int i = 0; i < all.length(); i++) {
                JSONObject f = all.optJSONObject(i);
                if (f != null && type.equals(f.optString("type"))) out.put(f);
            }
        } catch (Exception ignored) {
            // none
        }
        return out;
    }
}
