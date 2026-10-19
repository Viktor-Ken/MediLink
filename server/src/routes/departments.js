import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, code, floor, phone_ext, head, hours, description FROM departments ORDER BY name',
    );
    res.json({ departments: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = (b.name || '').trim();
    const code = (b.code || '').trim().replace(/\s+/g, '_').toUpperCase();
    if (!name || !code) {
      return res.status(400).json({ error: 'name and code are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO departments (name, code, floor, phone_ext, head, hours, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id, name, code, floor, phone_ext, head, hours, description`,
      [name, code, b.floor || null, b.phone_ext || null, b.head || null, b.hours || null, b.description || null],
    );
    res.status(201).json({ department: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;