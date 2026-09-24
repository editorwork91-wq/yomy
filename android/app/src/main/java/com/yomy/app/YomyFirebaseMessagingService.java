package com.yomy.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class YomyFirebaseMessagingService extends FirebaseMessagingService {
    @Override public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (data == null || data.isEmpty()) return;

        String eventType = value(data, "event_type");
        // Only the explicit CALL_INCOMING event is allowed to start the native
        // ringing service. CALL_ACCEPTED / DECLINED / MISSED / FAILED notifications
        // may carry a call_id for history/deep-linking but must never ring again.
        if (!"CALL_INCOMING".equals(eventType)) return;
        if (message.getPriority() != RemoteMessage.PRIORITY_HIGH) return;

        String callId = value(data, "call_id");
        if (callId.isEmpty()) return;

        String title = first(data, "push_title", "title");
        String body = first(data, "push_body", "body");
        String kind = first(data, "call_kind", "kind");
        String avatarUrl = value(data, "avatar_url");
        if (title == null || title.isEmpty()) title = "Yomy";
        if (body == null || body.isEmpty()) body = "Incoming call";
        if (kind == null || kind.isEmpty()) kind = "voice";

        try {
            CallNotificationService.start(this, callId, title, body, kind, avatarUrl);
        } catch (Exception ignored) {
            // The OS may reject foreground-service startup; the persistent push
            // notification remains available as the platform fallback.
        }
    }

    @Override public void onNewToken(String token) {
        super.onNewToken(token);
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
