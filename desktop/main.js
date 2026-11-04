// Electron main process for the MediLink desktop app.
//
// This does NOT reimplement the server — it runs the exact same Express app
// (server/src/app.js, staged into resources/server by scripts/prepare.mjs)
// in-process, inside the same Node runtime Electron already provides, then
// opens a native window pointed at it. One codebase, one set of bugs to fix.
//
// Config (DATABASE_URL, JWT_SECRET, etc. — the same keys as server/.env) is
// never bundled into the installer. On first launch, if no config is found,
// a small setup window collects it and writes it to this OS user's app-data
// folder, so the same installer works for any hospital's own database
// without rebuilding, and nobody's real secrets end up inside a shipped .exe.

import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isPackaged = app.isPackaged;
// Packaged: resources/ sits next to the asar, under process.resourcesPath.
// Dev (npm run start before building an installer): resources/ is right here,
// created by `npm run prepare`.
const resourcesDir = isPackaged
  ? join(process.resourcesPath, 'resources')
  : join(__dirname, 'resources');

const configDir = app.getPath('userData');
const configPath = join(configDir, 'config.env');

const REQUIRED_KEYS = ['JWT_SECRET'];

function readConfig() {
  if (!existsSync(configPath)) return {};
  try {
    return dotenv.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function isConfigured(cfg) {
  const hasDb = Boolean(cfg.DATABASE_URL) || Boolean(cfg.PGHOST && cfg.PGPASSWORD);
  return hasDb && REQUIRED_KEYS.every((k) => cfg[k]);
}

function writeConfig(fields) {
  mkdirSync(configDir, { recursive: true });
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v).replace(/\r?\n/g, ' ')}`);
  writeFileSync(configPath, lines.join('\n') + '\n', 'utf8');
}

let mainWindow = null;
let setupWindow = null;
let serverPort = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'MediLink',
    backgroundColor: '#f1f5f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  mainWindow.on('closed', () => { mainWindow = null; });

  // Links the app itself has no reason to navigate to (e.g. a future "visit
  // our site" link) open in the OS browser instead of hijacking the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createSetupWindow(prefill = {}) {
  setupWindow = new BrowserWindow({
    width: 560,
    height: 680,
    title: 'MediLink — Setup',
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f1f5f9',
    webPreferences: {
      preload: join(__dirname, 'setup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setupWindow.loadFile(join(__dirname, 'setup.html'));
  setupWindow.webContents.once('did-finish-load', () => {
    setupWindow.webContents.send('prefill', prefill);
  });
  setupWindow.on('closed', () => { setupWindow = null; });
}

async function startServer(env) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  if (!process.env.PORT) process.env.PORT = '4500';

  // Dynamic import: process.env must be populated first, since db.js reads
  // it at module-load time to build the connection pool.
  // pathToFileURL, not a manually built `file://${path}` string: on Windows a
  // raw path has backslashes and a drive letter, neither of which is valid
  // inside a file:// URL built by hand.
  const appModulePath = join(resourcesDir, 'server', 'src', 'app.js');
  const { createApp } = await import(pathToFileURL(appModulePath).href);
  const expressApp = createApp();

  return new Promise((resolve, reject) => {
    const server = expressApp.listen(Number(process.env.PORT), '127.0.0.1', () => {
      resolve(server.address().port);
    });
    server.on('error', reject);
  });
}

async function boot() {
  const cfg = readConfig();
  if (!isConfigured(cfg)) {
    createSetupWindow(cfg);
    return;
  }
  try {
    serverPort = await startServer(cfg);
    createMainWindow();
  } catch (err) {
    console.error('[medilink-desktop] failed to start server:', err);
    createSetupWindow({ ...cfg, _error: err.message });
  }
}

ipcMain.handle('generate-secret', () => randomBytes(32).toString('hex'));

ipcMain.handle('save-config', async (_event, fields) => {
  writeConfig(fields);
  try {
    serverPort = await startServer(readConfig());
    setupWindow?.close();
    createMainWindow();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'MediLink',
          submenu: [
            {
              label: 'Settings…',
              click: () => {
                if (!setupWindow) createSetupWindow(readConfig());
              },
            },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    );
    boot();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
}
