import { Router } from 'express';
import { compare, hash as hashPassword } from '@node-rs/bcrypt';
import pool from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

router.post('/password', async (req, res, next) => {
  try {
    const b = req.body || {};
    const current = String(b.current_password || '');
    const nextPassword = String(b.new_password || '');

    if (nextPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const { rows } = await pool.query(
      'SELECT password_hash FROM staff WHERE id = $1',
      [req.staff.id],
    );
    if (!rows[0] || !(await compare(current, rows[0].password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const hash = await hashPassword(nextPassword, 10);
    await pool.query('UPDATE staff SET password_hash = $1 WHERE id = $2', [
      hash,
      req.staff.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;