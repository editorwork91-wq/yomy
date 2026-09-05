package com.yomy.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {
    public static final String ACTION_ACCEPT = "com.yomy.app.CALL_ACCEPT";
    public static final String ACTION_DECLINE = "com.yomy.app.CALL_DECLINE";
    public static final String ACTION_OPEN = "com.yomy.app.CALL_OPEN";
    public static final String EXTRA_CALL_ID = "call_id";
    public static final String EXTRA_ACTION = "yomy_call_action";

    @Override public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        String callId = intent == null ? null : intent.getStringExtra(EXTRA_CALL_ID);
        if (callId == null || callId.trim().isEmpty()) return;

        if (ACTION_OPEN.equals(action)) {
            Intent launch = new Intent(context, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    .putExtra(EXTRA_CALL_ID, callId)
                    .putExtra(EXTRA_ACTION, "open");
            context.startActivity(launch);
            return;
        }

        context.stopService(new Intent(context, CallNotificationService.class));

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
        }
    }
}
