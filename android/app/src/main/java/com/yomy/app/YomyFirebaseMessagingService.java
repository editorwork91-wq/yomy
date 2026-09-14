package com.yomy.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class YomyFirebaseMessagingService extends FirebaseMessagingService {
    @Override public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (data == null || data.isEmpty()) return;

        String eventType = value(data, "event_type");
        String callId = value(data, "call_id");
        if (callId.isEmpty()) return;

        if (isTerminalCallEvent(eventType)) {
            try { CallActionReceiver.cancelCallNotification(this); } catch (Exception ignored) {}
            try {
                android.content.Intent launch = new android.content.Intent(this, MainActivity.class)
                        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        .putExtra(CallActionReceiver.EXTRA_CALL_ID, callId)
                        .putExtra(CallActionReceiver.EXTRA_ACTION, "terminal");
                startActivity(launch);
            } catch (Exception ignored) {}
            return;
        }

        if (!"CALL_INCOMING".equals(eventType)) return;
        if (message.getPriority() != RemoteMessage.PRIORITY_HIGH) return;

        String title = first(data, "push_title", "title");
        String body = first(data, "push_body", "body");
        String kind = first(data, "kind", "call_kind");
        if (title == null || title.isEmpty()) title = "Yomy";
        if (body == null || body.isEmpty()) body = "Incoming call";
        if (kind == null || kind.isEmpty()) kind = "voice";

        try {
            CallNotificationService.start(this, callId, title, body, kind);
        } catch (Exception ignored) {
            // The normal push notification remains available if the OS refuses FGS start.
        }
    }

    @Override public void onNewToken(String token) {
        super.onNewToken(token);
        // Capacitor Push Notifications owns token persistence in the web/native bridge.
    }

    private static boolean isTerminalCallEvent(String eventType) {
        return "CALL_DECLINED".equals(eventType)
                || "CALL_MISSED".equals(eventType)
                || "CALL_FAILED".equals(eventType)
                || "CALL_ENDED".equals(eventType);
    }

    private static String value(Map<String, String> data, String key) {
        String value = data.get(key);
        return value == null ? "" : value.trim();
    }

    private static String first(Map<String, String> data, String a, String b) {
        String value = value(data, a);
        return value.isEmpty() ? value(data, b) : value;
    }
}
