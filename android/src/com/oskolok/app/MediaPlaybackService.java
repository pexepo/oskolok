package com.oskolok.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Keeps the app alive while music plays in the WebView and shows the system media notification
 * (lock screen, notification shade, headset buttons). The page reports what plays through
 * MainActivity's bridge; the buttons are sent back to the page as commands.
 */
public final class MediaPlaybackService extends Service {
    static final String ACTION_UPDATE = "com.oskolok.app.UPDATE";
    static final String ACTION_STOP = "com.oskolok.app.STOP";
    static final String ACTION_COMMAND = "com.oskolok.app.COMMAND";
    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 7;
    private static MediaPlaybackService instance;

    private MediaSession session;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String title = "", artist = "", artworkUrl = "", loadedArtwork = "";
    private Bitmap artwork;
    private boolean playing;
    private long position, duration;
    private boolean foreground;

    static MediaPlaybackService get() { return instance; }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Воспроизведение", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
        session = new MediaSession(this, "Oskolok");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { command("play", 0); }
            @Override public void onPause() { command("pause", 0); }
            @Override public void onSkipToNext() { command("next", 0); }
            @Override public void onSkipToPrevious() { command("previous", 0); }
            @Override public void onSeekTo(long ms) { command("seek", ms); }
            @Override public void onStop() { command("pause", 0); }
        });
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE));
        session.setActive(true);
    }

    private void command(String name, long ms) {
        Intent intent = new Intent(ACTION_COMMAND).setPackage(getPackageName());
        intent.putExtra("command", name);
        intent.putExtra("position", ms);
        sendBroadcast(intent);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) { shutdown(); return START_NOT_STICKY; }
        if (ACTION_COMMAND.equals(action)) { command(intent.getStringExtra("command"), 0); return START_NOT_STICKY; }
        if (ACTION_UPDATE.equals(action)) apply(intent.getStringExtra("title"), intent.getStringExtra("artist"), intent.getStringExtra("artwork"),
            intent.getBooleanExtra("playing", false), intent.getLongExtra("position", 0), intent.getLongExtra("duration", 0));
        return START_NOT_STICKY;
    }

    /** Called on the main thread with what the page is playing now. */
    void apply(String title, String artist, String artworkUrl, boolean playing, long position, long duration) {
        this.title = value(title);
        this.artist = value(artist);
        String nextArtwork = value(artworkUrl);
        if (!nextArtwork.equals(this.artworkUrl)) artwork = null;
        this.artworkUrl = nextArtwork;
        this.playing = playing;
        this.position = Math.max(0, position);
        this.duration = Math.max(0, duration);
        publish();
        loadArtwork();
    }

    void stop() { shutdown(); }

    private static String value(String s) { return s == null ? "" : s; }

    private void publish() {
        MediaMetadata.Builder meta = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        if (artwork != null) { meta.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork); meta.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork); }
        // The quick-settings player and the lock screen read the active session: keep it active on every update.
        if (!session.isActive()) session.setActive(true);
        session.setMetadata(meta.build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, playing ? 1f : 0f, android.os.SystemClock.elapsedRealtime())
            .build());
        Notification notification = build();
        if (playing && !foreground) {
            try {
                if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                else startForeground(NOTIFICATION_ID, notification);
                foreground = true;
            } catch (RuntimeException notAllowedNow) {
                // Android 12+ may refuse a foreground start from the background; the notification still shows.
                getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
            }
        } else if (!playing) {
            // Paused: the notification stays (and can be swiped away), the service no longer pins the process.
            if (foreground) { stopForeground(STOP_FOREGROUND_DETACH); foreground = false; }
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
        } else {
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
        }
    }

    private PendingIntent button(String name, int code) {
        Intent intent = new Intent(this, MediaPlaybackService.class).setAction(ACTION_COMMAND).putExtra("command", name);
        return PendingIntent.getService(this, code, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification build() {
        Notification.Builder builder = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.icon)
            .setContentTitle(title)
            .setContentText(artist)
            .setLargeIcon(artwork)
            .setContentIntent(session.getController().getSessionActivity())
            .setDeleteIntent(PendingIntent.getService(this, 9, new Intent(this, MediaPlaybackService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setColorized(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(playing)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Назад", button("previous", 1)).build())
            .addAction(playing
                ? new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Пауза", button("pause", 2)).build()
                : new Notification.Action.Builder(android.R.drawable.ic_media_play, "Играть", button("play", 3)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Вперёд", button("next", 4)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        return builder.build();
    }

    private void loadArtwork() {
        final String url = artworkUrl;
        if (url.equals(loadedArtwork) || !url.startsWith("https://")) return;
        loadedArtwork = url;
        new Thread(() -> {
            Bitmap bitmap = null;
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                try (InputStream in = connection.getInputStream()) { bitmap = BitmapFactory.decodeStream(in); }
                finally { connection.disconnect(); }
                if (bitmap != null && bitmap.getWidth() > 512) bitmap = Bitmap.createScaledBitmap(bitmap, 512, 512 * bitmap.getHeight() / bitmap.getWidth(), true);
            } catch (Exception ignored) { /* The notification keeps the app icon. */ }
            final Bitmap result = bitmap;
            main.post(() -> { if (url.equals(artworkUrl) && result != null) { artwork = result; publish(); } });
        }).start();
    }

    private void shutdown() {
        if (foreground) { stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; }
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        stopSelf();
    }

    @Override public void onDestroy() {
        session.setActive(false);
        session.release();
        instance = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
