import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth.js';
import { cleanText, isUuid, parseDate } from '../util.js';

const router = Router();
router.use(requireAuth);

const LIST_SQL = `
  SELECT t.id, t.title, t.details, t.kind, t.ref_type, t.ref_id, t.due_at, t.created_at,
         t.status, d.name AS department_name,
         a.full_name AS assignee_name,
         c.full_name AS created_by_name
  FROM tasks t
  LEFT JOIN departments d ON d.id = t.department_id
  LEFT JOIN staff a ON a.id = t.assignee_id
  LEFT JOIN staff c ON c.id = t.created_by
`;

router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status || null;
    const isAdmin = req.staff.role === 'admin';
    const clauses = isAdmin ? [] : ['(t.department_id = $1 OR t.assignee_id = $2 OR t.created_by = $2)'];
    const params = [];
    if (!isAdmin) params.push(req.staff.department_id, req.staff.id);
    if (status) {
      params.push(status);
      clauses.push(`t.status = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `${LIST_SQL}
       ${where}
       ORDER BY t.created_at DESC LIMIT 500`,
      params,
    );
    res.json({ tasks: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (req.staff.role === 'admin') {
      return res.status(403).json({ error: 'Admins can review but not mutate tasks' });
    }
    const b = req.body || {};
    const title = cleanText(b.title, 200);
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (b.departmentId && !isUuid(b.departmentId)) return res.status(400).json({ error: 'Unknown department' });
    if (b.assigneeId && !isUuid(b.assigneeId)) return res.status(400).json({ error: 'Unknown assignee' });
    const dueAt = b.dueAt ? parseDate(b.dueAt) : null;
    if (b.dueAt && !dueAt) return res.status(400).json({ error: 'dueAt is not a valid date' });

    const { rows } = await pool.query(
      `INSERT INTO tasks (department_id, assignee_id, title, details, due_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, details, kind, due_at, created_at`,
      [
        b.departmentId || req.staff.department_id || null,
        b.assigneeId || null,
        title,
        cleanText(b.details, 5000) || null,
        dueAt,
        req.staff.id,
      ],
    );
    res.status(201).json({ task: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/done', async (req, res, next) => {
  try {
    if (req.staff.role === 'admin') {
      return res.status(403).json({ error: 'Admins can review but not mutate tasks' });
    }
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    // Only people the task is visible to (its department, assignee or creator)
    // may change it.
    const { rows } = await pool.query(
      `UPDATE tasks SET status = 'done', done_at = now()
       WHERE id = $1 AND (department_id = $2 OR assignee_id = $3 OR created_by = $3)
       RETURNING id, status, done_at`,
      [req.params.id, req.staff.department_id, req.staff.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json({ task: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reopen', async (req, res, next) => {
  try {
    if (req.staff.role === 'admin') {
      return res.status(403).json({ error: 'Admins can review but not mutate tasks' });
    }
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    // Only people the task is visible to (its department, assignee or creator)
    // may change it.
    const { rows } = await pool.query(
      `UPDATE tasks SET status = 'open', done_at = NULL
       WHERE id = $1 AND (department_id = $2 OR assignee_id = $3 OR created_by = $3)
       RETURNING id, status, done_at`,
      [req.params.id, req.staff.department_id, req.staff.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json({ task: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;