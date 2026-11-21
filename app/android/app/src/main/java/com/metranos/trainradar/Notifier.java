package com.metranos.trainradar;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/** Delay notifications; tapping one opens the train in the app. */
final class Notifier {
    static final String CHANNEL = "delays";

    private Notifier() {}

    static void ensureChannel(Context ctx, String lang) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        String name = "en".equals(lang) ? "Delays of your trains" : "Retrasos de tus trenes";
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, name, NotificationManager.IMPORTANCE_DEFAULT));
    }

    static void show(Context ctx, String trainNo, String title, String body) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ensureChannel(ctx, "es");
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("trainradar://train/" + trainNo), ctx, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(ctx, trainNo.hashCode(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_train)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(pi)
                .setAutoCancel(true);
        NotificationManagerCompat.from(ctx).notify(("train:" + trainNo).hashCode(), b.build());
    }

    /** A saved journey's alert (plan journeys J4): one notification per
     * event (`key`), the whole text shown; a tap opens the train. */
    static void showJourney(Context ctx, String key, String trainNo, String title, String body) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ensureChannel(ctx, "es");
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("trainradar://train/" + Uri.encode(trainNo)), ctx, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(ctx, key.hashCode(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_train)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pi)
                .setAutoCancel(true);
        NotificationManagerCompat.from(ctx).notify(("journey:" + key).hashCode(), b.build());
    }
}
