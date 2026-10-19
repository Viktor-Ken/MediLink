import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { LRU } from '../lru.js';

const router = Router();
router.use(requireAuth);

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.CHAT_RATE_LIMIT ?? 20);
const rateLimitKeys = Math.max(1, Number(process.env.RATE_LIMIT_KEYS) || 10_000);
const hits = new LRU({ max: rateLimitKeys, ttlMs: WINDOW_MS });

const MAX_MESSAGES = 20;
const MAX_CHARS = 4_000;

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

function chatConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.CHAT_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
}

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

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const m of input.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = String(m.content ?? '').slice(0, MAX_CHARS).trim();
    if (!content) continue;
    out.push({ role: m.role, content });
  }
  return out.length ? out : null;
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

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 45_000);
  try {
    const upstream = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.3,
        max_tokens: 700,
        messages: [{ role: 'system', content: process.env.CHAT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT }, ...messages],
      }),
      signal: abort.signal,
    });

    if (!upstream.ok) {
      console.error(`[medilink] chat upstream error ${upstream.status}`);
      const code = upstream.status === 429 ? 429 : 502;
      return res.status(code).json({ error: 'The assistant is temporarily unavailable.' });
    }

    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) return res.status(502).json({ error: 'The assistant returned an empty response.' });
    res.json({ reply });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'The assistant took too long to respond.' });
    }
    next(err);
  } finally {
    clearTimeout(timer);
  }
});

export default router;
