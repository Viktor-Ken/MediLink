import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.id, w.name, w.floor,
              jsonb_agg(
                jsonb_build_object(
                  'id', b.id, 'label', b.label, 'status', b.status,
                  'patient_id', p.id, 'patient_no', p.patient_no,
                  'first_name', p.first_name, 'last_name', p.last_name,
                  'admission_id', ad.id
                ) ORDER BY b.label
              ) FILTER (WHERE b.id IS NOT NULL) AS beds
       FROM wards w
       LEFT JOIN beds b ON b.ward_id = w.id
       LEFT JOIN admissions ad ON ad.bed_id = b.id AND ad.status = 'active'
       LEFT JOIN patients p ON p.id = ad.patient_id
       GROUP BY w.id
       ORDER BY w.name`,
    );
    res.json({ wards: rows.map((w) => ({ ...w, beds: w.beds || [] })) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, floor, departmentId } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await pool.query(
      `INSERT INTO wards (name, floor, department_id) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING RETURNING id, name, floor`,
      [name.trim(), floor || null, departmentId || null],
    );
    if (!rows[0]) return res.status(409).json({ error: 'Ward already exists' });
    res.status(201).json({ ward: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:wardId/beds', requireRole('admin'), async (req, res, next) => {
  try {
    const { label } = req.body || {};
    if (!label) return res.status(400).json({ error: 'label is required' });
    const { rows } = await pool.query(
      `INSERT INTO beds (ward_id, label) VALUES ($1, $2)
       ON CONFLICT (ward_id, label) DO NOTHING RETURNING id, label, status`,
      [req.params.wardId, label.trim()],
    );
    if (!rows[0]) return res.status(409).json({ error: 'Bed already exists' });
    res.status(201).json({ bed: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;