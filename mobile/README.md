# MediLink Mobile

A real Android/iOS app built from the same React client as the web version,
using [Capacitor](https://capacitorjs.com/) to wrap it in a native shell.
Unlike the desktop app, this one does **not** bundle the server — a phone
can't run Postgres — so it talks to your already-deployed API over the
network, same as any mobile app talking to a backend.

## One-time setup

```bash
cd mobile
npm install
cp .env.example .env
```

Edit `.env` and set `MEDILINK_API_BASE_URL` to your deployed API's real URL
(the server from `server/`, deployed somewhere reachable from a phone — e.g.
wherever you pointed the desktop app or your Supabase-backed deployment).

Then add the native platform project(s) you want — this only needs doing
once, and only for the platforms you're actually targeting:

```bash
npm run add:android   # needs Android Studio installed
npm run add:ios       # needs Xcode — Mac only, no way around this
```

## Build and open in the native IDE

Every time you change the web app, or the first time:

```bash
npm run release
```

This builds `web/` with `VITE_API_BASE_URL` baked in (see
`scripts/build-web.mjs`), then runs `npx cap sync` to copy the result into
the native project(s) and sync native dependencies.

Then open the native project to build/run/ship it:

```bash
npm run open:android   # opens Android Studio
npm run open:ios       # opens Xcode (Mac only)
```

From there it's the normal native flow: run on an emulator/device from the
IDE for testing, or Build → Generate Signed Bundle/APK (Android) / Archive
(Xcode) when you're ready to submit to the Play Store / App Store.

## Things that need your attention before shipping this to real users

- **CORS**: the app's own origin is no longer the same as the API's (it's
  `https://localhost` on Android, `capacitor://localhost` on iOS — Capacitor
  conventions, not your actual domain). The server denies cross-origin
  requests by default, so add to `server/.env`:
  ```
  CORS_ORIGIN=capacitor://localhost,https://localhost
  ```
  (comma-separate additional origins, e.g. your real web app's domain, if
  you need both working against the same server).

- **Camera permission (QR/barcode scanning)**: the app's scan feature uses
  the browser camera API, which works automatically on web, but a native
  Android/iOS build needs the permission declared in the native project
  Capacitor generates:
  - Android: open `android/app/src/main/AndroidManifest.xml` after
    `npm run add:android` and confirm
    `<uses-permission android:name="android.permission.CAMERA" />` is
    present (Capacitor usually adds this automatically when it detects
    camera usage, but check).
  - iOS: open `ios/App/App/Info.plist` after `npm run add:ios` and add an
    `NSCameraUsageDescription` key with a short string explaining why
    (e.g. "Used to scan patient QR/barcode cards"). iOS will reject the app
    in review without this, and the camera will silently fail at runtime
    without it.

- **Cleartext HTTP (testing only)**: if `MEDILINK_API_BASE_URL` is an
  `http://` address (e.g. a LAN IP for testing a debug build on your own
  phone), Android blocks it by default. Either use `https://` (normal for
  anything beyond quick local testing), or, for a debug build only, add a
  network security config allowing cleartext to that specific host — don't
  ship a release build with cleartext allowed broadly.

- **App icons/splash screen**: Capacitor can generate these from a source
  image via `@capacitor/assets` — not set up yet here. Without it, the
  native projects ship with Capacitor's default icon.

- This hasn't been built or run anywhere yet (no Android SDK, Xcode, or npm
  registry access in the environment this was written in) — `npm install`
  and `npm run add:android`/`add:ios` are the first real test, on your own
  machine. Paste me the output and I'll help with whatever comes up.
