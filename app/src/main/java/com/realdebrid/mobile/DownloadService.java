package com.realdebrid.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import java.util.Locale;

/** Keeps downloads running when the app is in the background and shows their progress. */
public class DownloadService extends Service {

    private static final String CHANNEL = "downloads";
    private static volatile DownloadService live;

    static void start(Context c) {
        try {
            Intent i = new Intent(c, DownloadService.class);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception ignored) { }
    }

    static void refresh(Context c) {
        DownloadService s = live;
        if (s != null) s.update();
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW));
            }
        }
    }

    static void notifyDone(Context c, String name) {
        try {
            ensureChannel(c);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle("Download complete")
                    .setContentText(name)
                    .setAutoCancel(true)
                    .setContentIntent(openApp(c));
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify((int) (2000 + (System.nanoTime() / 1000) % 100000), b.build());
        } catch (Exception ignored) { }
    }

    private static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        live = this;
        ensureChannel(this);
        Notification n = build(DownloadEngine.get(this).summary());
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(1, n);
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        update();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        live = null;
        super.onDestroy();
    }

    private void update() {
        DownloadEngine.Summary s = DownloadEngine.get(this).summary();
        if (s.active == 0 && s.queued == 0) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(1, build(s));
    }

    private Notification build(DownloadEngine.Summary s) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        int pct = s.total > 0 ? (int) Math.min(100, s.done * 100 / s.total) : 0;
        String title = s.active > 1 ? s.active + " downloads" : (s.active == 1 ? s.firstName : "Downloads waiting");
        String text = s.active == 0 ? s.queued + " in the queue"
                : pct + "%  \u00B7  " + String.format(Locale.US, "%.1f MB/s", s.speed / 1048576.0)
                + (s.queued > 0 ? "  \u00B7  " + s.queued + " waiting" : "");
        b.setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(text)
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setContentIntent(openApp(this));
        if (s.total > 0) b.setProgress(100, pct, false);
        else b.setProgress(0, 0, true);
        return b.build();
    }
}
