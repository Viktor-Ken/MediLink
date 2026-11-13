import { API_BASE } from './apiBase.js';

const TOKEN_KEY = 'medilink_token';

async function handleLicenseLock() {
  try {
    const { signalLicenseLocked } = await import('./components/LicenseLocked.jsx');
    signalLicenseLocked();
  } catch { /* noop */ }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers });

  if (res.status === 401 && !options.noSessionRedirect) {
    clearToken();
    if (window.location.pathname !== '/login') window.location.replace('/login');
    // Reject the request so AuthProvider can finish loading and render the login route.
    throw new Error('Session expired; please sign in again.');
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 403 && data.code === 'LICENSE_LOCKED') {
    await handleLicenseLock();
    return new Promise(() => {});
  }

  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}