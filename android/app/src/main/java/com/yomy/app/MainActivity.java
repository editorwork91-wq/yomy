package com.yomy.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private static final int YOMY_PERMISSIONS = 7001;
    private static final int YOMY_WEB_PERMISSION_REQUEST = 7002;
    private PermissionRequest pendingWebPermissionRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestYomyPermissions();
        installMediaPermissionBridge();
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
                // Ignore an already completed WebView permission request.
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
            // The WebView may have cancelled the request while the Activity changed state.
        }
    }

    private void denyPendingWebPermission() {
        PermissionRequest request = pendingWebPermissionRequest;
        pendingWebPermissionRequest = null;
        if (request == null) return;

        try {
            request.deny();
        } catch (Exception ignored) {
            // The WebView may have cancelled the request already.
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
            if (granted) {
                grantPendingWebPermission();
            } else {
                denyPendingWebPermission();
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onDestroy() {
        denyPendingWebPermission();
        super.onDestroy();
    }
}
