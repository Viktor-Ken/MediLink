import { Router } from 'express';
import { hash as hashPassword } from '@node-rs/bcrypt';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { caches, invalidate, load } from '../cache.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole('admin'));

const ROLES = ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'optometrist', 'lab_scientist'];

const LIST_SQL = `
  SELECT s.id, s.username, s.full_name, s.role, s.active, s.created_at, s.email,
         (s.clerk_user_id IS NOT NULL) AS sso_linked,
         d.name AS department_name, d.code AS department_code
  FROM staff s
  LEFT JOIN departments d ON d.id = s.department_id
`;

router.get('/', async (req, res, next) => {
  try {
    const { value, hit } = await load(caches.staff, 'all', async () => {
      const { rows } = await pool.query(`${LIST_SQL} ORDER BY s.created_at`);
      return rows;
    });
    res.set('X-Cache', hit ? 'HIT' : 'MISS');
    res.json({ staff: value });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const username = (b.username || '').trim();
    const password = (b.password || '').toString();
    const fullName = (b.full_name || '').trim();
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!fullName) {
      return res.status(400).json({ error: 'full_name is required' });
    }
    const role = ROLES.includes(b.role) ? b.role : null;
    if (!role) {
      return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
    }
    if (b.department_id) {
      const { rows: depts } = await pool.query('SELECT id FROM departments WHERE id = $1', [b.department_id]);
      if (!depts[0]) return res.status(400).json({ error: 'Unknown department_id' });
    }

    // Optional email — used to link a Clerk single-sign-on identity to this account.
    let email = null;
    if (b.email !== undefined && b.email !== null && String(b.email).trim() !== '') {
      email = String(b.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'email is not valid' });
      }
    }

    const passwordHash = await hashPassword(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO staff (username, password_hash, full_name, role, department_id, email)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO UPDATE SET active = TRUE, password_hash = EXCLUDED.password_hash,
         full_name = EXCLUDED.full_name, role = EXCLUDED.role, department_id = EXCLUDED.department_id,
         email = COALESCE(EXCLUDED.email, staff.email)
       RETURNING id, username, full_name, role, department_id, active, email`,
      [username, passwordHash, fullName, role, b.department_id || null, email],
    );
    invalidate(caches.staff);
    res.status(201).json({ staff: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.staff.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const { rows } = await pool.query(
      `UPDATE staff SET active = FALSE WHERE id = $1 AND active = TRUE
       RETURNING id, username, full_name, role`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Active staff member not found' });
    invalidate(caches.staff);
    res.json({ staff: { ...rows[0], active: false } });
  } catch (err) {
    next(err);
  }
});

export default router;