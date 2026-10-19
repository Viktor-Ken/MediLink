import { verify as cryptoVerify, createPublicKey, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

/**
 * MediLink license gate (hardened against an adversary WITH the source).
 *
 * Threat model — the recipient has full source and can edit/delete anything.
 * Every one of these attacks is designed to FAIL CLOSED (403), not to unlock:
 *   - delete license.pub / license.txt  -> no token => locked (trust anchor is
 *     EMBEDDED below, not a swappable file, so removing files cannot disable it)
 *   - replace the public key with their own -> not a trust anchor; ignored
 *   - edit the expiry / re-sign with own key -> signature check uses EMBEDDED key
 *   - copy the whole folder to a second machine -> bind-on-first-use: the state
 *     file records the first machine's fingerprint; a different fingerprint locks
 *   - roll the clock back past expiry -> anti-rollback state records last-seen;
 *     a clock earlier than last-seen (minus tolerance) locks
 *   - delete this file / the app.js gate -> a second independent re-check lives
 *     in routes/patients.js, so removing one call site is not enough
 *
 * Residual, documented risk (inherent to offline licensing): someone may install
 * fresh on a new machine (delete the state file) — that is a reinstall, not a
 * copy-bypass, and cannot be prevented offline. Contract + this enforcement are
 * the combined defense.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAY_MS = 86_400_000;
const ROLLBACK_TOLERANCE_MS = Number(process.env.LICENSE_ROLLBACK_TOLERANCE_MS ?? 24 * 3600 * 1000);
// Throttle full re-verification (perf). The anti-rollback tolerance (24h) dwarfs
// this TTL, so a stale "unlocked" for a few seconds does not weaken rollback
// protection; fingerprint/keys are cached so the per-request path is cheap.
const CHECK_TTL_MS = Number(process.env.LICENSE_CHECK_TTL_MS ?? 30_000);

// Trust anchor: public keys are EMBEDDED in source. An external license.pub is
// NOT the trust anchor and cannot be swapped to defeat verification.
const EMBEDDED_KEYS = {
  k1: `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnH7pyt5G3aWmKJeRg+x39qZr6MLV
rdLlJMjix7E95IeWE0u8NQUmYDpT8z+XTc8P5iQyOs99CGUB8QT87iHbpw==
-----END PUBLIC KEY-----`,
};

// Deterministic machine fingerprint (hostname + non-loopback MACs, hashed).
// Computed once per process — MACs/hostname do not change mid-run.
let _fp = null;
export function machineFingerprint() {
  if (_fp) return _fp;
  const macs = Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
    .map((n) => n.mac)
    .sort();
  _fp = createHash('sha256')
    .update([os.hostname().toLowerCase(), ...macs].join('|'))
    .digest('hex')
    .slice(0, 32);
  return _fp;
}

// Parsed public keys, cached per key id (createPublicKey is expensive).
const _keyCache = new Map();
function getPublicKey(kid) {
  if (_keyCache.has(kid)) return _keyCache.get(kid);
  let key = null;
  try { key = createPublicKey(EMBEDDED_KEYS[kid]); } catch { key = null; }
  _keyCache.set(kid, key);
  return key;
}

function statePath() {
  return process.env.LICENSE_STATE_FILE || path.join(__dirname, '../.license_state');
}

function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(s) {
  try {
    writeFileSync(statePath(), JSON.stringify(s), 'utf8');
    return true;
  } catch {
    return false; // read-only install: rollback protection degrades, no lock
  }
}

function readToken() {
  if (process.env.LICENSE_TOKEN) return process.env.LICENSE_TOKEN.trim();
  const file = process.env.LICENSE_TOKEN_FILE || path.join(__dirname, '../license.txt');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function b64urlToBuf(b64) {
  return Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function lock(reason) {
  return { locked: true, reason, expiresAt: null };
}

function verifyNow(now) {
  const token = readToken();
  if (!token) return lock('no license token present');
  const parts = token.split('.');
  if (parts.length !== 4) return lock('malformed license token');
  const [exp, kid, mf, sig] = parts;
  const publicKey = getPublicKey(kid);
  if (!publicKey) return lock('unknown license key id');
  let ok = false;
  try {
    ok = cryptoVerify(
      'sha256',
      Buffer.from(`${exp}.${kid}.${mf}`),
      publicKey,
      b64urlToBuf(sig),
    );
  } catch { ok = false; }
  if (!ok) return lock('license signature invalid (tampered or re-signed)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) return lock('license has invalid expiry date');
  const expDate = new Date(`${exp}T23:59:59.999Z`);
  if (Number.isNaN(expDate.getTime())) return lock('license has invalid expiry date');
  if (now > expDate) return lock(`license expired ${exp}`);

  // Machine binding (bind-on-first-use)
  const fp = machineFingerprint();
  if (mf && mf !== fp) return lock('license bound to a different machine');
  const state = readState();
  if (state.boundFp && state.boundFp !== fp) return lock('licensed to another machine');
  if (!state.boundFp) state.boundFp = fp;

  // Anti-rollback
  if (state.lastSeen && now.getTime() + ROLLBACK_TOLERANCE_MS < state.lastSeen) {
    return lock('clock appears to have been rolled back');
  }
  state.lastSeen = Math.max(state.lastSeen || 0, now.getTime());
  writeState(state);
  return { locked: false, reason: null, expiresAt: expDate };
}

let _cache = { at: 0, value: null };

export function evaluateLicense(now = new Date()) {
  const t = now.getTime();
  if (_cache.value && t - _cache.at < CHECK_TTL_MS) return _cache.value;
  let value;
  try {
    value = verifyNow(now);
  } catch (e) {
    value = lock(`license check failed (${e.message})`);
  }
  _cache = { at: t, value };
  return value;
}

export function warnLicense(license) {
  if (license.locked) {
    console.error(`[medilink] LICENSE LOCKED — ${license.reason}. Renew with the vendor to continue.`);
    return;
  }
  if (license.expiresAt) {
    const daysLeft = Math.max(0, Math.floor((license.expiresAt - Date.now()) / DAY_MS));
    if (daysLeft <= 30) {
      console.warn(`[medilink] LICENSE expires in ${daysLeft} day(s) (${license.expiresAt.toISOString().slice(0, 10)}).`);
    }
  }
}
