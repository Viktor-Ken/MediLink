// Shared plumbing behind both chat surfaces (staff assistant in routes/chat.js,
// patient assistant in routes/portal.js). Each surface supplies its own system
// prompt and auth/rate-limit scoping; this module only talks to the model.

export const MAX_MESSAGES = 20;
export const MAX_CHARS = 4_000;

export function chatConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.CHAT_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
}

export function sanitizeMessages(input) {
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

/**
 * Calls the configured chat-completion endpoint. Throws on failure; the
 * thrown error carries `.upstreamStatus` when the upstream itself responded
 * with a non-2xx status, `.name === 'AbortError'` on timeout, so callers can
 * map either to the right HTTP response without duplicating that logic.
 */
export async function completeChat({ cfg, systemPrompt, messages }) {
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
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
      signal: abort.signal,
    });

    if (!upstream.ok) {
      const err = new Error(`chat upstream error ${upstream.status}`);
      err.upstreamStatus = upstream.status;
      throw err;
    }

    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    return reply || null;
  } finally {
    clearTimeout(timer);
  }
}
