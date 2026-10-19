import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import PatientPicker from '../components/PatientPicker.jsx';
import { fmtDateTime } from '../util.js';

const TABS = [
  { id: 'team', label: 'Team' },
  { id: 'patients', label: 'Patients' },
  { id: 'help', label: 'Help desk' },
];

const KIND_TAG = {
  staff: { label: 'Team', cls: 'tag' },
  doctor_patient: { label: 'Patient', cls: 'tag tag-danger' },
  help: { label: 'Help', cls: 'tag tag-warn' },
};

function pfull(c) {
  return [c.first_name, c.patient_last_name || c.last_name].filter(Boolean).join(' ');
}

export default function Messages() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState('team');
  const [conversations, setConversations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [active, setActive] = useState(null);
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [nForm, setNForm] = useState({ subject: '', departmentId: '', patient: null });
  const [showPatientNew, setShowPatientNew] = useState(false);
  const [pTarget, setPTarget] = useState(null);
  const [showHelpNew, setShowHelpNew] = useState(false);
  const [helpForm, setHelpForm] = useState({ subject: '', patient: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const canChatPatient = user?.role === 'admin' || user?.role === 'doctor';

  const reloadList = useCallback(async () => {
    try {
      const d = await api('/conversations');
      setConversations(d.conversations);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    reloadList();
    const t = setInterval(reloadList, 20000);
    return () => clearInterval(t);
  }, [reloadList]);

  useEffect(() => {
    api('/departments')
      .then((d) => setDepartments(d.departments))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const patientParam = sp.get('patient');
    if (!patientParam || !canChatPatient) return;
    setTab('patients');
    setError('');
    (async () => {
      try {
        const d = await api('/conversations/doctor-patient', {
          method: 'POST',
          body: JSON.stringify({ patientId: patientParam }),
        });
        await openThread(d.conversation.id);
      } catch (err) {
        setError(err.message);
      }
      setSp({}, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openThread(id) {
    try {
      const d = await api(`/conversations/${id}`);
      setActive(id);
      setThread(d.conversation);
      setMessages(d.messages);
      setTab((v) => (d.conversation.kind === 'staff' ? 'team' : d.conversation.kind === 'doctor_patient' ? 'patients' : 'help'));
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
      await api(`/conversations/${active}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setBody('');
      const d = await api(`/conversations/${active}`);
      setMessages(d.messages);
      reloadList();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createConversation(e) {
    e.preventDefault();
    if (!nForm.subject.trim()) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        subject: nForm.subject.trim(),
        departmentId: nForm.departmentId || undefined,
        patientId: nForm.patient?.id || undefined,
      };
      const d = await api('/conversations', { method: 'POST', body: JSON.stringify(payload) });
      setShowNew(false);
      setNForm({ subject: '', departmentId: '', patient: null });
      openThread(d.conversation.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function startPatientChat(p) {
    if (!p) return;
    setBusy(true);
    setError('');
    try {
      const d = await api('/conversations/doctor-patient', {
        method: 'POST',
        body: JSON.stringify({ patientId: p.id }),
      });
      setShowPatientNew(false);
      setPTarget(null);
      await openThread(d.conversation.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createHelp(e) {
    e.preventDefault();
    if (!helpForm.subject.trim()) return;
    setBusy(true);
    setError('');
    try {
      const d = await api('/conversations', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'help',
          subject: helpForm.subject.trim(),
          patientId: helpForm.patient?.id || undefined,
        }),
      });
      setShowHelpNew(false);
      setHelpForm({ subject: '', patient: null });
      openThread(d.conversation.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const list = conversations.filter((c) => c.kind === tab);
  const unreadByTab = (id) => conversations.filter((c) => c.kind === id).reduce((n, c) => n + (c.unread || 0), 0);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Messages</h1>
          <div className="page-sub">Team channels, doctor–patient chats and help desk requests.</div>
        </div>
        {tab === 'team' && (
          <button className="btn" onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : '+ New conversation'}
          </button>
        )}
        {tab === 'patients' && canChatPatient && (
          <button className="btn" onClick={() => setShowPatientNew((s) => !s)}>
            {showPatientNew ? 'Cancel' : '+ Message patient'}
          </button>
        )}
        {tab === 'help' && (
          <button className="btn" onClick={() => setShowHelpNew((s) => !s)}>
            {showHelpNew ? 'Cancel' : '+ New help request'}
          </button>
        )}
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="tabs" style={{ marginBottom: 16 }}>
        {TABS.map((t) => {
          const n = unreadByTab(t.id);
          return (
            <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {n > 0 && <span className="badge" style={{ marginLeft: 6 }}>{n}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'team' && showNew && (
        <form className="card" onSubmit={createConversation} style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>New conversation</h3>
          <div className="form-grid">
            <div className="field">
              <label>Subject *</label>
              <input value={nForm.subject} onChange={(e) => setNForm({ ...nForm, subject: e.target.value })} placeholder="e.g. HM-1002 bed assignment" required />
            </div>
            <div className="field">
              <label>Channel (department)</label>
              <select value={nForm.departmentId} onChange={(e) => setNForm({ ...nForm, departmentId: e.target.value })}>
                <option value="">My department</option>
                {departments.filter((d) => d.id !== user?.department_id).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Link a patient (optional)</label>
              <PatientPicker value={nForm.patient} onChange={(p) => setNForm({ ...nForm, patient: p })} placeholder="Search patient…" />
            </div>
          </div>
          <button className="btn" style={{ marginTop: 14 }} disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {tab === 'patients' && showPatientNew && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>Message a patient</h3>
          <p className="muted">Opens (or reuses) the private chat between you and this patient. Patients see it on their portal.</p>
          <PatientPicker value={pTarget} onChange={setPTarget} placeholder="Search patient…" />
          <button className="btn" style={{ marginTop: 12 }} disabled={busy || !pTarget} onClick={() => startPatientChat(pTarget)}>
            {busy ? 'Opening…' : 'Start chat'}
          </button>
        </div>
      )}

      {tab === 'help' && showHelpNew && (
        <form className="card" onSubmit={createHelp} style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>New help request</h3>
          <div className="form-grid">
            <div className="field">
              <label>Subject *</label>
              <input value={helpForm.subject} onChange={(e) => setHelpForm({ ...helpForm, subject: e.target.value })} placeholder="e.g. System access for new nurse" required />
            </div>
            <div className="field">
              <label>Link a patient (optional)</label>
              <PatientPicker value={helpForm.patient} onChange={(p) => setHelpForm({ ...helpForm, patient: p })} placeholder="Search patient…" />
            </div>
          </div>
          <button className="btn" style={{ marginTop: 14 }} disabled={busy}>
            {busy ? 'Creating…' : 'Create request'}
          </button>
        </form>
      )}

      <div className="messages-shell">
        <aside className="mlist">
          {list.length === 0 && (
            <p className="muted" style={{ padding: 16 }}>
              No {TABS.find((t) => t.id === tab)?.label.toLowerCase()} conversations yet.
            </p>
          )}
          {list.map((c) => {
            const tag = KIND_TAG[c.kind] || KIND_TAG.staff;
            return (
              <button key={c.id} className={`mconv${active === c.id ? ' active' : ''}`} onClick={() => openThread(c.id)}>
                <div className="mconv-top">
                  <span className="mconv-subject">{c.subject}</span>
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </div>
                <div className="mconv-meta">
                  <span className={tag.cls}>{tag.label}</span>
                  {' '}
                  {c.kind === 'staff'
                    ? c.department_name || 'Personal'
                    : pfull(c) || c.requester_name || '—'}
                </div>
                <div className="mconv-last">
                  {c.last_body ? (c.last_body.length > 70 ? `${c.last_body.slice(0, 70)}…` : c.last_body) : 'No messages yet'}
                </div>
              </button>
            );
          })}
        </aside>

        <section className="mdetail">
          {!thread ? (
            <div className="center-thread muted">Select a conversation on the left.</div>
          ) : (
            <>
              <header className="mhead">
                <div>
                  <div className="msubject">{thread.subject}</div>
                  <div className="mmeta">
                    {KIND_TAG[thread.kind]?.label || 'Channel'}
                    {thread.patient_no && (
                      <>
                        {' · '}
                        <Link to={`/patients/${thread.patient_id}`}>
                          {thread.patient_no} {thread.first_name} {thread.last_name}
                        </Link>
                      </>
                    )}
                    {thread.kind === 'staff' && thread.department_name && ` · ${thread.department_name}`}
                  </div>
                </div>
              </header>
              <div className="mbody" ref={scrollRef}>
                {messages.length === 0 && <p className="muted">Start the conversation.</p>}
                {messages.map((m) => {
                  const mine = m.sender_id === user?.id;
                  const patientMsg = !!m.sender_patient_id;
                  const name = mine ? 'You' : patientMsg ? pfull(m) || 'Patient' : m.sender_name || 'Staff';
                  return (
                    <div key={m.id} className={`mbubble${mine ? ' mine' : ''}`}>
                      <div className="mbubble-head">
                        {name}{patientMsg && ' · Patient'} · {fmtDateTime(m.created_at)}
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
    </>
  );
}