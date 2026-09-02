package com.yomy.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private static final int YOMY_PERMISSIONS = 7001;
    private static final int YOMY_WEB_PERMISSION_REQUEST = 7002;
    private PermissionRequest pendingWebPermissionRequest;
    private AudioManager audioManager;
    private int previousAudioMode = AudioManager.MODE_NORMAL;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        requestYomyPermissions();
        installMediaPermissionBridge();
        installAudioRouteBridge();
    }

    private void requestYomyPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;

        java.util.ArrayList<String> permissions = new java.util.ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.CAMERA);
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        }

        if (!permissions.isEmpty()) {
            requestPermissions(permissions.toArray(new String[0]), YOMY_PERMISSIONS);
        }
    }

    private void installMediaPermissionBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }
        });
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        if (request == null || isFinishing()) return;

        java.util.ArrayList<String> nativePermissions = new java.util.ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                nativePermissions.add(Manifest.permission.RECORD_AUDIO);
                nativePermissions.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                nativePermissions.add(Manifest.permission.CAMERA);
            }
        }

        java.util.LinkedHashSet<String> unique = new java.util.LinkedHashSet<>(nativePermissions);
        nativePermissions.clear();
        nativePermissions.addAll(unique);

        if (nativePermissions.isEmpty()) {
            request.grant(request.getResources());
            return;
        }

        if (pendingWebPermissionRequest != null) {
            try {
                pendingWebPermissionRequest.deny();
            } catch (Exception ignored) {
                // Request may already be completed.
            }
        }
        pendingWebPermissionRequest = request;

        boolean allGranted = true;
        for (String permission : nativePermissions) {
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                allGranted = false;
                break;
            }
        }

        if (allGranted) {
            grantPendingWebPermission();
            return;
        }

        requestPermissions(nativePermissions.toArray(new String[0]), YOMY_WEB_PERMISSION_REQUEST);
    }

    private void grantPendingWebPermission() {
        PermissionRequest request = pendingWebPermissionRequest;
        pendingWebPermissionRequest = null;
        if (request == null) return;

        try {
            request.grant(request.getResources());
        } catch (Exception ignored) {
            // WebView may have cancelled the request.
        }
    }

    private void denyPendingWebPermission() {
        PermissionRequest request = pendingWebPermissionRequest;
        pendingWebPermissionRequest = null;
        if (request == null) return;

        try {
            request.deny();
        } catch (Exception ignored) {
            // WebView may have cancelled the request.
        }
    }

    private void installAudioRouteBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().addJavascriptInterface(new AudioRouteBridge(), "YomyAudio");
    }

    private final class AudioRouteBridge {
        @JavascriptInterface
        public void setSpeaker(boolean enabled) {
            runOnUiThread(() -> setSpeakerRoute(enabled));
        }
    }

    private void setSpeakerRoute(boolean enabled) {
        if (audioManager == null) return;
        try {
            if (audioManager.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
                previousAudioMode = audioManager.getMode();
            }
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                AudioDeviceInfo desired = null;
                for (AudioDeviceInfo device : audioManager.getAvailableCommunicationDevices()) {
                    if (enabled && device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                        desired = device;
                        break;
                    }
                    if (!enabled && device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                        desired = device;
                        break;
                    }
                }
                if (desired != null) {
                    audioManager.setCommunicationDevice(desired);
                }
            } else {
                audioManager.setSpeakerphoneOn(enabled);
            }
        } catch (Exception ignored) {
            // Keep the call alive even when a device refuses a route switch.
        }
    }

    private void restoreAudioRoute() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.clearCommunicationDevice();
            }
            audioManager.setSpeakerphoneOn(false);
            audioManager.setMode(previousAudioMode == AudioManager.MODE_IN_COMMUNICATION
                    ? AudioManager.MODE_NORMAL : previousAudioMode);
        } catch (Exception ignored) {
            // Ignore teardown failures.
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == YOMY_WEB_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    granted = false;
                    break;
                }
            }
            if (granted) grantPendingWebPermission();
            else denyPendingWebPermission();
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    public void onDestroy() {
        denyPendingWebPermission();
        restoreAudioRoute();
        super.onDestroy();
    }
}
