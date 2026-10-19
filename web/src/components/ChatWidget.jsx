import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const WELCOME = {
  role: 'assistant',
  content: "Hi! I'm the MediLink assistant. Ask me about workflows, referrals, handoffs, reports or how to use the system. I won't ask for or repeat patient-identifying details.",
};

export default function ChatWidget() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api('/chat/status')
      .then((s) => { if (alive) setEnabled(Boolean(s?.configured)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

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
      const { reply } = await api('/chat', {
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
        <section className="bot-panel" aria-label="MediLink assistant">
          <header className="bot-head">
            <span className="bot-title">MediLink Assistant</span>
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
              placeholder="Ask about the system…"
              maxLength={2000}
              aria-label="Message"
            />
            <button className="btn btn-primary bot-send" type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
          <p className="bot-note">Assistant responses may be inaccurate — verify clinical details.</p>
        </section>
      )}
    </>
  );
}
