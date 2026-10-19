import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function Departments() {
  const { user } = useAuth();
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({ name: '', code: '', floor: '', phone_ext: '', head: '', hours: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    api('/departments')
      .then((d) => setDepartments(d.departments))
      .catch((e) => setError(e.message));
  }, []);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api('/departments', { method: 'POST', body: JSON.stringify(form) });
      setDepartments((prev) => [...prev, data.department]);
      setForm({ name: '', code: '', floor: '', phone_ext: '', head: '', hours: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Departments</h1>
          <div className="page-sub">Directory across the hospital.</div>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        {departments.map((d) => (
          <div key={d.id} className="card department-card">
            <div>
              <span className="d-code">{d.code}</span>
              <div className="d-name">{d.name}</div>
            </div>
            {d.description && <div className="d-desc">{d.description}</div>}
            <div className="d-meta">
              {d.floor && <div>📍 {d.floor}</div>}
              {d.phone_ext && <div>☎ ext. {d.phone_ext}</div>}
              {d.head && <div>Head: {d.head}</div>}
              {d.hours && <div>Hours: {d.hours}</div>}
            </div>
          </div>
        ))}
      </div>

      {isAdmin && (
        <form className="card" onSubmit={submit}>
          <h3>Add department</h3>
          <div className="form-grid">
            <div className="field">
              <label>Name *</label>
              <input value={form.name} onChange={set('name')} required />
            </div>
            <div className="field">
              <label>Code *</label>
              <input value={form.code} onChange={set('code')} placeholder="ORTHO" required />
            </div>
            <div className="field">
              <label>Floor / location</label>
              <input value={form.floor} onChange={set('floor')} />
            </div>
            <div className="field">
              <label>Phone extension</label>
              <input value={form.phone_ext} onChange={set('phone_ext')} />
            </div>
            <div className="field">
              <label>Head</label>
              <input value={form.head} onChange={set('head')} />
            </div>
            <div className="field">
              <label>Hours</label>
              <input value={form.hours} onChange={set('hours')} />
            </div>
          </div>
          <button className="btn" style={{ marginTop: 16 }} disabled={busy}>
            {busy ? 'Adding…' : 'Add department'}
          </button>
        </form>
      )}
    </>
  );
}