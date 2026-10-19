import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { emitEvent } from '../events.js';

const router = Router();
router.use(requireAuth);

router.get('/', requireRole('admin', 'doctor', 'nurse'), async (req, res, next) => {
  try {
    const { patientId } = req.query;
    const clauses = [];
    const params = [];
    if (patientId) {
      params.push(patientId);
      clauses.push(`(p.id::text = $${params.length} OR p.patient_no = $${params.length})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT n.id, n.note_type, n.body, n.created_at,
              p.id AS patient_id, p.patient_no, p.first_name, p.last_name,
              s.full_name AS staff_name
       FROM clinical_notes n
       JOIN patients p ON p.id = n.patient_id
       LEFT JOIN staff s ON s.id = n.staff_id
       ${where}
       ORDER BY n.created_at DESC LIMIT 200`,
      params,
    );
    res.json({ notes: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('doctor', 'nurse'), async (req, res, next) => {
  try {
    const { patientId, noteType = 'progress', body } = req.body || {};
    if (!patientId || !body?.trim()) {
      return res.status(400).json({ error: 'patientId and body are required' });
    }
    if (!['triage', 'progress', 'consult', 'discharge_summary'].includes(noteType)) {
      return res.status(400).json({ error: 'Invalid noteType' });
    }
    if (req.staff.role === 'nurse' && noteType !== 'triage') {
      return res.status(403).json({ error: 'Nurses can only write triage notes' });
    }
    const { rows: patients } = await pool.query(
      'SELECT id, patient_no, first_name, last_name FROM patients WHERE id::text = $1 OR patient_no = $1',
      [patientId],
    );
    if (!patients[0]) return res.status(404).json({ error: 'Patient not found' });
    const patient = patients[0];

    const { rows } = await pool.query(
      `INSERT INTO clinical_notes (patient_id, staff_id, note_type, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, note_type, body, created_at`,
      [patient.id, req.staff.id, noteType, body.trim()],
    );

    await emitEvent({
      patientId: patient.id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'note_added',
      data: { type: noteType },
    });

    res.status(201).json({ note: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;