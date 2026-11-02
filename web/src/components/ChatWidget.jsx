import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const DEFAULT_WELCOME = {
  role: 'assistant',
  content: "Hi! I'm the MediLink assistant. Ask me about workflows, referrals, handoffs, reports or how to use the system. I won't ask for or repeat patient-identifying details.",
};

/**
 * Floating assistant widget. Defaults match the staff assistant (api.js,
 * /chat/*); the patient portal mounts this with different props (portalApi.js,
 * /portal/chat/*, its own title/welcome/placeholder) to keep the two
 * assistants — and their very different system prompts server-side — visibly
 * separate rather than sharing one "the assistant" identity in the UI.
 */
export default function ChatWidget({
  apiFn = api,
  statusPath = '/chat/status',
  chatPath = '/chat',
  title = 'MediLink Assistant',
  welcome = DEFAULT_WELCOME,
  placeholder = 'Ask about the system…',
  note = 'Assistant responses may be inaccurate — verify clinical details.',
}) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([welcome]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    apiFn(statusPath)
      .then((s) => { if (alive) setEnabled(Boolean(s?.configured)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [apiFn, statusPath]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, open, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!enabled) return null;

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setError('');
    setBusy(true);
    try {
      const { reply } = await apiFn(chatPath, {
        method: 'POST',
        body: JSON.stringify({
          messages: next
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="bot-fab"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '×' : '💬'}
      </button>

      {open && (
        <section className="bot-panel" aria-label={title}>
          <header className="bot-head">
            <span className="bot-title">{title}</span>
            <button className="bot-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className="bot-log" ref={logRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bot-msg bot-${m.role}`}>{m.content}</div>
            ))}
            {busy && <div className="bot-msg bot-assistant bot-typing">Thinking…</div>}
            {error && <div className="bot-error">{error}</div>}
          </div>

          <form className="bot-form" onSubmit={send}>
            <input
              ref={inputRef}
              className="bot-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              maxLength={2000}
              aria-label="Message"
            />
            <button className="btn btn-primary bot-send" type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
          <p className="bot-note">{note}</p>
        </section>
      )}
    </>
  );
}
