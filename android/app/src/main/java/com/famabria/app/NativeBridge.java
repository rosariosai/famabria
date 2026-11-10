package com.famabria.app;

import android.webkit.JavascriptInterface;

/**
 * The only door from the web app to Android code, exposed as window.FamabriaNative.
 * The page is always the bundled app (other URLs are opened in the browser), so the surface is kept tiny.
 */
class NativeBridge {
    private final MainActivity activity;

    NativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    /** json: [{"id": "...", "at": epochMillis, "title": "...", "body": "..."}, ...] */
    @JavascriptInterface
    public void setReminders(String json) {
        if (json == null || json.length() > 200_000) return;
        Reminders.replaceAll(activity.getApplicationContext(), json);
        if (!"[]".equals(json)) activity.askNotificationPermission();
    }
}
