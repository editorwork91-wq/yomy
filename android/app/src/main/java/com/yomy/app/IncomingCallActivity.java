package com.yomy.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public class IncomingCallActivity extends Activity {
    private static final int BG = Color.rgb(8, 18, 16);
    private static final int TEXT = Color.WHITE;
    private static final int MUTED = Color.rgb(176, 193, 187);
    private static final int ANSWER = Color.rgb(32, 182, 102);
    private static final int DECLINE = Color.rgb(222, 74, 74);
    private static final int TRACK = Color.rgb(24, 39, 35);
    private static final int KNOB = Color.rgb(255, 255, 255);

    private String callId;
    private boolean finished;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        configureWindow();
        buildUi();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readIntent(intent);
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(BG);
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR * 0
            );
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) controller.hide(WindowInsets.Type.statusBars());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardCompat.dismiss(this);
        } else {
            window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
    }

    private void buildUi() {
        readIntent(getIntent());
        String title = safe(getIntent().getStringExtra(CallNotificationService.EXTRA_TITLE), "Yomy");
        String kind = safe(getIntent().getStringExtra(CallNotificationService.EXTRA_KIND), "voice");
        String subtitle = "video".equalsIgnoreCase(kind) ? "Incoming video call" : "Incoming voice call";

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(24), dp(46), dp(24), dp(18));
        FrameLayout.LayoutParams contentParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        );
        root.addView(content, contentParams);

        TextView brand = text("YOMY", 13, Color.rgb(107, 193, 167), Typeface.BOLD);
        content.addView(brand, new LinearLayout.LayoutParams(-2, -2));

        SpaceView topSpace = new SpaceView(this);
        content.addView(topSpace, new LinearLayout.LayoutParams(1, 0, 1f));

        TextView avatar = text(initials(title), 42, TEXT, Typeface.BOLD);
        avatar.setGravity(Gravity.CENTER);
        avatar.setBackgroundColor(Color.rgb(34, 76, 66));
        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(dp(116), dp(116));
        avatarParams.gravity = Gravity.CENTER_HORIZONTAL;
        content.addView(avatar, avatarParams);

        TextView caller = text(title, 30, TEXT, Typeface.BOLD);
        caller.setGravity(Gravity.CENTER);
        caller.setPadding(0, dp(18), 0, 0);
        content.addView(caller, new LinearLayout.LayoutParams(-1, -2));

        TextView type = text(subtitle, 16, MUTED, Typeface.NORMAL);
        type.setGravity(Gravity.CENTER);
        type.setPadding(0, dp(6), 0, 0);
        content.addView(type, new LinearLayout.LayoutParams(-1, -2));

        SpaceView middleSpace = new SpaceView(this);
        content.addView(middleSpace, new LinearLayout.LayoutParams(1, 0, 1f));

        TextView hint = text("Swipe right to answer  •  swipe left to decline", 14, MUTED, Typeface.NORMAL);
        hint.setGravity(Gravity.CENTER);
        content.addView(hint, new LinearLayout.LayoutParams(-1, -2));

        SwipeCallControl control = new SwipeCallControl(this);
        LinearLayout.LayoutParams controlParams = new LinearLayout.LayoutParams(-1, dp(82));
        controlParams.setMargins(0, dp(12), 0, dp(6));
        content.addView(control, controlParams);

        TextView fallback = text("Tap the action areas", 12, Color.rgb(115, 137, 130), Typeface.NORMAL);
        fallback.setGravity(Gravity.CENTER);
        content.addView(fallback, new LinearLayout.LayoutParams(-1, -2));

        setContentView(root);
    }

    private void readIntent(Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra(CallNotificationService.EXTRA_CALL_ID);
        if (id != null && !id.trim().isEmpty()) callId = id.trim();
    }

    private void answer() {
        if (finished || callId == null || callId.isEmpty()) return;
        finished = true;
        stopCallService();
        launchMain("accept");
    }

    private void decline() {
        if (finished || callId == null || callId.isEmpty()) return;
        finished = true;
        stopCallService();
        Intent launch = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(CallActionReceiver.EXTRA_CALL_ID, callId)
                .putExtra(CallActionReceiver.EXTRA_ACTION, "decline");
        startActivity(launch);
        finish();
    }

    private void launchMain(String action) {
        Intent launch = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(CallActionReceiver.EXTRA_CALL_ID, callId)
                .putExtra(CallActionReceiver.EXTRA_ACTION, action);
        startActivity(launch);
        finish();
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
    }

    private void stopCallService() {
        try {
            startService(new Intent(this, CallNotificationService.class).setAction(CallNotificationService.ACTION_STOP));
        } catch (Exception ignored) {}
    }

    private TextView text(String value, float sizeSp, int color, int typefaceStyle) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(sizeSp);
        view.setTypeface(Typeface.create("sans", typefaceStyle));
        return view;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private static String safe(String value, String fallback) {
        if (value == null || value.trim().isEmpty()) return fallback;
        return value.trim();
    }

    private static String initials(String value) {
        String s = safe(value, "Y").trim();
        if (s.isEmpty()) return "Y";
        String[] parts = s.split("\\s+");
        if (parts.length == 1) return parts[0].substring(0, 1).toUpperCase();
        return (parts[0].substring(0, 1) + parts[parts.length - 1].substring(0, 1)).toUpperCase();
    }

    private final class SwipeCallControl extends View {
        private float downX;
        private float dragX;
        private boolean dragging;
        private final float threshold;

        SwipeCallControl(Context context) {
            super(context);
            threshold = dp(92);
            setBackgroundColor(TRACK);
            setFocusable(true);
            setClickable(true);
        }

        @Override protected void onDraw(android.graphics.Canvas canvas) {
            super.onDraw(canvas);
            float centerY = getHeight() / 2f;
            float max = Math.max(0f, getWidth() / 2f - dp(44));
            float knobX = getWidth() / 2f + Math.max(-max, Math.min(max, dragX));

            android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
            paint.setColor(DECLINE);
            canvas.drawCircle(dp(28), centerY, dp(24), paint);
            paint.setColor(ANSWER);
            canvas.drawCircle(getWidth() - dp(28), centerY, dp(24), paint);

            paint.setColor(KNOB);
            canvas.drawCircle(knobX, centerY, dp(30), paint);

            paint.setColor(Color.rgb(100, 120, 114));
            paint.setStrokeWidth(dp(3));
            paint.setStrokeCap(android.graphics.Paint.Cap.ROUND);
            float alpha = Math.min(1f, Math.abs(dragX) / Math.max(1f, max));
            paint.setAlpha((int) (255 * Math.max(0.25f, alpha)));
            canvas.drawLine(getWidth() / 2f, centerY, knobX, centerY, paint);
        }

        @Override public boolean onTouchEvent(MotionEvent event) {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = event.getX();
                    dragX = 0f;
                    dragging = true;
                    invalidate();
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (!dragging) return true;
                    dragX = event.getX() - downX;
                    invalidate();
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    if (!dragging) return true;
                    dragging = false;
                    float distance = event.getX() - downX;
                    if (distance >= threshold) answer();
                    else if (distance <= -threshold) decline();
                    else {
                        dragX = 0f;
                        invalidate();
                    }
                    return true;
                default:
                    return true;
            }
        }
    }

    private static final class SpaceView extends View {
        SpaceView(Context context) { super(context); setVisibility(View.VISIBLE); }
    }

    private static final class KeyguardCompat {
        static void dismiss(Activity activity) {
            try {
                activity.getWindow().addFlags(
                        android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                                | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                                | android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                );
            } catch (Exception ignored) {}
        }
    }
}
