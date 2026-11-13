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

// Keep the token only long enough to revoke its matching database session.
export async function revokePatientSession() {
  const token = getPatientToken();
  clearPatientToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/api/auth/patient-logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Local sign-out still completes if the network is unavailable.
  }
}

export async function portalApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getPatientToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers });

  if (res.status === 401 && !options.noSessionRedirect) {
    clearPatientToken();
    if (window.location.pathname !== '/portal/login') window.location.replace('/portal/login');
    // Settle protected-page requests so stale content cannot remain after expiry.
    throw new Error('Patient session expired; please sign in again.');
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 403 && data.code === 'LICENSE_LOCKED') {
    await handleLicenseLock();
    return new Promise(() => {});
  }

  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}