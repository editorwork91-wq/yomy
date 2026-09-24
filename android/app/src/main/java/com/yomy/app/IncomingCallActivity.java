package com.yomy.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.graphics.LinearGradient;
import android.graphics.Shader;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.animation.ValueAnimator;
import android.view.animation.DecelerateInterpolator;
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
    private static final long RING_DURATION_MS = 60_000L;
    private static final long[] VIBRATION_PATTERN = {0L, 900L, 500L, 900L, 500L};

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::finishIncoming;
    private String callId;
    private boolean finished;
    private MediaPlayer ringtonePlayer;
    private Vibrator vibrator;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        configureWindow();
        buildUi();
        // Keep the foreground call service alive while this screen is visible.
        // Stopping/canceling the notification from onCreate can cause Android
        // (especially OEM builds) to tear down a full-screen notification activity
        // immediately after it is shown. The service remains the single owner of
        // ringtone/vibration and is stopped only after answer/decline/timeout.
        handler.postDelayed(timeout, RING_DURATION_MS);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readIntent(intent);
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(BG);
        window.setNavigationBarColor(BG);
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
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

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);

        CallBackdrop backdrop = new CallBackdrop(this);
        root.addView(backdrop, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(22), dp(28), dp(22), dp(20));

        FrameLayout.LayoutParams contentParams = new FrameLayout.LayoutParams(-1, -1);
        root.addView(content, contentParams);

        LinearLayout brandRow = new LinearLayout(this);
        brandRow.setGravity(Gravity.CENTER);
        TextView brand = text("YOMY", 14, Color.rgb(118, 220, 190), Typeface.BOLD);
        brandRow.addView(brand, new LinearLayout.LayoutParams(-2, -2));

        TextView callBadge = text("  INCOMING CALL  ", 10, Color.rgb(199, 236, 223), Typeface.BOLD);
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setColor(Color.argb(34, 255, 255, 255));
        badgeBg.setCornerRadius(dp(18));
        callBadge.setBackground(badgeBg);
        callBadge.setPadding(dp(10), dp(6), dp(10), dp(6));
        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(-2, -2);
        badgeParams.setMargins(dp(10), 0, 0, 0);
        brandRow.addView(callBadge, badgeParams);
        content.addView(brandRow);

        SpaceView top = new SpaceView(this);
        content.addView(top, new LinearLayout.LayoutParams(1, 0, 0.7f));

        FrameLayout avatarWrap = new FrameLayout(this);
        LinearLayout.LayoutParams avatarWrapParams = new LinearLayout.LayoutParams(dp(154), dp(154));
        avatarWrapParams.gravity = Gravity.CENTER_HORIZONTAL;
        content.addView(avatarWrap, avatarWrapParams);

        TextView ringOuter = text("", 1, Color.TRANSPARENT, Typeface.NORMAL);
        GradientDrawable outerBg = new GradientDrawable();
        outerBg.setShape(GradientDrawable.OVAL);
        outerBg.setColor(Color.TRANSPARENT);
        outerBg.setStroke(dp(1), Color.argb(34, 118, 220, 190));
        ringOuter.setBackground(outerBg);
        avatarWrap.addView(ringOuter, new FrameLayout.LayoutParams(dp(154), dp(154)));

        TextView ringMid = text("", 1, Color.TRANSPARENT, Typeface.NORMAL);
        GradientDrawable midBg = new GradientDrawable();
        midBg.setShape(GradientDrawable.OVAL);
        midBg.setColor(Color.TRANSPARENT);
        midBg.setStroke(dp(1), Color.argb(48, 255, 255, 255));
        ringMid.setBackground(midBg);
        FrameLayout.LayoutParams midParams = new FrameLayout.LayoutParams(dp(140), dp(140), Gravity.CENTER);
        avatarWrap.addView(ringMid, midParams);

        TextView avatar = text(initials(title), 44, TEXT, Typeface.BOLD);
        avatar.setGravity(Gravity.CENTER);
        GradientDrawable avatarBg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[] { Color.rgb(42, 109, 91), Color.rgb(22, 55, 48) }
        );
        avatarBg.setShape(GradientDrawable.OVAL);
        avatar.setBackground(avatarBg);
        avatar.setElevation(dp(12));
        FrameLayout.LayoutParams avatarParams = new FrameLayout.LayoutParams(dp(116), dp(116), Gravity.CENTER);
        avatarWrap.addView(avatar, avatarParams);

        TextView caller = text(title, 32, TEXT, Typeface.BOLD);
        caller.setGravity(Gravity.CENTER);
        caller.setPadding(0, dp(22), 0, 0);
        content.addView(caller, new LinearLayout.LayoutParams(-1, -2));

        TextView subtitle = text("video".equalsIgnoreCase(kind) ? "Incoming video call" : "Incoming voice call", 16, MUTED, Typeface.NORMAL);
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setPadding(0, dp(6), 0, 0);
        content.addView(subtitle, new LinearLayout.LayoutParams(-1, -2));

        TextView helper = text("Swipe the control to answer or decline", 13, Color.rgb(125, 151, 142), Typeface.NORMAL);
        helper.setGravity(Gravity.CENTER);
        helper.setPadding(0, dp(8), 0, 0);
        content.addView(helper, new LinearLayout.LayoutParams(-1, -2));

        SpaceView middle = new SpaceView(this);
        content.addView(middle, new LinearLayout.LayoutParams(1, 0, 0.95f));

        SwipeCallControl control = new SwipeCallControl(this);
        LinearLayout.LayoutParams controlParams = new LinearLayout.LayoutParams(-1, dp(112));
        content.addView(control, controlParams);

        TextView foot = text("Move past the center to confirm", 11, Color.rgb(91, 115, 108), Typeface.NORMAL);
        foot.setGravity(Gravity.CENTER);
        foot.setPadding(0, dp(8), 0, 0);
        content.addView(foot, new LinearLayout.LayoutParams(-1, -2));

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
        finishPlayback();
        stopCallService();
        launchMain("accept");
    }

    private void decline() {
        if (finished || callId == null || callId.isEmpty()) return;
        finished = true;
        finishPlayback();
        stopCallService();
        Intent launch = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(CallActionReceiver.EXTRA_CALL_ID, callId)
                .putExtra(CallActionReceiver.EXTRA_ACTION, "decline");
        startActivity(launch);
        finish();
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
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

    private void finishIncoming() {
        if (finished) return;
        finished = true;
        finishPlayback();
        stopCallService();
        finish();
    }

    private void stopCallService() {
        try {
            startService(new Intent(this, CallNotificationService.class).setAction(CallNotificationService.ACTION_STOP));
        } catch (Exception ignored) {}
    }

    /*
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
            finishPlayback();
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

    */

    private void finishPlayback() {
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

    @Override protected void onDestroy() {
        finishPlayback();
        super.onDestroy();
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
        private int armed = 0;
        private boolean actionLocked;
        private final float threshold;

        SwipeCallControl(Context context) {
            super(context);
            threshold = dp(76);
            setFocusable(true);
            setClickable(true);
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        }

        @Override protected void onDraw(android.graphics.Canvas canvas) {
            super.onDraw(canvas);
            float w = getWidth();
            float h = getHeight();
            float centerX = w / 2f;
            float centerY = h / 2f;
            float max = Math.max(dp(76), w / 2f - dp(42));
            float knobX = centerX + Math.max(-max, Math.min(max, dragX));
            float ratio = Math.min(1f, Math.abs(dragX) / Math.max(1f, max));

            android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
            paint.setStyle(android.graphics.Paint.Style.FILL);
            paint.setColor(Color.argb(28, 255, 255, 255));
            RectF track = new RectF(dp(4), dp(8), w - dp(4), h - dp(8));
            canvas.drawRoundRect(track, dp(32), dp(32), paint);

            paint.setStyle(android.graphics.Paint.Style.STROKE);
            paint.setStrokeWidth(dp(1));
            paint.setColor(Color.argb(28, 255, 255, 255));
            canvas.drawRoundRect(track, dp(32), dp(32), paint);

            paint.setStyle(android.graphics.Paint.Style.FILL);
            paint.setColor(Color.argb(32, 222, 74, 74));
            canvas.drawCircle(dp(34), centerY, dp(28), paint);
            paint.setColor(Color.argb(32, 32, 182, 102));
            canvas.drawCircle(w - dp(34), centerY, dp(28), paint);

            paint.setColor(armed < 0 ? Color.rgb(222, 74, 74) : armed > 0 ? Color.rgb(32, 182, 102) : Color.argb(85, 255, 255, 255));
            canvas.drawRoundRect(new RectF(centerX - dp(70), centerY - dp(3), centerX + dp(70), centerY + dp(3)), dp(3), dp(3), paint);

            paint.setColor(KNOB);
            paint.setShadowLayer(dp(12), 0, dp(4), Color.argb(100, 0, 0, 0));
            canvas.drawCircle(knobX, centerY, dp(31), paint);
            paint.clearShadowLayer();

            paint.setColor(armed < 0 ? Color.rgb(222, 74, 74) : armed > 0 ? Color.rgb(32, 182, 102) : Color.rgb(36, 58, 51));
            paint.setStrokeWidth(dp(3));
            paint.setStyle(android.graphics.Paint.Style.STROKE);
            paint.setStrokeCap(android.graphics.Paint.Cap.ROUND);
            float iconCx = knobX;
            if (dragX >= 0) {
                canvas.drawLine(iconCx - dp(8), centerY, iconCx + dp(5), centerY, paint);
                canvas.drawLine(iconCx + dp(5), centerY, iconCx - dp(2), centerY - dp(7), paint);
                canvas.drawLine(iconCx + dp(5), centerY, iconCx - dp(2), centerY + dp(7), paint);
            } else {
                canvas.drawLine(iconCx + dp(8), centerY, iconCx - dp(5), centerY, paint);
                canvas.drawLine(iconCx - dp(5), centerY, iconCx + dp(2), centerY - dp(7), paint);
                canvas.drawLine(iconCx - dp(5), centerY, iconCx + dp(2), centerY + dp(7), paint);
            }

            paint.setStyle(android.graphics.Paint.Style.FILL);
            paint.setColor(Color.argb((int)(180 * Math.max(0.25f, 1f - ratio)), 176, 193, 187));
            paint.setTextAlign(android.graphics.Paint.Align.CENTER);
            paint.setTextSize(dp(10));
            paint.setTypeface(Typeface.create("sans", Typeface.BOLD));
            canvas.drawText("DECLINE", dp(54), centerY + dp(47), paint);
            canvas.drawText("ANSWER", w - dp(54), centerY + dp(47), paint);

            if (ratio < 0.12f) {
                paint.setTextSize(dp(9));
                paint.setColor(Color.argb(130, 255, 255, 255));
                canvas.drawText("SLIDE", centerX, centerY + dp(4), paint);
            }
        }

        @Override public boolean onTouchEvent(MotionEvent event) {
            if (actionLocked) return true;
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = event.getX();
                    dragX = 0f;
                    armed = 0;
                    dragging = true;
                    performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);
                    invalidate();
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (!dragging) return true;
                    float max = Math.max(dp(76), getWidth() / 2f - dp(42));
                    dragX = event.getX() - downX;
                    dragX = Math.max(-max, Math.min(max, dragX));
                    int nextArmed = dragX >= threshold ? 1 : dragX <= -threshold ? -1 : 0;
                    if (nextArmed != armed) {
                        armed = nextArmed;
                        if (armed != 0) performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM);
                    }
                    invalidate();
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    if (!dragging) return true;
                    dragging = false;
                    final int action = armed;
                    final float target = action > 0 ? Math.max(dp(76), getWidth() / 2f - dp(42)) : action < 0 ? -Math.max(dp(76), getWidth() / 2f - dp(42)) : 0f;
                    animateSnap(target, action);
                    return true;
                default:
                    return true;
            }
        }

        private void animateSnap(float target, int action) {
            float start = dragX;
            ValueAnimator animator = ValueAnimator.ofFloat(start, target);
            animator.setDuration(action == 0 ? 220 : 150);
            animator.setInterpolator(new DecelerateInterpolator());
            animator.addUpdateListener(value -> {
                dragX = (float) value.getAnimatedValue();
                invalidate();
            });
            animator.addListener(new android.animation.AnimatorListenerAdapter() {
                @Override public void onAnimationEnd(android.animation.Animator animation) {
                    if (action == 0) {
                        armed = 0;
                        invalidate();
                        return;
                    }
                    actionLocked = true;
                    performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM);
                    handler.postDelayed(() -> {
                        if (action > 0) answer();
                        else decline();
                    }, 90L);
                }
            });
            animator.start();
        }
    }

    private static final class CallBackdrop extends View {
        private final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        private final android.graphics.Paint glow = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);

        CallBackdrop(Context context) {
            super(context);
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        }

        @Override protected void onDraw(android.graphics.Canvas canvas) {
            float w = getWidth();
            float h = getHeight();

            paint.setShader(new LinearGradient(
                    0, 0, w, h,
                    new int[] { Color.rgb(4, 14, 12), Color.rgb(8, 28, 23), Color.rgb(3, 12, 11) },
                    null,
                    Shader.TileMode.CLAMP
            ));
            canvas.drawRect(0, 0, w, h, paint);
            paint.setShader(null);

            glow.setColor(Color.argb(35, 55, 211, 147));
            glow.setMaskFilter(new android.graphics.BlurMaskFilter(dp(42), android.graphics.BlurMaskFilter.Blur.NORMAL));
            canvas.drawCircle(w * 0.5f, h * 0.22f, dp(72), glow);

            glow.setColor(Color.argb(20, 71, 126, 255));
            canvas.drawCircle(w * 0.08f, h * 0.84f, dp(95), glow);

            glow.setColor(Color.argb(18, 255, 255, 255));
            canvas.drawCircle(w * 0.9f, h * 0.72f, dp(75), glow);

            glow.clearShadowLayer();
            paint.setColor(Color.argb(12, 255, 255, 255));
            paint.setStyle(android.graphics.Paint.Style.STROKE);
            paint.setStrokeWidth(dp(1));
            canvas.drawCircle(w * 0.5f, h * 0.22f, dp(150), paint);
        }

        private int dp(int value) {
            return Math.round(value * getResources().getDisplayMetrics().density);
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
