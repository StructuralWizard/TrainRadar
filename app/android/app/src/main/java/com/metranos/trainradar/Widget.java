package com.metranos.trainradar;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.widget.RemoteViews;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget (TrainRadar Pro): up to four favourite trains with their
 * delay, coloured like the map. Refreshed by AlertsWorker (every 15 min) and
 * when the app changes the favourites.
 */
public class Widget extends AppWidgetProvider {
    static final int[] ROWS = {R.id.row0, R.id.row1, R.id.row2, R.id.row3};
    static final int GREEN = Color.rgb(22, 163, 74);
    static final int AMBER = Color.rgb(217, 119, 6);
    static final int RED = Color.rgb(220, 38, 38);
    static final int GREY = Color.rgb(107, 114, 128);

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        SharedPreferences p = ctx.getSharedPreferences(AlertsWorker.PREFS, Context.MODE_PRIVATE);
        boolean pro = AlertRules.isPro(p.getString("pro-entitlement", null), System.currentTimeMillis());
        JSONArray cached = null;
        try {
            cached = new JSONArray(p.getString("widget-summary", "[]"));
        } catch (Exception ignored) {
            // nothing cached yet
        }
        render(ctx, cached, pro);
        refreshSoon(ctx);
    }

    static void refreshSoon(Context ctx) {
        WorkManager.getInstance(ctx).enqueueUniqueWork("widget-now", ExistingWorkPolicy.REPLACE,
                new OneTimeWorkRequest.Builder(AlertsWorker.class).build());
    }

    static void render(Context ctx, JSONArray summary, boolean pro) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, Widget.class));
        if (ids.length == 0) return;
        SharedPreferences p = ctx.getSharedPreferences(AlertsWorker.PREFS, Context.MODE_PRIVATE);
        String lang = "es";
        try {
            lang = new JSONObject(p.getString("alert-config", "{}")).optString("lang", "es");
        } catch (Exception ignored) {
            // default
        }
        boolean en = "en".equals(lang);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_favourites);
        Intent open = new Intent(ctx, MainActivity.class);
        v.setOnClickPendingIntent(R.id.widget_root,
                PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE));
        for (int r : ROWS) v.setTextViewText(r, "");
        if (!pro) {
            v.setTextViewText(R.id.row0, en ? "The widget is part of TrainRadar Pro." : "El widget es parte de TrainRadar Pro.");
            v.setTextColor(R.id.row0, GREY);
        } else {
            int row = 0;
            try {
                JSONArray favs = new JSONArray(p.getString("favourites", "[]"));
                for (int i = 0; i < favs.length() && row < ROWS.length; i++) {
                    JSONObject f = favs.optJSONObject(i);
                    if (f == null || !"train".equals(f.optString("type"))) continue;
                    String no = AlertRules.number(f.optString("number"));
                    JSONObject t = summary == null ? null : AlertRules.find(summary, no);
                    String state;
                    int color;
                    if (t == null) {
                        state = en ? "not running" : "no circula";
                        color = GREY;
                    } else if ("cancelled".equals(t.optString("status"))) {
                        state = en ? "cancelled" : "cancelado";
                        color = RED;
                    } else if (t.isNull("delayMin")) {
                        state = "—";
                        color = GREY;
                    } else {
                        int d = t.optInt("delayMin");
                        state = d <= 0 ? (en ? "on time" : "a su hora") : "+" + d + " min";
                        color = d < 5 ? GREEN : d < 15 ? AMBER : RED;
                    }
                    v.setTextViewText(ROWS[row], f.optString("label", no) + "  " + state);
                    v.setTextColor(ROWS[row], color);
                    row++;
                }
            } catch (Exception ignored) {
                // leave the rows empty
            }
            if (row == 0) {
                v.setTextViewText(R.id.row0, en ? "Save trains with ☆ to see them here." : "Guarda trenes con ☆ para verlos aquí.");
                v.setTextColor(R.id.row0, GREY);
            }
        }
        mgr.updateAppWidget(ids, v);
    }
}
