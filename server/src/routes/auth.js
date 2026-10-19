import { Router } from 'express';
import { compare, hash as hashPassword } from '@node-rs/bcrypt';
import pool from '../db.js';
import {
  createLockout, requireAuth, requirePatient, signPatientToken, signToken,
} from '../auth.js';
import { clerkConfigured, fetchVerifiedEmails, verifyClerkSession } from '../clerk.js';
import { LRU } from '../lru.js';

const router = Router();

const loginWindowMs = 60_000;
const loginMax = Number(process.env.AUTH_RATE_LIMIT ?? 30);
const rateLimitKeys = Math.max(1, Number(process.env.RATE_LIMIT_KEYS) || 10_000);
const loginHits = new LRU({ max: rateLimitKeys, ttlMs: loginWindowMs });

// Per-account lockouts (in addition to the per-IP limiter below).
const staffLockout = createLockout({ maxFails: 8, lockMs: 10 * 60_000 });
const patientLockout = createLockout({ maxFails: 5, lockMs: 15 * 60_000 });

// Compared against when the account does not exist so response time does not
// reveal which usernames / patient numbers are valid.
const DUMMY_HASH = await hashPassword('medilink-timing-equaliser', 10);

function lockedResponse(res, seconds) {
  res.setHeader('Retry-After', String(seconds));
  return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
}

function authRateLimit(req, res, next) {
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const rec = loginHits.get(key);
  if (!rec) {
    loginHits.set(key, { count: 1 });
    return next();
  }
  rec.count++;
  if (rec.count > loginMax) {
    return res.status(429).json({ error: 'Too many login attempts, try again later' });
  }
  next();
}

router.post('/login', authRateLimit, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const uname = username.trim();
    const lockKey = uname.toLowerCase();
    const wait = staffLockout.check(lockKey);
    if (wait) return lockedResponse(res, wait);

    const { rows } = await pool.query(
      'SELECT id, username, password_hash, full_name, role, department_id, active FROM staff WHERE username = $1',
      [uname],
    );
    const staff = rows[0];
    const passwordOk = await compare(password, staff ? staff.password_hash : DUMMY_HASH);
    if (!staff || !passwordOk) {
      staffLockout.fail(lockKey);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (staff.active === false) {
      return res.status(401).json({ error: 'This account has been deactivated' });
    }
    staffLockout.clear(lockKey);

    const { password_hash, ...safe } = staff;
    res.json({ token: signToken(staff), staff: safe });
  } catch (err) {
    next(err);
  }
});

// Single sign-on: exchange a verified Clerk session token for a MediLink JWT.
// Clerk is optional — when the server has no Clerk configuration this route
// reports 503 and the normal username/password login is unaffected.
router.post('/clerk', authRateLimit, async (req, res, next) => {
  try {
    if (!clerkConfigured()) {
      return res.status(503).json({ error: 'Single sign-on is not configured on this server' });
    }
    const header = req.headers.authorization || '';
    const clerkToken = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!clerkToken) {
      return res.status(401).json({ error: 'Missing Clerk session token' });
    }

    let claims;
    try {
      claims = await verifyClerkSession(clerkToken);
    } catch {
      return res.status(401).json({ error: 'Invalid Clerk session' });
    }

    const clerkUserId = String(claims.sub || '');
    if (!clerkUserId) return res.status(401).json({ error: 'Invalid Clerk session' });

    // Prefer a stable link (clerk_user_id); otherwise match on verified email.
    const COLS = 'id, username, password_hash, full_name, role, department_id, active, email, clerk_user_id';
    let { rows } = await pool.query(`SELECT ${COLS} FROM staff WHERE clerk_user_id = $1`, [clerkUserId]);
    let staff = rows[0];

    if (!staff) {
      // Link by email only using addresses Clerk reports as verified for this
      // user. The email in the request body is client-controlled and must never
      // decide which staff account (e.g. an admin) a session is bound to.
      const emails = await fetchVerifiedEmails(clerkUserId);
      if (emails.length) {
        ({ rows } = await pool.query(
          `SELECT ${COLS} FROM staff WHERE lower(email) = ANY($1) AND clerk_user_id IS NULL`,
          [emails],
        ));
        // Exactly one match, otherwise refuse rather than guess.
        staff = rows.length === 1 ? rows[0] : undefined;
        if (staff) {
          const upd = await pool.query(
            'UPDATE staff SET clerk_user_id = $1 WHERE id = $2 AND clerk_user_id IS NULL',
            [clerkUserId, staff.id],
          );
          if (!upd.rowCount) staff = undefined;
        }
      }
    }

    if (!staff) {
      return res.status(403).json({
        error: 'No MediLink account is linked to this sign-in. Ask an administrator to add your email to your staff record.',
      });
    }
    if (staff.active === false) {
      return res.status(401).json({ error: 'This account has been deactivated' });
    }

    const { password_hash, clerk_user_id, ...safe } = staff;
    res.json({ token: signToken(staff), staff: safe });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.username, s.full_name, s.role, s.department_id, d.name AS department
       FROM staff s
       LEFT JOIN departments d ON d.id = s.department_id
       WHERE s.id = $1`,
      [req.staff.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff member not found' });
    res.json({ staff: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/patient-me', requirePatient, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, patient_no, first_name, last_name FROM patients WHERE id = $1`,
      [req.patientId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Patient not found' });
    res.json({ patient: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/patient-login', authRateLimit, async (req, res, next) => {
  try {
    const { patientNo, pin } = req.body || {};
    if (!patientNo || !pin) {
      return res.status(400).json({ error: 'Patient number and PIN are required' });
    }
    const patientKey = String(patientNo).trim().toUpperCase().slice(0, 40);
    const wait = patientLockout.check(patientKey);
    if (wait) return lockedResponse(res, wait);

    const { rows } = await pool.query(
      'SELECT id, patient_no, first_name, last_name, pin_hash FROM patients WHERE patient_no = $1',
      [patientKey],
    );
    const patient = rows[0];
    const pinOk = await compare(String(pin), patient?.pin_hash || DUMMY_HASH);
    if (!patient?.pin_hash || !pinOk) {
      patientLockout.fail(patientKey);
      return res.status(401).json({ error: 'Invalid patient number or PIN' });
    }
    patientLockout.clear(patientKey);
    await pool.query(
      `INSERT INTO patient_events (patient_id, kind, data)
       VALUES ($1, 'portal_login', $2)`,
      [patient.id, JSON.stringify({ patient_no: patient.patient_no })],
    );
    const { pin_hash, ...safe } = patient;
    res.json({ token: signPatientToken(patient), patient: safe });
  } catch (err) {
    next(err);
  }
});

export default router;