package com.metranos.trainradar;

import android.Manifest;
import android.os.Build;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.TimeUnit;

/**
 * The app's own native bits (phase C5c), reached from web/js/native.js as
 * Capacitor.Plugins.TrainRadar: delay alerts in the background, in-app
 * notifications and the widget.
 */
@CapacitorPlugin(
        name = "TrainRadar",
        permissions = {@Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})})
public class TrainRadarPlugin extends Plugin {
    static final String WORK = "delay-alerts";

    /** Turn the 15-minute background check on or off. */
    @PluginMethod
    public void setAlerts(PluginCall call) {
        boolean on = call.getBoolean("enabled", false);
        WorkManager wm = WorkManager.getInstance(getContext());
        if (on) {
            Notifier.ensureChannel(getContext(), call.getString("lang", "es"));
            Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
            wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP,
                    new PeriodicWorkRequest.Builder(AlertsWorker.class, 15, TimeUnit.MINUTES).setConstraints(c).build());
        } else {
            wm.cancelUniqueWork(WORK);
        }
        call.resolve();
    }

    /** Ask for permission to notify (Android 13+); resolves {granted}. */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }

    /** A notification from the app while it is open (live alerts). */
    @PluginMethod
    public void notify(PluginCall call) {
        Notifier.show(getContext(), call.getString("trainNo", ""), call.getString("title", ""), call.getString("body", ""));
        call.resolve();
    }

    /** Redraw the widget soon (favourites or Pro changed). */
    @PluginMethod
    public void refreshWidget(PluginCall call) {
        Widget.refreshSoon(getContext());
        call.resolve();
    }
}
