package com.metranos.trainradar;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Every 15 minutes (WorkManager, only with a network): read rt/summary.json
 * from the live bucket, notify the favourite trains that crossed a delay
 * threshold, and refresh the widget. Nothing is sent anywhere: one GET of a
 * public file, the same for every user.
 */
public class AlertsWorker extends Worker {
    /** Capacitor Preferences' file: the app's settings and favourites. */
    static final String PREFS = "CapacitorStorage";
    static final int MAX_BYTES = 2_000_000;

    public AlertsWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONObject cfg = new JSONObject(p.getString("alert-config", "{}"));
            boolean pro = AlertRules.isPro(p.getString("pro-entitlement", null), System.currentTimeMillis());
            String base = cfg.optString("liveBase", "");
            if (!pro || !base.startsWith("https://")) {
                Widget.render(ctx, null, pro);
                return Result.success();
            }
            JSONArray summary = new JSONArray(get(base + "summary.json"));
            p.edit().putString("widget-summary", summary.toString()).apply();
            Widget.render(ctx, summary, true);
            if (!cfg.optBoolean("enabled")) return Result.success();
            JSONArray favs = new JSONArray(p.getString("favourites", "[]"));
            JSONObject state = new JSONObject(p.getString("alert-state", "{}"));
            List<AlertRules.Alert> alerts = AlertRules.decide(favs, summary, state, today(),
                    cfg.optInt("minor", 5), cfg.optInt("major", 15), cfg.optString("lang", "es"));
            p.edit().putString("alert-state", state.toString()).apply();
            for (AlertRules.Alert a : alerts) Notifier.show(ctx, a.trainNo, a.title, a.body);
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    static String today() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));
        return f.format(new Date());
    }

    static String get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10_000);
        c.setReadTimeout(10_000);
        try (InputStream in = c.getInputStream()) {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) throw new Exception("summary too large");
            }
            return out.toString(StandardCharsets.UTF_8.name());
        } finally {
            c.disconnect();
        }
    }
}
