import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

router.get('/summary', async (req, res, next) => {
  try {
    const dept = req.staff.department_id;
    const me = req.staff.id;

    const [tasks, referrals, handoffs, unread] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS n FROM tasks
         WHERE status = 'open' AND (department_id = $1 OR assignee_id = $2 OR created_by = $2)`,
        [dept, me],
      ),
      pool.query(
        `SELECT count(*)::int AS n FROM referrals
         WHERE status IN ('open', 'accepted') AND to_department_id = $1`,
        [dept],
      ),
      pool.query(
        `SELECT count(*)::int AS n FROM handoffs
         WHERE status IN ('open', 'accepted')
           AND (to_department_id = $1 OR to_staff_id = $2)`,
        [dept, me],
      ),
      pool.query(
        `SELECT count(*)::int AS n FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.sender_id IS DISTINCT FROM $2
           AND (
             (c.kind = 'staff' AND (c.department_id = $1 OR c.created_by = $2))
             OR (c.kind IN ('doctor_patient', 'help')
                 AND ($3::text = 'admin' OR c.created_by = $2 OR c.requester_id = $2))
           )
           AND NOT EXISTS (
             SELECT 1 FROM message_reads r
             WHERE r.message_id = m.id AND r.staff_id = $2
           )`,
        [dept, me, req.staff.role],
      ),
    ]);

    res.json({
      tasks: tasks.rows[0].n,
      referrals: referrals.rows[0].n,
      handoffs: handoffs.rows[0].n,
      unread: unread.rows[0].n,
    });
  } catch (err) {
    next(err);
  }
});

export default router;