import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { emitEvent } from '../events.js';

const router = Router();
router.use(requireAuth);

router.get('/', requireRole('admin', 'doctor', 'nurse', 'lab_scientist'), async (req, res, next) => {
  try {
    const { patientId, kind, status } = req.query;
    const clauses = [];
    const params = [];
    if (patientId) {
      params.push(patientId);
      clauses.push(`(p.id::text = $${params.length} OR p.patient_no = $${params.length})`);
    }
    if (kind) {
      params.push(kind);
      clauses.push(`i.kind = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`i.status = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT i.id, i.kind, i.test_name, i.clinical_note, i.status, i.result_json,
              i.created_at, i.resulted_at,
              p.id AS patient_id, p.patient_no, p.first_name, p.last_name,
              d.name AS department_name,
              s.full_name AS ordered_by_name, r.full_name AS resulted_by_name
       FROM investigations i
       JOIN patients p ON p.id = i.patient_id
       LEFT JOIN departments d ON d.id = i.department_id
       LEFT JOIN staff s ON s.id = i.ordered_by
       LEFT JOIN staff r ON r.id = i.resulted_by
       ${where}
       ORDER BY i.created_at DESC LIMIT 200`,
      params,
    );
    res.json({ investigations: rows });
  } catch (err) {
    next(err);
  }
});

async function findDeptByCode(code) {
  const { rows } = await pool.query('SELECT id FROM departments WHERE code = $1', [code]);
  return rows[0]?.id || null;
}

router.post('/', requireRole('doctor'), async (req, res, next) => {
  try {
    const { patientId, kind, testName, clinicalNote } = req.body || {};
    if (!patientId || !kind || !testName) {
      return res.status(400).json({ error: 'patientId, kind and testName are required' });
    }
    if (!['lab', 'radiology'].includes(kind)) {
      return res.status(400).json({ error: 'kind must be "lab" or "radiology"' });
    }
    const { rows: patients } = await pool.query(
      'SELECT id, patient_no, first_name, last_name FROM patients WHERE id::text = $1 OR patient_no = $1',
      [patientId],
    );
    if (!patients[0]) return res.status(404).json({ error: 'Patient not found' });
    const patient = patients[0];

    const { rows } = await pool.query(
      `INSERT INTO investigations (patient_id, department_id, kind, test_name, clinical_note, ordered_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, kind, test_name, status, created_at`,
      [patient.id, req.staff.department_id, kind, testName.trim(), clinicalNote?.trim() || null, req.staff.id],
    );
    const investigation = rows[0];

    await emitEvent({
      patientId: patient.id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'investigation_ordered',
      data: { type: kind, test: testName.trim(), note: clinicalNote },
    });

    const targetCode = kind === 'radiology' ? 'RAD' : 'MLS';
    const targetDeptId = await findDeptByCode(targetCode);
    if (targetDeptId) {
      await pool.query(
        `INSERT INTO tasks (department_id, title, details, kind, ref_type, ref_id, created_by)
         VALUES ($1, $2, $3, 'investigation', 'investigation', $4, $5)`,
        [
          targetDeptId,
          `${kind === 'radiology' ? 'Radiology' : 'Lab'} order: ${patient.patient_no} ${patient.first_name} ${patient.last_name}`,
          `${testName.trim()}${clinicalNote ? ` — ${clinicalNote}` : ''}`,
          investigation.id,
          req.staff.id,
        ],
      );
    }

    res.status(201).json({ investigation });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/result', requireRole('doctor', 'lab_scientist'), async (req, res, next) => {
  try {
    const { result } = req.body || {};
    if (!result) return res.status(400).json({ error: 'result is required' });
    if (req.staff.role === 'lab_scientist') {
      const { rows: kindRows } = await pool.query(
        'SELECT kind FROM investigations WHERE id = $1',
        [req.params.id],
      );
      if (!kindRows[0]) return res.status(404).json({ error: 'Order not found' });
      if (kindRows[0].kind !== 'lab') {
        return res.status(403).json({ error: 'Lab scientists can only result lab tests' });
      }
    }
    const { rows } = await pool.query(
      `UPDATE investigations SET status = 'resulted', result_json = $1, resulted_by = $2, resulted_at = now()
       WHERE id = $3 AND status IN ('ordered', 'in_progress')
       RETURNING id, status, patient_id, kind, test_name`,
      [JSON.stringify({ text: String(result) }), req.staff.id, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found or not awaiting result' });
    const inv = rows[0];
    await pool.query(
      `UPDATE tasks SET status = 'done', done_at = now()
       WHERE ref_type = 'investigation' AND ref_id = $1 AND status = 'open'`,
      [inv.id],
    );
    await emitEvent({
      patientId: inv.patient_id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'investigation_resulted',
      data: { type: inv.kind, test: inv.test_name, result: String(result) },
    });
    res.json({ investigation: inv });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', requireRole('doctor'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE investigations SET status = 'cancelled'
       WHERE id = $1 AND status IN ('ordered', 'in_progress')
       RETURNING id, status, patient_id`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found or already resolved' });
    const inv = rows[0];
    await pool.query(
      `UPDATE tasks SET status = 'done', done_at = now()
       WHERE ref_type = 'investigation' AND ref_id = $1 AND status = 'open'`,
      [inv.id],
    );
    res.json({ investigation: inv });
  } catch (err) {
    next(err);
  }
});

export default router;