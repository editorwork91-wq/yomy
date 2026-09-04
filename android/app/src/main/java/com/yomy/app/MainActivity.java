package com.yomy.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private static final int YOMY_PERMISSIONS = 7001;
    private static final int YOMY_WEB_PERMISSION_REQUEST = 7002;
    private PermissionRequest pendingWebPermissionRequest;
    private AudioManager audioManager;
    private int previousAudioMode = AudioManager.MODE_NORMAL;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        requestYomyPermissions();
        installMediaPermissionBridge();
        installAudioRouteBridge();
        installLocalNotificationBridge();
    }

    private void requestYomyPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        java.util.ArrayList<String> permissions = new java.util.ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.CAMERA);
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!permissions.isEmpty()) requestPermissions(permissions.toArray(new String[0]), YOMY_PERMISSIONS);
    }

    private void installMediaPermissionBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override public void onPermissionRequest(final PermissionRequest request) { runOnUiThread(() -> handleWebPermissionRequest(request)); }
        });
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        if (request == null || isFinishing()) return;
        java.util.ArrayList<String> nativePermissions = new java.util.ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) nativePermissions.add(Manifest.permission.RECORD_AUDIO);
            else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) nativePermissions.add(Manifest.permission.CAMERA);
        }
        java.util.LinkedHashSet<String> unique = new java.util.LinkedHashSet<>(nativePermissions);
        nativePermissions.clear(); nativePermissions.addAll(unique);
        if (nativePermissions.isEmpty()) { request.grant(request.getResources()); return; }
        if (pendingWebPermissionRequest != null) { try { pendingWebPermissionRequest.deny(); } catch (Exception ignored) {} }
        pendingWebPermissionRequest = request;
        boolean allGranted = true;
        for (String permission : nativePermissions) if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) { allGranted = false; break; }
        if (allGranted) { grantPendingWebPermission(); return; }
        requestPermissions(nativePermissions.toArray(new String[0]), YOMY_WEB_PERMISSION_REQUEST);
    }

    private void grantPendingWebPermission() {
        PermissionRequest request = pendingWebPermissionRequest; pendingWebPermissionRequest = null;
        if (request == null) return;
        try { request.grant(request.getResources()); } catch (Exception ignored) {}
    }

    private void denyPendingWebPermission() {
        PermissionRequest request = pendingWebPermissionRequest; pendingWebPermissionRequest = null;
        if (request == null) return;
        try { request.deny(); } catch (Exception ignored) {}
    }

    private void installAudioRouteBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().addJavascriptInterface(new AudioRouteBridge(), "YomyAudio");
    }

    private final class AudioRouteBridge {
        @JavascriptInterface public void setSpeaker(boolean enabled) { runOnUiThread(() -> setSpeakerRoute(enabled)); }
    }

    private void installLocalNotificationBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().addJavascriptInterface(new LocalNotificationBridge(), "YomyNotification");
    }

    private final class LocalNotificationBridge {
        @JavascriptInterface public void show(String title, String body, String kind) {
            runOnUiThread(() -> showLocalNotification(title, body, kind));
        }
    }

    private void showLocalNotification(String title, String body, String kind) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        String channelId = "call".equals(kind) ? "yomy_calls" : "yomy_default";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            String channelName = "call".equals(kind) ? "Yomy Calls" : "Yomy";
            NotificationChannel channel = new NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Yomy " + ("call".equals(kind) ? "incoming call" : "message") + " notifications");
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int requestCode = (int) (System.currentTimeMillis() & 0x7fffffff);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(this, requestCode, intent, flags);

        String safeTitle = title == null || title.trim().isEmpty() ? "Yomy" : title.trim();
        String safeBody = body == null ? "" : body.trim();
        if (safeTitle.length() > 80) safeTitle = safeTitle.substring(0, 80);
        if (safeBody.length() > 240) safeBody = safeBody.substring(0, 240);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, channelId)
                : new Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH);
        builder.setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(safeTitle)
                .setContentText(safeBody)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setShowWhen(true)
                .setCategory("call".equals(kind) ? Notification.CATEGORY_CALL : Notification.CATEGORY_MESSAGE)
                .setVisibility(Notification.VISIBILITY_PRIVATE);

        manager.notify(requestCode, builder.build());
    }

    private void setSpeakerRoute(boolean enabled) {
        if (audioManager == null) return;
        try {
            if (audioManager.getMode() != AudioManager.MODE_IN_COMMUNICATION) previousAudioMode = audioManager.getMode();
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                AudioDeviceInfo desired = null;
                for (AudioDeviceInfo device : audioManager.getAvailableCommunicationDevices()) {
                    if (enabled && device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) { desired = device; break; }
                    if (!enabled && device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) { desired = device; break; }
                }
                if (desired != null) audioManager.setCommunicationDevice(desired);
            } else audioManager.setSpeakerphoneOn(enabled);
        } catch (Exception ignored) {}
    }

    private void restoreAudioRoute() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audioManager.clearCommunicationDevice();
            audioManager.setSpeakerphoneOn(false);
            audioManager.setMode(previousAudioMode == AudioManager.MODE_IN_COMMUNICATION ? AudioManager.MODE_NORMAL : previousAudioMode);
        } catch (Exception ignored) {}
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == YOMY_WEB_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0;
            for (int result : grantResults) if (result != PackageManager.PERMISSION_GRANTED) { granted = false; break; }
            if (granted) grantPendingWebPermission(); else denyPendingWebPermission();
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override public void onDestroy() {
        denyPendingWebPermission();
        restoreAudioRoute();
        super.onDestroy();
    }
}
