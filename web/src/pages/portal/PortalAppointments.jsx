import { useEffect, useState } from 'react';
import { portalApi } from '../../portalApi.js';
import { fmtDateTime } from '../../util.js';

export default function PortalAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({ departmentId: '', scheduledFor: '', reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const reload = () =>
    portalApi('/portal/appointments')
      .then((d) => setAppointments(d.appointments))
      .catch((e) => setError(e.message));

  useEffect(() => {
    reload();
    portalApi('/portal/departments')
      .then((d) => setDepartments(d.departments))
      .catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await portalApi('/portal/appointments', {
        method: 'POST',
        body: JSON.stringify({
          departmentId: form.departmentId,
          scheduled_for: form.scheduledFor,
          reason: form.reason,
        }),
      });
      setNotice('Request sent — the clinic will confirm.');
      setForm({ departmentId: '', scheduledFor: '', reason: '' });
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const upcoming = appointments.filter(
    (a) => a.status === 'scheduled' || a.status === 'checked_in',
  );

  return (
    <>
      <h1 className="page-title">Appointments</h1>
      {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {notice && <div className="alert-info" style={{ marginBottom: 12 }}>{notice}</div>}

      <div className="grid grid-2">
        <div className="card">
          <h3>Request an appointment</h3>
          <form className="stack" onSubmit={submit}>
            <div className="field">
              <label>Department</label>
              <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} required>
                <option value="">Select…</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>When</label>
              <input type="datetime-local" value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} required />
            </div>
            <div className="field">
              <label>Reason</label>
              <textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="What would you like to see us about?" />
            </div>
            <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Request appointment'}</button>
          </form>
        </div>

        <div>
          <div className="card">
            <h3>Upcoming</h3>
            {upcoming.length === 0 && <p className="muted">No upcoming appointments.</p>}
            {upcoming.map((a) => (
              <div key={a.id} className="presc-row">
                <div className="presc-head">
                  <strong>{a.department_name}</strong>
                  <span className="tag status-tag">{a.status}</span>
                </div>
                <div className="psub">{fmtDateTime(a.scheduled_for)}{a.reason ? ` · ${a.reason}` : ''}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <h3>History</h3>
            {appointments.filter((a) => !upcoming.includes(a)).map((a) => (
              <div key={a.id} className="presc-row">
                <div className="presc-head">
                  <strong>{a.department_name}</strong>
                  <span className="tag status-tag">{a.status}</span>
                </div>
                <div className="psub">{fmtDateTime(a.scheduled_for)}</div>
              </div>
            ))}
            {appointments.filter((a) => !upcoming.includes(a)).length === 0 && <p className="muted">None.</p>}
          </div>
        </div>
      </div>
    </>
  );
}