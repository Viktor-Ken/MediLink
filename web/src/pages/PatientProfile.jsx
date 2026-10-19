import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import CriticalBanner from '../components/CriticalBanner.jsx';
import VitalsCard from '../components/VitalsCard.jsx';
import Code128 from '../components/Code128.jsx';
import { timeAgo, EVENT_META, eventSummary, patientView } from '../util.js';

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENDERS = ['Female', 'Male', 'Other', 'Not disclosed'];
const GENOTYPES = ['AA', 'AS', 'SS', 'AC', 'SC'];

const CONSENT_LABELS = {
  treatment: 'Care & treatment',
  data_sharing: 'Data sharing',
  research: 'Research',
  photography: 'Photography',
};

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function toCsv(v) {
  return Array.isArray(v) ? v.join(', ') : v || '';
}

export default function PatientProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const view = patientView(user?.role);
  const [patient, setPatient] = useState(null);
  const [history, setHistory] = useState([]);
  const [qr, setQr] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [events, setEvents] = useState([]);
  const [consents, setConsents] = useState({});
  const [consentBusy, setConsentBusy] = useState('');

  useEffect(() => {
    api(`/patients/${id}`)
      .then((d) => {
        setPatient(d.patient);
        setForm({ ...d.patient, allergies: toCsv(d.patient.allergies), conditions: toCsv(d.patient.conditions), medications: toCsv(d.patient.medications) });
      })
      .catch((e) => setError(e.message));
    api(`/patients/${id}/scans`)
      .then((d) => setHistory(d.scans))
      .catch(() => {});
    if (view.timeline) {
      api(`/patients/${id}/events`)
        .then((d) => setEvents(d.events))
        .catch(() => {});
    }
    if (view.consents) {
      api(`/patients/${id}/consents`)
        .then((d) => {
          const map = {};
          d.consents.forEach((c) => { map[c.kind] = c; });
          setConsents(map);
        })
        .catch(() => {});
    }
  }, [id, view.timeline, view.consents]);

  useEffect(() => {
    if (patient) {
      QRCode.toDataURL(patient.patient_no, { width: 200, margin: 1 })
        .then(setQr)
        .catch(() => {});
    }
  }, [patient]);

  if (error && !patient) {
    return <div className="alert-error">{error}</div>;
  }
  if (!patient) {
    return <div className="center-screen">Loading patient…</div>;
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setSaveBusy(true);
    setError('');
    try {
      const data = await api(`/patients/${id}`, { method: 'PUT', body: JSON.stringify(form) });
      setPatient(data.patient);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaveBusy(false);
    }
  }

  async function deletePatient() {
    if (!view.canDelete) return;
    if (!window.confirm(`Delete patient ${patient.patient_no}? This permanently removes their record and all care history.`)) return;
    setSaveBusy(true);
    setError('');
    try {
      await api(`/patients/${id}`, { method: 'DELETE' });
      nav('/');
    } catch (err) {
      setError(err.message);
      setSaveBusy(false);
    }
  }

  async function toggleConsent(kind, currentStatus) {
    setConsentBusy(kind);
    setError('');
    try {
      await api(`/patients/${id}/consents`, {
        method: 'POST',
        body: JSON.stringify({ kind, action: currentStatus === 'granted' ? 'revoke' : 'grant' }),
      });
      api(`/patients/${id}/consents`)
        .then((d) => {
          const map = {};
          d.consents.forEach((c) => { map[c.kind] = c; });
          setConsents(map);
        })
        .catch(() => {});
      api(`/patients/${id}/events`).then((d) => setEvents(d.events)).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setConsentBusy('');
    }
  }

  return (
    <div className="stack">
      <div className="page-heading">
        <div>
          <h1 className="page-title">{patient.first_name} {patient.last_name}</h1>
          <div className="page-sub">{patient.patient_no} · registered {fmtDate(patient.created_at)}</div>
        </div>
        <div className="row">
          {view.clinicalLink && <Link className="btn" to={`/patients/${id}/clinical`}>Clinical care</Link>}
          {view.message && (
            <Link className="btn" to={`/messages?patient=${patient.patient_no}`}>Message patient</Link>
          )}
          {view.canEdit && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>Edit record</button>
          )}
          {view.canDelete && !editing && (
            <button className="btn btn-ghost" style={{ color: 'var(--danger)', borderColor: 'var(--border)' }} disabled={saveBusy} onClick={deletePatient}>
              Delete patient
            </button>
          )}
          <button className="btn btn-ghost no-print" style={{ color: 'var(--primary)', borderColor: 'var(--border)' }} onClick={() => window.print()}>
            Print card
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <CriticalBanner patient={patient} role={user?.role} />

      {editing && view.canEdit ? (
        <form className="card" onSubmit={save}>
          <div className="form-grid">
            <div className="field">
              <label>First name</label>
              <input value={form.first_name || ''} onChange={set('first_name')} required />
            </div>
            <div className="field">
              <label>Last name</label>
              <input value={form.last_name || ''} onChange={set('last_name')} required />
            </div>
            <div className="field">
              <label>Date of birth</label>
              <input type="date" value={form.dob || ''} onChange={set('dob')} />
            </div>
            <div className="field">
              <label>Gender</label>
              <select value={form.gender || ''} onChange={set('gender')}>
                <option value="">Not set</option>
                {GENDERS.map((g) => <option key={g}>{g}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Blood type</label>
              <select value={form.blood_type || ''} onChange={set('blood_type')}>
                <option value="">Unknown</option>
                {BLOOD_TYPES.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Genotype</label>
              <select value={form.genotype || ''} onChange={set('genotype')}>
                <option value="">Unknown</option>
                {GENOTYPES.map((g) => <option key={g}>{g}</option>)}
              </select>
            </div>
            {view.nin && (
              <div className="field">
                <label>NIN (National ID)</label>
                <input value={form.nin || ''} onChange={set('nin')} />
              </div>
            )}
            {view.nhis && (
              <div className="field">
                <label>NHIS / HMO number</label>
                <input value={form.nhis_no || ''} onChange={set('nhis_no')} />
              </div>
            )}
            {view.allergies && (
              <div className="field">
                <label>Allergies</label>
                <input value={form.allergies || ''} onChange={set('allergies')} />
              </div>
            )}
            {view.conditions && (
              <div className="field">
                <label>Conditions</label>
                <input value={form.conditions || ''} onChange={set('conditions')} />
              </div>
            )}
            {view.medications && (
              <div className="field">
                <label>Medications</label>
                <input value={form.medications || ''} onChange={set('medications')} />
              </div>
            )}
            <div className="field">
              <label>Emergency contact</label>
              <input value={form.emergency_contact_name || ''} onChange={set('emergency_contact_name')} />
            </div>
            <div className="field">
              <label>Emergency contact phone</label>
              <input value={form.emergency_contact_phone || ''} onChange={set('emergency_contact_phone')} />
            </div>
            <div className="field">
              <label>Relationship</label>
              <input value={form.emergency_contact_relation || ''} onChange={set('emergency_contact_relation')} />
            </div>
          </div>
          {view.notes && (
            <div className="field" style={{ marginTop: 14 }}>
              <label>Notes</label>
              <textarea rows={3} value={form.notes || ''} onChange={set('notes')} />
            </div>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" disabled={saveBusy}>{saveBusy ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--primary)', borderColor: 'var(--border)' }} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-3">
          <div className="card">
            <h3>Record</h3>
            <div className="kv">
              <div>
                <div className="k">Date of birth</div>
                <div className="v">{fmtDate(patient.dob)}</div>
              </div>
              <div>
                <div className="k">Gender</div>
                <div className="v">{patient.gender || '—'}</div>
              </div>
              <div>
                <div className="k">Blood type</div>
                <div className="v">{patient.blood_type || 'Unknown'}</div>
              </div>
              <div>
                <div className="k">Genotype</div>
                <div className="v">{patient.genotype || 'Unknown'}</div>
              </div>
              {view.nin && (
                <div>
                  <div className="k">NIN</div>
                  <div className="v">{patient.nin || '—'}</div>
                </div>
              )}
              {view.nhis && (
                <div>
                  <div className="k">NHIS / HMO</div>
                  <div className="v">{patient.nhis_no || '—'}</div>
                </div>
              )}
              {view.allergies && (
                <div>
                  <div className="k">Allergies</div>
                  <div className="v">
                    {(patient.allergies || []).length
                      ? patient.allergies.map((a) => <span key={a} className="tag tag-danger">{a}</span>)
                      : <span className="muted">None</span>}
                  </div>
                </div>
              )}
              {view.conditions && (
                <div>
                  <div className="k">Conditions</div>
                  <div className="v">
                    {(patient.conditions || []).map((c) => <span key={c} className="tag">{c}</span>)}
                    {!patient.conditions?.length && <span className="muted">None</span>}
                  </div>
                </div>
              )}
              {view.medications && (
                <div>
                  <div className="k">Medications</div>
                  <div className="v">
                    {(patient.medications || []).map((m) => <span key={m} className="tag">{m}</span>)}
                    {!patient.medications?.length && <span className="muted">None</span>}
                  </div>
                </div>
              )}
              <div>
                <div className="k">Emergency contact</div>
                <div className="v">
                  {patient.emergency_contact_name || '—'}
                  {patient.emergency_contact_relation ? ` (${patient.emergency_contact_relation})` : ''}
                </div>
              </div>
              <div>
                <div className="k">Contact phone</div>
                <div className="v">{patient.emergency_contact_phone || '—'}</div>
              </div>
            </div>
            {view.notes && patient.notes && (
              <>
                <div className="k" style={{ marginTop: 14 }}>Notes</div>
                <div className="v muted" style={{ marginTop: 4 }}>{patient.notes}</div>
              </>
            )}
          </div>

          <div className="card qr-card">
            <h3>Card / bracelet codes</h3>
            {qr && <img src={qr} alt={`QR for ${patient.patient_no}`} />}
            <div className="pno" style={{ marginTop: 8 }}>{patient.patient_no}</div>
            <Code128 value={patient.patient_no} height={40} />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              QR + Code 128 · scan at any intake point to open this record instantly.
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Portal sign-in: <strong>/portal</strong> with {patient.patient_no} + the PIN given at registration.
            </div>
          </div>

          <div className="card">
            <h3>Scan history</h3>
            {history.length === 0 && <p className="muted">No scans recorded yet.</p>}
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Location</th>
                  <th>Staff</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td>{fmtDate(s.created_at)}</td>
                    <td>{s.location || '—'}</td>
                    <td>{s.staff_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!editing && view.consents && (
        <div className="card">
          <h3>Consents</h3>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {Object.entries(CONSENT_LABELS).map(([kind, label]) => {
              const c = consents[kind];
              const granted = c?.status === 'granted';
              return (
                <div key={kind} className="consent-chip" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 13.5 }}>{label}</strong>
                  <span className={`tag status-tag`} style={{ background: granted ? 'var(--success)' : undefined }}>
                    {granted ? 'granted' : 'revoked'}{c?.set_via === 'portal' ? ' · portal' : ''}
                  </span>
                  {!view.canDelete && (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={granted ? { color: 'var(--danger)', borderColor: 'var(--border)' } : { color: 'var(--primary)', borderColor: 'var(--border)' }}
                      disabled={consentBusy === kind}
                      onClick={() => toggleConsent(kind, c?.status || 'revoked')}
                    >
                      {granted ? 'Revoke' : 'Grant'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!editing && view.vitals && <VitalsCard patientId={patient.id} />}

      {!editing && view.timeline && (
        <div className="card">
          <h3>Activity timeline</h3>
          {events.length === 0 && <p className="muted">No activity recorded yet.</p>}
          <div className="timeline">
            {events.map((e) => {
              const meta = EVENT_META[e.kind] || { icon: '•', label: e.kind };
              const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
              return (
                <div key={e.id} className="tl-item">
                  <div className="tl-icon">{meta.icon}</div>
                  <div className="tl-body">
                    <div className="tl-title">
                      {meta.label}
                      <span className="muted" style={{ fontWeight: 400 }}> · {timeAgo(e.created_at)}</span>
                    </div>
                    <div className="tl-detail">{eventSummary(e.kind, data)}</div>
                    <div className="psub">
                      {e.staff_name || 'System'}{e.department_name ? ` · ${e.department_name}` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="no-print" style={{ marginTop: 4 }}>
        <Link to="/">← Back to dashboard</Link>
      </div>
    </div>
  );
}