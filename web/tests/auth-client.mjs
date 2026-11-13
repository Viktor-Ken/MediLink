/** Client regression checks for expired/revoked session redirects. */
import assert from 'node:assert/strict';
import { api, setToken, getToken } from '../src/api.js';
import { portalApi, setPatientToken, getPatientToken } from '../src/portalApi.js';

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const redirects = [];
globalThis.window = { location: { pathname: '/dashboard', replace: (path) => redirects.push(path) } };
globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
  status: 401,
  headers: { 'Content-Type': 'application/json' },
});

setToken('expired-staff-token');
await assert.rejects(api('/auth/me'), /Session expired/);
assert.equal(getToken(), null, 'staff token is cleared on a 401');
assert.deepEqual(redirects.splice(0), ['/login'], 'staff app starts its login redirect');

window.location.pathname = '/portal/record';
setPatientToken('expired-patient-token');
await assert.rejects(portalApi('/portal/me'), /Patient session expired/);
assert.equal(getPatientToken(), null, 'patient token is cleared on a 401');
assert.deepEqual(redirects, ['/portal/login'], 'portal leaves the protected page after a 401');

console.log('PASS expired staff and patient sessions clear state, redirect, and settle their requests');
