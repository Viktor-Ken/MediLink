import { API_BASE } from './apiBase.js';

const TOKEN_KEY = 'medilink_patient_token';

async function handleLicenseLock() {
  try {
    const { signalLicenseLocked } = await import('./components/LicenseLocked.jsx');
    signalLicenseLocked();
  } catch { /* noop */ }
}

export function getPatientToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setPatientToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearPatientToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function portalApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getPatientToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers });

  if (res.status === 401 && !options.noSessionRedirect) {
    clearPatientToken();
    if (!window.location.pathname.startsWith('/portal')) window.location.replace('/portal');
    return new Promise(() => {});
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 403 && data.code === 'LICENSE_LOCKED') {
    await handleLicenseLock();
    return new Promise(() => {});
  }

  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}