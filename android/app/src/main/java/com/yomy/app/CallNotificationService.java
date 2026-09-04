package com.yomy.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.content.pm.ServiceInfo;

public class CallNotificationService extends Service {
    public static final String ACTION_START = "com.yomy.app.CALL_RING_START";
    public static final String ACTION_STOP = "com.yomy.app.CALL_RING_STOP";
    public static final String EXTRA_CALL_ID = "call_id";
    public static final String EXTRA_TITLE = "call_title";
    public static final String EXTRA_BODY = "call_body";
    public static final String EXTRA_KIND = "call_kind";

    private static final String CHANNEL_ID = "yomy_calls_v2";
    private static final int NOTIFICATION_ID = 41001;
    private static final long RING_DURATION_MS = 60_000L;
    private static final long[] VIBRATION_PATTERN = {0L, 900L, 500L, 900L, 500L};

    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaPlayer ringtonePlayer;
    private Vibrator vibrator;
    private String activeCallId;
    private final Runnable timeout = this::stopRinging;

    public static void start(Context context, String callId, String title, String body, String kind) {
        Intent i = new Intent(context, CallNotificationService.class)
                .setAction(ACTION_START)
                .putExtra(EXTRA_CALL_ID, callId)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_BODY, body)
                .putExtra(EXTRA_KIND, kind);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i);
        else context.startService(i);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopRinging();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action)) return START_NOT_STICKY;

        activeCallId = intent.getStringExtra(EXTRA_CALL_ID);
        String title = safe(intent.getStringExtra(EXTRA_TITLE), "Yomy");
        String body = safe(intent.getStringExtra(EXTRA_BODY), "Incoming call");
        String kind = safe(intent.getStringExtra(EXTRA_KIND), "voice");

        handler.removeCallbacks(timeout);
        stopPlaybackOnly();
        ensureChannel();
        Notification notification = buildNotification(title, body, kind, activeCallId);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception ignored) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startPlaybackRespectingSystemMode();
        handler.postDelayed(timeout, RING_DURATION_MS);
        return START_NOT_STICKY;
    }

    private Notification buildNotification(String title, String body, String kind, String callId) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;

        PendingIntent open = PendingIntent.getBroadcast(this, 41002, actionIntent(CallActionReceiver.ACTION_OPEN, callId), flags);
        PendingIntent decline = PendingIntent.getBroadcast(this, 41003, actionIntent(CallActionReceiver.ACTION_DECLINE, callId), flags);

        builder.setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(Notification.CATEGORY_CALL)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .setShowWhen(true)
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "فتح المكالمة", open).build())
                .addAction(new Notification.Action.Builder(null, "إلغاء", decline).build());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) builder.setTimeoutAfter(RING_DURATION_MS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return builder.build();
    }

    private Intent actionIntent(String action, String callId) {
        return new Intent(this, CallActionReceiver.class)
                .setAction(action)
                .putExtra(CallActionReceiver.EXTRA_CALL_ID, callId);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Yomy Calls", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Incoming Yomy calls");
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    private void startPlaybackRespectingSystemMode() {
        try {
            AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audio == null) return;
            int mode = audio.getRingerMode();
            if (mode == AudioManager.RINGER_MODE_SILENT) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null && nm.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL) return;
            }
            if (mode == AudioManager.RINGER_MODE_NORMAL) playDefaultRingtone();
            if (mode == AudioManager.RINGER_MODE_NORMAL || mode == AudioManager.RINGER_MODE_VIBRATE) startVibration();
        } catch (Exception ignored) {}
    }

    private void playDefaultRingtone() {
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            ringtonePlayer = new MediaPlayer();
            ringtonePlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            ringtonePlayer.setDataSource(this, uri);
            ringtonePlayer.setLooping(true);
            ringtonePlayer.prepare();
            ringtonePlayer.start();
        } catch (Exception ignored) {
            stopPlaybackOnly();
        }
    }

    private void startVibration() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vm == null ? null : vm.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION_PATTERN, 0));
            else vibrator.vibrate(VIBRATION_PATTERN, 0);
        } catch (Exception ignored) {}
    }

    private void stopPlaybackOnly() {
        handler.removeCallbacks(timeout);
        if (ringtonePlayer != null) {
            try { if (ringtonePlayer.isPlaying()) ringtonePlayer.stop(); } catch (Exception ignored) {}
            try { ringtonePlayer.release(); } catch (Exception ignored) {}
            ringtonePlayer = null;
        }
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
            vibrator = null;
        }
    }

    private void stopRinging() {
        stopPlaybackOnly();
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.cancel(NOTIFICATION_ID);
        } catch (Exception ignored) {}
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) {}
        stopSelf();
    }

    private static String safe(String value, String fallback) {
        if (value == null || value.trim().isEmpty()) return fallback;
        return value.trim();
    }

    @Override public void onDestroy() {
        stopPlaybackOnly();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
