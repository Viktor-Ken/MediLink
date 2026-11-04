# MediLink Desktop

A native Windows/Mac/Linux wrapper around the exact same server and web
client as the browser version — no separate app to maintain. On first
launch, a small setup screen collects your database connection and a
session-signing key and saves them to this computer only
(`app.getPath('userData')/config.env`); nothing is bundled into the
installer itself, so the same installer works for any hospital's own
database.

## Build it

From this folder:

```bash
npm install
```

Then, from `web/`, make sure there's a production build to bundle:

```bash
cd ../web
npm install
npm run build
```

Back in `desktop/`, run it in development (no installer, just launches the
app):

```bash
npm start
```

Or build a real installer for your platform:

```bash
npm run dist:win     # Windows .exe (NSIS installer)
npm run dist:mac     # Mac .dmg (must be run on a Mac)
npm run dist:linux   # Linux .AppImage
```

Installers land in `desktop/dist/`.

## How it works

- `main.js` starts the same Express app from `server/src/app.js` in-process
  (not as a subprocess — it's just another module in the same Node runtime
  Electron already provides), then opens a window pointed at
  `http://127.0.0.1:<port>`.
- `scripts/prepare.mjs` stages a copy of `server/` and `web/dist` into
  `desktop/resources/` before each run/build, in the same relative layout the
  server code already expects — so nothing in `server/src` needed to change
  to run inside Electron.
- Config (`DATABASE_URL`, `JWT_SECRET`, etc. — the same keys as
  `server/.env`) is collected by `setup.html` on first run and written to
  this OS user's app-data folder, never into the installer.

## Known rough edges (first pass — check these before shipping to anyone)

- **Icons**: the build config points at `web/public/icons/icon-512.png` for
  all three platforms. Windows and Mac installers look better with real
  `.ico`/`.icns` files — run the PNG through an icon generator (e.g.
  `electron-icon-builder`) and update the `build.win.icon` / `build.mac.icon`
  paths in `package.json` before a real release.
- **Native module (`@node-rs/bcrypt`)**: this is an N-API module, which is
  generally ABI-stable across Node/Electron versions without a rebuild step,
  and it's excluded from the `asar` archive (`asarUnpack`) so its binary can
  load normally. If you hit a "cannot find module" or a native-loading error
  on `npm start`/the packaged app specifically (not on the plain server), try
  `npx electron-rebuild` in this folder first.
- **Code signing**: unsigned builds will trigger a Windows SmartScreen / Mac
  Gatekeeper warning on first run. Fine for internal testing; get a code
  signing certificate before distributing outside your own organization.
- This hasn't been built or run yet in this environment (no network access
  to download Electron here) — the first real build is on your machine.
  Paste me the output of `npm install` / `npm start` and I'll help with
  whatever comes up.
