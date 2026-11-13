import { Router } from 'express';
import { compare, hash as hashPassword } from '@node-rs/bcrypt';
import pool, { PATIENT_COLUMNS } from '../db.js';
import { requirePatient } from '../auth.js';
import { emitEvent } from '../events.js';
import { cleanText, isUuid, parseDate } from '../util.js';
import { LRU } from '../lru.js';
import { chatConfig, sanitizeMessages, completeChat } from '../chatEngine.js';

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

// --- Patient-facing assistant (separate scope/prompt from the staff one in
// routes/chat.js) ---------------------------------------------------------

const PORTAL_CHAT_WINDOW_MS = 60_000;
const PORTAL_CHAT_MAX_PER_WINDOW = Number(process.env.PORTAL_CHAT_RATE_LIMIT ?? 15);
const portalChatRateLimitKeys = Math.max(1, Number(process.env.RATE_LIMIT_KEYS) || 10_000);
const portalChatHits = new LRU({ max: portalChatRateLimitKeys, ttlMs: PORTAL_CHAT_WINDOW_MS });

// Deliberately more restrictive than the staff prompt: this assistant is
// never given any of the patient's real record data, so it must never imply
// it has — and it must route anything clinical, and especially anything
// urgent, to a real person rather than attempt to help with it itself.
const PORTAL_CHAT_SYSTEM_PROMPT =
  process.env.PORTAL_CHAT_SYSTEM_PROMPT ||
  'You are the MediLink Patient Assistant, built into a hospital patient portal. You help ' +
  'patients use the portal itself: how to request an appointment, where to find their care ' +
  'timeline, prescriptions and test results, how to grant or withdraw consents, and how to ' +
  'message their care team or raise a help desk request. ' +
  'You are never given this patient\'s actual medical records, test results, or appointment ' +
  'details — never claim to see, summarize, or interpret any specific personal health data; ' +
  'if asked about it, point them to the relevant page in the portal instead. ' +
  'Never give a medical diagnosis, never interpret symptoms or test results, never recommend ' +
  'or adjust medication or dosing, and never tell a patient their condition is or isn\'t ' +
  'serious. For any clinical question, direct them to message their care team through the ' +
  'portal or to contact the hospital directly. If a message describes a medical emergency or ' +
  'urgent/worsening symptoms, your first priority is telling them clearly to call emergency ' +
  'services or go to the nearest emergency department immediately. Keep answers short, plain ' +
  'and reassuring. If asked something unrelated to the hospital or this portal, politely ' +
  'redirect.';

function portalChatRateLimit(req, res, next) {
  const key = req.patientId || req.ip || 'unknown';
  const rec = portalChatHits.get(key);
  if (!rec) {
    portalChatHits.set(key, { count: 1 });
    return next();
  }
  rec.count++;
  if (rec.count > PORTAL_CHAT_MAX_PER_WINDOW) {
    return res.status(429).json({ error: 'Too many messages, please slow down.' });
  }
  next();
}

router.get('/chat/status', (_req, res) => {
  res.json({ configured: Boolean(chatConfig()), model: chatConfig()?.model || null });
});

router.post('/chat', portalChatRateLimit, async (req, res, next) => {
  const cfg = chatConfig();
  if (!cfg) {
    return res.status(503).json({ error: 'The assistant is not configured on this server.' });
  }

  const messages = sanitizeMessages(req.body?.messages);
  if (!messages) {
    return res.status(400).json({ error: 'messages must be a non-empty array of {role, content}' });
  }

  try {
    const reply = await completeChat({ cfg, systemPrompt: PORTAL_CHAT_SYSTEM_PROMPT, messages });
    if (!reply) return res.status(502).json({ error: 'The assistant returned an empty response.' });
    res.json({ reply });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'The assistant took too long to respond.' });
    }
    if (err.upstreamStatus) {
      console.error(`[medilink] portal chat upstream error ${err.upstreamStatus}`);
      const code = err.upstreamStatus === 429 ? 429 : 502;
      return res.status(code).json({ error: 'The assistant is temporarily unavailable.' });
    }
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
         AND e.kind <> 'message'
         AND e.kind !~ '^(referral|handoff)_'
         AND e.kind <> 'scan'
       ORDER BY e.created_at DESC LIMIT 200`,
      [req.patientId],
    );
    // Staff-to-staff coordination (referrals, handoffs, scans, internal
    // message text) is not patient-facing and is excluded above.
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
    const when = parseDate(scheduledFor);
    if (!when) return res.status(400).json({ error: 'scheduled_for is not a valid date' });
    if (when.getTime() < Date.now() - 5 * 60_000) {
      return res.status(400).json({ error: 'Appointments must be in the future' });
    }
    const duration = Number(b.duration_min ?? 30);
    if (!Number.isInteger(duration) || duration < 5 || duration > 240) {
      return res.status(400).json({ error: 'duration_min must be between 5 and 240' });
    }
    if (!isUuid(b.departmentId)) return res.status(400).json({ error: 'Unknown department' });
    const { rows: dept } = await pool.query(
      'SELECT id, name FROM departments WHERE id = $1',
      [b.departmentId],
    );
    if (!dept[0]) return res.status(400).json({ error: 'Unknown department' });

    const { rows } = await pool.query(
      `INSERT INTO appointments (patient_id, department_id, scheduled_for, duration_min, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, patient_id, department_id, scheduled_for, status, reason`,
      [req.patientId, b.departmentId, when, duration, cleanText(b.reason, 500) || null],
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
    const subject = cleanText(b.subject, 200);
    const body = cleanText(b.body, 5000);
    if (!subject || !body) {
      return res.status(400).json({ error: 'subject and body are required' });
    }
    const { rows: recent } = await pool.query(
      `SELECT count(*)::int AS n FROM conversations
       WHERE patient_id = $1 AND kind = 'help' AND created_at > now() - interval '1 day'`,
      [req.patientId],
    );
    if (recent[0].n >= 10) {
      return res.status(429).json({ error: 'Too many help requests today. Please wait or call the hospital.' });
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
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Conversation not found' });
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
    const body = cleanText(b.body, 5000);
    if (!body) return res.status(400).json({ error: 'message body is required' });
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Conversation not found' });

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
    const newPin = String(req.body?.new_pin || '');
    if (!/^\d{4,8}$/.test(newPin)) {
      return res.status(400).json({ error: 'New PIN must be 4–8 digits' });
    }
    if (!rows[0] || !(await compare(cur, rows[0].pin_hash))) {
      return res.status(400).json({ error: 'Current PIN is incorrect' });
    }
    const hash = await hashPassword(newPin, 10);
    await pool.query('UPDATE patients SET pin_hash = $1 WHERE id = $2', [hash, req.patientId]);
    // Revoke other devices after a credential change; keep this active flow usable.
    await pool.query(
      `UPDATE auth_sessions SET revoked_at = now()
       WHERE patient_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [req.patientId, req.authSessionId],
    );
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