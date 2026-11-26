# Moonwave ☾

A standalone music player for Android that streams free music from [Audius](https://audius.co). It has animated night-sky themes and plays everything itself, with no other app needed.

## Features (v1.0.0)
- **Home:** trending songs for this week, this month or all time, filtered by genre.
- **Search:** songs and artists. Tap an artist to see and play their songs.
- **Playing:** a big round cover that spins while music plays, with play/pause, next/previous, seek, shuffle and repeat (off / all / one). Swipe the cover left for the next song, right for the previous one.
- **Queue:** tap a song to play its list from there. Drag any song to the left (or use ⋯) to add it to the queue, or use **Play next**. The Queue button lets you jump to a song or remove one.
- **Background playback:** keeps playing with the screen off or the app in the background. Lock-screen and notification controls, headphone and Bluetooth buttons, and pauses when headphones are unplugged.
- **Library (saved on the phone):** ♥ Favourites and your own playlists (create, rename, delete, add and remove songs).
- **Sleep timer:** 5 minutes to 1.5 hours, or end of this song.
- **Home-screen widget:** cover, title, artist, previous / play-pause / next.
- **Themes:** StarryNight (7 colour schemes), Aurora, Rain, Lava lamp, Fireflies, Snowfall and Album glow. Motion can be set to Full, Calm or Still.

Every song shows its artist, and **⋯ → Open on Audius** opens the song's page on audius.co.

## Install on a OnePlus 12
1. On the phone, open the [latest release](../../releases/latest) and tap **Moonwave.apk** under *Assets*.
2. Open the download from the notification or from **Files → Downloads**.
3. If Android asks, allow your browser or Files app to **install unknown apps**, then tap **Install**.
4. If **Play Protect** warns about an unknown app, tap **More details → Install anyway**. Moonwave only asks for normal permissions: internet, background playback, and an alarm for the sleep timer.
5. Open Moonwave and tap any trending song.

**Keep music playing in the background:** OxygenOS can stop background apps to save battery. If the music stops when the screen is off, go to **Settings → Apps → Moonwave → Battery** and choose **Unrestricted** (on some versions: *Allow background activity*).

**Add the widget:** long-press the home screen → **Widgets** → **Moonwave**, and drag it onto the screen.

**Updating:** install a newer APK over the old one. Your favourites, playlists and theme stay.

## Audius API
- Moonwave uses the public, read-only [Audius REST API](https://docs.audius.co) at `https://api.audius.co/v1`: `/tracks/trending`, `/tracks/search`, `/users/search`, `/users/{id}/tracks` and `/tracks/{id}/stream`.
- Each request sends `app_name=Moonwave` to identify the app.
- Read-only calls don't need an API key. The Audius docs offer an optional free key at https://api.audius.co/plans; the free plan allows 10 requests per second.
- The secret bearer token Audius gives out is for servers only. Moonwave never uses or ships one.
- Songs that are deleted, unavailable or gated (premium, or collectible-only) are hidden.

## Project layout
- `web/`: the app's screens (HTML/CSS/JS). `audius.js` is the API client, `player.js` controls playback (native on the phone, an `<audio>` element in a PC browser), `themes.js` holds the animated backgrounds, and `app.js` the screens.
- `android/`: the Android app. `MainActivity` hosts the screens. `PlaybackService` plays the audio with Media3 ExoPlayer and provides the media session and notification. There are also `PlayerWidget` and `SleepReceiver`.

## Building
Open `android/` in Android Studio, or run `android\gradlew.bat assembleDebug` with `JAVA_HOME` set to Android Studio's `jbr` folder. The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. It's debug-signed, for personal use.

To try the screens on a PC, run `python -m http.server 8738 --directory web` and open http://127.0.0.1:8738/index.html. Music plays in the browser too.

## Credits
Music and artwork come from Audius, and belong to their artists. The theme engine comes from [StarrySky](https://github.com/thepyroblazer-tech/StarrySky). StarryNight colours and shooting-star motion are based on the StarryNight Spicetify theme by b-chen00 (MIT licence). Moonwave is not made by or affiliated with Audius.
