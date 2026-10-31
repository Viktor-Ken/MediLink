import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth.js';
import { emitEvent } from '../events.js';
import { cleanText, isUuid, parseDate } from '../util.js';
import { idempotent } from '../idempotency.js';

const router = Router();
router.use(requireAuth);

const TRANSITIONS = { check_in: 'checked_in', complete: 'completed', cancel: 'cancelled', no_show: 'no_show' };

// Which current statuses each status may be reached from.
const FROM = {
  checked_in: ['scheduled'],
  completed: ['scheduled', 'checked_in'],
  cancelled: ['scheduled', 'checked_in'],
  no_show: ['scheduled'],
};

router.get('/', async (req, res, next) => {
  try {
    const me = req.staff.id;
    const myDept = req.staff.department_id;
    const { patientId, mine } = req.query;
    const clauses = [];
    const params = [];
    if (patientId) {
      params.push(patientId);
      clauses.push(`(p.id::text = $${params.length} OR p.patient_no = $${params.length})`);
    }
    if (mine === '1' && !patientId) {
      params.push(myDept, me);
      clauses.push(`(a.department_id = $${params.length - 1} OR a.staff_id = $${params.length} OR a.created_by = $${params.length})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT a.id, a.scheduled_for, a.duration_min, a.reason, a.status, a.created_at,
              p.id AS patient_id, p.patient_no, p.first_name, p.last_name,
              d.name AS department_name,
              s.full_name AS assigned_staff, c.full_name AS created_by_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN departments d ON d.id = a.department_id
       LEFT JOIN staff s ON s.id = a.staff_id
       LEFT JOIN staff c ON c.id = a.created_by
       ${where}
       ORDER BY a.scheduled_for DESC LIMIT 200`,
      params,
    );
    res.json({ appointments: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', idempotent('appointments.create'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const { patientId, departmentId, staffId, scheduledFor, durationMin = 30 } = b;
    const reason = cleanText(b.reason, 500) || undefined;
    if (!patientId || !scheduledFor) {
      return res.status(400).json({ error: 'patientId and scheduledFor are required' });
    }
    const when = parseDate(scheduledFor);
    if (!when) return res.status(400).json({ error: 'scheduledFor is not a valid date' });
    const duration = Number(durationMin);
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
      return res.status(400).json({ error: 'durationMin must be between 5 and 480' });
    }
    if (departmentId && !isUuid(departmentId)) return res.status(400).json({ error: 'Valid department required' });
    if (staffId && !isUuid(staffId)) return res.status(400).json({ error: 'Unknown staff member' });
    const { rows: patients } = await pool.query(
      'SELECT id, patient_no, first_name, last_name FROM patients WHERE id::text = $1 OR patient_no = $1',
      [patientId],
    );
    if (!patients[0]) return res.status(404).json({ error: 'Patient not found' });
    const patient = patients[0];

    const { rows: depts } = await pool.query(
      'SELECT id, name FROM departments WHERE id::text = ANY($1)',
      [[departmentId || req.staff.department_id]],
    );
    const dept = depts[0];
    if (!dept) return res.status(400).json({ error: 'Valid department required' });

    const { rows } = await pool.query(
      `INSERT INTO appointments (patient_id, department_id, staff_id, scheduled_for, duration_min, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, scheduled_for, status`,
      [patient.id, dept.id, staffId || null, when, duration, reason || null, req.staff.id],
    );
    const appointment = rows[0];

    await emitEvent({
      patientId: patient.id,
      staffId: req.staff.id,
      departmentId: dept.id,
      kind: 'appointment_created',
      data: { department: dept.name, scheduledFor, reason },
    });

    res.status(201).json({ appointment: { ...appointment, patient_no: patient.patient_no } });
  } catch (err) {
    next(err);
  }
});

Object.entries(TRANSITIONS).forEach(([action, status]) => {
  router.post(`/:id/${action}`, async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Appointment not found' });
      const { rows } = await pool.query(
        `UPDATE appointments SET status = $1
         WHERE id = $2 AND status = ANY($3)
         RETURNING id, status, patient_id, department_id`,
        [status, req.params.id, FROM[status]],
      );
      if (!rows[0]) {
        const { rows: exists } = await pool.query('SELECT status FROM appointments WHERE id = $1', [req.params.id]);
        if (!exists[0]) return res.status(404).json({ error: 'Appointment not found' });
        return res.status(409).json({ error: `Appointment is ${exists[0].status}; it cannot be ${status}` });
      }
      const appt = rows[0];

      if (status === 'checked_in') {
        await pool.query(
          `INSERT INTO visits (patient_id, department_id, visit_type, reason, status, created_by)
           SELECT $1, $2, 'outpatient', reason, 'active', $3 FROM appointments WHERE id = $4`,
          [appt.patient_id, appt.department_id, req.staff.id, appt.id],
        );
      }
      if (status === 'completed') {
        await pool.query(
          `UPDATE visits SET status = 'closed', ended_at = now()
           WHERE patient_id = $1 AND status = 'active' AND visit_type = 'outpatient'`,
          [appt.patient_id],
        );
      }

      await emitEvent({
        patientId: appt.patient_id,
        staffId: req.staff.id,
        departmentId: appt.department_id,
        kind: `appointment_${status}`,
        data: {},
      });

      res.json({ appointment: rows[0] });
    } catch (err) {
      next(err);
    }
  });
});

export default router;