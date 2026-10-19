import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { emitEvent } from '../events.js';
import { cleanText, isUuid } from '../util.js';

const router = Router();
router.use(requireAuth);

const LIST_SQL = `
  SELECT r.id, r.priority, r.reason, r.status, r.created_at, r.resolved_at,
         p.id AS patient_id, p.patient_no, p.first_name, p.last_name,
         f.name AS from_department, t.name AS to_department,
         s.full_name AS created_by_name
  FROM referrals r
  JOIN patients p ON p.id = r.patient_id
  JOIN departments f ON f.id = r.from_department_id
  JOIN departments t ON t.id = r.to_department_id
  LEFT JOIN staff s ON s.id = r.created_by
`;

async function loadReferral(id) {
  const { rows } = await pool.query('SELECT * FROM referrals WHERE id = $1', [id]);
  return rows[0];
}

// Staff without a department get no blanket access; only the two departments
// named on the referral may act on it.
function canActOn(staff, referral) {
  if (!staff.department_id) return false;
  return (
    staff.department_id === referral.from_department_id ||
    staff.department_id === referral.to_department_id
  );
}

// Which current statuses each action may be applied to.
const ALLOWED_FROM = {
  accept: ['open'],
  decline: ['open', 'accepted'],
  complete: ['open', 'accepted'],
};

async function resolveRelatedRefTask(refId) {
  await pool.query(
    `UPDATE tasks SET status = 'done', done_at = now()
     WHERE ref_type = 'referral' AND ref_id = $1 AND status = 'open'`,
    [refId],
  );
}

router.get('/', async (req, res, next) => {
  try {
    if (req.staff.role === 'admin') {
      const { rows } = await pool.query(
        `${LIST_SQL} ORDER BY r.created_at DESC LIMIT 500`,
      );
      return res.json({ referrals: rows });
    }
    const { rows } = await pool.query(
      `${LIST_SQL}
       WHERE r.from_department_id = $1 OR r.to_department_id = $1
       ORDER BY r.created_at DESC LIMIT 200`,
      [req.staff.department_id],
    );
    res.json({ referrals: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('doctor', 'nurse'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const { patientId, toDepartmentId, priority = 'routine' } = b;
    const reason = cleanText(b.reason, 2000);
    if (!patientId || !toDepartmentId || !reason) {
      return res.status(400).json({ error: 'patientId, toDepartmentId and reason are required' });
    }
    if (!isUuid(toDepartmentId)) return res.status(400).json({ error: 'Unknown receiving department' });
    if (!['stat', 'urgent', 'routine'].includes(priority)) {
      return res.status(400).json({ error: 'priority must be stat, urgent or routine' });
    }
    if (toDepartmentId === req.staff.department_id) {
      return res.status(400).json({ error: 'Receiving department must differ from your own' });
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
    if (!req.staff.department_id || !deptName[toDepartmentId]) {
      return res.status(400).json({ error: 'You must belong to a department to refer' });
    }

    const { rows } = await pool.query(
      `INSERT INTO referrals (patient_id, from_department_id, to_department_id, priority, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [patient.id, req.staff.department_id, toDepartmentId, priority, reason, req.staff.id],
    );
    const referral = rows[0];

    await emitEvent({
      patientId: patient.id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'referral_created',
      data: { from: deptName[req.staff.department_id], to: deptName[toDepartmentId], priority, reason },
    });
    await pool.query(
      `INSERT INTO tasks (department_id, title, details, kind, ref_type, ref_id, created_by)
       VALUES ($1, $2, $3, 'referral', 'referral', $4, $5)`,
      [
        toDepartmentId,
        `Referral: ${patient.patient_no} ${patient.first_name} ${patient.last_name} → ${deptName[toDepartmentId]}`,
        `${priority} · ${reason}`,
        referral.id,
        req.staff.id,
      ],
    );

    res.status(201).json({ referral });
  } catch (err) {
    next(err);
  }
});

['accept', 'decline', 'complete'].forEach((action) => {
  router.post(`/:id/${action}`, async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Referral not found' });
      const referral = await loadReferral(req.params.id);
      if (!referral) return res.status(404).json({ error: 'Referral not found' });
      if (req.staff.role === 'admin') {
        return res.status(403).json({ error: 'Admins can review but not act on referrals' });
      }
      if (!canActOn(req.staff, referral)) {
        return res.status(403).json({ error: 'Only the involved departments can act on this referral' });
      }

      const statusMap = { accept: 'accepted', decline: 'declined', complete: 'completed' };
      const status = statusMap[action];
      const resolved = status === 'accepted' ? null : new Date();

      const { rows } = await pool.query(
        `UPDATE referrals SET status = $1, resolved_at = $2
         WHERE id = $3 AND status = ANY($4)
         RETURNING id, status, resolved_at`,
        [status, resolved, referral.id, ALLOWED_FROM[action]],
      );
      if (!rows[0]) {
        return res.status(409).json({ error: `Referral is ${referral.status}; it cannot be ${status}` });
      }
      await resolveRelatedRefTask(referral.id);

      await emitEvent({
        patientId: referral.patient_id,
        staffId: req.staff.id,
        departmentId: req.staff.department_id,
        kind: `referral_${action === 'accept' ? 'accepted' : action === 'complete' ? 'completed' : 'declined'}`,
        data: { reason: referral.reason },
      });

      res.json({ referral: rows[0] });
    } catch (err) {
      next(err);
    }
  });
});

export default router;