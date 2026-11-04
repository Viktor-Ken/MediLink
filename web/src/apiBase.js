// Web/PWA/Electron builds call the API same-origin (relative /api/...) and
// need nothing set here. A Capacitor mobile build has no same-origin server
// to call — the app's own origin is capacitor://localhost / https://localhost
// — so those builds set VITE_API_BASE_URL at build time to the deployed API's
// real URL (see mobile/README.md), and every fetch below picks it up.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
