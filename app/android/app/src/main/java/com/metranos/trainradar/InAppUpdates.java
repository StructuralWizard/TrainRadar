package com.metranos.trainradar;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * Google Play in-app updates. Each time the app comes to the front it asks
 * Play whether a newer version is out for this user's track (testers get
 * test releases first):
 *
 * <ul>
 *   <li>An update marked high priority (4–5, set when the release is sent
 *       to Play through its API) is <b>immediate</b>: Play's full-screen
 *       prompt, the app waits until it's installed.
 *   <li>Any other is <b>flexible</b>: Play asks once, downloads in the
 *       background while TrainRadar keeps working, and a small dialog offers
 *       to restart when it's ready. A "no" is respected for a few days.
 * </ul>
 *
 * Outside Play (debug builds, the emulator test, sideloaded APKs) Play
 * answers with an error and nothing happens.
 */
final class InAppUpdates {
    private static final String TAG = "TrainRadarUpdates";
    private static final String PREFS = "in_app_updates";
    /** Priority (0–5) from which an update is mandatory. */
    static final int IMMEDIATE_PRIORITY = 4;
    /** Days before a declined flexible update is offered again. */
    static final int ASK_AGAIN_DAYS = 3;

    private final AppCompatActivity activity;
    private final AppUpdateManager manager;
    private final ActivityResultLauncher<IntentSenderRequest> launcher;
    private final InstallStateUpdatedListener listener;
    private AlertDialog restartDialog;
    private int offeredVersion = -1;

    /** Call from onCreate (before the activity starts): it registers for results. */
    InAppUpdates(AppCompatActivity activity) {
        this.activity = activity;
        this.manager = AppUpdateManagerFactory.create(activity);
        this.launcher =
                activity.registerForActivityResult(
                        new ActivityResultContracts.StartIntentSenderForResult(),
                        result -> {
                            // Declined (or failed): don't ask again for a while.
                            if (result.getResultCode() != AppCompatActivity.RESULT_OK && offeredVersion > 0) {
                                rememberDeclined(offeredVersion);
                            }
                        });
        this.listener =
                state -> {
                    if (state.installStatus() == InstallStatus.DOWNLOADED) offerRestart();
                };
        manager.registerListener(listener);
    }

    /** Call from onResume: check Play, and finish whatever is in progress. */
    void check() {
        manager.getAppUpdateInfo()
                .addOnSuccessListener(this::handle)
                .addOnFailureListener(e -> Log.i(TAG, "no update check: " + e.getMessage()));
    }

    /** Call from onDestroy. */
    void close() {
        manager.unregisterListener(listener);
        if (restartDialog != null) restartDialog.dismiss();
    }

    private void handle(AppUpdateInfo info) {
        // A flexible update already downloaded: offer the restart again.
        if (info.installStatus() == InstallStatus.DOWNLOADED) {
            offerRestart();
            return;
        }
        int availability = info.updateAvailability();
        // An immediate update the user left: Play requires resuming it.
        if (availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
            start(info, AppUpdateType.IMMEDIATE);
            return;
        }
        if (availability != UpdateAvailability.UPDATE_AVAILABLE) return;
        int type = chooseType(info.updatePriority(), info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE), info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE));
        if (type < 0) return;
        if (type == AppUpdateType.FLEXIBLE && recentlyDeclined(info.availableVersionCode())) return;
        start(info, type);
    }

    /** Immediate for high-priority updates, else flexible; -1 if neither is allowed. */
    static int chooseType(int priority, boolean immediateAllowed, boolean flexibleAllowed) {
        if (priority >= IMMEDIATE_PRIORITY && immediateAllowed) return AppUpdateType.IMMEDIATE;
        if (flexibleAllowed) return AppUpdateType.FLEXIBLE;
        return -1;
    }

    private void start(AppUpdateInfo info, int type) {
        offeredVersion = info.availableVersionCode();
        try {
            manager.startUpdateFlowForResult(info, launcher, AppUpdateOptions.newBuilder(type).build());
        } catch (RuntimeException e) {
            Log.w(TAG, "update flow", e);
        }
    }

    /** "Update downloaded. Restart TrainRadar to use it." */
    private void offerRestart() {
        if (activity.isFinishing() || (restartDialog != null && restartDialog.isShowing())) return;
        restartDialog =
                new AlertDialog.Builder(activity)
                        .setTitle(R.string.update_ready_title)
                        .setMessage(R.string.update_ready_message)
                        .setPositiveButton(R.string.update_restart, (d, w) -> manager.completeUpdate())
                        .setNegativeButton(R.string.update_later, null)
                        .show();
    }

    private SharedPreferences prefs() {
        return activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void rememberDeclined(int version) {
        prefs().edit().putInt("declined_version", version).putLong("declined_at", System.currentTimeMillis()).apply();
    }

    private boolean recentlyDeclined(int version) {
        SharedPreferences p = prefs();
        return p.getInt("declined_version", -1) == version
                && System.currentTimeMillis() - p.getLong("declined_at", 0) < ASK_AGAIN_DAYS * 24L * 3600 * 1000;
    }
}
