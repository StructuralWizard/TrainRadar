package com.metranos.trainradar;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
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
            p.edit().putString("widget-summary", summary.toString())
                    .putString("widget-summary-at", String.valueOf(System.currentTimeMillis())).apply();
            Widget.render(ctx, summary, true);
            if (!cfg.optBoolean("enabled")) return Result.success();
            JSONArray favs = new JSONArray(p.getString("favourites", "[]"));
            JSONObject state = new JSONObject(p.getString("alert-state", "{}"));
            List<AlertRules.Alert> alerts = AlertRules.decide(favs, summary, state, today(),
                    cfg.optInt("minor", 5), cfg.optInt("major", 15), cfg.optString("lang", "es"));
            p.edit().putString("alert-state", state.toString()).apply();
            for (AlertRules.Alert a : alerts) Notifier.show(ctx, a.trainNo, a.title, a.body);
            try {
                journeys(ctx, p, summary, cfg.optString("lang", "es"));
            } catch (Exception e) {
                // a saved journey's check failing mustn't retry the favourites'
            }
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    /** Saved journeys' alerts (plan journeys J4): Spain's commutes only. */
    static void journeys(Context ctx, SharedPreferences p, JSONArray summary, String lang) throws Exception {
        long now = System.currentTimeMillis();
        List<JourneyRules.Active> active = JourneyRules.active(new JSONObject(p.getString("commute", "{}")), now);
        if (active.isEmpty()) return;
        String api = WidgetStore.appConfig(ctx).optString("apiBase", "");
        if (!api.startsWith("https://")) api = "";
        // Each train's run from its station, until it leaves (then the
        // summary has it); the notices only if some journey wants them.
        List<JSONObject[]> runs = new ArrayList<>();
        boolean wantNotices = false;
        for (JourneyRules.Active j : active) {
            JSONObject[] r = new JSONObject[j.legs.length()];
            for (int i = 0; i < r.length && !api.isEmpty(); i++) {
                if (now > j.dep[i] + 5 * JourneyRules.MIN) continue;
                JSONObject l = j.legs.getJSONObject(i);
                try {
                    r[i] = new JSONObject(get(api + "v1/live/run/" + Uri.encode(l.optString("from")) + "/" + Uri.encode(l.optString("number"))));
                } catch (Exception e) {
                    r[i] = null; // the summary may still have it
                }
            }
            runs.add(r);
            wantNotices |= j.notify("stations");
        }
        JSONArray notices = null;
        if (wantNotices && !api.isEmpty()) {
            try {
                notices = new JSONObject(get(api + "v1/live/notices/all")).optJSONArray("notices");
            } catch (Exception e) {
                notices = null;
            }
        }
        JSONObject state = new JSONObject(p.getString("journey-alert-state", "{}"));
        List<JourneyRules.Alert> alerts = JourneyRules.decide(active, runs, summary, notices, state, now, lang);
        p.edit().putString("journey-alert-state", state.toString()).apply();
        for (JourneyRules.Alert a : alerts) Notifier.showJourney(ctx, a.key, a.trainNo, a.title, a.body);
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
