package com.yomy.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class YomyFirebaseMessagingService extends FirebaseMessagingService {
    @Override public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (data == null || data.isEmpty()) return;

        // Only the explicit incoming-call event is allowed to start the
        // foreground ringing service. Terminal/result events also contain a
        // call_id, but must never trigger a second ring on either device.
        String eventType = value(data, "event_type");
        if (!"CALL_INCOMING".equals(eventType)) return;

        String callId = value(data, "call_id");
        if (callId.isEmpty()) return;
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

    private static String value(Map<String, String> data, String key) {
        String value = data.get(key);
        return value == null ? "" : value.trim();
    }

    private static String first(Map<String, String> data, String a, String b) {
        String value = value(data, a);
        return value.isEmpty() ? value(data, b) : value;
    }
}
