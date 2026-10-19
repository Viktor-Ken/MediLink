import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import PatientPicker from '../components/PatientPicker.jsx';
import { timeAgo } from '../util.js';

const PRIORITIES = ['stat', 'urgent', 'routine'];
const STATUS_LABEL = { open: 'Open', accepted: 'Accepted', completed: 'Completed', declined: 'Declined' };

function PriorityTag({ p }) {
  return <span className={`priority priority-${p}`}>{p}</span>;
}

function StatusTag({ s }) {
  return <span className="tag status-tag">{STATUS_LABEL[s] || s}</span>;
}

export default function Coordination() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canRefer = ['doctor', 'nurse'].includes(user?.role);
  const [tab, setTab] = useState('referrals');
  const [departments, setDepartments] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [handoffs, setHandoffs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  const [refForm, setRefForm] = useState({ patient: null, toDepartmentId: '', priority: 'routine', reason: '' });
  const [hoForm, setHoForm] = useState({ patient: null, toDepartmentId: '', summary: '' });

  const myDept = user?.department_id;
  const others = departments.filter((d) => d.id !== myDept);

  useEffect(() => {
    api('/departments')
      .then((d) => setDepartments(d.departments))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api('/referrals')
      .then((d) => setReferrals(d.referrals))
      .catch((e) => setError(e.message));
    api('/handoffs')
      .then((d) => setHandoffs(d.handoffs))
      .catch(() => {});
  }, [refresh]);

  const gone = () => {
    setError('');
    setRefresh((n) => n + 1);
  };

  async function createReferral(e) {
    e.preventDefault();
    if (!refForm.patient || !refForm.toDepartmentId || !refForm.reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api('/referrals', {
        method: 'POST',
        body: JSON.stringify({
          patientId: refForm.patient.id,
          toDepartmentId: refForm.toDepartmentId,
          priority: refForm.priority,
          reason: refForm.reason,
        }),
      });
      setRefForm({ patient: null, toDepartmentId: '', priority: 'routine', reason: '' });
      gone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createHandoff(e) {
    e.preventDefault();
    if (!hoForm.patient || !hoForm.summary.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api('/handoffs', {
        method: 'POST',
        body: JSON.stringify({
          patientId: hoForm.patient.id,
          toDepartmentId: hoForm.toDepartmentId || undefined,
          summary: hoForm.summary,
        }),
      });
      setHoForm({ patient: null, toDepartmentId: '', summary: '' });
      gone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function action(url) {
    try {
      await api(url, { method: 'POST' });
      gone();
    } catch (err) {
      setError(err.message);
    }
  }

  const incomingReferrals = isAdmin ? referrals : referrals.filter((r) => r.to_department_id === myDept);
  const outgoingReferrals = isAdmin ? [] : referrals.filter((r) => r.from_department_id === myDept);
  const incomingHandoffs = isAdmin ? handoffs : handoffs.filter((h) => h.to_department_id === myDept || h.to_staff_id === user?.id);
  const outgoingHandoffs = isAdmin ? [] : handoffs.filter((h) => h.from_department_id === myDept);

  const refActions = (r) => {
    if (isAdmin) return [];
    const btns = [];
    if (r.to_department_id === myDept && r.status === 'open') {
      btns.push(['accept', 'Accept', 'btn']);
      btns.push(['decline', 'Decline', 'btn btn-ghost']);
    }
    if (r.status === 'accepted') btns.push(['complete', 'Complete', 'btn']);
    return btns;
  };

  const handoffActions = (h) => {
    if (isAdmin) return [];
    const isMine = h.to_department_id === myDept || h.to_staff_id === user?.id;
    const btns = [];
    if (isMine && h.status === 'open') btns.push(['accept', 'Accept', 'btn']);
    if (h.status === 'accepted') btns.push(['complete', 'Complete', 'btn']);
    return btns;
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Referrals &amp; Handoffs</h1>
          <div className="page-sub">Coordinate patient movement and care between departments.</div>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="tabs">
        <button className={`tab${tab === 'referrals' ? ' active' : ''}`} onClick={() => setTab('referrals')}>
          Referrals
        </button>
        <button className={`tab${tab === 'handoffs' ? ' active' : ''}`} onClick={() => setTab('handoffs')}>
          Handoffs
        </button>
      </div>

      {tab === 'referrals' && (
        <div className="grid grid-2">
          {canRefer && (
            <div className="card">
              <h3>New referral</h3>
              <form className="stack" onSubmit={createReferral}>
                <div className="field">
                  <label>Patient</label>
                  <PatientPicker value={refForm.patient} onChange={(p) => setRefForm({ ...refForm, patient: p })} />
                </div>
                <div className="field">
                  <label>To department</label>
                  <select value={refForm.toDepartmentId} onChange={(e) => setRefForm({ ...refForm, toDepartmentId: e.target.value })} required>
                    <option value="">Select…</option>
                    {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Priority</label>
                  <select value={refForm.priority} onChange={(e) => setRefForm({ ...refForm, priority: e.target.value })}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Reason</label>
                  <textarea rows={3} value={refForm.reason} onChange={(e) => setRefForm({ ...refForm, reason: e.target.value })} required />
                </div>
                <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send referral'}</button>
              </form>
            </div>
          )}

          <div className="stack">
            <div className="card">
              <h3>{isAdmin ? 'All referrals — view only' : 'Incoming to my department'}</h3>
              {incomingReferrals.length === 0 && <p className="muted">Nothing incoming.</p>}
              {incomingReferrals.map((r) => (
                <div key={r.id} className="coord-row">
                  <div className="coord-main">
                    <Link to={`/patients/${r.patient_id}`} className="row" style={{ gap: 6 }}>
                      <span className="pno">{r.patient_no}</span>
                      <strong>{r.first_name} {r.last_name}</strong>
                    </Link>
                    <div className="psub">
                      From {r.from_department} · <PriorityTag p={r.priority} /> · <StatusTag s={r.status} /> · {timeAgo(r.created_at)}
                    </div>
                    <div className="reason">“{r.reason}”</div>
                  </div>
                  <div className="coord-actions">
                    {refActions(r).map(([k, label, cls]) => (
                      <button key={k} className={cls} onClick={() => action(`/referrals/${r.id}/${k}`)}>{label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <h3>Outgoing</h3>
              {outgoingReferrals.length === 0 && <p className="muted">Nothing sent.</p>}
              {outgoingReferrals.map((r) => (
                <div key={r.id} className="coord-row">
                  <div className="coord-main">
                    <Link to={`/patients/${r.patient_id}`} className="row" style={{ gap: 6 }}>
                      <span className="pno">{r.patient_no}</span>
                      <strong>{r.first_name} {r.last_name}</strong>
                    </Link>
                    <div className="psub">
                      To {r.to_department} · <PriorityTag p={r.priority} /> · <StatusTag s={r.status} /> · {timeAgo(r.created_at)}
                    </div>
                    <div className="reason">“{r.reason}”</div>
                  </div>
                  <div className="coord-actions">
                    {refActions(r).map(([k, label, cls]) => (
                      <button key={k} className={cls} onClick={() => action(`/referrals/${r.id}/${k}`)}>{label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'handoffs' && (
        <div className="grid grid-2">
          {!isAdmin && (
            <div className="card">
              <h3>New handoff</h3>
            <form className="stack" onSubmit={createHandoff}>
              <div className="field">
                <label>Patient</label>
                <PatientPicker value={hoForm.patient} onChange={(p) => setHoForm({ ...hoForm, patient: p })} />
              </div>
              <div className="field">
                <label>To department (optional)</label>
                <select value={hoForm.toDepartmentId} onChange={(e) => setHoForm({ ...hoForm, toDepartmentId: e.target.value })}>
                  <option value="">My department</option>
                  {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Summary</label>
                <textarea rows={3} value={hoForm.summary} onChange={(e) => setHoForm({ ...hoForm, summary: e.target.value })} required />
              </div>
              <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create handoff'}</button>
            </form>
          </div>
          )}

          <div className="stack">
            <div className="card">
              <h3>{isAdmin ? 'All handoffs — view only' : 'Incoming'}</h3>
              {incomingHandoffs.length === 0 && <p className="muted">Nothing incoming.</p>}
              {incomingHandoffs.map((h) => (
                <div key={h.id} className="coord-row">
                  <div className="coord-main">
                    <Link to={`/patients/${h.patient_id}`} className="row" style={{ gap: 6 }}>
                      <span className="pno">{h.patient_no}</span>
                      <strong>{h.first_name} {h.last_name}</strong>
                    </Link>
                    <div className="psub">
                      From {h.from_department || '—'} · <StatusTag s={h.status} /> · {timeAgo(h.created_at)}
                    </div>
                    <div className="reason">“{h.summary}”</div>
                  </div>
                  <div className="coord-actions">
                    {handoffActions(h).map(([k, label, cls]) => (
                      <button key={k} className={cls} onClick={() => action(`/handoffs/${h.id}/${k}`)}>{label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <h3>Outgoing</h3>
              {outgoingHandoffs.length === 0 && <p className="muted">Nothing sent.</p>}
              {outgoingHandoffs.map((h) => (
                <div key={h.id} className="coord-row">
                  <div className="coord-main">
                    <Link to={`/patients/${h.patient_id}`} className="row" style={{ gap: 6 }}>
                      <span className="pno">{h.patient_no}</span>
                      <strong>{h.first_name} {h.last_name}</strong>
                    </Link>
                    <div className="psub">
                      To {h.to_department || '—'} · <StatusTag s={h.status} /> · {timeAgo(h.created_at)}
                    </div>
                    <div className="reason">“{h.summary}”</div>
                  </div>
                  <div className="coord-actions">
                    {handoffActions(h).map(([k, label, cls]) => (
                      <button key={k} className={cls} onClick={() => action(`/handoffs/${h.id}/${k}`)}>{label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}