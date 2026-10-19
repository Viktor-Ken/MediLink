import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { emitEvent } from '../events.js';

const router = Router();
router.use(requireAuth);

async function findPharmacyDept() {
  const { rows } = await pool.query("SELECT id FROM departments WHERE code = 'PHARM'");
  return rows[0]?.id || null;
}

router.get('/', requireRole('admin', 'doctor', 'pharmacist', 'nurse'), async (req, res, next) => {
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
      `SELECT pr.id, pr.status, pr.notes, pr.created_at,
              p.id AS patient_id, p.patient_no, p.first_name, p.last_name,
              s.full_name AS prescribed_by_name,
              jsonb_agg(
                jsonb_build_object(
                  'id', pi.id, 'drug_name', pi.drug_name, 'dose', pi.dose,
                  'frequency', pi.frequency, 'route', pi.route, 'duration_days', pi.duration_days
                ) ORDER BY pi.id
              ) FILTER (WHERE pi.id IS NOT NULL) AS items
       FROM prescriptions pr
       JOIN patients p ON p.id = pr.patient_id
       LEFT JOIN staff s ON s.id = pr.prescribed_by
       LEFT JOIN prescription_items pi ON pi.prescription_id = pr.id
       ${where}
       GROUP BY pr.id, p.id, s.full_name
       ORDER BY pr.created_at DESC LIMIT 200`,
      params,
    );
    res.json({ prescriptions: rows.map((r) => ({ ...r, items: r.items || [] })) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('doctor'), async (req, res, next) => {
  try {
    const { patientId, notes, items = [] } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    if (!Array.isArray(items) || !items.length || items.some((i) => !i.drugName)) {
      return res.status(400).json({ error: 'At least one item with a drugName is required' });
    }
    const { rows: patients } = await pool.query(
      'SELECT id, patient_no, first_name, last_name FROM patients WHERE id::text = $1 OR patient_no = $1',
      [patientId],
    );
    if (!patients[0]) return res.status(404).json({ error: 'Patient not found' });
    const patient = patients[0];

    const { rows } = await pool.query(
      `INSERT INTO prescriptions (patient_id, prescribed_by, status, notes)
       VALUES ($1, $2, 'active', $3)
       RETURNING id, status, created_at`,
      [patient.id, req.staff.id, notes || null],
    );
    const prescription = rows[0];

    for (const item of items) {
      await pool.query(
        `INSERT INTO prescription_items (prescription_id, drug_name, dose, frequency, route, duration_days)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          prescription.id,
          item.drugName.trim(),
          item.dose?.trim() || null,
          item.frequency?.trim() || null,
          item.route?.trim() || 'oral',
          item.durationDays ? Number(item.durationDays) : null,
        ],
      );
    }

    await emitEvent({
      patientId: patient.id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'prescription_created',
      data: { drugs: items.map((i) => i.drugName).join(', '), notes },
    });

    const pharmDeptId = await findPharmacyDept();
    if (pharmDeptId) {
      await pool.query(
        `INSERT INTO tasks (department_id, title, details, kind, ref_type, ref_id, created_by)
         VALUES ($1, $2, $3, 'medication', 'prescription', $4, $5)`,
        [
          pharmDeptId,
          `Dispense: Rx for ${patient.patient_no} ${patient.first_name} ${patient.last_name}`,
          items.map((i) => `${i.drugName}${i.dose ? ` ${i.dose}` : ''}${i.frequency ? ` — ${i.frequency}` : ''}`).join('; '),
          prescription.id,
          req.staff.id,
        ],
      );
    }

    res.status(201).json({ prescription });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/dispense', requireRole('pharmacist'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE prescriptions SET status = 'dispensed' WHERE id = $1 AND status = 'active'
       RETURNING id, status, patient_id`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Active prescription not found' });
    const rx = rows[0];
    await pool.query(
      `UPDATE tasks SET status = 'done', done_at = now()
       WHERE ref_type = 'prescription' AND ref_id = $1 AND status = 'open'`,
      [rx.id],
    );
    await emitEvent({
      patientId: rx.patient_id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'prescription_dispensed',
      data: {},
    });
    res.json({ prescription: rx });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', requireRole('doctor', 'pharmacist'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE prescriptions SET status = 'cancelled' WHERE id = $1 AND status = 'active'
       RETURNING id, status, patient_id`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Active prescription not found' });
    const rx = rows[0];
    await pool.query(
      `UPDATE tasks SET status = 'done', done_at = now()
       WHERE ref_type = 'prescription' AND ref_id = $1 AND status = 'open'`,
      [rx.id],
    );
    res.json({ prescription: rx });
  } catch (err) {
    next(err);
  }
});

export default router;