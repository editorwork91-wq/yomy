package com.yomy.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import com.huawei.hms.push.HmsMessageService;
import com.huawei.hms.push.RemoteMessage;
import org.json.JSONObject;
import java.util.Map;

public class YomyHuaweiMessagingService extends HmsMessageService {
    private static final String PREFS = "yomy_huawei_push";
    private static final String TOKEN_KEY = "token";
    private static final String CHANNEL_ID = "yomy_default";
    private static final String EXTRA_DEEP_LINK = "yomy_deep_link";
    private static final int NOTIFICATION_ID_BASE = 42000;

    @Override public void onNewToken(String token, Bundle bundle) {
        super.onNewToken(token, bundle);
        saveToken(token);
    }

    @Override public void onNewToken(String token) {
        super.onNewToken(token);
        saveToken(token);
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);

        String raw = message.getData();
        if (TextUtils.isEmpty(raw)) {
            try {
                Map<String, String> map = message.getDataOfMap();
                if (map != null && !map.isEmpty()) raw = new JSONObject(map).toString();
            } catch (Exception ignored) {
                raw = "";
            }
        }
        if (TextUtils.isEmpty(raw)) return;

        try {
            JSONObject data = new JSONObject(raw);
            String eventType = value(data, "event_type");
            String callId = value(data, "call_id");
            String kind = value(data, "call_kind");
            String title = value(data, "push_title");
            String body = value(data, "push_body");
            if (TextUtils.isEmpty(title)) title = value(data, "title");
            if (TextUtils.isEmpty(body)) body = value(data, "body");
            if (TextUtils.isEmpty(title)) title = "Yomy";
            if (TextUtils.isEmpty(body)) body = "New activity";
            if (TextUtils.isEmpty(kind)) kind = "voice";

            if ("CALL_INCOMING".equals(eventType) && !TextUtils.isEmpty(callId)) {
                CallNotificationService.start(this, callId, title, body, kind);
                return;
            }

            String deepLink = value(data, "url");
            if (TextUtils.isEmpty(deepLink)) deepLink = value(data, "deep_link");
            showNotification(title, body, deepLink);
        } catch (Exception ignored) {
        }
    }

    private void saveToken(String token) {
        if (TextUtils.isEmpty(token)) return;
        getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(TOKEN_KEY, token.trim()).apply();
    }

    private void showNotification(String title, String body, String deepLink) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Yomy", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Yomy notifications");
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        Intent intent = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (!TextUtils.isEmpty(deepLink) && deepLink.startsWith("/")) {
            intent.putExtra(EXTRA_DEEP_LINK, deepLink);
        }

        int requestCode = NOTIFICATION_ID_BASE + (int) (System.currentTimeMillis() & 0x0FFF);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, requestCode, intent, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH);

        builder.setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(safe(title, "Yomy"))
                .setContentText(safe(body, "New activity"))
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setContentIntent(pending);

        manager.notify(requestCode, builder.build());
    }

    private static String value(JSONObject object, String key) {
        try {
            String value = object.optString(key, "");
            return value == null ? "" : value.trim();
        } catch (Exception ignored) {
            return "";
        }
    }

    private static String safe(String value, String fallback) {
        return TextUtils.isEmpty(value) ? fallback : value.trim();
    }
}
