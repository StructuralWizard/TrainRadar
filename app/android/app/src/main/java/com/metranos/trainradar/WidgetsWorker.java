package com.metranos.trainradar;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.net.Uri;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Downloads what the list widgets show, once per station, train and for the
 * notices however many widgets share them, from TrainRadar's live API
 * (backend/src/widgets.js): every 15 minutes while a widget exists, or now
 * with ↻ (at most once a minute). One GET per item of public data; nothing
 * is sent about the user. Only with TrainRadar Pro.
 */
public class WidgetsWorker extends Worker {
    static final String PERIODIC = "list-widgets-refresh";
    static final String NOW = "list-widgets-now";
    /** Older than this, data is downloaded again when a widget is drawn. */
    static final long STALE_MS = 10 * 60_000L;

    public WidgetsWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    static void schedule(Context ctx) {
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
                new PeriodicWorkRequest.Builder(WidgetsWorker.class, 15, TimeUnit.MINUTES).setConstraints(c).build());
    }

    static void cancel(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(PERIODIC);
    }

    /** ↻: download now, unless that happened in the last minute. */
    static void refreshNow(Context ctx) {
        if (System.currentTimeMillis() - WidgetStore.prefs(ctx).getLong("last-run", 0) < 60_000L) return;
        enqueue(ctx);
    }

    static void refreshIfStale(Context ctx) {
        if (System.currentTimeMillis() - WidgetStore.prefs(ctx).getLong("last-run", 0) < STALE_MS) return;
        enqueue(ctx);
    }

    private static void enqueue(Context ctx) {
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP,
                new OneTimeWorkRequest.Builder(WidgetsWorker.class).setConstraints(c).build());
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        String api = WidgetStore.appConfig(ctx).optString("apiBase", "");
        if (!WidgetStore.pro(ctx) || !api.startsWith("https://")) {
            ListWidget.renderAll(ctx);
            return Result.success();
        }
        if (!api.endsWith("/")) api += "/";
        WidgetStore.prefs(ctx).edit().putLong("last-run", System.currentTimeMillis()).apply();
        // What the widgets on the home screen need, each item once.
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        Set<String> keys = new LinkedHashSet<>();
        for (int id : ListWidget.allIds(ctx)) {
            String kind = ListWidget.kindOf(mgr.getAppWidgetInfo(id));
            JSONObject cfg = WidgetStore.config(ctx, id);
            if (kind.isEmpty() || (!WidgetStore.NOTICES.equals(kind) && cfg.optString("id").isEmpty())) continue;
            keys.add(ListWidget.dataKey(kind, cfg));
        }
        boolean failed = false;
        for (String key : keys) {
            String path = key.equals("notices") ? "v1/live/notices"
                    : key.startsWith("train:") ? "v1/live/train/" + Uri.encode(key.substring(6))
                    : "v1/live/board/" + Uri.encode(key.substring(6));
            try {
                String body = AlertsWorker.get(api + path);
                new JSONObject(body); // only well-formed JSON is kept
                WidgetStore.putCached(ctx, key, body);
            } catch (Exception e) {
                failed = true; // keep what we had
            }
        }
        ListWidget.renderAll(ctx);
        return failed && getRunAttemptCount() < 2 ? Result.retry() : Result.success();
    }
}
