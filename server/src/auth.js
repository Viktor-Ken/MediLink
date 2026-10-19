import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { createSecretKey, randomBytes } from 'node:crypto';
import pool from './db.js';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET
  || (process.env.NODE_ENV === 'production'
    ? null
    : randomBytes(48).toString('hex'));

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    '[medilink] JWT_SECRET must be set to a random value of at least 32 characters (use: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))")');
}

if (!process.env.JWT_SECRET) {
  console.log(
    '[medilink] WARNING: JWT_SECRET not set — generated a random secret for this boot. ' +
    'Set JWT_SECRET in server/.env to keep sessions valid across restarts.');
}

// Pre-built symmetric KeyObject: jsonwebtoken's verify() otherwise calls
// createPublicKey(secret) (which throws) then createSecretKey() on EVERY
// request — measured at ~13% of server CPU under load. Same HMAC key material.
const JWT_SECRET_KEY = createSecretKey(Buffer.from(JWT_SECRET, 'utf8'));
const JWT_ALGS = ['HS256'];

export function signToken(staff) {
  return jwt.sign(
    { id: staff.id, username: staff.username, role: staff.role, department_id: staff.department_id },
    JWT_SECRET,
    { expiresIn: '12h', algorithm: 'HS256' },
  );
}

export function signPatientToken(patient) {
  return jwt.sign(
    { pid: patient.id, patient_no: patient.patient_no, role: 'patient' },
    JWT_SECRET,
    { expiresIn: '12h', algorithm: 'HS256' },
  );
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// A signed token alone is not enough: deactivated accounts must lose access
// immediately and role/department changes must apply without waiting for the
// 12h token to expire. A short cache keeps this off the hot path.
const ACCOUNT_TTL_MS = 10_000;
const accountCache = new Map();

async function loadAccount(id) {
  const hit = accountCache.get(id);
  const now = Date.now();
  if (hit && now - hit.at < ACCOUNT_TTL_MS) return hit.row;
  const { rows } = await pool.query(
    'SELECT id, username, role, department_id, active FROM staff WHERE id = $1',
    [id],
  );
  const row = rows[0] || null;
  accountCache.set(id, { at: now, row });
  if (accountCache.size > 5000) accountCache.clear();
  return row;
}

export function invalidateAccount(id) {
  accountCache.delete(id);
}

export async function requireAuth(req, res, next) {
  const token = bearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET_KEY, { algorithms: JWT_ALGS });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (payload.role === 'patient' || !payload.id) {
    return res.status(401).json({ error: 'Staff access only' });
  }
  try {
    const account = await loadAccount(payload.id);
    if (!account || account.active === false) {
      return res.status(401).json({ error: 'Account is no longer active' });
    }
    req.staff = {
      ...payload,
      username: account.username,
      role: account.role,
      department_id: account.department_id,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePatient(req, res, next) {
  const token = bearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET_KEY, { algorithms: JWT_ALGS });
    if (!payload.pid || payload.role !== 'patient') {
      return res.status(401).json({ error: 'Patient access only' });
    }
    req.patientId = payload.pid;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.staff || !roles.includes(req.staff.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Per-account failed-login lockout. The per-IP limiter alone cannot stop a
 * distributed or slow guess against one account (portal PINs are 4-8 digits and
 * patient numbers are sequential). In-memory: per worker process.
 */
export function createLockout({ maxFails = 5, lockMs = 15 * 60_000 } = {}) {
  const rec = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rec) if (v.until < now && now - v.last > lockMs) rec.delete(k);
  }, 60_000).unref();

  return {
    /** Seconds remaining if locked, else 0. */
    check(key) {
      const v = rec.get(key);
      if (v && v.until > Date.now()) return Math.ceil((v.until - Date.now()) / 1000);
      return 0;
    },
    fail(key) {
      const now = Date.now();
      const v = rec.get(key) || { fails: 0, until: 0, last: now };
      if (v.until && v.until <= now) { v.fails = 0; v.until = 0; }
      v.fails += 1;
      v.last = now;
      if (v.fails >= maxFails) v.until = now + lockMs;
      rec.set(key, v);
    },
    clear(key) {
      rec.delete(key);
    },
  };
}
