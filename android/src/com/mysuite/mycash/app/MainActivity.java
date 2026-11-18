package com.mysuite.mycash.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.mysuite.mycash.net.Json;
import com.mysuite.mycash.net.SyncNode;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** MYCASH for Android: the shared web UI (assets/index.html) in a WebView plus the native LAN sync node. */
public class MainActivity extends Activity {
    static final String TAG = "MYCASH";
    static final int REQ_SCAN = 1, REQ_CAM = 2;
    WebView web;
    SyncNode node;
    final ExecutorService pool = Executors.newCachedThreadPool();
    int scanId = 0;
    boolean resumedOnce = false;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(StartScreen.BG);
        web = new WebView(this);
        web.setBackgroundColor(StartScreen.BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setTextZoom(100);
        s.setAllowContentAccess(false);
        s.setAllowFileAccess(false); // file:///android_asset/ still loads
        s.setGeolocationEnabled(false);
        s.setSupportZoom(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                Log.i(TAG, "js: " + m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; } // never navigate away
            @Override public boolean onRenderProcessGone(WebView v, android.webkit.RenderProcessGoneDetail d) {
                // The WebView renderer died (low memory or a crash). Do not take the whole app down: rebuild the screen.
                Log.w(TAG, "WebView renderer gone, crashed=" + d.didCrash() + "; recreating");
                if (v == web) web = null;
                ViewGroup p = (ViewGroup) v.getParent();
                if (p != null) p.removeView(v);
                v.destroy();
                recreate();
                return true;
            }
        });
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        StartScreen.show(this, root);
        try {
            String name = Build.MODEL == null || Build.MODEL.isEmpty() ? "Android phone" : Build.MODEL;
            node = new SyncNode(new File(getFilesDir(), "mycash"), "android", StartScreen.version(this), name, SyncNode.DEFAULT_PORT);
            node.setListener(new SyncNode.Listener() {
                public void onChange() { event("change"); }
                public void onPair() { event("pair"); }
            });
            node.start();
        } catch (Exception e) { Log.e(TAG, "sync node", e); }
        web.addJavascriptInterface(new Bridge(), "MCAndroid");
        web.loadUrl("file:///android_asset/index.html");
    }

    void js(final String code) {
        final WebView w = web;
        if (w == null) return;
        w.post(new Runnable() { public void run() { w.evaluateJavascript(code, null); } });
    }

    void event(String name) { js("window.MC_event && window.MC_event(" + Json.quote(name) + ")"); }

    void done(int id, String json) { js("window.MC_done && window.MC_done(" + id + "," + json + ")"); }

    final class Bridge {
        @JavascriptInterface public void call(final int id, final String method, final String args) {
            if ("scan".equals(method)) { runOnUiThread(new Runnable() { public void run() { startScan(id); } }); return; }
            if ("exit".equals(method)) { runOnUiThread(new Runnable() { public void run() { finish(); } }); done(id, "{\"ok\":true}"); return; }
            pool.execute(new Runnable() { public void run() {
                String r;
                try { r = node == null ? "{\"ok\":false,\"error\":\"storage unavailable\"}" : node.call(method, args); }
                catch (Exception e) { Log.e(TAG, "call " + method, e); r = "{\"ok\":false,\"error\":" + Json.quote(String.valueOf(e.getMessage())) + "}"; }
                done(id, r);
            }});
        }
    }

    void startScan(int id) {
        if (scanId != 0) done(scanId, "{\"cancel\":true}");
        scanId = id;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM);
            return;
        }
        startActivityForResult(new Intent(this, ScanActivity.class), REQ_SCAN);
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req != REQ_CAM) return;
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) startActivityForResult(new Intent(this, ScanActivity.class), REQ_SCAN);
        else { finishScan("{\"error\":\"Camera permission is needed to scan. You can also use Enter pairing text.\"}"); }
    }

    @Override protected void onActivityResult(int req, int code, Intent data) {
        if (req != REQ_SCAN) return;
        String t = data == null ? null : data.getStringExtra("link");
        finishScan(code == RESULT_OK && t != null ? "{\"text\":" + Json.quote(t) + "}" : "{\"cancel\":true}");
    }

    void finishScan(String json) { if (scanId != 0) { done(scanId, json); scanId = 0; } }

    @Override public void onBackPressed() { event("back"); }

    @Override protected void onResume() {
        super.onResume();
        if (node != null) node.start(); // no-op when already listening
        if (resumedOnce) event("resume");
        resumedOnce = true;
    }

    @Override protected void onDestroy() {
        if (node != null) node.stop();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
