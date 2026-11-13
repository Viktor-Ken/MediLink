import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { createSecretKey, randomBytes, randomUUID } from 'node:crypto';
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
// Access tokens are short enough to limit exposure when copied, while the
// database session record lets logout revoke a token immediately rather than
// waiting for this expiry. There is intentionally no silent refresh here.
const TOKEN_TTL = '8h';

/** Create a server-side session before returning a token to a client. */
export async function createSession({ staffId = null, patientId = null }) {
  if (Boolean(staffId) === Boolean(patientId)) {
    throw new Error('A session must belong to exactly one staff member or patient');
  }
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO auth_sessions (id, staff_id, patient_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [id, staffId, patientId, expiresAt],
  );
  return id;
}

export function signToken(staff, sessionId) {
  return jwt.sign(
    {
      id: staff.id,
      username: staff.username,
      role: staff.role,
      department_id: staff.department_id,
      // Snapshot of the account's token_version at issuance. requireAuth
      // rejects the token once this no longer matches the DB value, so
      // bumping token_version (e.g. on a password change) revokes every
      // token issued before that point instead of waiting out its 12h life.
      tv: staff.token_version ?? 0,
    },
    JWT_SECRET,
    { jwtid: sessionId, expiresIn: TOKEN_TTL, algorithm: 'HS256' },
  );
}

export function signPatientToken(patient, sessionId) {
  return jwt.sign(
    { pid: patient.id, patient_no: patient.patient_no, role: 'patient' },
    JWT_SECRET,
    { jwtid: sessionId, expiresIn: TOKEN_TTL, algorithm: 'HS256' },
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
    'SELECT id, username, role, department_id, active, token_version FROM staff WHERE id = $1',
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
    // This read is deliberately uncached: a token copied before logout must
    // stop working on the next request, including requests handled by another
    // clustered worker. The signed jti is only valid while its DB row is active.
    if (!payload.jti) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const { rows: sessions } = await pool.query(
      `SELECT id FROM auth_sessions
       WHERE id = $1 AND staff_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [payload.jti, payload.id],
    );
    if (!sessions[0]) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const account = await loadAccount(payload.id);
    if (!account || account.active === false) {
      return res.status(401).json({ error: 'Account is no longer active' });
    }
    if ((payload.tv ?? 0) !== (account.token_version ?? 0)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
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

export async function requirePatient(req, res, next) {
  const token = bearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET_KEY, { algorithms: JWT_ALGS });
    if (!payload.pid || payload.role !== 'patient') {
      return res.status(401).json({ error: 'Patient access only' });
    }
    if (!payload.jti) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    // Patient sessions use the same server-side revocation check as staff
    // sessions, but remain bound to the patient ID carried by this token.
    const { rows } = await pool.query(
      `SELECT id FROM auth_sessions
       WHERE id = $1 AND patient_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [payload.jti, payload.pid],
    );
    if (!rows[0]) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.patientId = payload.pid;
    req.authSessionId = payload.jti;
    next();
  } catch (err) {
    next(err);
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
 * patient numbers are sequential).
 *
 * Backed by the shared `login_lockouts` table rather than an in-memory Map:
 * this process runs under Node's cluster module with one worker per CPU core
 * by default (see index.js), and an in-memory counter would be tracked
 * separately per worker, multiplying the real guess budget by the worker
 * count. The shared table enforces one limit regardless of which worker
 * handles a given request. `bucket` namespaces keys so the staff and patient
 * lockouts (created separately, below) never collide in the same table.
 */
export function createLockout({ maxFails = 5, lockMs = 15 * 60_000, bucket }) {
  if (!bucket) throw new Error('createLockout requires a bucket name');
  const fullKey = (key) => `${bucket}:${key}`;
  const lockSecs = lockMs / 1000;

  // Sweep this bucket's long-stale rows so the table doesn't grow forever.
  // Runs once per worker on a 10 minute interval — cheap, and harmless if
  // every worker's sweep overlaps since it only ever deletes rows that are
  // already well past any lock window.
  setInterval(() => {
    pool.query(
      `DELETE FROM login_lockouts
       WHERE key LIKE $1 AND last_attempt_at < now() - make_interval(secs => $2)`,
      [`${bucket}:%`, lockSecs * 4],
    ).catch(() => {});
  }, 10 * 60_000).unref();

  return {
    /** Seconds remaining if locked, else 0. */
    async check(key) {
      const { rows } = await pool.query(
        'SELECT locked_until FROM login_lockouts WHERE key = $1',
        [fullKey(key)],
      );
      const until = rows[0]?.locked_until;
      if (until && new Date(until).getTime() > Date.now()) {
        return Math.ceil((new Date(until).getTime() - Date.now()) / 1000);
      }
      return 0;
    },
    async fail(key) {
      // A single upsert: ON CONFLICT takes a row lock, so concurrent
      // failures against the same key (from any worker) still serialize
      // correctly instead of racing. A lockout that has already expired
      // (locked_until is in the past) is treated as a fresh start, matching
      // the original in-memory implementation this replaced.
      await pool.query(
        `INSERT INTO login_lockouts (key, fails, locked_until, last_attempt_at)
         VALUES ($1, 1, NULL, now())
         ON CONFLICT (key) DO UPDATE SET
           fails = CASE
             WHEN login_lockouts.locked_until IS NOT NULL
                  AND login_lockouts.locked_until < now()
               THEN 1
             ELSE login_lockouts.fails + 1
           END,
           locked_until = CASE
             WHEN login_lockouts.locked_until IS NOT NULL
                  AND login_lockouts.locked_until < now()
               THEN NULL
             WHEN (CASE
                     WHEN login_lockouts.locked_until IS NOT NULL
                          AND login_lockouts.locked_until < now()
                       THEN 1
                     ELSE login_lockouts.fails + 1
                   END) >= $2
               THEN now() + make_interval(secs => $3)
             ELSE login_lockouts.locked_until
           END,
           last_attempt_at = now()`,
        [fullKey(key), maxFails, lockSecs],
      );
    },
    async clear(key) {
      await pool.query('DELETE FROM login_lockouts WHERE key = $1', [fullKey(key)]);
    },
  };
}
