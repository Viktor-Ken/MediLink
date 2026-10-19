import { useEffect, useRef, useState } from 'react';
import { portalApi } from '../../portalApi.js';
import { fmtDateTime } from '../../util.js';

export default function PortalMessages() {
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [hForm, setHForm] = useState({ subject: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const scrollRef = useRef(null);

  const reloadList = async () => {
    try {
      const d = await portalApi('/messages');
      setConversations(d.conversations);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    reloadList();
    const t = setInterval(reloadList, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function openThread(id) {
    try {
      const d = await portalApi(`/messages/${id}`);
      setActive(id);
      setThread(d.conversation);
      setMessages(d.messages);
      reloadList();
    } catch (err) {
      setError(err.message);
    }
  }

  async function send() {
    if (!body.trim() || !active) return;
    setBusy(true);
    setError('');
    try {
      await portalApi(`/messages/${active}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setBody('');
      const d = await portalApi(`/messages/${active}`);
      setMessages(d.messages);
      reloadList();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createHelp(e) {
    e.preventDefault();
    if (!hForm.subject.trim() || !hForm.body.trim()) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const d = await portalApi('/messages/help', {
        method: 'POST',
        body: JSON.stringify({ subject: hForm.subject.trim(), body: hForm.body.trim() }),
      });
      setShowHelp(false);
      setHForm({ subject: '', body: '' });
      openThread(d.conversation.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-heading" style={{ marginBottom: 12 }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 22 }}>Messages</h1>
          <div className="page-sub">Chat privately with your doctor, or ask for help with the portal.</div>
        </div>
        <button className="btn" onClick={() => setShowHelp((s) => !s)}>
          {showHelp ? 'Cancel' : '+ Contact help desk'}
        </button>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {info && <div className="alert-info" style={{ marginBottom: 16, borderColor: 'var(--success)' }}>{info}</div>}

      {showHelp && (
        <form className="card" onSubmit={createHelp} style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>Contact help desk</h3>
          <div className="field">
            <label>Subject *</label>
            <input value={hForm.subject} onChange={(e) => setHForm({ ...hForm, subject: e.target.value })} placeholder="e.g. Can't see my lab results" required />
          </div>
          <div className="field">
            <label>Message *</label>
            <textarea rows={3} value={hForm.body} onChange={(e) => setHForm({ ...hForm, body: e.target.value })} placeholder="Describe your question…" required />
          </div>
          <button className="btn" style={{ marginTop: 4 }} disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </form>
      )}

      <div className="messages-shell">
        <aside className="mlist" style={{ background: '#fff' }}>
          {conversations.length === 0 && (
            <p className="muted" style={{ padding: 16 }}>No conversations yet. Your doctor can start a private chat with you.</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`mconv${active === c.id ? ' active' : ''}`}
              onClick={() => openThread(c.id)}
            >
              <div className="mconv-top">
                <span className="mconv-subject">{c.subject}</span>
                {c.unread > 0 && <span className="badge">{c.unread}</span>}
              </div>
              <div className="mconv-meta">
                {c.kind === 'help' ? 'Help desk' : 'My doctor'}
              </div>
              <div className="mconv-last">
                {c.last_body ? (c.last_body.length > 70 ? `${c.last_body.slice(0, 70)}…` : c.last_body) : 'No messages yet'}
              </div>
            </button>
          ))}
        </aside>

        <section className="mdetail">
          {!thread ? (
            <div className="center-thread muted">
              {conversations.length
                ? 'Select a conversation on the left.'
                : 'No messages yet. If your doctor messages you, it will appear here.'}
            </div>
          ) : (
            <>
              <header className="mhead">
                <div>
                  <div className="msubject">{thread.subject}</div>
                  <div className="mmeta">
                    {thread.kind === 'help' ? 'Help desk' : 'Private chat with your doctor'}
                  </div>
                </div>
              </header>
              <div className="mbody" ref={scrollRef}>
                {messages.length === 0 && <p className="muted">No messages yet.</p>}
                {messages.map((m) => {
                  const mine = !!m.is_patient;
                  return (
                    <div key={m.id} className={`mbubble${mine ? ' mine' : ''}`}>
                      <div className="mbubble-head">
                        {mine ? 'You' : m.sender_name || 'MediLink'} · {fmtDateTime(m.created_at)}
                      </div>
                      <div className="mbubble-body">{m.body}</div>
                    </div>
                  );
                })}
              </div>
              <footer className="mfoot">
                <input
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
                  placeholder="Type a message…"
                />
                <button className="btn" onClick={send} disabled={busy}>Send</button>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}