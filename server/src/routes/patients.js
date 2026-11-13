import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { hash as hashPassword } from '@node-rs/bcrypt';
import pool, { PATIENT_COLUMNS } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { emitEvent } from '../events.js';
import { evaluateLicense } from '../license.js';
import { caches, invalidate } from '../cache.js';
import { escapeLike } from '../util.js';

const router = Router();
router.use(requireAuth);
// Defense in depth: a second, independent license re-check. Deleting the gate
// in app.js is not enough — this route re-evaluates and fails closed too.
router.use((_req, res, next) => {
  const lic = evaluateLicense();
  if (lic.locked) return res.status(403).json({ error: 'This software license has expired. Contact the vendor to renew.', code: 'LICENSE_LOCKED' });
  next();
});

// Reception and optometry can use shared registration/profile workflows, but
// they do not need national identifiers, medical history, or free-text notes
// for every patient. Keep their API response to operational demographics and
// contacts; clinical roles retain the additional fields needed for treatment.
const PHI_RESTRICTED_ROLES = new Set(['receptionist', 'optometrist']);
const PHI_RESTRICTED_FIELDS = [
  'nin', 'nhis_no', 'blood_type', 'genotype', 'allergies', 'conditions', 'medications', 'notes',
];

function redactPhiForRole(patient, role) {
  if (!patient || !PHI_RESTRICTED_ROLES.has(role)) return patient;
  const copy = { ...patient };
  for (const field of PHI_RESTRICTED_FIELDS) delete copy[field];
  return copy;
}

export function toList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      const { rows } = await pool.query(
        `SELECT ${PATIENT_COLUMNS} FROM patients ORDER BY created_at DESC LIMIT 100`,
      );
      return res.json({ patients: rows.map((p) => redactPhiForRole(p, req.staff.role)) });
    }
    const like = `%${escapeLike(q.slice(0, 100))}%`;
    const { rows } = await pool.query(
      `SELECT ${PATIENT_COLUMNS} FROM patients
       WHERE patient_no ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
          OR nin ILIKE $1 OR nhis_no ILIKE $1
       ORDER BY last_name, first_name LIMIT 50`,
      [like],
    );
    res.json({ patients: rows.map((p) => redactPhiForRole(p, req.staff.role)) });
  } catch (err) {
    next(err);
  }
});

router.get('/count', async (_req, res, next) => {
  try {
    // The dashboard needs a single aggregate, not a page of patient records.
    // This avoids transferring personal data solely to display a count and
    // keeps the displayed total correct beyond the list endpoint's 100-row cap.
    const { rows } = await pool.query('SELECT count(*)::int AS total FROM patients');
    res.json({ total: rows[0].total });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const first = (b.first_name || '').trim();
    const last = (b.last_name || '').trim();
    if (!first || !last) {
      return res.status(400).json({ error: 'first_name and last_name are required' });
    }

    // Never fall back to a guessable PIN: patient numbers are sequential, so a
    // shared default would expose every portal account.
    let portalPin;
    if (b.pin === undefined || b.pin === null || b.pin === '') {
      portalPin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    } else {
      portalPin = String(b.pin);
      if (!/^\d{4,8}$/.test(portalPin)) {
        return res.status(400).json({ error: 'PIN must be 4–8 digits' });
      }
    }
    const pinHash = await hashPassword(portalPin, 10);

    const { rows } = await pool.query(
      `INSERT INTO patients
         (patient_no, first_name, last_name, dob, gender, blood_type, genotype, nin, nhis_no,
          allergies, conditions, medications,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relation, notes,
          pin_hash)
       VALUES
         ('HM-' || nextval('patient_no_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING ${PATIENT_COLUMNS}`,
      [
        first, last,
        b.dob || null, b.gender || null, b.blood_type || null,
        b.genotype || null, b.nin || null, b.nhis_no || null,
        toList(b.allergies) || [], toList(b.conditions) || [], toList(b.medications) || [],
        b.emergency_contact_name || null,
        b.emergency_contact_phone || null,
        b.emergency_contact_relation || null,
        b.notes || null,
        pinHash,
      ],
    );
    const patient = rows[0];
    await pool.query(
      `INSERT INTO patient_consents (patient_id, kind, status, set_via, note)
       VALUES ($1, 'treatment', 'granted', 'staff', 'Implied consent captured at registration')`,
      [patient.id],
    );
    res.status(201).json({ patient: { ...patient, portal_pin: portalPin } });
    emitEvent({
      patientId: patient.id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'registration',
      data: { patient_no: patient.patient_no },
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PATIENT_COLUMNS} FROM patients WHERE id::text = $1 OR patient_no = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Patient not found' });
    res.json({ patient: redactPhiForRole(rows[0], req.staff.role) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows: p } = await pool.query(
      'SELECT id, patient_no FROM patients WHERE id::text = $1 OR patient_no = $1',
      [req.params.id],
    );
    if (!p[0]) return res.status(404).json({ error: 'Patient not found' });
    await pool.query('DELETE FROM patients WHERE id = $1', [p[0].id]);
    invalidate(caches.wards);
    res.json({ success: true, patient_no: p[0].patient_no });
  } catch (err) {
    next(err);
  }
});

const EDITABLE = [
  'first_name', 'last_name', 'dob', 'gender', 'blood_type',
  'genotype', 'nin', 'nhis_no',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'notes',
];

router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = [];
    const params = [];
    let i = 1;

    for (const col of EDITABLE) {
      if (b[col] !== undefined) {
        sets.push(`${col} = $${i++}`);
        params.push(b[col]);
      }
    }
    for (const col of ['allergies', 'conditions', 'medications']) {
      if (b[col] !== undefined) {
        sets.push(`${col} = $${i++}`);
        params.push(toList(b[col]) || []);
      }
    }
    if (sets.length === 0) {
const { rows } = await pool.query(
        `SELECT ${PATIENT_COLUMNS} FROM patients WHERE id::text = $1 OR patient_no = $1`,
        [req.params.id],
      );
      return res.json({ patient: rows[0] });
    }

    sets.push('updated_at = now()');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE patients SET ${sets.join(', ')}
       WHERE id::text = $${i} OR patient_no = $${i}
       RETURNING ${PATIENT_COLUMNS}`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Patient not found' });
    invalidate(caches.wards);
    res.json({ patient: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/scans', async (req, res, next) => {
  try {
    const { rows: p } = await pool.query(
      'SELECT id FROM patients WHERE id::text = $1 OR patient_no = $1',
      [req.params.id],
    );
    if (!p[0]) return res.status(404).json({ error: 'Patient not found' });
    const { rows } = await pool.query(
      `SELECT e.id, e.action, e.location, e.created_at, s.full_name AS staff_name
       FROM scan_events e
       LEFT JOIN staff s ON s.id = e.staff_id
       WHERE e.patient_id = $1
       ORDER BY e.created_at DESC LIMIT 100`,
      [p[0].id],
    );
    res.json({ scans: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/events', async (req, res, next) => {
  try {
    const { rows: p } = await pool.query(
      'SELECT id FROM patients WHERE id::text = $1 OR patient_no = $1',
      [req.params.id],
    );
    if (!p[0]) return res.status(404).json({ error: 'Patient not found' });
    const { rows } = await pool.query(
      `SELECT e.id, e.kind, e.data, e.created_at,
              s.full_name AS staff_name,
              d.name AS department_name
       FROM patient_events e
       LEFT JOIN staff s ON s.id = e.staff_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.patient_id = $1
       ORDER BY e.created_at DESC LIMIT 200`,
      [p[0].id],
    );
    res.json({ events: rows });
  } catch (err) {
    next(err);
  }
});

const CONSENT_KINDS = ['treatment', 'data_sharing', 'research', 'photography'];

router.get('/:id/consents', async (req, res, next) => {
  try {
    const { rows: p } = await pool.query(
      'SELECT id FROM patients WHERE id::text = $1 OR patient_no = $1',
      [req.params.id],
    );
    if (!p[0]) return res.status(404).json({ error: 'Patient not found' });
    const { rows } = await pool.query(
      `SELECT c.kind, c.status, c.note, c.set_via, c.set_at,
              s.full_name AS set_by_name
       FROM patient_consents c
       LEFT JOIN staff s ON s.id = c.set_by_staff
       WHERE c.patient_id = $1
       ORDER BY c.kind`,
      [p[0].id],
    );
    res.json({ consents: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/consents', requireRole('doctor', 'nurse'), async (req, res, next) => {
  try {
    const kind = (req.body?.kind || '').toString();
    const action = (req.body?.action || '').toString();
    if (!CONSENT_KINDS.includes(kind)) {
      return res.status(400).json({ error: 'Unknown consent kind' });
    }
    const status = action === 'revoke' ? 'revoked' : 'granted';
    const { rows: p } = await pool.query(
      'SELECT id, patient_no FROM patients WHERE id::text = $1 OR patient_no = $1',
      [req.params.id],
    );
    if (!p[0]) return res.status(404).json({ error: 'Patient not found' });
    const { rows } = await pool.query(
      `INSERT INTO patient_consents (patient_id, kind, status, note, set_by_staff, set_via)
       VALUES ($1, $2, $3, $4, $5, 'staff')
       ON CONFLICT (patient_id, kind)
       DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note,
                     set_by_staff = EXCLUDED.set_by_staff, set_via = 'staff', set_at = now()
       RETURNING kind, status, set_via, set_at`,
      [p[0].id, kind, status, (req.body?.note || '').trim() || null, req.staff.id],
    );
    res.json({ consent: rows[0] });
    emitEvent({
      patientId: p[0].id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: rows[0].status === 'granted' ? 'consent_granted' : 'consent_revoked',
      data: { kind, patient_no: p[0].patient_no },
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
});

export default router;
