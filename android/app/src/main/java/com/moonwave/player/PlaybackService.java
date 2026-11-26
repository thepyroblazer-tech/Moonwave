package com.moonwave.player;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.ArrayList;
import java.util.List;

/**
 * Plays the music. Runs as a media service so playback continues with the screen off or the app closed,
 * and gives the lock screen, notification, headphones and Bluetooth their play/pause/skip controls.
 */
public class PlaybackService extends MediaSessionService {
    static final String STREAM = "https://api.audius.co/v1/tracks/%s/stream?app_name=Moonwave";

    /** Same-process access for the widget and sleep timer. Null when the service isn't running. */
    @Nullable static PlaybackService instance;
    static volatile String lastError = "";
    static volatile long lastErrorAt = 0;

    private MediaSession session;
    ExoPlayer player;

    @Override
    public void onCreate() {
        super.onCreate();
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent("Moonwave/1.0 (Android)")
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(20000);
        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(new DefaultDataSource.Factory(this, http)))
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(), /* handleAudioFocus= */ true)
                .setHandleAudioBecomingNoisy(true) // pause when headphones are unplugged
                .setWakeMode(C.WAKE_MODE_NETWORK)  // keep streaming with the screen off
                .build();

        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                lastError = "Couldn't play that song, so it was skipped.";
                lastErrorAt = System.currentTimeMillis();
                if (player.hasNextMediaItem()) {
                    player.seekToNextMediaItem();
                    player.prepare();
                    player.play();
                }
            }

            @Override
            public void onEvents(@NonNull Player p, @NonNull Player.Events events) {
                PlayerWidget.render(PlaybackService.this);
            }
        });

        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(MainActivity.EXTRA_OPEN_NOW, true);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        session = new MediaSession.Builder(this, player)
                .setSessionActivity(pi)
                .setCallback(new MediaSession.Callback() {
                    /** Controllers can't send stream URLs, only ids: turn each id back into its Audius stream. */
                    @NonNull
                    @Override
                    public ListenableFuture<List<MediaItem>> onAddMediaItems(@NonNull MediaSession s, @NonNull MediaSession.ControllerInfo c, @NonNull List<MediaItem> items) {
                        List<MediaItem> out = new ArrayList<>(items.size());
                        for (MediaItem it : items) out.add(it.buildUpon().setUri(Uri.parse(String.format(STREAM, Uri.encode(it.mediaId)))).build());
                        return Futures.immediateFuture(out);
                    }
                })
                .build();
        instance = this;
    }

    @Nullable
    @Override
    public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (session != null) { session.release(); session = null; }
        if (player != null) { player.release(); player = null; }
        PlayerWidget.render(this);
        super.onDestroy();
    }
}
