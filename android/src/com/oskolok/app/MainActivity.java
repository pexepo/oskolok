package com.oskolok.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.*;
import android.widget.*;

/** Shared HTTPS client. No embedded credentials or API server; the only bridge reports what plays, for the media notification. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://oskolok.lol/";
    private static final int PICK_FILE = 1;
    private WebView web;
    private LinearLayout offline;
    private ValueCallback<Uri[]> fileCallback;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    // Buttons in the notification, the lock screen and on headphones come back here and go to the page.
    private final android.content.BroadcastReceiver commands = new android.content.BroadcastReceiver() {
        @Override public void onReceive(android.content.Context context, Intent intent) {
            String command = intent.getStringExtra("command");
            if (command == null || !command.matches("play|pause|next|previous|seek")) return;
            long position = intent.getLongExtra("position", 0);
            web.evaluateJavascript("window.__oskolokMedia&&window.__oskolokMedia('" + command + "'," + position + ")", null);
        }
    };

    /** Called by the page (audio manager) whenever the track, play state or position changes. */
    public final class MediaBridge {
        @JavascriptInterface public void update(final String title, final String artist, final String artwork, final boolean playing, final double positionMs, final double durationMs) {
            main.post(() -> {
                String url = web.getUrl();
                if (url == null || !ownOrigin(Uri.parse(url)) || !Double.isFinite(positionMs) || !Double.isFinite(durationMs)) return;
                MediaPlaybackService service = MediaPlaybackService.get();
                if (service != null) { service.apply(title, artist, artwork, playing, (long) positionMs, (long) durationMs); return; }
                if (!playing) return;
                Intent start = new Intent(MainActivity.this, MediaPlaybackService.class).setAction(MediaPlaybackService.ACTION_UPDATE)
                    .putExtra("title", title).putExtra("artist", artist).putExtra("artwork", artwork)
                    .putExtra("playing", true).putExtra("position", (long) positionMs).putExtra("duration", (long) durationMs);
                try { startForegroundService(start); } catch (RuntimeException ignored) { /* Started again on the next update. */ }
            });
        }
        /** The page's theme: status and navigation bar icons turn dark on the light theme and light on the dark one. */
        @JavascriptInterface public void setTheme(final boolean dark) {
            main.post(() -> { String url = web.getUrl(); if (url == null || !ownOrigin(Uri.parse(url))) return; applyBars(dark); });
        }
        @JavascriptInterface public void clear() {
            main.post(() -> { String url = web.getUrl(); if (url == null || !ownOrigin(Uri.parse(url))) return; MediaPlaybackService service = MediaPlaybackService.get(); if (service != null) service.stop(); });
        }
    }

    private int insetTop, insetBottom;
    private boolean darkTheme = false;
    /** Edge-to-edge: the page paints behind the bars; their icons follow the page's theme. */
    @SuppressWarnings("deprecation")
    private void applyBars(boolean dark) {
        darkTheme = dark;
        android.view.Window window = getWindow();
        window.setStatusBarColor(0x00000000);
        window.setNavigationBarColor(0x00000000);
        if (android.os.Build.VERSION.SDK_INT >= 29) { window.setStatusBarContrastEnforced(false); window.setNavigationBarContrastEnforced(false); }
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int light = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : light, light);
            }
        } else {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (!dark) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            window.getDecorView().setSystemUiVisibility(flags);
        }
        web.setBackgroundColor(dark ? 0xff070c14 : 0xfff0f4f9);
    }
    /** Bar heights in CSS pixels, for the page's safe-area padding (WebView's env(safe-area-inset-*) is not reliable). */
    private void pushInsets() {
        float density = getResources().getDisplayMetrics().density;
        int top = Math.round(insetTop / density), bottom = Math.round(insetBottom / density);
        web.evaluateJavascript("(function(){var s=document.documentElement.style;s.setProperty('--tg-content-top','" + top + "px');s.setProperty('--tg-content-bottom','" + bottom + "px');s.setProperty('--native-inset-top','" + top + "px');s.setProperty('--native-inset-bottom','" + bottom + "px');document.documentElement.classList.add('is-native-app');})()", null);
    }

    private boolean ownOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && "oskolok.lol".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }
    private void external(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme) && !"tg".equals(scheme)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "Нет приложения для этой ссылки", Toast.LENGTH_SHORT).show(); }
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(0xfff0f4f9);
        // No rubber-band glow or text-selection handles: it should feel like an app, not a page.
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setHapticFeedbackEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setTextZoom(100);
        // The page recognises the app shell (native-like styling, no install prompts).
        settings.setUserAgentString(settings.getUserAgentString() + " OskolokAndroid/" + BuildConfigVersion.NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(false);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL);
        offline.setGravity(android.view.Gravity.CENTER);
        offline.setBackgroundColor(0xff101b2b);
        TextView message = new TextView(this);
        message.setText("Не удалось открыть Осколок. Проверьте интернет.");
        message.setTextColor(0xffeeeeee);
        message.setPadding(32, 32, 32, 32);
        offline.addView(message);
        Button retry = new Button(this);
        retry.setText("Повторить");
        retry.setOnClickListener(v -> { offline.setVisibility(View.GONE); web.setVisibility(View.VISIBLE); web.loadUrl(ORIGIN); });
        offline.addView(retry);
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        // Edge-to-edge like a native player: the page runs under the status and navigation bars and pads its own
        // header and tab bar by their height (sent as CSS variables). Only the side cutouts are padded natively.
        if (android.os.Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left, right;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(android.view.WindowInsets.Type.ime());
                left = bars.left; right = bars.right; insetTop = bars.top; insetBottom = Math.max(bars.bottom, 0);
                view.setPadding(left, 0, right, ime.bottom);
            } else {
                left = insets.getSystemWindowInsetLeft(); right = insets.getSystemWindowInsetRight();
                insetTop = insets.getSystemWindowInsetTop(); insetBottom = insets.getSystemWindowInsetBottom();
                view.setPadding(left, 0, right, 0);
            }
            pushInsets();
            return insets;
        });
        setContentView(root);
        applyBars(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (ownOrigin(request.getUrl())) return false;
                if (request.isForMainFrame()) external(request.getUrl());
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { web.setVisibility(View.GONE); offline.setVisibility(View.VISIBLE); }
            }
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); pushInsets(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("*/*");
                String[] accepted = params.getAcceptTypes();
                if (accepted != null && accepted.length > 0 && !accepted[0].isEmpty()) picker.putExtra(Intent.EXTRA_MIME_TYPES, accepted);
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(picker, PICK_FILE); }
                catch (ActivityNotFoundException e) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, type, size) -> external(Uri.parse(url)));
        web.addJavascriptInterface(new MediaBridge(), "OskolokNative");
        android.content.IntentFilter filter = new android.content.IntentFilter(MediaPlaybackService.ACTION_COMMAND);
        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(commands, filter, RECEIVER_NOT_EXPORTED);
        else registerReceiver(commands, filter);
        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2);
        if (state == null || web.restoreState(state) == null) web.loadUrl(ORIGIN);
    }
    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (request == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, intent));
            fileCallback = null;
        }
    }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        try { unregisterReceiver(commands); } catch (IllegalArgumentException ignored) { }
        // The WebView is the player: once it is gone, so is the music and its notification.
        MediaPlaybackService service = MediaPlaybackService.get();
        if (service != null) service.stop();
        web.destroy();
        super.onDestroy();
    }
}
