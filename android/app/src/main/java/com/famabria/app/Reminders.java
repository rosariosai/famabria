package com.famabria.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Native reminders. The web app hands over its upcoming reminders (id, time, title, body) and this class
 * keeps them in SharedPreferences and schedules one alarm each, so they fire even when the app is closed.
 * Alarms are inexact (no special permission needed) and are rebuilt after a reboot or an app update.
 */
final class Reminders {
    private static final String PREFS = "reminders";
    private static final String KEY = "list";
    private static final int MAX = 100;

    private Reminders() { }

    /** Replaces everything that was scheduled before with the list in json: [{id, at, title, body}, ...]. */
    static void replaceAll(Context ctx, String json) {
        JSONArray next = new JSONArray();
        long now = System.currentTimeMillis();
        try {
            JSONArray in = new JSONArray(json);
            for (int i = 0; i < in.length() && next.length() < MAX; i++) {
                JSONObject o = in.getJSONObject(i);
                String id = o.getString("id");
                long at = o.getLong("at");
                if (at <= now || id.isEmpty() || id.length() > 80) continue;
                JSONObject c = new JSONObject();
                c.put("id", id);
                c.put("at", at);
                c.put("title", clip(o.optString("title"), 120));
                c.put("body", clip(o.optString("body"), 200));
                next.put(c);
            }
        } catch (Exception e) {
            return; // malformed input: keep what is already scheduled
        }
        cancelAll(ctx);
        prefs(ctx).edit().putString(KEY, next.toString()).apply();
        scheduleAll(ctx);
    }

    /** Schedules every stored reminder that is still in the future (used after boot and after an update). */
    static void scheduleAll(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long now = System.currentTimeMillis();
        for (JSONObject o : stored(ctx)) {
            long at = o.optLong("at");
            if (at > now) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intentFor(ctx, o));
        }
    }

    static void forget(Context ctx, String id) {
        JSONArray keep = new JSONArray();
        for (JSONObject o : stored(ctx)) if (!id.equals(o.optString("id"))) keep.put(o);
        prefs(ctx).edit().putString(KEY, keep.toString()).apply();
    }

    private static void cancelAll(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        for (JSONObject o : stored(ctx)) am.cancel(intentFor(ctx, o));
    }

    private static PendingIntent intentFor(Context ctx, JSONObject o) {
        String id = o.optString("id");
        Intent i = new Intent(ctx, ReminderReceiver.class)
                .setData(Uri.parse("famabria://reminder/" + Uri.encode(id)))
                .putExtra("id", id)
                .putExtra("title", o.optString("title"))
                .putExtra("body", o.optString("body"));
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static java.util.List<JSONObject> stored(Context ctx) {
        java.util.ArrayList<JSONObject> out = new java.util.ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs(ctx).getString(KEY, "[]"));
            for (int i = 0; i < a.length(); i++) out.add(a.getJSONObject(i));
        } catch (Exception ignored) { }
        return out;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String clip(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
