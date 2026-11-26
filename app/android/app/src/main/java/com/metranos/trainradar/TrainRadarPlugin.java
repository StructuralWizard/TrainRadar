package com.metranos.trainradar;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.telephony.TelephonyManager;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * The app's own native bits (phase C5c), reached from web/js/native.js as
 * Capacitor.Plugins.TrainRadar: delay alerts in the background, in-app
 * notifications, the widget, and home-screen shortcuts (TrainRadar Pro: an
 * icon that opens a favourite station, train or commute, and the app icon's
 * long-press menu).
 */
@CapacitorPlugin(
        name = "TrainRadar",
        permissions = {@Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})})
public class TrainRadarPlugin extends Plugin {
    static final String WORK = "delay-alerts";

    /**
     * The phone's country, for the first map the app opens: the SIM's
     * country (where the phone's line was bought), else the mobile network's
     * (where it is now), else the language setting's region. Two-letter
     * lower-case code, or "" when none is known. Nothing leaves the phone.
     */
    @PluginMethod
    public void deviceCountry(PluginCall call) {
        String cc = "";
        try {
            TelephonyManager tm = (TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
            if (tm != null) {
                cc = tm.getSimCountryIso();
                if (cc == null || cc.length() != 2) cc = tm.getNetworkCountryIso();
            }
        } catch (RuntimeException e) {
            cc = "";
        }
        if (cc == null || cc.length() != 2) cc = Locale.getDefault().getCountry();
        JSObject r = new JSObject();
        r.put("country", cc == null || cc.length() != 2 ? "" : cc.toLowerCase(Locale.ROOT));
        call.resolve(r);
    }

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

    /** Only the app's own links: trainradar://station|train|commute/… */
    static boolean ourLink(String url) {
        return url != null && url.matches("trainradar://(station|train|commute)/[a-z]{2}/[A-Za-z0-9._%:-]{1,80}");
    }

    static IconCompat iconFor(Context ctx, String kind) {
        int res = "train".equals(kind) ? R.drawable.ic_shortcut_train
                : "commute".equals(kind) ? R.drawable.ic_shortcut_commute
                : R.drawable.ic_shortcut_station;
        return IconCompat.createWithResource(ctx, res);
    }

    static ShortcutInfoCompat shortcut(Context ctx, String id, String label, String url, String kind) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url), ctx, MainActivity.class);
        String text = label == null || label.isEmpty() ? "TrainRadar" : label;
        return new ShortcutInfoCompat.Builder(ctx, id)
                .setShortLabel(text.length() > 24 ? text.substring(0, 24) : text)
                .setLongLabel(text)
                .setIcon(iconFor(ctx, kind))
                .setIntent(open)
                .build();
    }

    /** Ask the launcher for a home-screen icon; resolves {pinned}. */
    @PluginMethod
    public void pinShortcut(PluginCall call) {
        Context ctx = getContext();
        String url = call.getString("url", "");
        String id = call.getString("id", "");
        JSObject r = new JSObject();
        if (!ourLink(url) || id.isEmpty() || !ShortcutManagerCompat.isRequestPinShortcutSupported(ctx)) {
            r.put("pinned", false);
            call.resolve(r);
            return;
        }
        boolean ok = ShortcutManagerCompat.requestPinShortcut(ctx,
                shortcut(ctx, id, call.getString("label", ""), url, call.getString("kind", "station")), null);
        r.put("pinned", ok);
        call.resolve(r);
    }

    /** The app icon's long-press menu: up to four favourites ([] clears it). */
    @PluginMethod
    public void setShortcuts(PluginCall call) {
        Context ctx = getContext();
        JSArray items = call.getArray("items", new JSArray());
        List<ShortcutInfoCompat> list = new ArrayList<>();
        int max = Math.min(4, ShortcutManagerCompat.getMaxShortcutCountPerActivity(ctx));
        for (int i = 0; i < items.length() && list.size() < max; i++) {
            JSONObject o = items.optJSONObject(i);
            if (o == null || !ourLink(o.optString("url")) || o.optString("id").isEmpty()) continue;
            list.add(shortcut(ctx, o.optString("id"), o.optString("label"), o.optString("url"), o.optString("kind")));
        }
        try {
            ShortcutManagerCompat.setDynamicShortcuts(ctx, list);
        } catch (RuntimeException e) {
            // Rate-limited by the launcher: the next change tries again.
        }
        call.resolve();
    }

    /** Redraw the widgets (favourites, Pro or the language changed). */
    @PluginMethod
    public void refreshWidget(PluginCall call) {
        Widget.refreshSoon(getContext());
        ListWidget.renderAll(getContext());
        if (!ListWidget.allIds(getContext()).isEmpty()) WidgetsWorker.refreshIfStale(getContext());
        call.resolve();
    }
}
