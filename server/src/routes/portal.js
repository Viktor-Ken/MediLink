import { Router } from 'express';
import { compare, hash as hashPassword } from '@node-rs/bcrypt';
import pool, { PATIENT_COLUMNS } from '../db.js';
import { requirePatient } from '../auth.js';
import { emitEvent } from '../events.js';

const router = Router();
router.use(requirePatient);

const CONSENT_KINDS = ['treatment', 'data_sharing', 'research', 'photography'];

router.use(async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id FROM patients WHERE id = $1', [req.patientId]);
    if (!rows[0]) return res.status(404).json({ error: 'Patient not found' });
    next();
  } catch (err) {
    next(err);
  }
});

router.get('/departments', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, code, floor, phone_ext, head, hours FROM departments ORDER BY name',
    );
    res.json({ departments: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1`,
      [req.patientId],
    );
    const { rows: consents } = await pool.query(
      `SELECT kind, status, set_via, set_at FROM patient_consents WHERE patient_id = $1 ORDER BY kind`,
      [req.patientId],
    );
    res.json({ patient: rows[0], consents });
  } catch (err) {
    next(err);
  }
});

router.get('/timeline', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.kind, e.data, e.created_at, s.full_name AS staff_name
       FROM patient_events e
       LEFT JOIN staff s ON s.id = e.staff_id
       WHERE e.patient_id = $1
       ORDER BY e.created_at DESC LIMIT 200`,
      [req.patientId],
    );
    res.json({ events: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/prescriptions', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.status, p.notes, p.created_at,
              s.full_name AS prescribed_by_name,
              COALESCE(json_agg(
                json_build_object(
                  'id', pi.id,
                  'drug_name', pi.drug_name,
                  'dose', pi.dose,
                  'frequency', pi.frequency,
                  'route', pi.route,
                  'duration_days', pi.duration_days
                ) ORDER BY pi.id
              ) FILTER (WHERE pi.id IS NOT NULL), '[]') AS items
       FROM prescriptions p
       LEFT JOIN prescription_items pi ON pi.prescription_id = p.id
       LEFT JOIN staff s ON s.id = p.prescribed_by
       WHERE p.patient_id = $1
       GROUP BY p.id, s.full_name
       ORDER BY p.created_at DESC LIMIT 50`,
      [req.patientId],
    );
    res.json({ prescriptions: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/investigations', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.kind, i.test_name, i.clinical_note, i.status,
              i.result_json, i.created_at, i.resulted_at,
              d.name AS department_name,
              s.full_name AS ordered_by_name
       FROM investigations i
       LEFT JOIN departments d ON d.id = i.department_id
       LEFT JOIN staff s ON s.id = i.ordered_by
       WHERE i.patient_id = $1
       ORDER BY i.created_at DESC LIMIT 50`,
      [req.patientId],
    );
    res.json({ investigations: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/appointments', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.scheduled_for::text AS scheduled_for, a.duration_min,
              a.reason, a.status, a.created_at,
              d.name AS department_name
       FROM appointments a
       LEFT JOIN departments d ON d.id = a.department_id
       WHERE a.patient_id = $1
       ORDER BY a.scheduled_for DESC LIMIT 50`,
      [req.patientId],
    );
    res.json({ appointments: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/appointments', async (req, res, next) => {
  try {
    const b = req.body || {};
    const scheduledFor = b.scheduled_for || b.scheduledFor;
    if (!scheduledFor || !b.departmentId) {
      return res.status(400).json({ error: 'departmentId and scheduled_for are required' });
    }
    const { rows: dept } = await pool.query(
      'SELECT id, name FROM departments WHERE id = $1',
      [b.departmentId],
    );
    if (!dept[0]) return res.status(400).json({ error: 'Unknown department' });

    const { rows } = await pool.query(
      `INSERT INTO appointments (patient_id, department_id, scheduled_for, duration_min, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, patient_id, department_id, scheduled_for, status, reason`,
      [req.patientId, b.departmentId, new Date(scheduledFor), Number(b.duration_min || 30), b.reason || null],
    );
    res.status(201).json({ appointment: rows[0] });
    emitEvent({
      patientId: req.patientId,
      kind: 'appointment_requested',
      data: { department: dept[0].name, when: scheduledFor },
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
});

router.get('/consents', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT kind, status, note, set_via,
              s.full_name AS set_by_name, set_at
       FROM patient_consents c
       LEFT JOIN staff s ON s.id = c.set_by_staff
       WHERE c.patient_id = $1
       ORDER BY c.kind`,
      [req.patientId],
    );
    res.json({ consents: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/consents', async (req, res, next) => {
  try {
    const kind = (req.body?.kind || '').toString();
    const action = (req.body?.action || '').toString();
    if (!CONSENT_KINDS.includes(kind)) {
      return res.status(400).json({ error: 'Unknown consent kind' });
    }
    const status = action === 'revoke' ? 'revoked' : 'granted';
    const { rows } = await pool.query(
      `INSERT INTO patient_consents (patient_id, kind, status, set_via)
       VALUES ($1, $2, $3, 'portal')
       ON CONFLICT (patient_id, kind)
       DO UPDATE SET status = EXCLUDED.status, note = NULL,
                     set_by_staff = NULL, set_via = 'portal', set_at = now()
       RETURNING kind, status, set_via, set_at`,
      [req.patientId, kind, status],
    );
    res.json({ consent: rows[0] });
    emitEvent({
      patientId: req.patientId,
      kind: rows[0].status === 'granted' ? 'consent_granted' : 'consent_revoked',
      data: { kind },
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
});

router.get('/messages', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT c.id, c.subject, c.kind, c.created_at, c.closed_at,
                s.full_name AS staff_name,
                (SELECT count(*)
                 FROM messages m
                 WHERE m.conversation_id = c.id
                   AND m.sender_id IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM message_reads r
                     WHERE r.message_id = m.id AND r.patient_id = $1
                   )
                )::int AS unread,
                (SELECT m.body FROM messages m
                 WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC LIMIT 1) AS last_body,
                (SELECT m.created_at FROM messages m
                 WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC LIMIT 1) AS last_at
         FROM conversations c
         LEFT JOIN staff s ON s.id = c.created_by
         WHERE c.patient_id = $1 AND c.kind IN ('doctor_patient', 'help')
       ) t
       ORDER BY COALESCE(t.last_at, t.created_at) DESC LIMIT 100`,
      [req.patientId],
    );
    res.json({ conversations: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/messages/help', async (req, res, next) => {
  try {
    const b = req.body || {};
    const subject = (b.subject || '').trim();
    const body = (b.body || '').trim();
    if (!subject || !body) {
      return res.status(400).json({ error: 'subject and body are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO conversations (kind, subject, patient_id, created_by, requester_id)
       VALUES ('help', $1, $2, NULL, NULL)
       RETURNING id, kind, subject, patient_id, created_at`,
      [subject, req.patientId],
    );
    const conv = rows[0];
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_patient_id, body)
       VALUES ($1, $2, $3)`,
      [conv.id, req.patientId, body],
    );
    res.status(201).json({ conversation: conv });
    emitEvent({
      patientId: req.patientId,
      kind: 'message',
      data: { conversation: subject, body },
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
});

router.get('/messages/:id', async (req, res, next) => {
  try {
    const { rows: convRow } = await pool.query(
      `SELECT c.*, s.full_name AS staff_name
       FROM conversations c
       LEFT JOIN staff s ON s.id = c.created_by
       WHERE c.id = $1 AND c.patient_id = $2
         AND c.kind IN ('doctor_patient', 'help')`,
      [req.params.id, req.patientId],
    );
    const conv = convRow[0];
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    await pool.query(
      `INSERT INTO message_reads (message_id, patient_id)
       SELECT id, $2 FROM messages WHERE conversation_id = $1
       ON CONFLICT DO NOTHING`,
      [conv.id, req.patientId],
    );

    const { rows: messages } = await pool.query(
      `SELECT m.id, m.body, m.created_at, m.sender_id, m.sender_patient_id,
              s.full_name AS sender_name,
              (m.sender_patient_id = $2) AS is_patient
       FROM messages m
       LEFT JOIN staff s ON s.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conv.id, req.patientId],
    );
    res.json({ conversation: conv, messages });
  } catch (err) {
    next(err);
  }
});

router.post('/messages/:id/messages', async (req, res, next) => {
  try {
    const b = req.body || {};
    const body = (b.body || '').trim();
    if (!body) return res.status(400).json({ error: 'message body is required' });

    const { rows: convRow } = await pool.query(
      `SELECT * FROM conversations
       WHERE id = $1 AND patient_id = $2 AND kind IN ('doctor_patient', 'help')`,
      [req.params.id, req.patientId],
    );
    const conv = convRow[0];
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_patient_id, body)
       VALUES ($1, $2, $3) RETURNING id, body, created_at, sender_patient_id`,
      [conv.id, req.patientId, body],
    );
    const message = rows[0];
    await pool.query(
      `INSERT INTO message_reads (message_id, patient_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [message.id, req.patientId],
    );
    res.status(201).json({ message: { ...message, is_patient: true, sender_name: null } });
  } catch (err) {
    next(err);
  }
});

router.post('/pin', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT pin_hash FROM patients WHERE id = $1',
      [req.patientId],
    );
    const cur = String(req.body?.current_pin || '');
    const next = String(req.body?.new_pin || '');
    if (!/^\d{4,8}$/.test(next)) {
      return res.status(400).json({ error: 'New PIN must be 4–8 digits' });
    }
    if (!rows[0] || !(await compare(cur, rows[0].pin_hash))) {
      return res.status(400).json({ error: 'Current PIN is incorrect' });
    }
    const hash = await hashPassword(next, 10);
    await pool.query('UPDATE patients SET pin_hash = $1 WHERE id = $2', [hash, req.patientId]);
    emitEvent({
      patientId: req.patientId,
      kind: 'portal_pin_changed',
      data: {},
    }).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;