package com.moonwave.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import androidx.webkit.WebViewAssetLoader;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Thin shell around the web UI in assets/. Playback is done by PlaybackService through a MediaController. */
public class MainActivity extends Activity {
    static final String HOME = "https://appassets.androidplatform.net/assets/index.html";
    static final String EXTRA_OPEN_NOW = "openNow";

    private WebView web;
    private WebViewAssetLoader assets;
    private boolean pageReady = false;
    private int insetTop = 0, insetBottom = 0;

    private ListenableFuture<MediaController> controllerFuture;
    private MediaController controller;
    private final List<Runnable> pending = new ArrayList<>();
    private boolean queueDirty = true;
    private boolean pushQueued = false;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);

        assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.addJavascriptInterface(new Bridge(), "MoonNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                openExternal(u.toString());
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                queueDirty = true;
                pushInsets();
                pushState();
                if (getIntent().getBooleanExtra(EXTRA_OPEN_NOW, false)) {
                    getIntent().removeExtra(EXTRA_OPEN_NOW);
                    web.evaluateJavascript("window.onNativeOpenNow && window.onNativeOpenNow()", null);
                }
            }
        });

        web.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                insetTop = bars.top;
                insetBottom = bars.bottom;
            } else {
                insetTop = insets.getSystemWindowInsetTop();
                insetBottom = insets.getSystemWindowInsetBottom();
            }
            pushInsets();
            return insets;
        });

        setContentView(web);
        web.loadUrl(HOME);
        connect();
    }

    /* ---------------- connection to the playback service ---------------- */

    private void connect() {
        SessionToken token = new SessionToken(this, new ComponentName(this, PlaybackService.class));
        controllerFuture = new MediaController.Builder(this, token).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                controller = controllerFuture.get();
            } catch (Exception e) {
                return;
            }
            controller.addListener(new Player.Listener() {
                @Override
                public void onEvents(@NonNull Player p, @NonNull Player.Events events) {
                    if (events.contains(Player.EVENT_TIMELINE_CHANGED)) queueDirty = true;
                    schedulePush();
                }
            });
            for (Runnable r : pending) r.run();
            pending.clear();
            queueDirty = true;
            pushState();
        }, MoreExecutors.directExecutor());
    }

    /** Runs now if connected, otherwise as soon as the controller is ready. Main thread only. */
    private void withController(Runnable r) {
        if (controller != null) r.run(); else pending.add(r);
    }

    private void schedulePush() {
        if (pushQueued) return;
        pushQueued = true;
        web.postDelayed(() -> { pushQueued = false; pushState(); }, 60);
    }

    private void pushState() {
        if (!pageReady || controller == null) return;
        String json = stateJson(queueDirty);
        queueDirty = false;
        web.evaluateJavascript("window.onPlayerState && window.onPlayerState(" + JSONObject.quote(json) + ")", null);
    }

    /** Snapshot of the player for the web UI. Main thread only. */
    private String stateJson(boolean withQueue) {
        JSONObject j = new JSONObject();
        try {
            if (controller == null) { j.put("index", -1).put("playing", false); return j.toString(); }
            Player p = controller;
            j.put("index", p.getMediaItemCount() == 0 ? -1 : p.getCurrentMediaItemIndex());
            j.put("playing", p.getPlayWhenReady());
            j.put("buffering", p.getPlaybackState() == Player.STATE_BUFFERING);
            j.put("position", Math.max(0, p.getCurrentPosition()));
            long d = p.getDuration();
            j.put("duration", d == C.TIME_UNSET ? 0 : d);
            j.put("shuffle", p.getShuffleModeEnabled());
            j.put("repeat", p.getRepeatMode() == Player.REPEAT_MODE_ONE ? "one" : p.getRepeatMode() == Player.REPEAT_MODE_ALL ? "all" : "off");
            if (System.currentTimeMillis() - PlaybackService.lastErrorAt < 6000) j.put("error", PlaybackService.lastError);
            if (withQueue) {
                JSONArray q = new JSONArray();
                for (int i = 0; i < p.getMediaItemCount(); i++) {
                    MediaItem it = p.getMediaItemAt(i);
                    Bundle ex = it.mediaMetadata.extras;
                    String raw = ex == null ? null : ex.getString("json");
                    JSONObject t = raw != null ? new JSONObject(raw) : new JSONObject()
                            .put("id", it.mediaId)
                            .put("title", String.valueOf(it.mediaMetadata.title))
                            .put("artist", String.valueOf(it.mediaMetadata.artist));
                    q.put(t);
                }
                j.put("queue", q);
            }
        } catch (Exception ignored) { }
        return j.toString();
    }

    private static List<MediaItem> parseItems(String json) {
        List<MediaItem> items = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject t = a.getJSONObject(i);
                Bundle extras = new Bundle();
                extras.putString("json", t.toString());
                String art = t.optString("artBig", t.optString("art", ""));
                MediaMetadata.Builder md = new MediaMetadata.Builder()
                        .setTitle(t.optString("title"))
                        .setArtist(t.optString("artist"))
                        .setExtras(extras);
                if (!art.isEmpty()) md.setArtworkUri(Uri.parse(art));
                items.add(new MediaItem.Builder().setMediaId(t.getString("id")).setMediaMetadata(md.build()).build());
            }
        } catch (Exception ignored) { }
        return items;
    }

    /** Runs on the main thread and waits for the result (bridge calls arrive on a background thread). */
    private <T> T onUi(Callable<T> c, T fallback) {
        AtomicReference<T> out = new AtomicReference<>(fallback);
        CountDownLatch done = new CountDownLatch(1);
        runOnUiThread(() -> {
            try { out.set(c.call()); } catch (Exception ignored) { } finally { done.countDown(); }
        });
        try { done.await(1500, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { }
        return out.get();
    }

    private void pushInsets() {
        if (!pageReady) return;
        float d = getResources().getDisplayMetrics().density;
        web.evaluateJavascript("window.onNativeInsets && window.onNativeInsets(" + Math.round(insetTop / d) + "," + Math.round(insetBottom / d) + ")", null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getBooleanExtra(EXTRA_OPEN_NOW, false) && pageReady) {
            web.evaluateJavascript("window.onNativeOpenNow && window.onNativeOpenNow()", null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (pageReady) { queueDirty = true; pushState(); }
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (controllerFuture != null) MediaController.releaseFuture(controllerFuture);
        controller = null;
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.onNativeBack ? window.onNativeBack() : false", result -> {
            if (!"true".equals(result)) moveTaskToBack(true); // keep the music playing
        });
    }

    void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open that link.", Toast.LENGTH_LONG).show();
        }
    }

    /** Methods callable from JavaScript as window.MoonNative.*. */
    class Bridge {
        @JavascriptInterface
        public String state(boolean withQueue) { return onUi(() -> stateJson(withQueue), "{\"index\":-1}"); }

        @JavascriptInterface
        public void setQueue(String json, int index) {
            List<MediaItem> items = parseItems(json);
            runOnUiThread(() -> withController(() -> {
                if (items.isEmpty()) return;
                controller.setMediaItems(items, Math.max(0, Math.min(index, items.size() - 1)), 0);
                controller.prepare();
                controller.play();
            }));
        }

        @JavascriptInterface
        public void add(String json, boolean next) {
            List<MediaItem> items = parseItems(json);
            runOnUiThread(() -> withController(() -> {
                if (items.isEmpty()) return;
                if (controller.getMediaItemCount() == 0) {
                    controller.setMediaItems(items);
                    controller.prepare();
                    controller.play();
                } else if (next) {
                    controller.addMediaItems(controller.getCurrentMediaItemIndex() + 1, items);
                } else {
                    controller.addMediaItems(items);
                }
            }));
        }

        @JavascriptInterface
        public void control(String cmd, String arg) {
            runOnUiThread(() -> withController(() -> {
                Player p = controller;
                switch (cmd) {
                    case "play": if (p.getPlaybackState() == Player.STATE_IDLE) p.prepare(); p.play(); break;
                    case "pause": p.pause(); break;
                    case "toggle":
                        if (p.getPlayWhenReady()) p.pause();
                        else {
                            if (p.getPlaybackState() == Player.STATE_IDLE) p.prepare();
                            if (p.getPlaybackState() == Player.STATE_ENDED) p.seekToDefaultPosition();
                            p.play();
                        }
                        break;
                    case "next": p.seekToNext(); p.play(); break;
                    case "prev": p.seekToPrevious(); p.play(); break;
                    case "seek": try { p.seekTo(Long.parseLong(arg)); } catch (NumberFormatException ignored) { } break;
                    case "skipTo":
                        try { p.seekToDefaultPosition(Integer.parseInt(arg)); p.prepare(); p.play(); } catch (Exception ignored) { }
                        break;
                    case "remove": try { p.removeMediaItem(Integer.parseInt(arg)); } catch (Exception ignored) { } break;
                    case "shuffle": p.setShuffleModeEnabled("true".equals(arg)); break;
                    case "repeat":
                        p.setRepeatMode("one".equals(arg) ? Player.REPEAT_MODE_ONE : "all".equals(arg) ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF);
                        break;
                    default: break;
                }
            }));
        }

        @JavascriptInterface
        public void setAccent(String hex) {
            if (hex == null || !hex.matches("#[0-9a-fA-F]{6}")) return;
            getSharedPreferences("moonwave", MODE_PRIVATE).edit().putString("accent", hex).apply();
            runOnUiThread(() -> PlayerWidget.render(MainActivity.this));
        }

        @JavascriptInterface
        public void openExternal(String url) {
            if (url == null || !url.startsWith("https://audius.co")) return;
            runOnUiThread(() -> MainActivity.this.openExternal(url));
        }

        @JavascriptInterface
        public void sleepSet(String atMillis) {
            try { SleepReceiver.schedule(MainActivity.this, Long.parseLong(atMillis)); } catch (NumberFormatException ignored) { }
        }

        @JavascriptInterface
        public String sleepGet() { return String.valueOf(SleepReceiver.endsAt(MainActivity.this)); }

        @JavascriptInterface
        public void sleepCancel() { SleepReceiver.cancel(MainActivity.this); }

        @JavascriptInterface
        public void haptic() {
            runOnUiThread(() -> web.performHapticFeedback(HapticFeedbackConstants.CONFIRM));
        }
    }
}
