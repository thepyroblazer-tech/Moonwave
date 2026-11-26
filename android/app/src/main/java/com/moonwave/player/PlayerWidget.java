package com.moonwave.player;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Shader;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.widget.RemoteViews;

import androidx.media3.common.MediaItem;
import androidx.media3.exoplayer.ExoPlayer;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Home-screen widget: round cover, title, artist, previous / play-pause / next. */
public class PlayerWidget extends AppWidgetProvider {
    static final String ACTION_TOGGLE = "com.moonwave.player.TOGGLE";
    static final String ACTION_NEXT = "com.moonwave.player.NEXT";
    static final String ACTION_PREV = "com.moonwave.player.PREV";

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static String artUrl = "";
    private static Bitmap artRound = null;
    private static boolean artLoading = false;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) { render(ctx); }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String a = intent.getAction();
        if (!ACTION_TOGGLE.equals(a) && !ACTION_NEXT.equals(a) && !ACTION_PREV.equals(a)) return;
        PlaybackService svc = PlaybackService.instance;
        ExoPlayer p = svc == null ? null : svc.player;
        if (p == null || p.getMediaItemCount() == 0) {
            // Nothing loaded: open Moonwave so a song can be picked.
            Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(open);
            return;
        }
        if (ACTION_TOGGLE.equals(a)) {
            if (p.getPlayWhenReady()) p.pause(); else { if (p.getPlaybackState() == ExoPlayer.STATE_IDLE) p.prepare(); p.play(); }
        } else if (ACTION_NEXT.equals(a)) { p.seekToNext(); p.play(); }
        else { p.seekToPrevious(); p.play(); }
        render(ctx);
    }

    static void render(Context ctx) {
        final Context app = ctx.getApplicationContext();
        AppWidgetManager mgr = AppWidgetManager.getInstance(app);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(app, PlayerWidget.class));
        if (ids.length == 0) return;
        RemoteViews v = new RemoteViews(app.getPackageName(), R.layout.widget_player);

        PlaybackService svc = PlaybackService.instance;
        ExoPlayer p = svc == null ? null : svc.player;
        MediaItem item = p == null ? null : p.getCurrentMediaItem();
        boolean playing = p != null && p.getPlayWhenReady();
        if (item == null) {
            v.setTextViewText(R.id.w_title, "Moonwave");
            v.setTextViewText(R.id.w_artist, "Tap to pick some music");
            v.setImageViewResource(R.id.w_cover, R.drawable.ic_w_disc);
        } else {
            v.setTextViewText(R.id.w_title, String.valueOf(item.mediaMetadata.title));
            v.setTextViewText(R.id.w_artist, String.valueOf(item.mediaMetadata.artist));
            Uri art = item.mediaMetadata.artworkUri;
            String url = art == null ? "" : art.toString();
            if (url.equals(artUrl) && artRound != null) v.setImageViewBitmap(R.id.w_cover, artRound);
            else {
                v.setImageViewResource(R.id.w_cover, R.drawable.ic_w_disc);
                loadArt(app, url);
            }
        }

        v.setImageViewResource(R.id.w_play_icon, playing ? R.drawable.ic_w_pause : R.drawable.ic_w_play);
        int accent;
        try { accent = Color.parseColor(app.getSharedPreferences("moonwave", Context.MODE_PRIVATE).getString("accent", "#FFF3C4")); } catch (Exception e) { accent = 0xFFFFF3C4; }
        v.setInt(R.id.w_play_bg, "setColorFilter", accent);
        v.setInt(R.id.w_play_icon, "setColorFilter", luminance(accent) > 0.5 ? Color.BLACK : Color.WHITE);

        v.setOnClickPendingIntent(R.id.w_prev, broadcast(app, ACTION_PREV, 1));
        v.setOnClickPendingIntent(R.id.w_play, broadcast(app, ACTION_TOGGLE, 2));
        v.setOnClickPendingIntent(R.id.w_next, broadcast(app, ACTION_NEXT, 3));
        Intent open = new Intent(app, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(MainActivity.EXTRA_OPEN_NOW, true);
        PendingIntent openPi = PendingIntent.getActivity(app, 4, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        v.setOnClickPendingIntent(R.id.w_cover, openPi);
        v.setOnClickPendingIntent(R.id.w_text, openPi);
        mgr.updateAppWidget(ids, v);
    }

    /** Downloads the cover once per song, makes it round, then redraws the widget. */
    private static synchronized void loadArt(Context app, String url) {
        if (url.isEmpty() || artLoading || !url.startsWith("https://")) return;
        artLoading = true;
        new Thread(() -> {
            Bitmap round = null;
            try {
                HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
                con.setConnectTimeout(8000); con.setReadTimeout(8000);
                Bitmap src;
                try (InputStream in = con.getInputStream()) { src = BitmapFactory.decodeStream(in); }
                if (src != null) {
                    int size = 200;
                    Bitmap scaled = Bitmap.createScaledBitmap(src, size, size, true);
                    round = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
                    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
                    paint.setShader(new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
                    new Canvas(round).drawCircle(size / 2f, size / 2f, size / 2f, paint);
                }
            } catch (Exception ignored) { }
            final Bitmap done = round;
            main.post(() -> {
                synchronized (PlayerWidget.class) { artLoading = false; artUrl = url; artRound = done; }
                if (done != null) render(app);
            });
        }).start();
    }

    static PendingIntent broadcast(Context ctx, String action, int code) {
        Intent i = new Intent(ctx, PlayerWidget.class).setAction(action);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static double luminance(int c) {
        return (0.2126 * Color.red(c) + 0.7152 * Color.green(c) + 0.0722 * Color.blue(c)) / 255.0;
    }
}
