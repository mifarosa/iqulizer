# iqulizer

Personal EQ player for iPhone (Expo + react-native-audio-api). Audio comes from
a small self-hosted proxy (`server/`) that resolves tracks with yt-dlp; the
10-band EQ, preamp and soft limiter run on the phone.

For personal use only. Streaming YouTube audio this way may violate YouTube's
Terms of Service; use at your own risk.

## Server (e.g. Oracle Always Free VM)

```bash
cd server
pip install -r requirements.txt
EQ_TOKEN=<long-random-secret> uvicorn app:app --host 0.0.0.0 --port 8000
```

Put it behind HTTPS (Caddy / Cloudflare Tunnel) if you can. Without a token the
server rejects every request. Keep yt-dlp updated (`pip install -U yt-dlp`).

## YouTube Music library (optional)

Sign-in happens once on the server, not in the app (Google blocks logins inside
app WebViews). On the server:

1. Open <https://music.youtube.com> in a desktop browser, signed in.
2. DevTools -> Network -> pick any `browse` request -> copy its request headers.
3. Run `ytmusicapi browser` in `server/` and paste the headers. This writes
   `browser.json` (git-ignored; treat it like a password).
4. Restart the server. The app's "Kitaplığım" buttons now list your liked songs
   and playlists.

This uses unofficial endpoints, so it can break and carries a small risk for
the account; a throwaway account is safer than your main one.

## App

```bash
cd app
npm install
# Needs a development build (Expo Go does not include the native audio module):
npx expo run:ios --device          # Mac, free Apple account (7-day signing)
# or, with a paid Apple Developer account:
eas device:create && eas build --profile development --platform ios
```

Open the app, enter the server URL and `EQ_TOKEN` at the bottom, search, play.

## Notes

- A track is downloaded and decoded fully before playback (a few seconds delay).
- `NSAllowsArbitraryLoads` is on so a plain `http://` server works; switch to
  HTTPS and remove it for anything beyond personal use.
