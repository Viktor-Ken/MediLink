import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { emitEvent } from '../events.js';
import { caches, invalidate } from '../cache.js';
import { cleanText, isUuid } from '../util.js';

const router = Router();
router.use(requireAuth);

const LIST_SQL = `
  SELECT ad.id, ad.reason, ad.admitted_at, ad.discharged_at, ad.status,
         p.id AS patient_id, p.patient_no, p.first_name, p.last_name,
         w.name AS ward_name, w.id AS ward_id,
         b.id AS bed_id, b.label AS bed_label,
         s.full_name AS admitted_by_name
  FROM admissions ad
  JOIN patients p ON p.id = ad.patient_id
  LEFT JOIN wards w ON w.id = ad.ward_id
  LEFT JOIN beds b ON b.id = ad.bed_id
  LEFT JOIN staff s ON s.id = ad.admitted_by
`;

router.get('/', async (req, res, next) => {
  try {
    const { patientId, status } = req.query;
    const clauses = [];
    const params = [];
    if (patientId) {
      params.push(patientId);
      clauses.push(`(p.id::text = $${params.length} OR p.patient_no = $${params.length})`);
    }
    if (status) {
      params.push(status);
      clauses.push(`ad.status = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `${LIST_SQL} ${where} ORDER BY ad.admitted_at DESC LIMIT 200`,
      params,
    );
    res.json({ admissions: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('doctor', 'nurse'), async (req, res, next) => {
  const { patientId, wardId, reason } = req.body || {};
  if (!patientId) {
    return res.status(400).json({ error: 'patientId is required' });
  }
  if (wardId && !isUuid(wardId)) {
    return res.status(400).json({ error: 'Unknown ward' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Locking the patient row serialises concurrent admissions of the same
    // patient, so the "already admitted" check cannot be raced.
    const { rows: patients } = await client.query(
      `SELECT id, patient_no, first_name, last_name FROM patients
       WHERE id::text = $1 OR patient_no = $1 FOR UPDATE`,
      [String(patientId)],
    );
    if (!patients[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Patient not found' });
    }
    const patient = patients[0];

    const { rows: activeRows } = await client.query(
      `SELECT id FROM admissions WHERE patient_id = $1 AND status = 'active'`,
      [patient.id],
    );
    if (activeRows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Patient is already admitted' });
    }

    // SKIP LOCKED: two simultaneous admissions can never be handed the same bed.
    const { rows: bedRows } = await client.query(
      `SELECT b.id AS bed_id, b.label, w.id AS ward_id, w.name AS ward_name
       FROM beds b JOIN wards w ON w.id = b.ward_id
       WHERE b.status = 'available' AND ($1::uuid IS NULL OR w.id = $1)
       ORDER BY w.name, b.label
       LIMIT 1
       FOR UPDATE OF b SKIP LOCKED`,
      [wardId || null],
    );
    if (!bedRows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No available bed in that ward' });
    }
    const bed = bedRows[0];
    const cleanReason = cleanText(reason, 1000) || null;

    const { rows } = await client.query(
      `INSERT INTO admissions (patient_id, ward_id, bed_id, reason, admitted_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, admitted_at, status`,
      [patient.id, bed.ward_id, bed.bed_id, cleanReason, req.staff.id],
    );
    await client.query(`UPDATE beds SET status = 'occupied' WHERE id = $1`, [bed.bed_id]);
    await client.query(
      `INSERT INTO visits (patient_id, department_id, visit_type, reason, status, created_by)
       VALUES ($1, $2, 'admission', $3, 'active', $4)`,
      [patient.id, req.staff.department_id, cleanReason, req.staff.id],
    );
    await client.query('COMMIT');
    invalidate(caches.wards);

    await emitEvent({
      patientId: patient.id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'admission_admitted',
      data: { ward: bed.ward_name, bed: bed.label, reason: cleanReason },
    });

    res.status(201).json({
      admission: {
        ...rows[0],
        ward_id: bed.ward_id,
        ward_name: bed.ward_name,
        bed_id: bed.bed_id,
        bed_label: bed.label,
        patient_id: patient.id,
        patient_no: patient.patient_no,
        first_name: patient.first_name,
        last_name: patient.last_name,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.post('/:id/discharge', requireRole('doctor'), async (req, res, next) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Active admission not found' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE admissions SET status = 'discharged', discharged_at = now()
       WHERE id = $1 AND status = 'active'
       RETURNING id, patient_id, ward_id, bed_id, discharged_at, status`,
      [req.params.id],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active admission not found' });
    }
    const admission = rows[0];

    if (admission.bed_id) {
      await client.query(`UPDATE beds SET status = 'available' WHERE id = $1`, [admission.bed_id]);
    }
    // Only the inpatient visit ends at discharge; an open outpatient visit
    // (e.g. a clinic appointment the same day) must stay active.
    await client.query(
      `UPDATE visits SET status = 'closed', ended_at = now()
       WHERE patient_id = $1 AND status = 'active' AND visit_type = 'admission'`,
      [admission.patient_id],
    );
    await client.query('COMMIT');
    invalidate(caches.wards);

    await emitEvent({
      patientId: admission.patient_id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'admission_discharged',
      data: {},
    });

    res.json({ admission });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

export default router;