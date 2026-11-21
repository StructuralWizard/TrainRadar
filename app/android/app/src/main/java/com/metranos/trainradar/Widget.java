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
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget (TrainRadar Pro): up to four favourite trains with their
 * delay, coloured like the map. Refreshed by AlertsWorker every 15 minutes
 * while a widget is on the home screen, and redrawn from the cached summary
 * when the app changes the favourites.
 *
 * Battery: onUpdate used to start a one-off WorkManager job every time. With
 * no other work scheduled, WorkManager toggles one of its components, the
 * launcher answers with another APPWIDGET_UPDATE, and so on: a loop that
 * downloaded the summary and redrew the widget non-stop (it flickered, and
 * its remove button came and went). Now a download happens only when the
 * cached summary is older than STALE_MS, and a periodic job is kept while a
 * widget exists, so WorkManager never has to toggle anything.
 */
public class Widget extends AppWidgetProvider {
    static final int[] ROWS = {R.id.row0, R.id.row1, R.id.row2, R.id.row3};
    static final int GREEN = Color.rgb(22, 163, 74);
    static final int AMBER = Color.rgb(217, 119, 6);
    static final int RED = Color.rgb(220, 38, 38);
    static final int GREY = Color.rgb(107, 114, 128);

    static final String PERIODIC = "widget-refresh";
    /** A cached summary younger than this is used as it is. */
    static final long STALE_MS = 10 * 60_000L;

    @Override
    public void onEnabled(Context ctx) {
        schedule(ctx);
    }

    @Override
    public void onDisabled(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(PERIODIC);
    }

    /** When the cached summary was downloaded (a string: the file is the
     * app's Capacitor Preferences, which only hold strings). */
    static long cachedAt(SharedPreferences p) {
        try {
            return Long.parseLong(p.getString("widget-summary-at", "0"));
        } catch (Exception e) {
            return 0;
        }
    }

    /** Every 15 minutes with a network, while a widget is on the home screen. */
    static void schedule(Context ctx) {
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
                new PeriodicWorkRequest.Builder(AlertsWorker.class, 15, TimeUnit.MINUTES).setConstraints(c).build());
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        // Widgets added before the periodic job existed (older versions).
        schedule(ctx);
        refreshSoon(ctx);
    }

    /** Redraw now from the cache; download only if the cache is stale. */
    static void refreshSoon(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(AlertsWorker.PREFS, Context.MODE_PRIVATE);
        boolean pro = AlertRules.isPro(p.getString("pro-entitlement", null), System.currentTimeMillis());
        try {
            render(ctx, new JSONArray(p.getString("widget-summary", "[]")), pro);
        } catch (Exception ignored) {
            render(ctx, null, pro);
        }
        if (!pro || System.currentTimeMillis() - cachedAt(p) < STALE_MS) return;
        WorkManager.getInstance(ctx).enqueueUniqueWork("widget-now", ExistingWorkPolicy.KEEP,
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
