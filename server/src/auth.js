import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';

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

export function signToken(staff) {
  return jwt.sign(
    { id: staff.id, username: staff.username, role: staff.role, department_id: staff.department_id },
    JWT_SECRET,
    { expiresIn: '12h' },
  );
}

export function signPatientToken(patient) {
  return jwt.sign(
    { pid: patient.id, patient_no: patient.patient_no, role: 'patient' },
    JWT_SECRET,
    { expiresIn: '12h' },
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role === 'patient') {
      return res.status(401).json({ error: 'Staff access only' });
    }
    req.staff = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requirePatient(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.pid) {
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