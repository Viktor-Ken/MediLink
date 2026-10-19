import { Router } from 'express';
import { compare } from '@node-rs/bcrypt';
import pool from '../db.js';
import { requireAuth, requirePatient, signPatientToken, signToken } from '../auth.js';

const router = Router();

const loginWindowMs = 60_000;
const loginMax = Number(process.env.AUTH_RATE_LIMIT ?? 30);
const loginHits = new Map();
setInterval(() => loginHits.clear(), loginWindowMs).unref();

function authRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  const now = Date.now();
  const rec = loginHits.get(ip);
  if (!rec || now - rec.start > loginWindowMs) {
    loginHits.set(ip, { start: now, count: 1 });
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
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const { rows } = await pool.query(
      'SELECT id, username, password_hash, full_name, role, department_id, active FROM staff WHERE username = $1',
      [username.trim()],
    );
    const staff = rows[0];
    if (!staff || !(await compare(password, staff.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (staff.active === false) {
      return res.status(401).json({ error: 'This account has been deactivated' });
    }

    const { password_hash, ...safe } = staff;
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
    const { rows } = await pool.query(
      'SELECT id, patient_no, first_name, last_name, pin_hash FROM patients WHERE patient_no = $1',
      [String(patientNo).trim().toUpperCase()],
    );
    const patient = rows[0];
    if (!patient?.pin_hash || !(await compare(String(pin), patient.pin_hash))) {
      return res.status(401).json({ error: 'Invalid patient number or PIN' });
    }
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