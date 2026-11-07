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
