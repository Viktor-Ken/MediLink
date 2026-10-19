import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { timeAgo, fmtDateTime } from '../util.js';

const STATUS_TAG = {
  scheduled: 'Scheduled', checked_in: 'Checked in', completed: 'Completed',
  cancelled: 'Cancelled', no_show: 'No show',
  active: 'Active', discharged: 'Discharged',
  ordered: 'Ordered', in_progress: 'In progress', resulted: 'Resulted',
  dispensed: 'Dispensed',
};
const ROUTES = ['oral', 'iv', 'intramuscular', 'subcutaneous', 'topical', 'inhaled'];

function Tag({ s }) {
  return <span className="tag status-tag">{STATUS_TAG[s] || s}</span>;
}

export default function Clinical() {
  const { id } = useParams();
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = role === 'admin';
  const isDoctor = role === 'doctor';
  const isNurse = role === 'nurse';
  const isLab = role === 'lab_scientist';
  const [tab, setTab] = useState('encounters');
  const [patient, setPatient] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [wards, setWards] = useState([]);
  const [visits, setVisits] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [admissions, setAdmissions] = useState([]);
  const [investigations, setInvestigations] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  // forms
  const [admForm, setAdmForm] = useState({ wardId: '', reason: '' });
  const [apptForm, setApptForm] = useState({ departmentId: '', scheduledFor: '', reason: '' });
  const [ordForm, setOrdForm] = useState({ kind: 'lab', testName: '', clinicalNote: '' });
  const [rxForm, setRxForm] = useState({ notes: '', items: [{ drugName: '', dose: '', frequency: '', route: 'oral', durationDays: '' }] });
  const [noteForm, setNoteForm] = useState(() => ({ noteType: isNurse ? 'triage' : 'progress', body: '' }));
  const [resultFor, setResultFor] = useState(null);
  const [resultText, setResultText] = useState('');

  useEffect(() => {
    api(`/patients/${id}`)
      .then((d) => setPatient(d.patient))
      .catch((e) => setError(e.message));
    api('/departments')
      .then((d) => setDepartments(d.departments))
      .catch(() => {});
    api('/wards')
      .then((d) => setWards(d.wards))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    api(`/visits?patientId=${id}`).then((d) => setVisits(d.visits)).catch(() => {});
    api(`/appointments?patientId=${id}`).then((d) => setAppointments(d.appointments)).catch(() => {});
    api(`/admissions?patientId=${id}`).then((d) => setAdmissions(d.admissions)).catch(() => {});
    api(`/investigations?patientId=${id}`).then((d) => setInvestigations(d.investigations)).catch(() => {});
    api(`/prescriptions?patientId=${id}`).then((d) => setPrescriptions(d.prescriptions)).catch(() => {});
    api(`/notes?patientId=${id}`).then((d) => setNotes(d.notes)).catch(() => {});
  }, [id, refresh]);

  const activeAdmission = useMemo(() => admissions.find((a) => a.status === 'active'), [admissions]);
  const gone = () => {
    setRefresh((n) => n + 1);
  };

  async function act(url, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      await api(url, { method });
      setResultFor(null);
      setResultText('');
      gone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(path, body, reset) {
    setBusy(true);
    setError('');
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      reset?.();
      gone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function setItem(i, key, value) {
    const items = rxForm.items.slice();
    items[i] = { ...items[i], [key]: value };
    setRxForm({ ...rxForm, items });
  }

  if (!patient) {
    return <div className="center-screen">Loading patient…</div>;
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Clinical care — {patient.first_name} {patient.last_name}</h1>
          <div className="page-sub">
            <Link to={`/patients/${id}`}>{patient.patient_no}</Link>
            {activeAdmission && (
              <span> · admitted {timeAgo(activeAdmission.admitted_at)} · {activeAdmission.ward_name} bed {activeAdmission.bed_label}</span>
            )}
          </div>
        </div>
        <Link className="btn btn-ghost no-print" style={{ color: 'var(--primary)', borderColor: 'var(--border)' }} to={`/patients/${id}`}>
          ← Patient record
        </Link>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="tabs">
        <button className={`tab${tab === 'encounters' ? ' active' : ''}`} onClick={() => setTab('encounters')}>Encounters</button>
        <button className={`tab${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}>Orders &amp; Results</button>
        <button className={`tab${tab === 'meds' ? ' active' : ''}`} onClick={() => setTab('meds')}>Medications</button>
        <button className={`tab${tab === 'notes' ? ' active' : ''}`} onClick={() => setTab('notes')}>Clinical Notes</button>
      </div>

      {tab === 'encounters' && (
        <div className="grid grid-2">
          <div className="card">
            <h3>Admission status</h3>
            {activeAdmission ? (
              <div className="coord-row">
                <div className="coord-main">
                  <div className="task-title">Bed {activeAdmission.bed_label} · {activeAdmission.ward_name}</div>
                  <div className="psub">Admitted {timeAgo(activeAdmission.admitted_at)} by {activeAdmission.admitted_by_name}</div>
                  {activeAdmission.reason && <div className="reason">“{activeAdmission.reason}”</div>}
                </div>
                {isDoctor && <button className="btn" onClick={() => act(`/admissions/${activeAdmission.id}/discharge`)} disabled={busy}>Discharge</button>}
              </div>
            ) : (
              !isLab && !isAdmin && (
                <form className="stack" onSubmit={(e) => { e.preventDefault(); submit('/admissions', { patientId: id, wardId: admForm.wardId || undefined, reason: admForm.reason }, () => setAdmForm({ wardId: '', reason: '' })); }}>
                  <p className="muted" style={{ marginTop: 0 }}>Not currently admitted. Pick a ward and an available bed is assigned automatically.</p>
                  <div className="field">
                    <label>Ward</label>
                    <select value={admForm.wardId} onChange={(e) => setAdmForm({ ...admForm, wardId: e.target.value })}>
                      <option value="">First available bed</option>
                      {wards.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Reason for admission</label>
                    <input value={admForm.reason} onChange={(e) => setAdmForm({ ...admForm, reason: e.target.value })} />
                  </div>
                  <button className="btn" disabled={busy}>Admit patient</button>
                </form>
              )
            )}
          </div>

          {!isLab && !isAdmin && (
            <div className="card">
              <h3>Schedule appointment</h3>
              <form className="stack" onSubmit={(e) => { e.preventDefault(); submit('/appointments', { patientId: id, departmentId: apptForm.departmentId, scheduledFor: apptForm.scheduledFor, reason: apptForm.reason }, () => setApptForm({ departmentId: '', scheduledFor: '', reason: '' })); }}>
                <div className="field">
                  <label>Department</label>
                  <select value={apptForm.departmentId} onChange={(e) => setApptForm({ ...apptForm, departmentId: e.target.value })} required>
                    <option value="">Select…</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>When</label>
                  <input type="datetime-local" value={apptForm.scheduledFor} onChange={(e) => setApptForm({ ...apptForm, scheduledFor: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Reason</label>
                  <input value={apptForm.reason} onChange={(e) => setApptForm({ ...apptForm, reason: e.target.value })} />
                </div>
                <button className="btn" disabled={busy}>Schedule</button>
              </form>
            </div>
          )}

          <div className="card">
            <h3>Appointments</h3>
            {appointments.length === 0 && <p className="muted">No appointments.</p>}
            {appointments.slice(0, 6).map((a) => (
              <div key={a.id} className="coord-row">
                <div className="coord-main">
                  <div className="task-title">{fmtDateTime(a.scheduled_for)}</div>
                  <div className="psub">{a.department_name}{a.reason ? ` — ${a.reason}` : ''}{a.assigned_staff ? ` · ${a.assigned_staff}` : ''}</div>
                </div>
                <div className="coord-actions">
                  <Tag s={a.status} />
                  {!isAdmin && a.status === 'scheduled' && (
                    <button className="btn" style={{ padding: '4px 10px' }} onClick={() => act(`/appointments/${a.id}/check_in`)}>Check in</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Visits &amp; admissions</h3>
            {visits.length === 0 && <p className="muted">No visits recorded.</p>}
            {visits.slice(0, 6).map((v) => (
              <div key={v.id} className="coord-row">
                <div className="coord-main">
                  <div className="task-title">{v.visit_type === 'admission' ? 'Admission' : 'Outpatient visit'}</div>
                  <div className="psub">{v.department_name || '—'} · started {timeAgo(v.started_at)}</div>
                  {v.reason && <div className="reason">“{v.reason}”</div>}
                </div>
                <Tag s={v.status} />
              </div>
            ))}
            <div className="admission-history">
              {admissions.slice(0, 4).map((a) => (
                <div key={a.id} className="psub">
                  {a.status === 'discharged' ? 'Discharged' : 'Admitted'} · {a.ward_name || '—'} · {timeAgo(a.admitted_at)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'orders' && (
        <div className="grid grid-2">
          {isDoctor && (
            <div className="card">
              <h3>New order</h3>
              <form className="stack" onSubmit={(e) => { e.preventDefault(); submit('/investigations', { patientId: id, ...ordForm }, () => setOrdForm({ kind: 'lab', testName: '', clinicalNote: '' })); }}>
                <div className="form-grid">
                  <div className="field">
                    <label>Type</label>
                    <select value={ordForm.kind} onChange={(e) => setOrdForm({ ...ordForm, kind: e.target.value })}>
                      <option value="lab">Lab</option>
                      <option value="radiology">Radiology</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Test / study</label>
                    <input value={ordForm.testName} onChange={(e) => setOrdForm({ ...ordForm, testName: e.target.value })} placeholder={ordForm.kind === 'radiology' ? 'e.g. Chest X-ray' : 'e.g. Full Blood Count'} required />
                  </div>
                </div>
                <div className="field">
                  <label>Clinical note (optional)</label>
                  <input value={ordForm.clinicalNote} onChange={(e) => setOrdForm({ ...ordForm, clinicalNote: e.target.value })} />
                </div>
                <button className="btn" disabled={busy}>Order {ordForm.kind === 'radiology' ? 'study' : 'test'}</button>
              </form>
            </div>
          )}

          <div className="card">
            <h3>Orders</h3>
            {investigations.length === 0 && <p className="muted">No orders yet.</p>}
            {investigations.map((o) => (
              <div key={o.id} className="coord-row">
                <div className="coord-main">
                  <div className="task-title">
                    <span className={`kind-tag kind-${o.kind}`}>{o.kind}</span> {o.test_name}
                  </div>
                  <div className="psub">{o.department_name || ''}{o.ordered_by_name ? ` by ${o.ordered_by_name}` : ''} · {timeAgo(o.created_at)}</div>
                  {o.clinical_note && <div className="reason">“{o.clinical_note}”</div>}
                  {o.status === 'resulted' && (
                    <div className="result-box">
                      {o.result_json?.text || 'Result available'}
                      {o.resulted_by_name && <div className="psub">resulted by {o.resulted_by_name} · {timeAgo(o.resulted_at)}</div>}
                    </div>
                  )}
                  {(o.status === 'in_progress' || o.status === 'ordered') && (isDoctor || (isLab && o.kind === 'lab')) && (
                    <div className="coord-actions row" style={{ marginTop: 6, gap: 6 }}>
                      <button className="btn" style={{ padding: '4px 10px' }} onClick={() => { setResultFor(o); setResultText(''); }}>Enter result</button>
                      {isDoctor && <button className="btn btn-ghost" style={{ color: 'var(--danger)', borderColor: 'var(--border)', padding: '4px 10px' }} onClick={() => act(`/investigations/${o.id}/cancel`)}>Cancel</button>}
                    </div>
                  )}
                </div>
                <Tag s={o.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'meds' && (
        <div className="grid grid-2">
          {isDoctor && (
            <div className="card">
              <h3>Prescribe</h3>
              <form className="stack" onSubmit={(e) => {
                e.preventDefault();
                submit('/prescriptions', { patientId: id, notes: rxForm.notes, items: rxForm.items.map((i) => ({ ...i, durationDays: i.durationDays })) }, () => setRxForm({ notes: '', items: [{ drugName: '', dose: '', frequency: '', route: 'oral', durationDays: '' }] }));
              }}>
                <div className="field">
                  <label>Notes</label>
                  <input value={rxForm.notes} onChange={(e) => setRxForm({ ...rxForm, notes: e.target.value })} placeholder="e.g. for glucose control" />
                </div>
                {rxForm.items.map((item, i) => (
                  <div key={i} className="rx-row">
                    <div className="field">
                      <label>Drug</label>
                      <input value={item.drugName} onChange={(e) => setItem(i, 'drugName', e.target.value)} placeholder="Drug name" required />
                    </div>
                    <div className="field"><label>Dose</label><input value={item.dose} onChange={(e) => setItem(i, 'dose', e.target.value)} placeholder="e.g. 10mg" /></div>
                    <div className="field"><label>Frequency</label><input value={item.frequency} onChange={(e) => setItem(i, 'frequency', e.target.value)} placeholder="e.g. twice daily" /></div>
                    <div className="field">
                      <label>Route</label>
                      <select value={item.route} onChange={(e) => setItem(i, 'route', e.target.value)}>
                        {ROUTES.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="field"><label>Days</label><input type="number" min="0" value={item.durationDays} onChange={(e) => setItem(i, 'durationDays', e.target.value)} /></div>
                  </div>
                ))}
                <div className="row">
                  <button type="button" className="btn btn-ghost" style={{ color: 'var(--primary)', borderColor: 'var(--border)' }} onClick={() => setRxForm({ ...rxForm, items: [...rxForm.items, { drugName: '', dose: '', frequency: '', route: 'oral', durationDays: '' }] })}>+ Add item</button>
                  <button className="btn" disabled={busy}>Prescribe</button>
                </div>
              </form>
            </div>
          )}

          <div className="card">
            <h3>Prescriptions</h3>
            {prescriptions.length === 0 && <p className="muted">No prescriptions.</p>}
            {prescriptions.map((p) => (
              <div key={p.id} className="presc-row">
                <div className="presc-head">
                  <span className="task-title">{p.items.map((i) => i.drug_name).join(', ')}</span>
                  <Tag s={p.status} />
                </div>
                {p.items.map((i) => (
                  <div key={i.id} className="psub">
                    {i.dose || '—'} {i.route} {i.frequency && `· ${i.frequency}`} {i.duration_days ? `· ${i.duration_days}d` : ''}
                  </div>
                ))}
                <div className="psub">by {p.prescribed_by_name} · {timeAgo(p.created_at)}</div>
                {p.status === 'active' && isDoctor && (
                  <div className="row" style={{ marginTop: 6, gap: 6 }}>
                    <button className="btn btn-ghost" style={{ color: 'var(--danger)', borderColor: 'var(--border)', padding: '4px 10px' }} onClick={() => act(`/prescriptions/${p.id}/cancel`)}>Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'notes' && (
        <div className="grid grid-2">
          {!isLab && !isAdmin && (
            <div className="card">
              <h3>Add note</h3>
              <form className="stack" onSubmit={(e) => { e.preventDefault(); submit('/notes', { patientId: id, noteType: noteForm.noteType, body: noteForm.body }, () => setNoteForm({ noteType: isNurse ? 'triage' : 'progress', body: '' })); }}>
                <div className="field">
                  <label>Note type</label>
                  <select value={noteForm.noteType} onChange={(e) => setNoteForm({ ...noteForm, noteType: e.target.value })}>
                    {isNurse
                      ? <option value="triage">Triage</option>
                      : (
                        <>
                          <option value="triage">Triage</option>
                          <option value="progress">Progress</option>
                          <option value="consult">Consult</option>
                          <option value="discharge_summary">Discharge summary</option>
                        </>
                      )}
                  </select>
                </div>
                <div className="field">
                  <label>Note</label>
                  <textarea rows={6} value={noteForm.body} onChange={(e) => setNoteForm({ ...noteForm, body: e.target.value })} required />
                </div>
                <button className="btn" disabled={busy}>Save note</button>
              </form>
            </div>
          )}

          <div className="card">
            <h3>Notes</h3>
            {notes.length === 0 && <p className="muted">No notes yet.</p>}
            {notes.map((n) => (
              <div key={n.id} className="note-card">
                <div className="note-head">
                  <Tag s={n.note_type} />
                  <span className="psub">{n.staff_name} · {timeAgo(n.created_at)}</span>
                </div>
                <div className="note-body">{n.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {resultFor && (
        <div className="modal-backdrop" onClick={() => setResultFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Result — {resultFor.kind} {resultFor.test_name}</h3>
            <div className="field">
              <label>Result</label>
              <textarea rows={4} value={resultText} onChange={(e) => setResultText(e.target.value)} autoFocus />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" style={{ color: 'var(--primary)', borderColor: 'var(--border)' }} onClick={() => setResultFor(null)}>Cancel</button>
              <button className="btn" onClick={() => act(`/investigations/${resultFor.id}/result`, 'POST')} disabled={busy || !resultText.trim()}>Save result</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}