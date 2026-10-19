import { Router } from 'express';
import pool, { PATIENT_COLUMNS } from '../db.js';
import { requireAuth } from '../auth.js';
import { emitEvent } from '../events.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await pool.query(
      `SELECT e.id, e.action, e.location, e.created_at,
              p.id AS patient_id, p.patient_no, p.first_name, p.last_name,
              s.full_name AS staff_name
       FROM scan_events e
       JOIN patients p ON p.id = e.patient_id
       LEFT JOIN staff s ON s.id = e.staff_id
       ORDER BY e.created_at DESC
       LIMIT $1`,
      [limit],
    );
    res.json({ scans: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { patientId, location, action } = req.body || {};
    if (!patientId) {
      return res.status(400).json({ error: 'patientId is required' });
    }

    const { rows: patients } = await pool.query(
      `SELECT ${PATIENT_COLUMNS} FROM patients WHERE id::text = $1 OR patient_no = $1`,
      [patientId],
    );
    const patient = patients[0];
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const { rows } = await pool.query(
      `INSERT INTO scan_events (patient_id, staff_id, location, action)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [patient.id, req.staff.id || null, location || null, action || 'scan'],
    );

    emitEvent({
      patientId: patient.id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'scan',
      data: { location, action: action || 'scan' },
    }).catch(() => {});

    res.status(201).json({ ok: true, patient, scan: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;