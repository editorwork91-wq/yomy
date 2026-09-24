package com.yomy.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {
    public static final String ACTION_ACCEPT = "com.yomy.app.CALL_ACCEPT";
    public static final String ACTION_DECLINE = "com.yomy.app.CALL_DECLINE";
    public static final String ACTION_OPEN = "com.yomy.app.CALL_OPEN";
    public static final String ACTION_HANGUP = "com.yomy.app.CALL_HANGUP";
    public static final String EXTRA_CALL_ID = "call_id";
    public static final String EXTRA_ACTION = "yomy_call_action";
    private static final int CALL_NOTIFICATION_ID = 41001;
    private static final String PREFS = "yomy_call_action_queue";
    private static final String KEY_ACTION = "action";
    private static final String KEY_CALL_ID = "call_id";

    private static void persistPendingAction(Context context, String action, String callId) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_ACTION, action).putString(KEY_CALL_ID, callId).apply();
    }

    public static String[] readPendingAction(Context context) {
        android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String action = prefs.getString(KEY_ACTION, "");
        String callId = prefs.getString(KEY_CALL_ID, "");
        if (action == null || action.isEmpty() || callId == null || callId.isEmpty()) return null;
        return new String[]{action, callId};
    }

    public static void clearPendingAction(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    public static void cancelCallNotification(Context context) {
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.cancel(CALL_NOTIFICATION_ID);
        } catch (Exception ignored) {}
        try {
            context.stopService(new Intent(context, CallNotificationService.class));
        } catch (Exception ignored) {}
    }

    @Override public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        String callId = intent == null ? null : intent.getStringExtra(EXTRA_CALL_ID);
        if (callId == null || callId.trim().isEmpty()) return;

        persistPendingAction(context, action, callId);

        if (ACTION_OPEN.equals(action)) {
            Intent launch = new Intent(context, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    .putExtra(EXTRA_CALL_ID, callId)
                    .putExtra(EXTRA_ACTION, "open");
            context.startActivity(launch);
            return;
        }

        if (ACTION_DECLINE.equals(action)) {
            Intent launch = new Intent(context, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    .putExtra(EXTRA_CALL_ID, callId)
                    .putExtra(EXTRA_ACTION, "decline");
            context.startActivity(launch);
            return;
        }

        if (ACTION_ACCEPT.equals(action)) {
            Intent launch = new Intent(context, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    .putExtra(EXTRA_CALL_ID, callId)
                    .putExtra(EXTRA_ACTION, "accept");
            context.startActivity(launch);
            return;
        }

        if (ACTION_HANGUP.equals(action)) {
            Intent launch = new Intent(context, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    .putExtra(EXTRA_CALL_ID, callId)
                    .putExtra(EXTRA_ACTION, "end");
            context.startActivity(launch);
        }
    }
}
