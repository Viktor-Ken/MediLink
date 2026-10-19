import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { emitEvent } from '../events.js';

const router = Router();
router.use(requireAuth);

const KINDS = ['staff', 'doctor_patient', 'help'];

function canAccess(conv, staff) {
  if (conv.kind === 'staff') {
    return conv.department_id === staff.department_id || conv.created_by === staff.id;
  }
  if (conv.kind === 'doctor_patient') {
    return staff.role === 'admin' || conv.created_by === staff.id;
  }
  if (conv.kind === 'help') {
    return staff.role === 'admin' || conv.created_by === staff.id || conv.requester_id === staff.id;
  }
  return false;
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT c.id, c.subject, c.kind, c.department_id, c.patient_id, c.created_by,
                c.requester_id, c.closed_at, c.created_at,
                d.name AS department_name,
                p.patient_no, p.first_name, p.last_name AS patient_last_name,
                rq.full_name AS requester_name,
                (SELECT count(*)
                 FROM messages m
                 WHERE m.conversation_id = c.id
                   AND m.sender_id IS DISTINCT FROM $2
                   AND NOT EXISTS (
                     SELECT 1 FROM message_reads r
                     WHERE r.message_id = m.id AND r.staff_id = $2
                   )
                )::int AS unread,
                (SELECT m.body FROM messages m
                 WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC LIMIT 1) AS last_body,
                (SELECT m.created_at FROM messages m
                 WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC LIMIT 1) AS last_at
         FROM conversations c
         LEFT JOIN departments d ON d.id = c.department_id
         LEFT JOIN patients p ON p.id = c.patient_id
         LEFT JOIN staff rq ON rq.id = c.requester_id
         WHERE (
               c.kind = 'staff' AND (c.department_id = $1 OR c.created_by = $2)
           ) OR (
               c.kind IN ('doctor_patient', 'help')
               AND ($3::text = 'admin' OR c.created_by = $2 OR c.requester_id = $2)
           )
       ) t
       ORDER BY COALESCE(t.last_at, t.created_at) DESC
       LIMIT 200`,
      [req.staff.department_id, req.staff.id, req.staff.role],
    );
    res.json({ conversations: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const kind = b.kind === 'doctor_patient' || b.kind === 'help' ? b.kind : 'staff';
    const subject = (b.subject || '').trim();
    if (!subject) return res.status(400).json({ error: 'subject is required' });

    const departmentId = b.departmentId || req.staff.department_id;
    const { rows } = await pool.query(
      `INSERT INTO conversations (kind, subject, department_id, patient_id, created_by, requester_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, kind, subject, department_id, patient_id, created_by, created_at`,
      [kind, subject, departmentId || null, b.patientId || null, req.staff.id, req.staff.id],
    );
    res.status(201).json({ conversation: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/doctor-patient', requireRole('admin', 'doctor'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const patientId = b.patientId || b.patient_id;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const { rows: patients } = await pool.query(
      `SELECT id, patient_no, first_name, last_name FROM patients WHERE id::text = $1 OR patient_no = $1`,
      [patientId],
    );
    const patient = patients[0];
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const { rows: existing } = await pool.query(
      `SELECT c.*, p.patient_no, p.first_name, p.last_name AS patient_last_name, p.id AS patient_id
       FROM conversations c
       JOIN patients p ON p.id = c.patient_id
       WHERE c.kind = 'doctor_patient' AND c.created_by = $1 AND c.patient_id = $2
         AND c.closed_at IS NULL
       ORDER BY c.created_at DESC LIMIT 1`,
      [req.staff.id, patient.id],
    );
    if (existing[0]) return res.json({ conversation: existing[0] });

    const subject = `${patient.first_name} ${patient.last_name} · ${patient.patient_no}`;
    const { rows } = await pool.query(
      `INSERT INTO conversations (kind, subject, patient_id, created_by, requester_id)
       VALUES ('doctor_patient', $1, $2, $3, $3)
       RETURNING id, kind, subject, patient_id, created_by, created_at`,
      [subject, patient.id, req.staff.id],
    );
    res.status(201).json({ conversation: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows: convRow } = await pool.query(
      `SELECT c.id, c.subject, c.kind, c.department_id, c.patient_id, c.created_by,
              c.requester_id, c.created_at,
              d.name AS department_name,
              p.first_name, p.last_name, p.patient_no
       FROM conversations c
       LEFT JOIN departments d ON d.id = c.department_id
       LEFT JOIN patients p ON p.id = c.patient_id
       WHERE c.id = $1`,
      [req.params.id],
    );
    const conv = convRow[0];
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!canAccess(conv, req.staff)) {
      return res.status(403).json({ error: 'Conversation not visible to you' });
    }

    await pool.query(
      `INSERT INTO message_reads (message_id, staff_id)
       SELECT id, $2 FROM messages WHERE conversation_id = $1
       ON CONFLICT DO NOTHING`,
      [conv.id, req.staff.id],
    );

    const { rows: messages } = await pool.query(
      `SELECT m.id, m.body, m.created_at, m.sender_id, m.sender_patient_id,
              s.full_name AS sender_name,
              p.first_name, p.last_name AS patient_last_name,
              (r.staff_id IS NOT NULL) AS is_read
       FROM messages m
       LEFT JOIN staff s ON s.id = m.sender_id
       LEFT JOIN patients p ON p.id = m.sender_patient_id
       LEFT JOIN message_reads r ON r.message_id = m.id AND r.staff_id = $2
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conv.id, req.staff.id],
    );

    res.json({ conversation: conv, messages });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/messages', async (req, res, next) => {
  try {
    const b = req.body || {};
    const body = (b.body || '').trim();
    if (!body) return res.status(400).json({ error: 'message body is required' });

    const { rows: convRow } = await pool.query(
      'SELECT * FROM conversations WHERE id = $1',
      [req.params.id],
    );
    const conv = convRow[0];
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!canAccess(conv, req.staff)) {
      return res.status(403).json({ error: 'Conversation not visible to you' });
    }

    const { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, body)
       VALUES ($1, $2, $3) RETURNING id, body, created_at, sender_id`,
      [conv.id, req.staff.id, body],
    );
    const message = rows[0];
    await pool.query(
      `INSERT INTO message_reads (message_id, staff_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [message.id, req.staff.id],
    );

    if (conv.patient_id) {
      await emitEvent({
        patientId: conv.patient_id,
        staffId: req.staff.id,
        departmentId: req.staff.department_id,
        kind: 'message',
        data: { conversation: conv.subject, body, conversationId: conv.id },
      });
    }

    res.status(201).json({
      message: {
        ...message,
        sender_name: req.staff.username,
        sender_patient_id: null,
        is_read: true,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/messages/:id/read', async (req, res, next) => {
  try {
    await pool.query(
      `INSERT INTO message_reads (message_id, staff_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.staff.id],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;