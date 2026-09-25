package com.yomy.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.text.TextUtils;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import okhttp3.FormBody;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class YomyBackgroundService extends Service {
    public static final String ACTION_START = "com.yomy.app.action.START_BACKGROUND";
    public static final String ACTION_STOP = "com.yomy.app.action.STOP_BACKGROUND";

    private static final String PREFS = "yomy_background";
    private static final String KEY_ACCESS = "access_token";
    private static final String KEY_REFRESH = "refresh_token";
    private static final String KEY_USER = "user_id";
    private static final String KEY_URL = "supabase_url";
    private static final String KEY_ANON = "anon_key";
    private static final String KEY_EXPIRES = "expires_at";
    private static final String KEY_SEEN = "seen_event_ids";

    private static final String CHANNEL_ID = "yomy_background";
    private static final int FOREGROUND_ID = 48101;
    private static final long HEARTBEAT_MS = 20_000L;
    private static final long RECONNECT_START_MS = 2_000L;
    private static final long RECONNECT_MAX_MS = 60_000L;

    private static volatile YomyBackgroundService instance;
    private static volatile boolean appVisible;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ScheduledExecutorService worker;
    private OkHttpClient httpClient;
    private WebSocket webSocket;
    private boolean stopping;
    private long reconnectDelayMs = RECONNECT_START_MS;

    public static void configure(Context context, String accessToken, String refreshToken, String userId,
                                 String supabaseUrl, String anonKey, long expiresAtSeconds) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString(KEY_ACCESS, accessToken == null ? "" : accessToken)
                .putString(KEY_REFRESH, refreshToken == null ? "" : refreshToken)
                .putString(KEY_USER, userId == null ? "" : userId)
                .putString(KEY_URL, supabaseUrl == null ? "" : supabaseUrl)
                .putString(KEY_ANON, anonKey == null ? "" : anonKey)
                .putLong(KEY_EXPIRES, expiresAtSeconds)
                .apply();
    }

    public static void clearCredentials(Context context) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear().apply();
    }

    public static void setAppVisible(boolean visible) {
        appVisible = visible;
    }

    public static void start(Context context) {
        Intent intent = new Intent(context, YomyBackgroundService.class).setAction(ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {
        }
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, YomyBackgroundService.class).setAction(ACTION_STOP);
        try {
            context.startService(intent);
        } catch (Exception ignored) {
            context.stopService(intent);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        worker = Executors.newSingleThreadScheduledExecutor();
        httpClient = new OkHttpClient.Builder()
                .pingInterval(20, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopping = true;
            stopSelf();
            return START_NOT_STICKY;
        }

        stopping = false;
        promoteToForeground();

        worker.execute(() -> connectNow(false));
        return START_STICKY;
    }

    private void promoteToForeground() {
        Notification notification = buildForegroundNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                startForeground(
                        FOREGROUND_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                );
                return;
            } catch (Exception ignored) {
            }
        }
        startForeground(FOREGROUND_ID, notification);
    }

    private Notification buildForegroundNotification() {
        Intent open = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 48102, open, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        return builder
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Yomy")
                .setContentText("Background connection is active")
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setContentIntent(pending)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .build();
    }

    private void createNotificationChannel() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Yomy background connection",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps Yomy connected for background messages and calls.");
        manager.createNotificationChannel(channel);
    }

    private void connectNow(boolean forceRefresh) {
        if (stopping) return;

        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String access = prefs.getString(KEY_ACCESS, "");
        String refresh = prefs.getString(KEY_REFRESH, "");
        String userId = prefs.getString(KEY_USER, "");
        String baseUrl = prefs.getString(KEY_URL, "");
        String anonKey = prefs.getString(KEY_ANON, "");
        long expiresAt = prefs.getLong(KEY_EXPIRES, 0L);

        if (TextUtils.isEmpty(refresh) || TextUtils.isEmpty(userId)
                || TextUtils.isEmpty(baseUrl) || TextUtils.isEmpty(anonKey)) {
            return;
        }

        if (forceRefresh || TextUtils.isEmpty(access)
                || expiresAt <= (System.currentTimeMillis() / 1000L) + 90L) {
            String[] refreshed = refreshSession(baseUrl, anonKey, refresh);
            if (refreshed == null || TextUtils.isEmpty(refreshed[0])) {
                scheduleReconnect();
                return;
            }
            access = refreshed[0];
        }

        final String finalAccess = access;
        HttpUrl parsed = HttpUrl.parse(stripTrailingSlash(baseUrl) + "/realtime/v1/websocket");
        if (parsed == null) {
            scheduleReconnect();
            return;
        }

        HttpUrl realtimeUrl = parsed.newBuilder()
                .addQueryParameter("apikey", anonKey)
                .addQueryParameter("vsn", "1.0.0")
                .build();

        closeSocket();

        Request request = new Request.Builder()
                .url(realtimeUrl)
                .build();

        webSocket = httpClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket socket, Response response) {
                reconnectDelayMs = RECONNECT_START_MS;
                sendJoin(socket, userId, finalAccess);
                scheduleHeartbeat(socket);
            }

            @Override
            public void onMessage(WebSocket socket, String text) {
                handleRealtimeMessage(text);
            }

            @Override
            public void onFailure(WebSocket socket, Throwable t, Response response) {
                if (!stopping) scheduleReconnect();
            }

            @Override
            public void onClosed(WebSocket socket, int code, String reason) {
                if (!stopping) scheduleReconnect();
            }
        });
    }

    private void sendJoin(WebSocket socket, String userId, String accessToken) {
        try {
            JSONObject config = new JSONObject()
                    .put("broadcast", new JSONObject().put("ack", false).put("self", false))
                    .put("presence", new JSONObject().put("key", ""));

            JSONArray postgresChanges = new JSONArray();
            postgresChanges.put(new JSONObject()
                    .put("event", "INSERT")
                    .put("schema", "public")
                    .put("table", "messages")
                    .put("filter", "receiver_id=eq." + userId));
            postgresChanges.put(new JSONObject()
                    .put("event", "INSERT")
                    .put("schema", "public")
                    .put("table", "notifications")
                    .put("filter", "user_id=eq." + userId));

            config.put("postgres_changes", postgresChanges);

            JSONObject payload = new JSONObject()
                    .put("config", config)
                    .put("access_token", accessToken);

            JSONArray join = new JSONArray()
                    .put("1")
                    .put("1")
                    .put("realtime:yomy-background:" + userId)
                    .put("phx_join")
                    .put(payload);

            socket.send(join.toString());
        } catch (Exception ignored) {
        }
    }

    private void scheduleHeartbeat(WebSocket socket) {
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (stopping || webSocket != socket) return;
                try {
                    JSONArray heartbeat = new JSONArray()
                            .put("1")
                            .put(String.valueOf(System.currentTimeMillis()))
                            .put("phoenix")
                            .put("heartbeat")
                            .put(new JSONObject());
                    socket.send(heartbeat.toString());
                } catch (Exception ignored) {
                }
                scheduleHeartbeat(socket);
            }
        }, HEARTBEAT_MS);
    }

    private void handleRealtimeMessage(String message) {
        try {
            JSONArray envelope = new JSONArray(message);
            if (envelope.length() < 5) return;
            String event = envelope.optString(3, "");
            JSONObject payload = envelope.optJSONObject(4);
            if (!"postgres_changes".equals(event) || payload == null) return;

            JSONObject data = payload.optJSONObject("data");
            if (data == null) return;
            if (!"INSERT".equalsIgnoreCase(data.optString("type", ""))) return;

            String table = data.optString("table", "");
            JSONObject record = data.optJSONObject("record");
            if (record == null) return;

            if ("messages".equals(table)) {
                handleMessageRecord(record);
            } else if ("notifications".equals(table)) {
                handleNotificationRecord(record);
            }
        } catch (Exception ignored) {
        }
    }

    private void handleMessageRecord(JSONObject record) {
        String id = record.optString("id", "");
        if (TextUtils.isEmpty(id) || wasSeen("message:" + id)) return;
        if (record.optBoolean("deleted_for_everyone", false)) return;

        String messageType = record.optString("message_type", "");
        String callId = record.optString("call_id", "");
        String callKind = record.optString("call_kind", "voice");
        String mediaType = record.optString("media_type", "");
        boolean isCall = "call".equalsIgnoreCase(messageType) || !TextUtils.isEmpty(callId);

        if (isCall) {
            String title = "Incoming Yomy call";
            String body = "Someone is calling you";
            try {
                CallNotificationService.start(this, callId, title, body, callKind);
            } catch (Exception ignored) {
                showLocalNotification(title, body, "/messages?call=" + encode(callId), Notification.CATEGORY_CALL);
            }
        } else if (!appVisible) {
            String content = record.optString("content", "");
            if (TextUtils.isEmpty(content)) {
                content = "image".equals(mediaType) ? "Sent you a photo"
                        : "video".equals(mediaType) ? "Sent you a video"
                        : "Sent you a message";
            }
            showLocalNotification("New Yomy message", content, "/messages", Notification.CATEGORY_MESSAGE);
        }

        markDelivered(id);
    }

    private void handleNotificationRecord(JSONObject record) {
        if (appVisible) return;
        String id = record.optString("id", "");
        if (TextUtils.isEmpty(id) || wasSeen("notification:" + id)) return;

        String type = record.optString("type", "activity");
        String body;
        switch (type) {
            case "like":
                body = "Someone liked your post";
                break;
            case "comment":
                body = "Someone commented on your post";
                break;
            case "follow":
                body = "You have a new follower";
                break;
            case "follow_request":
                body = "You have a new follow request";
                break;
            default:
                body = "You have new activity";
                break;
        }
        showLocalNotification("Yomy", body, "/notifications", Notification.CATEGORY_SOCIAL);
    }

    private void showLocalNotification(String title, String body, String url, String category) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        String channelId = "call".equals(category) ? "yomy_calls" : "yomy_default";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    channelId,
                    "call".equals(category) ? "Yomy calls" : "Yomy notifications",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        Intent intent = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("yomy_deep_link", url);

        int requestCode = (int) (System.currentTimeMillis() & 0x7fffffff);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, requestCode, intent, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, channelId)
                : new Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH);

        builder.setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setCategory(category)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setShowWhen(true);

        manager.notify(requestCode, builder.build());
    }

    private void markDelivered(String messageId) {
        worker.execute(() -> {
            android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            String access = prefs.getString(KEY_ACCESS, "");
            String baseUrl = prefs.getString(KEY_URL, "");
            String anonKey = prefs.getString(KEY_ANON, "");
            if (TextUtils.isEmpty(access) || TextUtils.isEmpty(baseUrl) || TextUtils.isEmpty(anonKey)) return;

            try {
                HttpUrl endpoint = HttpUrl.parse(stripTrailingSlash(baseUrl) + "/rest/v1/rpc/mark_message_delivered");
                if (endpoint == null) return;
                JSONObject bodyJson = new JSONObject().put("p_message_id", messageId);
                RequestBody body = RequestBody.create(bodyJson.toString(), okhttp3.MediaType.get("application/json"));
                Request request = new Request.Builder()
                        .url(endpoint)
                        .addHeader("apikey", anonKey)
                        .addHeader("Authorization", "Bearer " + access)
                        .post(body)
                        .build();
                try (Response ignored = httpClient.newCall(request).execute()) {
                }
            } catch (Exception ignored) {
            }
        });
    }

    private String[] refreshSession(String baseUrl, String anonKey, String refreshToken) {
        try {
            HttpUrl endpoint = HttpUrl.parse(stripTrailingSlash(baseUrl) + "/auth/v1/token")
                    .newBuilder()
                    .addQueryParameter("grant_type", "refresh_token")
                    .build();

            RequestBody form = new FormBody.Builder()
                    .add("refresh_token", refreshToken)
                    .build();

            Request request = new Request.Builder()
                    .url(endpoint)
                    .addHeader("apikey", anonKey)
                    .addHeader("Content-Type", "application/x-www-form-urlencoded")
                    .post(form)
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful() || response.body() == null) return null;
                JSONObject json = new JSONObject(response.body().string());
                String access = json.optString("access_token", "");
                String refreshed = json.optString("refresh_token", refreshToken);
                long expiresIn = json.optLong("expires_in", 3600L);
                if (TextUtils.isEmpty(access)) return null;

                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putString(KEY_ACCESS, access)
                        .putString(KEY_REFRESH, refreshed)
                        .putLong(KEY_EXPIRES, (System.currentTimeMillis() / 1000L) + expiresIn)
                        .apply();
                return new String[]{access, refreshed};
            }
        } catch (Exception ignored) {
            return null;
        }
    }

    private boolean wasSeen(String id) {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String raw = prefs.getString(KEY_SEEN, "");
        Set<String> seen = new HashSet<>();
        if (!TextUtils.isEmpty(raw)) {
            String[] parts = raw.split("\\|", -1);
            for (String part : parts) if (!TextUtils.isEmpty(part)) seen.add(part);
        }
        if (seen.contains(id)) return true;

        LinkedList<String> ordered = new LinkedList<>(seen);
        ordered.add(id);
        while (ordered.size() > 100) ordered.removeFirst();
        prefs.edit().putString(KEY_SEEN, TextUtils.join("|", ordered)).apply();
        return false;
    }

    private void scheduleReconnect() {
        if (stopping || worker == null || worker.isShutdown()) return;
        long delay = reconnectDelayMs;
        reconnectDelayMs = Math.min(RECONNECT_MAX_MS, reconnectDelayMs * 2L);
        worker.schedule(() -> connectNow(false), delay, TimeUnit.MILLISECONDS);
    }

    private void closeSocket() {
        WebSocket socket = webSocket;
        webSocket = null;
        if (socket != null) {
            try {
                socket.close(1000, "reconnect");
            } catch (Exception ignored) {
            }
        }
    }

    private static String stripTrailingSlash(String value) {
        String result = value == null ? "" : value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }

    private static String encode(String value) {
        try {
            return java.net.URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (Exception e) {
            return value == null ? "" : value;
        }
    }

    @Override
    public void onDestroy() {
        stopping = true;
        mainHandler.removeCallbacksAndMessages(null);
        closeSocket();
        if (worker != null) worker.shutdownNow();
        if (httpClient != null) httpClient.dispatcher().executorService().shutdown();
        instance = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
