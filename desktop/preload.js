// Preload for the main app window. The window just loads the same web app
// that runs in a browser — no IPC bridge is needed for normal operation.
// This flag lets the web app know it's running inside the desktop shell, in
// case it ever wants to adjust UI (e.g. hide the browser-only PWA install
// button, since the app is already installed).
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('medilinkDesktop', { isDesktop: true });
