package com.famabria.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/**
 * Thin shell around the Famabria web app. The built web app (dist/web) is bundled in assets/app
 * and served from https://appassets.androidplatform.net/app/ so it behaves like the hosted PWA
 * (secure origin, IndexedDB, same absolute /app/ paths). No Google services, no analytics.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/app/app.html";
    private WebView web;
    private PermissionRequest pendingCamera;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/app/", new WebViewAssetLoader.AssetsPathHandler(this) {
                    @Override
                    public WebResourceResponse handle(String path) {
                        return super.handle("app/" + path);
                    }
                })
                .build();

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest req) {
                // Only the camera (QR scan to join a family) is ever requested.
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    req.grant(req.getResources());
                } else {
                    pendingCamera = req;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
                }
            }
        });

        if (state != null) web.restoreState(state); else web.loadUrl(START_URL);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (pendingCamera != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) pendingCamera.grant(pendingCamera.getResources());
            else pendingCamera.deny();
            pendingCamera = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
