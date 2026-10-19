import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
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
      `SELECT v.id, v.visit_type, v.reason, v.status, v.started_at, v.ended_at,
              p.id AS patient_id, p.patient_no, p.first_name, p.last_name,
              d.name AS department_name,
              s.full_name AS created_by_name
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       LEFT JOIN departments d ON d.id = v.department_id
       LEFT JOIN staff s ON s.id = v.created_by
       ${where}
       ORDER BY v.started_at DESC LIMIT 200`,
      params,
    );
    res.json({ visits: rows });
  } catch (err) {
    next(err);
  }
});

export default router;