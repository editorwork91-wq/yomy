package com.yomy.app;

import android.content.Context;
import android.os.Bundle;

import com.huawei.hms.push.HmsMessageService;

public class YomyHuaweiMessagingService extends HmsMessageService {
    private static final String PREFS = "yomy_huawei_push";

    @Override
    public void onNewToken(String token, Bundle extras) {
        saveToken(token);
    }

    @Override
    public void onNewToken(String token) {
        saveToken(token);
    }

    private void saveToken(String token) {
        if (token == null || token.trim().isEmpty()) return;
        getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString("token", token.trim())
                .apply();
    }
}
