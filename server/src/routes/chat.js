import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { LRU } from '../lru.js';
import { chatConfig, sanitizeMessages, completeChat } from '../chatEngine.js';

const router = Router();
router.use(requireAuth);

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.CHAT_RATE_LIMIT ?? 20);
const rateLimitKeys = Math.max(1, Number(process.env.RATE_LIMIT_KEYS) || 10_000);
const hits = new LRU({ max: rateLimitKeys, ttlMs: WINDOW_MS });

const DEFAULT_SYSTEM_PROMPT =
  'You are MediLink Assistant, an experienced hospital-operations helper inside the ' +
  'MediLink Hospital Management System. Help clinical and administrative staff with ' +
  'workflows (patient registration, referrals, handoffs, admissions, pharmacy, ' +
  'laboratory/radiology orders, appointments, reports) and with interpreting the data ' +
  'shown in the app. Never invent patient data, never ask for or repeat confidential ' +
  'personal health information (names, NIN, NHIS, diagnoses of real patients), and never ' +
  'give a definitive medical diagnosis or prescribe treatment. For anything clinical, ' +
  'advise consulting the treating clinician. Keep answers concise, practical and, where ' +
  'useful, formatted as short steps or bullet points. If asked something outside hospital ' +
  'operations, politely redirect.';

function rateLimit(req, res, next) {
  const key = req.staff?.id || req.ip || 'unknown';
  const rec = hits.get(key);
  if (!rec) {
    hits.set(key, { count: 1 });
    return next();
  }
  rec.count++;
  if (rec.count > MAX_PER_WINDOW) {
    return res.status(429).json({ error: 'Too many messages, please slow down.' });
  }
  next();
}

router.get('/status', (_req, res) => {
  res.json({ configured: Boolean(chatConfig()), model: chatConfig()?.model || null });
});

router.post('/', rateLimit, async (req, res, next) => {
  const cfg = chatConfig();
  if (!cfg) {
    return res.status(503).json({ error: 'The assistant is not configured on this server.' });
  }

  const messages = sanitizeMessages(req.body?.messages);
  if (!messages) {
    return res.status(400).json({ error: 'messages must be a non-empty array of {role, content}' });
  }

  try {
    const reply = await completeChat({
      cfg,
      systemPrompt: process.env.CHAT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT,
      messages,
    });
    if (!reply) return res.status(502).json({ error: 'The assistant returned an empty response.' });
    res.json({ reply });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'The assistant took too long to respond.' });
    }
    if (err.upstreamStatus) {
      console.error(`[medilink] chat upstream error ${err.upstreamStatus}`);
      const code = err.upstreamStatus === 429 ? 429 : 502;
      return res.status(code).json({ error: 'The assistant is temporarily unavailable.' });
    }
    next(err);
  }
});

export default router;
