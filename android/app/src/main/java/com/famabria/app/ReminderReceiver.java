package com.famabria.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Shows the notification of a reminder when its alarm fires. Tapping it opens the app. */
public class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL = "reminders";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String id = intent.getStringExtra("id");
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        if (id == null) return;

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, ctx.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH));
        }
        PendingIntent open = PendingIntent.getActivity(ctx, 0, new Intent(ctx, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title == null || title.isEmpty() ? ctx.getString(R.string.app_name) : title)
                .setContentText(body == null ? "" : body)
                .setContentIntent(open)
                .setAutoCancel(true);
        // Without the notification permission (Android 13+) this silently does nothing.
        nm.notify(id.hashCode(), b.build());
        Reminders.forget(ctx, id);
    }
}
