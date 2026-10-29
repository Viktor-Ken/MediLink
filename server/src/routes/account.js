import { Router } from 'express';
import { compare, hash as hashPassword } from '@node-rs/bcrypt';
import pool from '../db.js';
import { requireAuth, invalidateAccount } from '../auth.js';

const router = Router();
router.use(requireAuth);

router.post('/password', async (req, res, next) => {
  try {
    const b = req.body || {};
    const current = String(b.current_password || '');
    const nextPassword = String(b.new_password || '');

    if (nextPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (nextPassword === current) {
      return res.status(400).json({ error: 'New password must differ from the current one' });
    }
    const { rows } = await pool.query(
      'SELECT password_hash FROM staff WHERE id = $1',
      [req.staff.id],
    );
    if (!rows[0] || !(await compare(current, rows[0].password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const hash = await hashPassword(nextPassword, 10);
    await pool.query(
      'UPDATE staff SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [hash, req.staff.id],
    );
    // A stolen token must not keep working after the owner rotates their
    // password specifically to cut it off. Bumping token_version makes every
    // previously-issued JWT fail requireAuth's version check immediately,
    // and invalidating the cache means the next request sees it right away
    // instead of waiting out the 10s TTL.
    invalidateAccount(req.staff.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;