import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth.js';
import { emitEvent } from '../events.js';

const router = Router();
router.use(requireAuth);

const LIST_SQL = `
  SELECT h.id, h.summary, h.status, h.created_at, h.resolved_at,
         p.id AS patient_id, p.patient_no, p.first_name, p.last_name,
         f.name AS from_department, t.name AS to_department,
         fs.full_name AS from_staff, ts.full_name AS to_staff
  FROM handoffs h
  JOIN patients p ON p.id = h.patient_id
  LEFT JOIN departments f ON f.id = h.from_department_id
  LEFT JOIN departments t ON t.id = h.to_department_id
  LEFT JOIN staff fs ON fs.id = h.from_staff_id
  LEFT JOIN staff ts ON ts.id = h.to_staff_id
`;

async function loadHandoff(id) {
  const { rows } = await pool.query('SELECT * FROM handoffs WHERE id = $1', [id]);
  return rows[0];
}

function canActOn(staff, handoff) {
  if (!staff.department_id) return true;
  if (handoff.from_department_id && handoff.from_department_id === staff.department_id) return true;
  if (handoff.to_department_id && handoff.to_department_id === staff.department_id) return true;
  if (handoff.to_staff_id) return handoff.to_staff_id === staff.id || !staff.department_id;
  return !staff.department_id && !handoff.to_staff_id;
}

router.get('/', async (req, res, next) => {
  try {
    if (req.staff.role === 'admin') {
      const { rows } = await pool.query(`${LIST_SQL} ORDER BY h.created_at DESC LIMIT 500`);
      return res.json({ handoffs: rows });
    }
    const { rows } = await pool.query(
      `${LIST_SQL}
       WHERE (h.from_department_id = $1 OR h.to_department_id = $1 OR h.to_staff_id = $2)
       ORDER BY h.created_at DESC LIMIT 200`,
      [req.staff.department_id, req.staff.id],
    );
    res.json({ handoffs: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (req.staff.role === 'admin') {
      return res.status(403).json({ error: 'Admins can review but not create handoffs' });
    }
    const b = req.body || {};
    const { patientId, toDepartmentId, toStaffId = null, summary } = b;
    if (!patientId || !summary) {
      return res.status(400).json({ error: 'patientId and summary are required' });
    }

    const { rows: patients } = await pool.query(
      'SELECT id, patient_no, first_name, last_name FROM patients WHERE id::text = $1 OR patient_no = $1',
      [patientId],
    );
    if (!patients[0]) return res.status(404).json({ error: 'Patient not found' });
    const patient = patients[0];

    const { rows: depts } = await pool.query(
      'SELECT id, name FROM departments WHERE id::text = ANY($1)',
      [[req.staff.department_id, toDepartmentId]],
    );
    const deptName = Object.fromEntries(depts.map((d) => [d.id, d.name]));

    const { rows } = await pool.query(
      `INSERT INTO handoffs (patient_id, from_department_id, to_department_id, from_staff_id, to_staff_id, summary)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [patient.id, req.staff.department_id, toDepartmentId || null, req.staff.id, toStaffId || null, summary.trim()],
    );
    const handoff = rows[0];

    await emitEvent({
      patientId: patient.id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'handoff_created',
      data: {
        from: deptName[req.staff.department_id] || null,
        to: toDepartmentId ? deptName[toDepartmentId] : null,
        summary,
      },
    });
    await pool.query(
      `INSERT INTO tasks (department_id, assignee_id, title, details, kind, ref_type, ref_id, created_by)
       VALUES ($1, $2, $3, $4, 'handoff', 'handoff', $5, $6)`,
      [
        toDepartmentId || req.staff.department_id,
        toStaffId,
        `Handoff: ${patient.patient_no} ${patient.first_name} ${patient.last_name}`,
        summary,
        handoff.id,
        req.staff.id,
      ],
    );

    res.status(201).json({ handoff });
  } catch (err) {
    next(err);
  }
});

['accept', 'complete'].forEach((action) => {
  router.post(`/:id/${action}`, async (req, res, next) => {
    try {
      if (req.staff.role === 'admin') {
        return res.status(403).json({ error: 'Admins can review but not act on handoffs' });
      }
      const handoff = await loadHandoff(req.params.id);
      if (!handoff) return res.status(404).json({ error: 'Handoff not found' });
      if (!canActOn(req.staff, handoff)) {
        return res.status(403).json({ error: 'Not your department handoff' });
      }

      const status = action === 'accept' ? 'accepted' : 'completed';
      const { rows } = await pool.query(
        `UPDATE handoffs SET status = $1, resolved_at = $2 WHERE id = $3 RETURNING id, status, resolved_at`,
        [status, action === 'accept' ? null : new Date(), handoff.id],
      );
      await pool.query(
        `UPDATE tasks SET status = 'done', done_at = now()
         WHERE ref_type = 'handoff' AND ref_id = $1 AND status = 'open'`,
        [handoff.id],
      );
      await emitEvent({
        patientId: handoff.patient_id,
        staffId: req.staff.id,
        departmentId: req.staff.department_id,
        kind: `handoff_${action === 'accept' ? 'accepted' : 'completed'}`,
        data: { summary: handoff.summary },
      });

      res.json({ handoff: rows[0] });
    } catch (err) {
      next(err);
    }
  });
});

export default router;